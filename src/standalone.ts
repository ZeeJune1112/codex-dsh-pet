import type { AtlasBuffer } from './renderer/FrameDecoder'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readFileSync } from 'node:fs'
import { loadPetAtlas } from './pets'
import { PetWindow } from './renderer/PetWindow'
import type { WindowBackend } from './renderer/backend/WindowBackend'
import { selectBackend } from './renderer/backend/selectBackend'
import { acquireInstanceLock, defaultPetInstance, HostStorage, BOOLEAN_PREFERENCES, NUMBER_PREFERENCES, type HostState, type PetInstanceSettings, type InstanceLock } from './host/persistence'
import { HookEventServer } from './host/hook-server'
import { DEFAULT_HOOK_PIPE } from './integration/hooks-transport'
import { normalizeHookEvent, type NormalizedHookEvent } from './integration/hooks'
import type { CodexPetState, SemanticState } from './core/types'
import { ManagementServer } from './management/server'

export type CodexFeedbackState = 'IDLE' | 'STARTING' | 'THINKING' | 'WORKING' | 'POSSIBLY_WAITING' | 'UNKNOWN' | 'INTERRUPTED' | 'ENDED'
// shortcut: the sprite contract has no unknown/interrupted poses; management must display the separate feedback label.
const FEEDBACK_POSE: Record<CodexFeedbackState, SemanticState> = {
  IDLE: 'IDLE', STARTING: 'STARTING', THINKING: 'THINKING', WORKING: 'WORKING',
  POSSIBLY_WAITING: 'WAITING_FOR_USER', UNKNOWN: 'IDLE', INTERRUPTED: 'IDLE', ENDED: 'IDLE',
}
const EVENT_FEEDBACK: Record<NormalizedHookEvent['eventType'], CodexFeedbackState> = {
  SessionStart: 'STARTING', UserPromptSubmit: 'THINKING', PreToolUse: 'WORKING', PostToolUse: 'WORKING',
  PermissionRequest: 'POSSIBLY_WAITING', Stop: 'UNKNOWN', Interrupt: 'INTERRUPTED', SessionEnd: 'ENDED',
}

export interface PetInstanceSnapshot extends PetInstanceSettings {
  feedback: CodexFeedbackState
  availability: 'unbound' | 'unobserved' | 'observed' | 'stale' | 'unavailable'
  stale: boolean
  sleeping: boolean
  lastEventAt?: number
  lastEventType?: NormalizedHookEvent['eventType']
  pose?: CodexPetState
}
export type InstancePatch = Partial<Omit<PetInstanceSettings, 'id' | 'sessionId' | 'position'>>
interface PetInstance {
  settings: PetInstanceSettings
  feedback: CodexFeedbackState
  window?: PetWindow
  opening?: Promise<void>
  updating?: Promise<void>
  latestTimestamp: number
  turnId?: string
  turnHasActivity: boolean
  lastEventTurnId?: string
  completedTurns: Set<string>
  ended: boolean
  lastEvidenceAt?: number
  stale: boolean
  staleTimer?: ReturnType<typeof setTimeout>
  idleSince?: number
  sleepTimer?: ReturnType<typeof setTimeout>
  sleeping: boolean
  lastEventAt?: number
  lastEventType?: NormalizedHookEvent['eventType']
}
export interface DesktopPetHostOptions {
  backend?: WindowBackend | null
  storage?: HostStorage
  /** Test seam; production loads roles from the downstream data directory. */
  atlas?: AtlasBuffer
  /** Override the hook pipe for tests; null disables the pipe. */
  hookPipePath?: string | null
  /** Clock seam; stale age is based on host observation time, not the sender's clock. */
  now?: () => number
}
/** One desktop host, with independent windows and settings for each bound session. */
export class DesktopPetHost {
  private readonly storage: HostStorage
  private backend: WindowBackend | null | undefined
  private readonly atlas: AtlasBuffer | undefined
  private readonly instances = new Map<string, PetInstance>()
  private lock: InstanceLock | undefined
  private readonly hookPipePath: string | null
  private hookServer: HookEventServer | undefined
  private started = false
  private rendering = false
  private readonly now: () => number
  private metadata: Pick<HostState, 'selectedInstanceId' | 'migrationCompleted'> = {}
  private management: ManagementServer | undefined

