import type { AtlasBuffer } from './renderer/FrameDecoder'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadPetAtlas } from './pets'
import { PetWindow } from './renderer/PetWindow'
import type { WindowBackend } from './renderer/backend/WindowBackend'
import { selectBackend } from './renderer/backend/selectBackend'
import { acquireInstanceLock, HostStorage, type HostState, type InstanceLock } from './host/persistence'

export interface DesktopPetHostOptions {
  backend?: WindowBackend | null
  storage?: HostStorage
  /** Test seam; production loads the bundled licensed text pet. */
  atlas?: AtlasBuffer
}
/** Standalone Windows host for the bundled text pet. Hooks and session binding are intentionally absent. */
export class DesktopPetHost {
  private readonly storage: HostStorage
  private readonly backend: WindowBackend | null | undefined
  private readonly atlas: AtlasBuffer | undefined
  private state: HostState
  private lock: InstanceLock | undefined
  private window: PetWindow | undefined
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
    this.state = this.storage.load()
  }

  get currentPose() {
    return this.window?.currentPose
  }

  async start(): Promise<void> {
    if (this.started) return
    this.lock = acquireInstanceLock(this.storage.lockPath)
    try {
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
      this.started = true
      process.once('SIGINT', this.onSignal)
      process.once('SIGTERM', this.onSignal)
      process.once('exit', this.onExit)
    } catch (error) {
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
    const window = this.window
    this.window = undefined
    try { await window?.destroy() } finally {
      this.lock?.release()
      this.lock = undefined
    }
  }
}
/** Start the production host; the native window timers keep the process alive. */
export async function runDesktopPetHost(): Promise<DesktopPetHost> {
  const host = new DesktopPetHost()
  await host.start()
  return host
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  runDesktopPetHost().catch(error => {
    console.error(`[codex-dsh-pet] failed to start: ${(error as Error).message}`)
    process.exitCode = 1
  })
}

