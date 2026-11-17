import { mkdir, rm, stat, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { loadPet } from './renderer/codex-pet/PetLoader'

const MANIFEST_URL = 'https://petdex.dev/api/manifest'
const ALLOWED_ASSET_HOSTS = new Set(['assets.petdex.dev'])
const MAX_MANIFEST_BYTES = 256 * 1024
const MAX_SPRITESHEET_BYTES = 40 * 1024 * 1024

export const userPetsDir = join(homedir(), '.dsh', 'dsh-pet', 'pets')

export interface PetdexEntry {
  slug: string
  displayName: string
  submittedBy?: string
  spritesheetUrl: string
  petJsonUrl: string
  spriteVersionNumber?: 1 | 2
}

interface PetdexManifest {
  pets: PetdexEntry[]
}

export interface PetdexImportOptions {
  directory?: string
  fetchImpl?: typeof fetch
}

function validSlug(slug: string): boolean {
  return /^[a-z0-9][a-z0-9-]{0,79}$/.test(slug)
}

function trustedAssetUrl(raw: string): URL {
  const url = new URL(raw)
  if (url.protocol !== 'https:' || !ALLOWED_ASSET_HOSTS.has(url.hostname)) {
    throw new Error(`Petdex returned an untrusted asset URL: ${url.hostname}`)
  }
  return url
}

async function download(fetchImpl: typeof fetch, url: URL, maxBytes: number): Promise<Uint8Array> {
  const response = await fetchImpl(url, { signal: AbortSignal.timeout(60_000) })
  if (!response.ok) throw new Error(`Download failed (${response.status})`)
  const declared = Number(response.headers.get('content-length') ?? 0)
  if (declared > maxBytes) throw new Error('Downloaded file is too large')
  const bytes = new Uint8Array(await response.arrayBuffer())
  if (bytes.byteLength === 0 || bytes.byteLength > maxBytes) throw new Error('Downloaded file has an invalid size')
  return bytes
}

function parseManifest(raw: Uint8Array, entry: PetdexEntry, spriteFile: string): string {
  let value: Record<string, unknown>
  try {
    value = JSON.parse(new TextDecoder().decode(raw)) as Record<string, unknown>
  } catch {
    throw new Error('Petdex pet.json is invalid JSON')
  }
  const version = value.spriteVersionNumber === 2 ? 2 : 1
  return JSON.stringify({
    ...value,
    id: entry.slug,
    displayName: typeof value.displayName === 'string' && value.displayName.length > 0
      ? value.displayName
      : entry.displayName,
    spriteVersionNumber: version,
    spritesheetPath: spriteFile,
    petdex: {
      slug: entry.slug,
      submittedBy: entry.submittedBy,
      source: `https://petdex.dev/pets/${entry.slug}`,
    },
  }, null, 2)
}

/** Download, validate, and persist one approved Petdex pet without a CLI dependency. */
export async function importPetFromPetdex(slugInput: string, options: PetdexImportOptions = {}): Promise<PetdexEntry> {
  const slug = slugInput.trim().toLowerCase()
  if (!validSlug(slug)) throw new Error('Pet slug must contain only lowercase letters, numbers, and hyphens')

  const fetchImpl = options.fetchImpl ?? fetch
  const response = await fetchImpl(MANIFEST_URL, { signal: AbortSignal.timeout(60_000) })
  if (!response.ok) throw new Error(`Could not load the Petdex catalog (${response.status})`)
  const manifest = await response.json() as PetdexManifest
  const entry = Array.isArray(manifest.pets) ? manifest.pets.find(pet => pet.slug === slug) : undefined
  if (!entry) throw new Error(`Petdex pet "${slug}" was not found`)

  const petJsonUrl = trustedAssetUrl(entry.petJsonUrl)
  const spritesheetUrl = trustedAssetUrl(entry.spritesheetUrl)
  const spriteExt = spritesheetUrl.pathname.toLowerCase().endsWith('.png') ? '.png' : '.webp'
  const spriteFile = `spritesheet${spriteExt}`
  const root = options.directory ?? userPetsDir
  const target = join(root, slug)
  const staging = join(root, `.incoming-${slug}-${randomUUID()}`)

  await mkdir(root, { recursive: true })
  try {
    await stat(target)
    throw new Error(`Pet "${slug}" is already installed`)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }

  try {
    const [petJson, spritesheet] = await Promise.all([
      download(fetchImpl, petJsonUrl, MAX_MANIFEST_BYTES),
      download(fetchImpl, spritesheetUrl, MAX_SPRITESHEET_BYTES),
    ])
    await mkdir(staging, { recursive: true })
    const normalizedManifest = parseManifest(petJson, entry, spriteFile)
    await writeFile(join(staging, 'pet.json'), normalizedManifest, 'utf8')
    await writeFile(join(staging, basename(spriteFile)), spritesheet)
    await loadPet({ directory: staging })
    // Windows may keep the validated source file open briefly after Sharp.
    // Persist from the already-downloaded buffers instead of renaming it.
    await mkdir(target)
    await writeFile(join(target, 'pet.json'), normalizedManifest, 'utf8')
    await writeFile(join(target, spriteFile), spritesheet)
    await rm(staging, { recursive: true, force: true }).catch(() => {})
    return entry
  } catch (error) {
    await rm(staging, { recursive: true, force: true }).catch(() => {})
    await rm(target, { recursive: true, force: true }).catch(() => {})
    throw error
  }
}