  private readonly onSignal = (): void => { void this.stop() }
  private readonly onExit = (): void => {
    for (const pet of this.instances.values()) void pet.window?.destroy()
    this.lock?.release()
  }

  constructor(options: DesktopPetHostOptions = {}) {
    this.storage = options.storage ?? new HostStorage()
    this.backend = options.backend
    this.atlas = options.atlas
    this.now = options.now ?? Date.now
    this.hookPipePath = options.hookPipePath === undefined
      ? (process.platform === 'win32' ? DEFAULT_HOOK_PIPE : null)
      : options.hookPipePath
    this.restore()
  }

  private restore(): void {
    const { instances, version: _version, ...metadata } = this.storage.load()
    this.metadata = metadata
    this.instances.clear()
    for (const settings of instances) this.instances.set(settings.id, this.newInstance(settings))
  }

  private newInstance(settings: PetInstanceSettings): PetInstance {
    return { settings, feedback: settings.sessionId === undefined ? 'IDLE' : 'UNKNOWN', latestTimestamp: -1,
      completedTurns: new Set(), ended: false, stale: false, turnId: undefined, turnHasActivity: false, lastEventTurnId: undefined,
      lastEventAt: undefined, lastEventType: undefined, lastEvidenceAt: undefined, staleTimer: undefined,
      idleSince: settings.sessionId === undefined ? this.now() : undefined, sleepTimer: undefined, sleeping: false }
  }

  /** Immutable public view for management; observations never enter persisted settings. */
  getSnapshot(): PetInstanceSnapshot[] {
    return Array.from(this.instances.values(), pet => {
      this.refreshStale(pet)
      this.refreshSleep(pet)
      return {
        ...pet.settings, position: { ...pet.settings.position }, feedback: pet.feedback, stale: pet.stale, sleeping: pet.sleeping,
        availability: pet.settings.sessionId === undefined ? 'unbound' : !this.lock ? 'unavailable'
          : pet.lastEventAt === undefined ? 'unobserved' : pet.stale ? 'stale' : 'observed',
        lastEventAt: pet.lastEventAt, lastEventType: pet.lastEventType, pose: pet.window?.currentPose,
      }
    })
  }

  private refreshStale(pet: PetInstance): void {
    if (pet.lastEvidenceAt === undefined || pet.ended || pet.feedback === 'INTERRUPTED') return
    const timeout = pet.feedback === 'POSSIBLY_WAITING' ? 300_000 : 30_000
    if (this.now() - pet.lastEvidenceAt < timeout) return
    pet.stale = true
    if (pet.feedback !== 'POSSIBLY_WAITING') {
      pet.feedback = 'UNKNOWN'
      pet.window?.setState(FEEDBACK_POSE.UNKNOWN)
    }
  }

  get dataDirectory(): string { return this.storage.directory }
  get managementSettings() { return { ...this.metadata } }
  get managementUrl(): string | undefined { return this.management?.url }
  async startManagement(): Promise<string> {
    if (!this.started) throw new Error('desktop pet host is not running')
    if (!this.management) {
      const management = new ManagementServer(this, { onQuit: () => this.stop() })
      await management.start()
      this.management = management
    }
    return this.management.url
  }

  get currentPose() { return this.getSnapshot()[0]?.pose }
  get currentSemanticState() { return this.getSnapshot()[0]?.feedback }

  private persist(): void {
    this.storage.save({ version: 2, ...this.metadata, instances: Array.from(this.instances.values(), pet => pet.settings) })
  }

  private saveSettings(settings: PetInstanceSettings): void {
    const instances = Array.from(this.instances.values(), pet => pet.settings.id === settings.id ? settings : pet.settings)
    if (!this.instances.has(settings.id)) instances.push(settings)
    this.storage.save({ version: 2, ...this.metadata, instances })
  }

