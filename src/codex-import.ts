import { randomUUID } from 'node:crypto'
import { mkdir, rm, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, join, posix } from 'node:path'
import { unzipSync } from 'fflate'
import { userPetsDir } from './petdex'
import { loadPet } from './renderer/codex-pet/PetLoader'

const MAX_UNPACKED_BYTES = 80 * 1024 * 1024

export interface CodexImportResult { id: string; displayName: string; config?: Record<string, unknown> }

function safeEntry(name: string): boolean {
  return name.length > 0 && !name.startsWith('/') && !/^[A-Za-z]:/.test(name) && !name.split('/').includes('..')
}

function petId(value: unknown, filename: string): string {
  const record = typeof value === 'object' && value !== null ? value as Record<string, unknown> : {}
  const raw = typeof record.id === 'string' ? record.id : basename(filename, '.zip')
  const normalized = raw.toLowerCase().replace(/^dsh-/, '').replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '')
  if (!normalized) throw new Error('Codex package does not contain a usable pet id')
  return normalized.slice(0, 80)
}

/** Import a Codex/Pocket Pet ZIP without shelling out to a system unzip tool. */
export async function importCodexPetZip(bytes: Uint8Array, filename = 'codex-pet.zip', directory = userPetsDir): Promise<CodexImportResult> {
  let archive: Record<string, Uint8Array>
  try { archive = unzipSync(bytes) } catch { throw new Error('The selected file is not a readable ZIP package') }
  const names = Object.keys(archive).filter(safeEntry)
  const total = names.reduce((sum, name) => sum + archive[name].byteLength, 0)
  if (total <= 0 || total > MAX_UNPACKED_BYTES) throw new Error('The unpacked pet package is empty or too large')
  const manifests = names.filter(name => posix.basename(name).toLowerCase() === 'pet.json').sort((a, b) => a.split('/').length - b.split('/').length)
  if (manifests.length === 0) throw new Error('The ZIP package does not contain pet.json')
  const manifestPath = manifests[0]
  let manifest: Record<string, unknown>
  try { manifest = JSON.parse(new TextDecoder().decode(archive[manifestPath])) as Record<string, unknown> } catch { throw new Error('pet.json is not valid JSON') }
  const id = petId(manifest, filename)
  const root = posix.dirname(manifestPath) === '.' ? '' : `${posix.dirname(manifestPath)}/`
  const packageNames = names.filter(name => name.startsWith(root)).map(name => name.slice(root.length)).filter(Boolean)
  const spritePath = typeof manifest.spritesheetPath === 'string' ? manifest.spritesheetPath.replaceAll('\\', '/') : ''
  if (!safeEntry(spritePath) || archive[root + spritePath] === undefined) throw new Error('pet.json references a missing sprite sheet')
  const spriteBytes = archive[root + spritePath]
  const target = join(directory, id)
  const staging = join(directory, `.incoming-${id}-${randomUUID()}`)
  try {
    await stat(target)
    throw new Error(`Pet "${id}" is already installed`)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  await mkdir(staging, { recursive: true })
  try {
    for (const relative of packageNames) {
      if (!safeEntry(relative) || relative.endsWith('/')) continue
      const out = join(staging, ...relative.split('/'))
      await mkdir(dirname(out), { recursive: true })
      await writeFile(out, archive[root + relative])
    }
    manifest.id = id
    await writeFile(join(staging, 'pet.json'), JSON.stringify(manifest, null, 2), 'utf8')
    await loadPet({
      directory: staging,
      decoder: async () => {
        const { default: sharp } = await import('sharp')
        const { data, info } = await sharp(spriteBytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
        return { rgba: new Uint8Array(data.buffer, data.byteOffset, data.byteLength), width: info.width, height: info.height }
      },
    })
    await mkdir(target)
    for (const relative of packageNames) {
      if (!safeEntry(relative) || relative.endsWith('/')) continue
      const out = join(target, ...relative.split('/'))
      await mkdir(dirname(out), { recursive: true })
      await writeFile(out, relative === 'pet.json' ? JSON.stringify(manifest, null, 2) : archive[root + relative])
    }
    const configName = packageNames.find(name => posix.basename(name).toLowerCase() === 'pocket-pet-config.json')
    let config: Record<string, unknown> | undefined
    if (configName) {
      try { config = JSON.parse(new TextDecoder().decode(archive[root + configName])) as Record<string, unknown> } catch { /* old packages have no config */ }
    }
    return { id, displayName: typeof manifest.displayName === 'string' ? manifest.displayName : id, config }
  } catch (error) {
    await rm(target, { recursive: true, force: true, maxRetries: 4, retryDelay: 75 }).catch(() => {})
    throw error
  } finally {
    await rm(staging, { recursive: true, force: true, maxRetries: 4, retryDelay: 75 }).catch(() => {})
  }
}
