import type { AtlasBuffer } from './renderer/FrameDecoder'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadPetAtlas } from './pets'
import { PetWindow } from './renderer/PetWindow'
import type { WindowBackend } from './renderer/backend/WindowBackend'
import { selectBackend } from './renderer/backend/selectBackend'
import { acquireInstanceLock, HostStorage, type HostState, type InstanceLock } from './host/persistence'
import { HookEventServer } from './host/hook-server'
import { DEFAULT_HOOK_PIPE } from './integration/hooks-transport'
import { normalizeHookEvent } from './integration/hooks'
import type { SemanticState } from './core/types'

export type CodexFeedbackState = 'STARTING' | 'THINKING' | 'WORKING' | 'POSSIBLY_WAITING' | 'UNKNOWN' | 'INTERRUPTED' | 'ENDED'
// shortcut: neutral poses share idle sprites; expose distinct labels when the host gains a status indicator.
const FEEDBACK_POSE: Record<CodexFeedbackState, SemanticState> = {
  STARTING: 'STARTING', THINKING: 'THINKING', WORKING: 'WORKING',
  POSSIBLY_WAITING: 'WAITING_FOR_USER', UNKNOWN: 'IDLE', INTERRUPTED: 'IDLE', ENDED: 'IDLE',
}

export interface DesktopPetHostOptions {
  backend?: WindowBackend | null
  storage?: HostStorage
  /** Test seam; production loads the bundled licensed text pet. */
  atlas?: AtlasBuffer
  /** Override the hook pipe for tests; null disables the pipe. */
  hookPipePath?: string | null
}
/** Standalone Windows host for the bundled text pet and one bound Codex session. */
export class DesktopPetHost {
  private readonly storage: HostStorage
  private readonly backend: WindowBackend | null | undefined
  private readonly atlas: AtlasBuffer | undefined
  private state: HostState
  private lock: InstanceLock | undefined
  private window: PetWindow | undefined
  private feedback: CodexFeedbackState = 'UNKNOWN'
  private latestTimestamp = -1
  private staleTimer: ReturnType<typeof setTimeout> | undefined
  private readonly hookPipePath: string | null
  private hookServer: HookEventServer | undefined
  private boundSessionId: string | undefined
  private started = false

  private readonly onSignal = (): void => { void this.stop() }
  private readonly onExit = (): void => {
    this.window?.destroy()
    this.lock?.release()
  }

  constructor(options: DesktopPetHostOptions = {}) {
    this.storage = options.storage ?? new HostStorage()
    this.backend = options.backend
    this.atlas = options.atlas
    this.hookPipePath = options.hookPipePath === undefined
      ? (process.platform === 'win32' ? DEFAULT_HOOK_PIPE : null)
      : options.hookPipePath
    this.state = this.storage.load()
  }

  get currentPose() {
    return this.window?.currentPose
  }

  get currentSemanticState() {
    return this.feedback
  }

  async start(): Promise<void> {
    if (this.started) return
    this.lock = acquireInstanceLock(this.storage.lockPath)
    try {
      // Listen before atlas/native initialization so the first cold-start event is retained.
      if (this.hookPipePath !== null) {
        this.hookServer = new HookEventServer({ pipePath: this.hookPipePath, onEvent: event => this.acceptHookEvent(event) })
        await this.hookServer.start()
      }
      const backend = this.backend === undefined ? selectBackend() : this.backend
      if (!backend) throw new Error(`no supported desktop pet window backend on ${process.platform}`)
      const atlas = this.atlas ?? await loadPetAtlas('text')
      let petWindow: PetWindow | undefined
      petWindow = new PetWindow({
        backend,
        atlas,
        scale: this.state.scale,
        alwaysOnTop: true,
        animationEnabled: true,
        idleFrequencySec: 20,
        position: this.state.position,
        onDrag: (x, y) => {
          this.state.position = { x, y }
          this.storage.save(this.state)
        },
        onHover: () => petWindow?.playJump(),
        onUnhover: () => petWindow?.endHover(),
        onClose: () => petWindow?.hide(),
      })
      await petWindow.open()
      this.window = petWindow
      petWindow.setState(FEEDBACK_POSE[this.feedback])
      this.started = true
      process.once('SIGINT', this.onSignal)
      process.once('SIGTERM', this.onSignal)
      process.once('exit', this.onExit)
    } catch (error) {
      clearTimeout(this.staleTimer)
      await this.hookServer?.stop().catch(() => {})
      this.hookServer = undefined
      await this.window?.destroy()
      this.window = undefined
      this.lock.release()
      this.lock = undefined
      throw error
    }
  }

  async setScale(value: number): Promise<void> {
    if (!this.started || !this.window) throw new Error('desktop pet host is not running')
    if (!Number.isFinite(value) || value < 0.5 || value > 4) throw new Error('scale must be between 0.5 and 4')
    const scale = Math.round(value * 4) / 4
    await this.window.setScale(scale)
    this.state.scale = scale
    this.storage.save(this.state)
  }

  async stop(): Promise<void> {
    if (!this.started && !this.lock) return
    process.removeListener('SIGINT', this.onSignal)
    process.removeListener('SIGTERM', this.onSignal)
    process.removeListener('exit', this.onExit)
    this.started = false
    clearTimeout(this.staleTimer)
    const window = this.window
    this.window = undefined
    try { await window?.destroy() } finally {
      await this.hookServer?.stop().catch(() => {})
      this.hookServer = undefined
      this.lock?.release()
      this.lock = undefined
    }
  }

  /** Accept a validated hook event for the first session only. */
  acceptHookEvent(input: unknown): void {
    if (!this.lock) return
    const event = normalizeHookEvent(input)
    if (!event) return
    if (this.boundSessionId === undefined) this.boundSessionId = event.sessionId
    if (event.sessionId !== this.boundSessionId) return
    if (event.timestamp < this.latestTimestamp || this.feedback === 'ENDED') return
    this.latestTimestamp = event.timestamp
    clearTimeout(this.staleTimer)
    switch (event.eventType) {
      case 'SessionStart': this.feedback = 'STARTING'; break
      case 'UserPromptSubmit': this.feedback = 'THINKING'; break
      case 'PreToolUse': this.feedback = 'WORKING'; break
      case 'PostToolUse': this.feedback = 'WORKING'; break
      case 'PermissionRequest': this.feedback = 'POSSIBLY_WAITING'; break
      case 'Stop': this.feedback = 'UNKNOWN'; break
      case 'Interrupt': this.feedback = 'INTERRUPTED'; break
      case 'SessionEnd': this.feedback = 'ENDED'; break
    }
    this.window?.setState(FEEDBACK_POSE[this.feedback])
    if (this.feedback !== 'ENDED') {
      this.staleTimer = setTimeout(() => {
        this.feedback = 'UNKNOWN'
        this.window?.setState(FEEDBACK_POSE.UNKNOWN)
      }, 30_000)
    }
  }
}
/** Start the production host; the native window timers keep the process alive. */
export async function runDesktopPetHost(options: DesktopPetHostOptions = {}): Promise<DesktopPetHost> {
  const pipeIndex = process.argv.indexOf('--hook-pipe')
  const hookPipePath = options.hookPipePath !== undefined ? options.hookPipePath : (pipeIndex >= 0 ? process.argv[pipeIndex + 1] : undefined)
  const host = new DesktopPetHost({ ...options, hookPipePath })
  await host.start()
  return host
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  runDesktopPetHost().catch(error => {
    console.error(`[codex-dsh-pet] failed to start: ${(error as Error).message}`)
    process.exitCode = 1
  })
}