  selectInstance(id: string): void {
    this.requireInstance(id)
    this.storage.save({ version: 2, ...this.metadata, selectedInstanceId: id, instances: Array.from(this.instances.values(), pet => pet.settings) })
    this.metadata.selectedInstanceId = id
  }

  reorderInstances(order: string[]): void {
    const expected = new Set(this.instances.keys())
    if (order.length !== expected.size || order.some(id => !expected.delete(id))) throw new Error('order must contain every instance exactly once')
    const pets = order.map(id => this.requireInstance(id))
    this.storage.save({ version: 2, ...this.metadata, instances: pets.map(pet => pet.settings) })
    this.instances.clear()
    for (const pet of pets) this.instances.set(pet.settings.id, pet)
  }

  /** Validate/render additions before publishing settings; never replaces existing bindings. */
  async addInstances(settings: PetInstanceSettings[], options: { migration?: boolean; selectedId?: string } = {}): Promise<void> {
    if (!this.started) throw new Error('desktop pet host is not running')
    if (settings.some(pet => this.instances.has(pet.id)) || new Set(settings.map(pet => pet.id)).size !== settings.length) throw new Error('duplicate instance')
    const additions = settings.map(value => this.newInstance(value))
    try {
      for (const pet of additions) await this.openWindow(pet)
      const metadata = { ...this.metadata,
        ...(options.migration ? { migrationCompleted: true } : {}),
        ...(options.selectedId ? { selectedInstanceId: options.selectedId } : {}) }
      this.storage.save({ version: 2, ...metadata, instances: [...Array.from(this.instances.values(), pet => pet.settings), ...settings] })
      this.metadata = metadata
      for (const pet of additions) this.instances.set(pet.settings.id, pet)
    } catch (error) {
      for (const pet of additions) { clearTimeout(pet.sleepTimer); await pet.window?.destroy() }
      throw error
    }
  }

  private applyPresentation(pet: PetInstance): void {
    this.refreshSleep(pet)
    pet.window?.setState(pet.sleeping ? 'SLEEPING' : FEEDBACK_POSE[pet.feedback])
    pet.window?.setVisible(pet.settings.visible && !(pet.settings.hideWhenIdle && pet.sleeping))
  }

  private refreshSleep(pet: PetInstance): void {
    const sleeping = pet.idleSince !== undefined && ((pet.feedback === 'IDLE' && Boolean(pet.settings.startSleeping)) || this.now() - pet.idleSince >= 60_000)
    if (pet.sleeping === sleeping) return
    pet.sleeping = sleeping
    pet.window?.setState(sleeping ? 'SLEEPING' : FEEDBACK_POSE[pet.feedback])
    pet.window?.setVisible(pet.settings.visible && !(pet.settings.hideWhenIdle && sleeping))
  }

  private scheduleSleep(pet: PetInstance): void {
    clearTimeout(pet.sleepTimer)
    if (pet.idleSince === undefined) return
    pet.sleepTimer = setTimeout(() => this.refreshSleep(pet), Math.max(0, 60_000 - (this.now() - pet.idleSince)))
    pet.sleepTimer.unref()
  }

  private requireInstance(instanceId: string): PetInstance {
    if (!this.started) throw new Error('desktop pet host is not running')
    const pet = this.instances.get(instanceId)
    if (!pet) throw new Error('unknown pet instance')
    return pet
  }

