import { randomUUID } from 'node:crypto'
import { mkdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, join, posix } from 'node:path'
import { Unzip, UnzipInflate, unzipSync } from 'fflate'
import { userPetsDir } from './petdex'
import { loadPet } from './renderer/codex-pet/PetLoader'

const MAX_UNPACKED_BYTES = 80 * 1024 * 1024
const MAX_COMPRESSED_BYTES = 40 * 1024 * 1024

export interface CodexImportResult { id: string; displayName: string; config?: Record<string, unknown> }

function safeEntry(name: string): boolean {
  const normalized = name.replaceAll('\\', '/')
  return normalized.length > 0 && !normalized.startsWith('/') && !/[\x00-\x1f:]/.test(normalized)
    && !normalized.replace(/\/$/, '').split('/').some(part => !part || part === '..' || part === '.' || /[. ]$/.test(part)
      || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part))
}

function unpack(bytes: Uint8Array): Record<string, Uint8Array> {
  if (bytes.byteLength > MAX_COMPRESSED_BYTES) throw new Error('The compressed pet package is too large')
  const declared = new Map<string, number>()
  let declaredTotal = 0
  // Inspect every central-directory entry before any decompression or file writes.
  unzipSync(bytes, { filter: file => {
    if (!safeEntry(file.name)) throw new Error('Unsafe ZIP entry path')
    const name = file.name.replaceAll('\\', '/')
    const key = name.toLowerCase()
    if (declared.has(key)) throw new Error('Duplicate ZIP entry path')
    declared.set(key, file.originalSize)
    declaredTotal += file.originalSize
    if (!Number.isSafeInteger(declaredTotal) || declaredTotal > MAX_UNPACKED_BYTES) throw new Error('The unpacked pet package is too large')
    return false
  } })
  const archive: Record<string, Uint8Array> = Object.create(null)
  let total = 0
  const unzipper = new Unzip(file => {
    if (!safeEntry(file.name)) throw new Error('Unsafe ZIP entry path')
    const name = file.name.replaceAll('\\', '/')
    const key = name.toLowerCase()
    const expected = declared.get(key)
    if (expected === undefined) throw new Error('ZIP entry is missing from the directory')
    declared.delete(key)
    let size = 0
    const chunks: Uint8Array[] = []
    file.ondata = (error, chunk, final) => {
      if (error) throw error
      size += chunk.byteLength
      total += chunk.byteLength
      if (total > MAX_UNPACKED_BYTES) throw new Error('The unpacked pet package is too large')
      if (size > expected || (final && size !== expected)) throw new Error('ZIP entry has an invalid expanded size')
      chunks.push(chunk)
      if (final) {
        const content = new Uint8Array(size)
        let offset = 0
        for (const part of chunks) { content.set(part, offset); offset += part.length }
        archive[name] = content
      }
    }
    file.start()
  })
  unzipper.register(UnzipInflate)
  // Bound each inflate step even when an archive lies about its expanded size.
  for (let offset = 0; offset < bytes.length; offset += 1024) {
    unzipper.push(bytes.subarray(offset, offset + 1024), offset + 1024 >= bytes.length)
  }
  if (declared.size || total <= 0) throw new Error('The unpacked pet package is empty or incomplete')
  return archive
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
  const archive = unpack(bytes)
  const names = Object.keys(archive)
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
  manifest.spritesheetPath = spritePath
  const target = join(directory, id)
  const staging = join(directory, `.incoming-${id}-${randomUUID()}`)
  try {
    await stat(target)
    throw new Error(`Pet "${id}" is already installed`)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  await mkdir(staging, { recursive: true })
  let ownsTarget = false
  try {
    for (const relative of packageNames) {
      if (!safeEntry(relative) || relative.endsWith('/')) continue
      const out = join(staging, ...relative.split('/'))
      await mkdir(dirname(out), { recursive: true })
      await writeFile(out, archive[root + relative])
    }
    manifest.id = id
    await writeFile(join(staging, 'pet.json'), JSON.stringify(manifest, null, 2), 'utf8')
    await loadPet({ directory: staging })
    try { await rename(staging, target) } catch (error) {
      if (await stat(target).then(() => true, () => false)) throw new Error('Pet is already installed or being imported')
      throw error
    }
    ownsTarget = true
    const configName = packageNames.find(name => posix.basename(name).toLowerCase() === 'pocket-pet-config.json')
    let config: Record<string, unknown> | undefined
    if (configName) {
      try { config = JSON.parse(new TextDecoder().decode(archive[root + configName])) as Record<string, unknown> } catch { /* old packages have no config */ }
    }
    return { id, displayName: typeof manifest.displayName === 'string' ? manifest.displayName : id, config }
  } catch (error) {
    if (ownsTarget) await rm(target, { recursive: true, force: true, maxRetries: 4, retryDelay: 75 }).catch(() => {})
    throw error
  } finally {
    await rm(staging, { recursive: true, force: true, maxRetries: 4, retryDelay: 75 }).catch(() => {})
  }
}
