import { closeSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { randomUUID } from 'node:crypto'

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
}
export interface HostState {
  version: 2
  instances: PetInstanceSettings[]
}
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
    ids.add(instance.id)
    if (instance.sessionId !== undefined) sessions.add(instance.sessionId)
    instances.push({ id: instance.id, roleId: instance.roleId, ...settings, visible: instance.visible,
      ...(instance.sessionId === undefined ? {} : { sessionId: instance.sessionId }) })
  }
  return { version: 2, instances }
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

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== 'ESRCH'
  }
}

/** Acquire an atomic lock file and remove one left by a dead host process. */
export function acquireInstanceLock(path: string): InstanceLock {
  mkdirSync(dirname(path), { recursive: true })
  for (;;) {
    try {
      const fd = openSync(path, 'wx')
      writeFileSync(fd, `${process.pid}\n`, 'utf8')
      let released = false
      return {
        release() {
          if (released) return
          released = true
          try { closeSync(fd) } catch { /* already closed */ }
          try { rmSync(path, { force: true }) } catch { /* best effort on exit */ }
        },
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      let pid: number | undefined
      try {
        const value = Number.parseInt(readFileSync(path, 'utf8').trim(), 10)
        if (Number.isInteger(value) && value > 0) pid = value
      } catch {
        // Treat an unreadable lock as active; removing it could violate singleton semantics.
      }
      if (pid === undefined || isProcessAlive(pid)) throw new Error('desktop pet host is already running')
      try { rmSync(path, { force: true }) } catch { throw new Error('desktop pet host is already running') }
    }
  }
}