  /** Explicit management operation. null unbinds; focus never changes bindings. */
  bindInstance(instanceId: string, sessionId: string | null): void {
    const pet = this.requireInstance(instanceId)
    if (sessionId !== null && (typeof sessionId !== 'string' || !sessionId || sessionId.trim() !== sessionId || sessionId.length > 256)) throw new Error('invalid session binding')
    if (sessionId !== null && Array.from(this.instances.values()).some(other => other !== pet && other.settings.sessionId === sessionId)) {
      throw new Error('session is already bound to another instance')
    }
    if (pet.settings.sessionId === (sessionId ?? undefined)) return
    const settings = { ...pet.settings, sessionId: sessionId ?? undefined }
    this.saveSettings(settings)
    clearTimeout(pet.staleTimer)
    clearTimeout(pet.sleepTimer)
    Object.assign(pet, this.newInstance(settings))
    this.scheduleSleep(pet)
    this.applyPresentation(pet)
  }

  /** Update only this instance, even when another instance uses the same role. */
  async updateInstance(instanceId: string, patch: InstancePatch): Promise<void> {
    const pet = this.requireInstance(instanceId)
    const apply = () => this.applyInstanceUpdate(pet, patch)
    pet.updating = (pet.updating ?? Promise.resolve()).then(apply, apply)
    await pet.updating
  }

  private async applyInstanceUpdate(pet: PetInstance, patch: InstancePatch): Promise<void> {
    if (!this.started) throw new Error('desktop pet host is not running')
    const settings = { ...pet.settings }
    if (!patch || Array.isArray(patch) || Object.keys(patch).some(key => !['roleId', 'scale', 'visible', ...BOOLEAN_PREFERENCES, ...Object.keys(NUMBER_PREFERENCES)].includes(key))) throw new Error('invalid instance settings')
    for (const key of BOOLEAN_PREFERENCES) {
      if (patch[key] !== undefined) {
        if (typeof patch[key] !== 'boolean') throw new Error(`invalid ${key}`)
        settings[key] = patch[key]
      }
    }
    for (const key of Object.keys(NUMBER_PREFERENCES) as Array<keyof typeof NUMBER_PREFERENCES>) {
      const value = patch[key]
      if (value !== undefined) {
        const [min, max] = NUMBER_PREFERENCES[key]
        if (!Number.isFinite(value) || value < min || value > max) throw new Error(`invalid ${key}`)
        settings[key] = value
      }
    }
    if (patch.scale !== undefined) {
      if (!Number.isFinite(patch.scale) || patch.scale < 0.5 || patch.scale > 4) throw new Error('scale must be between 0.5 and 4')
      settings.scale = Math.round(patch.scale * 4) / 4
    }
    if (patch.visible !== undefined) {
      if (typeof patch.visible !== 'boolean') throw new Error('invalid visibility')
      settings.visible = patch.visible
    }
    if (patch.roleId !== undefined) {
      if (typeof patch.roleId !== 'string' || !/^[\w-]{1,128}$/.test(patch.roleId)) throw new Error('invalid role ID')
      settings.roleId = patch.roleId
    }
    const atlas = settings.roleId === pet.settings.roleId ? undefined
      : this.atlas ?? await loadPetAtlas(settings.roleId, join(this.storage.directory, 'pets'))
    if (atlas) await pet.window?.loadPet(atlas)
    await pet.window?.setScale(settings.scale)
    const current = { ...settings, position: pet.settings.position, sessionId: pet.settings.sessionId }
    this.saveSettings(current)
    pet.settings = current
    const rendererChanged = ['alwaysOnTop', 'animationEnabled', 'animationSpeed', 'idleFrequencySec', 'clickThrough'].some(key => key in patch)
    if (rendererChanged) { await pet.window?.destroy(); pet.window = undefined; await this.openWindow(pet) }
    this.applyPresentation(pet)
  }

