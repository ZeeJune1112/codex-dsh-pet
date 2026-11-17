import { lstat, readFile, readdir, realpath, mkdir, writeFile, rename, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname, isAbsolute, join, parse, relative, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import sharp from 'sharp'
import type { DesktopPetHost } from '../standalone'
import { defaultPetInstance, type PetInstanceSettings } from '../host/persistence'
import { quantizeScale } from '../pet-state'
import { scanPets } from '../pets'
import { loadPet } from '../renderer/codex-pet/PetLoader'

export function hasLegacyData(directory: string): boolean {
  return existsSync(join(directory, 'pets')) || existsSync(join(directory, 'state.json')) || existsSync(join(directory, 'position.json'))
}
function contained(root: string, path: string): boolean {
  const child = relative(resolve(root), resolve(path))
  return child !== '..' && !child.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) && !isAbsolute(child)
}
async function noLinks(path: string): Promise<void> {
  const absolute = resolve(path)
  let current = parse(absolute).root
  for (const part of relative(current, absolute).split(/[\\/]/).filter(Boolean)) {
    current = join(current, part)
    if ((await lstat(current)).isSymbolicLink()) throw new Error('migration refuses symbolic links and junctions')
  }
}
async function readLocal(root: string, path: string, limit: number): Promise<Buffer> {
  if (!contained(root, path)) throw new Error('migration path escapes source')
  await noLinks(path)
  const stat = await lstat(path)
  if (!stat.isFile() || stat.size > limit) throw new Error('migration source is not a regular bounded file')
  if (!contained(await realpath(root), await realpath(path))) throw new Error('migration path escapes source')
  const bytes = await readFile(path)
  if (bytes.length > limit) throw new Error('migration file too large')
  return bytes
}
async function rejectLinkedEntries(directory: string): Promise<void> {
  await noLinks(directory)
  for (const name of await readdir(directory)) {
    const path = join(directory, name)
    const stat = await lstat(path)
    if (stat.isSymbolicLink() || (!stat.isFile() && !stat.isDirectory())) throw new Error('migration refuses linked or special entries')
    if (stat.isDirectory()) await rejectLinkedEntries(path)
  }
}
function preference(value: unknown): Partial<PetInstanceSettings> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid legacy preference')
  const record = value as Record<string, unknown>
  const result: Partial<PetInstanceSettings> = {}
  for (const key of ['visible', 'hideWhenIdle'] as const) {
    if (record[key] !== undefined) {
      if (typeof record[key] !== 'boolean') throw new Error('invalid legacy visibility')
      result[key] = record[key]
    }
  }
  if (record.scale !== undefined) {
    if (typeof record.scale !== 'number' || !Number.isFinite(record.scale)) throw new Error('invalid legacy scale')
    result.scale = quantizeScale(record.scale)
  }
  if (record.position !== undefined) {
    const position = record.position as { x?: unknown; y?: unknown } | null
    if (!position || !Number.isFinite(position.x) || !Number.isFinite(position.y)) throw new Error('invalid legacy position')
    result.position = { x: Number(position.x), y: Number(position.y) }
  }
  return result
}

