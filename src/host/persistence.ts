import { closeSync, mkdirSync, openSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'

export interface HostPosition {
  x: number
  y: number
}
export interface PetInstanceSettings {
  id: string
  roleId: string
  sessionId?: string
  position: HostPosition
  scale: number
  visible: boolean
  hideWhenIdle?: boolean
  alwaysOnTop?: boolean
  animationEnabled?: boolean
  animationSpeed?: number
  idleFrequencySec?: number
  clickThrough?: boolean
  startSleeping?: boolean
}
export interface HostState {
  version: 2
  instances: PetInstanceSettings[]
  selectedInstanceId?: string
  migrationCompleted?: boolean
}
export const BOOLEAN_PREFERENCES = ['hideWhenIdle', 'alwaysOnTop', 'animationEnabled', 'clickThrough', 'startSleeping'] as const
export const NUMBER_PREFERENCES = { animationSpeed: [0.25, 4], idleFrequencySec: [8, 3600] } as const
export function defaultPetInstance(id: string = randomUUID()): PetInstanceSettings {
  return { id, roleId: 'text', position: { x: 40, y: 40 }, scale: 1, visible: true }
}
const MIN_SCALE = 0.5
const MAX_SCALE = 4

/** Resolve the private host directory without ever writing into the checkout. */
export function defaultHostDataDir(environment: NodeJS.ProcessEnv = process.env): string {
  const root = environment.LOCALAPPDATA || environment.XDG_DATA_HOME || join(homedir(), 'AppData', 'Local')
  return join(root, 'codex-dsh-pet')
}

function parsePositionAndScale(value: unknown): Pick<PetInstanceSettings, 'position' | 'scale'> | null {
  if (typeof value !== 'object' || value === null) return null
  const record = value as { position?: unknown; scale?: unknown }
  if (typeof record.position !== 'object' || record.position === null) return null
  const position = record.position as { x?: unknown; y?: unknown }
  if (!Number.isFinite(position.x) || !Number.isFinite(position.y)) return null
  if (!Number.isFinite(record.scale) || (record.scale as number) < MIN_SCALE || (record.scale as number) > MAX_SCALE) return null
  return {
    position: { x: Number(position.x), y: Number(position.y) },
    scale: Number(record.scale),
  }
}

function parseState(value: unknown): HostState | null {
  if (typeof value !== 'object' || value === null) return null
  const record = value as Partial<HostState>
  if (record.version === undefined) {
    const legacy = parsePositionAndScale(value)
    return legacy ? { version: 2, instances: [{ ...defaultPetInstance('default'), ...legacy }] } : null
  }
  if (record.version !== 2 || !Array.isArray(record.instances) || record.instances.length === 0) return null
  const instances: PetInstanceSettings[] = []
  const ids = new Set<string>()
  const sessions = new Set<string>()
  for (const instance of record.instances) {
    const settings = parsePositionAndScale(instance)
    if (!settings || typeof instance.id !== 'string' || !/^[\w-]{1,128}$/.test(instance.id)
      || typeof instance.roleId !== 'string' || !/^[\w-]{1,128}$/.test(instance.roleId)
      || typeof instance.visible !== 'boolean' || ids.has(instance.id)) return null
    if (instance.sessionId !== undefined && (typeof instance.sessionId !== 'string'
      || instance.sessionId.length === 0 || instance.sessionId.length > 256 || sessions.has(instance.sessionId))) return null
    const preferences: Partial<PetInstanceSettings> = {}
    for (const key of BOOLEAN_PREFERENCES) {
      if (instance[key] !== undefined) {
        if (typeof instance[key] !== 'boolean') return null
        preferences[key] = instance[key]
      }
    }
    for (const key of Object.keys(NUMBER_PREFERENCES) as Array<keyof typeof NUMBER_PREFERENCES>) {
      const value = instance[key]
      if (value !== undefined) {
        const [min, max] = NUMBER_PREFERENCES[key]
        if (!Number.isFinite(value) || value < min || value > max) return null
        preferences[key] = value
      }
    }
    ids.add(instance.id)
    if (instance.sessionId !== undefined) sessions.add(instance.sessionId)
    instances.push({ id: instance.id, roleId: instance.roleId, ...settings, ...preferences, visible: instance.visible,
      ...(instance.sessionId === undefined ? {} : { sessionId: instance.sessionId }) })
  }
  if (record.selectedInstanceId !== undefined && !ids.has(record.selectedInstanceId)) return null
  if (record.migrationCompleted !== undefined && typeof record.migrationCompleted !== 'boolean') return null
  return { version: 2, instances,
    ...(record.selectedInstanceId === undefined ? {} : { selectedInstanceId: record.selectedInstanceId }),
    ...(record.migrationCompleted === undefined ? {} : { migrationCompleted: record.migrationCompleted }) }
}

export class HostStorage {
  readonly statePath: string
  readonly lockPath: string

  constructor(readonly directory = defaultHostDataDir()) {
    this.statePath = join(directory, 'state.json')
    this.lockPath = join(directory, 'instance.lock')
  }

  load(): HostState {
    try {
      const parsed = parseState(JSON.parse(readFileSync(this.statePath, 'utf8')))
      return parsed ?? { version: 2, instances: [defaultPetInstance('default')] }
    } catch {
      return { version: 2, instances: [defaultPetInstance('default')] }
    }
  }

  save(state: HostState): void {
    const parsed = parseState(state)
    if (!parsed) throw new Error('invalid host state')
    mkdirSync(this.directory, { recursive: true })
    const temporary = `${this.statePath}.${randomUUID()}.tmp`
    try {
      writeFileSync(temporary, JSON.stringify(parsed, null, 2), { encoding: 'utf8', flush: true })
      renameSync(temporary, this.statePath)
    } finally {
      rmSync(temporary, { force: true })
    }
  }
}

export interface InstanceLock {
  release(): void
}

/** Windows releases the named kernel object on exit, including process crashes. */
export function acquireInstanceLock(path: string): InstanceLock {
  mkdirSync(dirname(path), { recursive: true })
  if (process.platform === 'win32') {
    // Hook diagnostics import storage too; load the native dependency only when acquiring ownership.
    const kernel = createRequire(import.meta.url)('koffi').load('kernel32.dll')
    const createMutex = kernel.func('void* __stdcall CreateMutexW(void*, int, str16)')
    const getLastError = kernel.func('uint32 __stdcall GetLastError()')
    const closeHandle = kernel.func('int __stdcall CloseHandle(void*)')
    const key = createHash('sha256').update(join(realpathSync(dirname(path)), basename(resolve(path))).toLowerCase()).digest('hex')
    const handle = createMutex(null, 0, `Global\\codex-dsh-pet-${key}`)
    const error = getLastError()
    if (!handle) throw new Error(`Cannot acquire desktop pet host mutex (${error})`)
    if (error === 183) { closeHandle(handle); throw new Error('desktop pet host is already running') }
    let released = false
    return { release() { if (!released) { released = true; closeHandle(handle) } } }
  }
  // shortcut: non-Windows CI fails closed on stale files; add an OS lock before supporting a non-Windows host.
  const token = randomUUID()
  let fd: number
  try { fd = openSync(path, 'wx') } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new Error('desktop pet host is already running')
    throw error
  }
  try { writeFileSync(fd, token, 'utf8') } finally { closeSync(fd) }
  let released = false
  return { release() {
    if (released) return
    released = true
    try { if (readFileSync(path, 'utf8') === token) rmSync(path) } catch { /* best effort on exit */ }
  } }
}