  private async openWindow(pet: PetInstance): Promise<void> {
    if (!this.rendering || pet.window) return pet.opening
    if (pet.opening) return pet.opening
    pet.opening = (async () => {
      const atlas = this.atlas ?? await loadPetAtlas(pet.settings.roleId, join(this.storage.directory, 'pets'))
      if (!this.rendering) return
      const window = new PetWindow({
        backend: this.backend!, atlas, scale: pet.settings.scale, alwaysOnTop: pet.settings.alwaysOnTop ?? true,
        animationEnabled: pet.settings.animationEnabled ?? true, animationSpeed: pet.settings.animationSpeed ?? 1,
        clickThrough: pet.settings.clickThrough ?? false, idleFrequencySec: pet.settings.idleFrequencySec ?? 20, position: pet.settings.position,
        onDrag: (x, y) => { pet.settings.position = { x, y }; this.persist() },
        onHover: () => pet.window?.playJump(),
        onUnhover: () => pet.window?.endHover(),
        onClose: () => { pet.settings.visible = false; pet.window?.hide(); this.persist() },
      })
      pet.window = window
      try {
        await window.open()
        if (!this.rendering) { await window.destroy(); return }
        this.applyPresentation(pet)
        this.scheduleSleep(pet)
      } catch (error) {
        await window.destroy()
        pet.window = undefined
        throw error
      }
    })()
    try { await pet.opening } finally { pet.opening = undefined }
  }

  async start(): Promise<void> {
    if (this.started) return
    this.lock = acquireInstanceLock(this.storage.lockPath)
    try {
      this.restore()
      // Listen before atlas/native initialization so the first cold-start event is retained.
      if (this.hookPipePath !== null) {
        this.hookServer = new HookEventServer({ pipePath: this.hookPipePath, onEvent: event => this.acceptHookEvent(event) })
        await this.hookServer.start()
      }
      if (this.backend === undefined) this.backend = selectBackend()
      if (!this.backend) throw new Error(`no supported desktop pet window backend on ${process.platform}`)
      this.rendering = true
      for (const pet of this.instances.values()) await this.openWindow(pet)
      this.started = true
      process.once('SIGINT', this.onSignal)
      process.once('SIGTERM', this.onSignal)
      process.once('exit', this.onExit)
    } catch (error) {
      await this.stop()
      throw error
    }
  }

  async setScale(value: number, instanceId = this.getSnapshot()[0].id): Promise<void> {
    await this.updateInstance(instanceId, { scale: value })
  }

  async stop(): Promise<void> {
    if (!this.started && !this.lock) return
    process.removeListener('SIGINT', this.onSignal)
    process.removeListener('SIGTERM', this.onSignal)
    process.removeListener('exit', this.onExit)
    this.started = false
    this.rendering = false
    // Discovery-file cleanup must not prevent native window/lock teardown.
    await this.management?.stop().catch(() => {})
    this.management = undefined
    await this.hookServer?.stop().catch(() => {})
    this.hookServer = undefined
    try {
      for (const pet of this.instances.values()) {
        clearTimeout(pet.staleTimer)
        clearTimeout(pet.sleepTimer)
        await pet.updating?.catch(() => {})
        await pet.opening?.catch(() => {})
        await pet.window?.destroy()
        this.instances.set(pet.settings.id, this.newInstance(pet.settings))
      }
    } finally {
      this.lock?.release()
      this.lock = undefined
    }
  }