/** Explicit local migration. Existing roles/settings win; no source file is modified. */
export async function migrateLegacy(host: DesktopPetHost, source: string): Promise<void> {
  if (host.managementSettings.migrationCompleted) return
  if (!hasLegacyData(source)) throw new Error('no legacy data found')
  await noLinks(source)
  const destination = join(host.dataDirectory, 'pets')
  const existingCatalog = new Set(scanPets(undefined, destination).map(role => role.id))
  await noLinks(host.dataDirectory)
  if (existsSync(destination)) await noLinks(destination)
  const preferences = new Map<string, Partial<PetInstanceSettings>>()
  let selected: string | undefined
  let order: string[] = []
  const statePath = join(source, 'state.json')
  if (existsSync(statePath)) {
    const state = JSON.parse((await readLocal(source, statePath, 1024 * 1024)).toString())
    if (!state || state.version !== 1 || !state.pets || typeof state.pets !== 'object' || Array.isArray(state.pets)
      || !Array.isArray(state.order) || !state.order.every((id: unknown) => typeof id === 'string' && /^[\w-]{1,128}$/.test(id))
      || typeof state.selectedPetId !== 'string' || !/^[\w-]{1,128}$/.test(state.selectedPetId)
      || new Set(state.order).size !== state.order.length) throw new Error('invalid legacy settings')
    order = state.order; selected = state.selectedPetId
    for (const [id, value] of Object.entries(state.pets)) {
      if (!/^[\w-]{1,128}$/.test(id)) throw new Error('invalid legacy role ID')
      preferences.set(id, preference(value))
    }
  }
  let fallback: Partial<PetInstanceSettings> = {}
  if (!existsSync(statePath) && existsSync(join(source, 'position.json'))) {
    const oldPosition = JSON.parse((await readLocal(source, join(source, 'position.json'), 16 * 1024)).toString())
    fallback = preference({ position: oldPosition })
  }
  const stage = join(host.dataDirectory, `.migration-${randomUUID()}`)
  const published: string[] = []
  const staged: string[] = []
  let total = 0
  try {
    const sourcePets = join(source, 'pets')
    if (existsSync(sourcePets)) {
      await rejectLinkedEntries(sourcePets)
      for (const id of await readdir(sourcePets)) {
        if (!/^[\w-]{1,128}$/.test(id)) throw new Error('invalid legacy role directory')
        const sourceRole = join(sourcePets, id)
        if (!(await lstat(sourceRole)).isDirectory()) throw new Error('invalid legacy role directory')
        if (existingCatalog.has(id) || existsSync(join(destination, id))) continue
        const bytes = await readLocal(sourceRole, join(sourceRole, 'pet.json'), 256 * 1024)
        const manifest = JSON.parse(bytes.toString())
        if (!manifest || typeof manifest.spritesheetPath !== 'string' || !manifest.spritesheetPath
          || /[:\x00-\x1f]/.test(manifest.spritesheetPath) || isAbsolute(manifest.spritesheetPath)) throw new Error('invalid legacy sprite path')
        const sprite = await readLocal(sourceRole, resolve(sourceRole, manifest.spritesheetPath), 40 * 1024 * 1024)
        total += bytes.length + sprite.length
        if (total > 200 * 1024 * 1024) throw new Error('legacy migration too large')
        const roleStage = join(stage, id)
        await mkdir(roleStage, { recursive: true })
        // Keep only the reusable role contract; neighboring files are not migration inputs.
        await writeFile(join(roleStage, 'pet.json'), JSON.stringify({ id, displayName: manifest.displayName,
          spriteVersionNumber: manifest.spriteVersionNumber, spritesheetPath: 'spritesheet' }))
        await writeFile(join(roleStage, 'spritesheet'), sprite)
        await loadPet({ directory: roleStage, decoder: async () => {
          const { data, info } = await sharp(sprite).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
          return { rgba: data, width: info.width, height: info.height }
        } })
        staged.push(id)
      }
    }
    const existingRoles = new Set(host.getSnapshot().map(pet => pet.roleId))
    const available = new Set([...scanPets(undefined, destination).map(role => role.id), ...staged])
    const desired = [...new Set([...order, ...staged, ...preferences.keys()])].filter(id => available.has(id) && !existingRoles.has(id)
      && (!existsSync(join(destination, id)) || staged.includes(id)))
    const instances = desired.map(roleId => ({ ...defaultPetInstance(), ...fallback, ...preferences.get(roleId), roleId }))
    await mkdir(destination, { recursive: true })
    for (const id of staged) {
      const target = join(destination, id)
      if (existsSync(target)) throw new Error('a migration role already exists')
      await rename(join(stage, id), target)
      published.push(target)
    }
    await rm(stage, { recursive: true, force: true, maxRetries: 4, retryDelay: 75 })
    // shortcut: handled failures roll back; a process crash can leave a complete orphan role, add a recovery journal before promising crash atomicity.
    await host.addInstances(instances, { migration: true,
      selectedId: host.managementSettings.selectedInstanceId ?? instances.find(pet => pet.roleId === selected)?.id })
  } catch (error) {
    for (const path of published.reverse()) {
      if (!contained(destination, path) || dirname(path) !== resolve(destination)) throw new Error('unsafe migration rollback target')
      await rm(path, { recursive: true, force: true, maxRetries: 4, retryDelay: 75 })
    }
    throw error
  } finally {
    if (!contained(host.dataDirectory, stage)) throw new Error('unsafe migration staging path')
    await rm(stage, { recursive: true, force: true, maxRetries: 4, retryDelay: 75 })
  }
}