  /** Normalize again at the host boundary; events can never replace an existing binding. */
  async acceptHookEvent(input: unknown): Promise<void> {
    if (!this.lock) return
    const event = normalizeHookEvent(input)
    if (!event) return
    let pet = Array.from(this.instances.values()).find(value => value.settings.sessionId === event.sessionId)
    if (!pet) {
      pet = Array.from(this.instances.values()).find(value => value.settings.sessionId === undefined)
      if (!pet) {
        pet = this.newInstance(defaultPetInstance())
      }
      const settings = { ...pet.settings, sessionId: event.sessionId }
      this.saveSettings(settings)
      pet.settings = settings
      this.instances.set(settings.id, pet)
    }
    if (event.timestamp < pet.latestTimestamp || (event.turnId !== undefined && pet.completedTurns.has(event.turnId))) return
    if (event.timestamp === pet.latestTimestamp && event.eventType === pet.lastEventType && event.turnId === pet.lastEventTurnId) return
    let ambiguous = event.timestamp === pet.latestTimestamp
    if (pet.ended && event.eventType !== 'SessionStart' && event.eventType !== 'UserPromptSubmit') return
    if (ambiguous) {
      // Equal timestamps establish neither completion nor a new turn.
    } else if (event.eventType === 'SessionEnd') {
      if (pet.turnId !== undefined) pet.completedTurns.add(pet.turnId)
      pet.ended = true
      pet.turnId = undefined
    } else if (event.eventType === 'SessionStart') {
      ambiguous ||= pet.lastEventAt !== undefined && !pet.ended
      pet.ended = false
    } else if (event.turnId === undefined) {
      // Turn-scoped hooks without a turn cannot reliably clear a known wait or complete a turn.
      ambiguous = event.eventType !== 'PermissionRequest'
    } else if (pet.turnId !== event.turnId) {
      if (pet.lastEventAt === undefined || event.eventType === 'UserPromptSubmit') {
        if (pet.turnId !== undefined) pet.completedTurns.add(pet.turnId)
        pet.turnId = event.turnId
        pet.turnHasActivity = event.eventType !== 'UserPromptSubmit' && event.eventType !== 'Stop'
        pet.ended = false
      } else ambiguous = true
    } else if (event.eventType === 'UserPromptSubmit') {
      ambiguous = pet.turnHasActivity
    } else {
      pet.turnHasActivity = event.eventType !== 'Stop'
    }
    if (!ambiguous && event.eventType === 'Interrupt' && event.turnId !== undefined) {
      pet.completedTurns.add(event.turnId)
    }
    pet.latestTimestamp = event.timestamp
    pet.lastEventAt = this.now()
    pet.lastEventType = event.eventType
    pet.lastEventTurnId = event.turnId
    pet.feedback = ambiguous ? (pet.feedback === 'POSSIBLY_WAITING' ? 'POSSIBLY_WAITING' : 'UNKNOWN') : EVENT_FEEDBACK[event.eventType]
    pet.idleSince = pet.feedback === 'ENDED' ? this.now() : undefined
    this.scheduleSleep(pet)
    if (!ambiguous) {
      clearTimeout(pet.staleTimer)
      pet.lastEvidenceAt = this.now()
      pet.stale = false
      if (!pet.ended && pet.feedback !== 'INTERRUPTED') {
        pet.staleTimer = setTimeout(() => this.refreshStale(pet!), pet.feedback === 'POSSIBLY_WAITING' ? 300_000 : 30_000)
        pet.staleTimer.unref()
      }
    }
    this.applyPresentation(pet)
    await this.openWindow(pet)
  }
}
/** Start the production host; the native window timers keep the process alive. */
export async function runDesktopPetHost(options: DesktopPetHostOptions = {}): Promise<DesktopPetHost> {
  const pipeIndex = process.argv.indexOf('--hook-pipe')
  const hookPipePath = options.hookPipePath !== undefined ? options.hookPipePath : (pipeIndex >= 0 ? process.argv[pipeIndex + 1] : undefined)
  const host = new DesktopPetHost({ ...options, hookPipePath })
  await host.start()
  try { await host.startManagement() } catch (error) { await host.stop(); throw error }
  return host
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  if (process.argv.includes('--management-url')) {
    try {
      const value = JSON.parse(readFileSync(join(new HostStorage().directory, 'management.json'), 'utf8'))
      const url = new URL(value.url)
      if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || !/^\d+$/.test(url.port)
        || !/^[\w-]{43}$/.test(url.searchParams.get('token') ?? '') || !Number.isInteger(value.pid)) throw new Error('invalid management discovery')
      process.kill(value.pid, 0)
      process.stdout.write(`${url.href}\n`)
    } catch { console.error('Desktop pet host is not running. Start it with npm run start:host.'); process.exitCode = 1 }
  } else runDesktopPetHost().then(host => {
    if (!process.argv.includes('--hook-pipe')) process.stdout.write(`Management: ${host.managementUrl}\n`)
  }).catch(error => {
    console.error(`[codex-dsh-pet] failed to start: ${(error as Error).message}`)
    process.exitCode = 1
  })
}
