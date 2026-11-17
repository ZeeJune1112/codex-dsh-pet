import { describe, expect, it, vi } from 'vitest'
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import sharp from 'sharp'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { importPetFromPetdex } from '../src/petdex'

const petJsonUrl = 'https://assets.petdex.dev/curated/boba/pet.json'
const spriteUrl = 'https://assets.petdex.dev/curated/boba/spritesheet.webp'

function fakeFetch(assetHost = 'assets.petdex.dev'): typeof fetch {
  const sprite = readFileSync(join(process.cwd(), 'assets', 'pets', 'text', 'spritesheet.webp'))
  return (async (input: string | URL | Request) => {
    const url = String(input)
    if (url === 'https://petdex.dev/api/manifest') {
      return Response.json({
        pets: [{
          slug: 'boba',
          displayName: 'Boba',
          submittedBy: 'railly',
          petJsonUrl: `https://${assetHost}/curated/boba/pet.json`,
          spritesheetUrl: spriteUrl,
        }],
      })
    }
    if (url === petJsonUrl) {
      return Response.json({ id: 'boba', displayName: 'Boba', spriteVersionNumber: 1, spritesheetPath: 'remote.webp' })
    }
    if (url === spriteUrl) return new Response(sprite)
    return new Response('not found', { status: 404 })
  }) as typeof fetch
}

describe('importPetFromPetdex', () => {
  it('rejects excessive sprite pixels before decoding or publishing downloaded assets', async () => {
    const root = mkdtempSync(join(tmpdir(), 'petdex-pixels-'))
    const sprite = await sharp({ create: { width: 2048, height: 2048, channels: 4, background: '#00000000' } }).png().toBuffer()
    const normalFetch = fakeFetch()
    const fetchImpl: typeof fetch = (url, options) => String(url) === spriteUrl ? Promise.resolve(new Response(sprite)) : normalFetch(url, options)
    const raw = vi.spyOn(sharp.prototype, 'raw')
    try {
      await expect(importPetFromPetdex('boba', { directory: root, fetchImpl })).rejects.toThrow(/pixel/i)
      expect(raw).not.toHaveBeenCalled()
      expect(readdirSync(root)).toEqual([])
    } finally { rmSync(root, { recursive: true, force: true }) }
  })

  it('rejects concurrent imports without removing the winning role', async () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-petdex-'))
    try {
      const results = await Promise.allSettled([
        importPetFromPetdex('boba', { directory: root, fetchImpl: fakeFetch() }),
        importPetFromPetdex('boba', { directory: root, fetchImpl: fakeFetch() }),
      ])
      expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1)
      expect(results.filter(result => result.status === 'rejected')).toHaveLength(1)
      expect(JSON.parse(readFileSync(join(root, 'boba', 'pet.json'), 'utf8')).id).toBe('boba')
      expect(readFileSync(join(root, 'boba', 'spritesheet.webp'))).toEqual(readFileSync(join(process.cwd(), 'assets', 'pets', 'text', 'spritesheet.webp')))
    } finally { rmSync(root, { recursive: true, force: true, maxRetries: 4, retryDelay: 75 }) }
  })

  it('imports and normalizes an approved Petdex pet', async () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-petdex-'))
    const result = await importPetFromPetdex('boba', { directory: root, fetchImpl: fakeFetch() })
    expect(result.displayName).toBe('Boba')
    const manifest = JSON.parse(readFileSync(join(root, 'boba', 'pet.json'), 'utf8'))
    expect(manifest.id).toBe('boba')
    expect(manifest.spritesheetPath).toBe('spritesheet.webp')
    expect(manifest.petdex.source).toBe('https://petdex.dev/pets/boba')
  })

  it('rejects asset URLs outside the Petdex asset host', async () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-petdex-'))
    await expect(importPetFromPetdex('boba', { directory: root, fetchImpl: fakeFetch('example.com') }))
      .rejects.toThrow('untrusted asset URL')
  })

  it('rejects unsafe slugs before network access', async () => {
    const fetchImpl = fakeFetch()
    await expect(importPetFromPetdex('../boba', { fetchImpl })).rejects.toThrow('Pet slug')
  })
})

it('bounds Petdex responses while streaming and disables redirects before fetching assets', async () => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-petdex-bounds-'))
  let chunks = 0
  const fetchImpl: typeof fetch = async (_input, options) => {
    expect(options?.redirect).toBe('error')
    return new Response(new ReadableStream({ pull(controller) { chunks++; controller.enqueue(new Uint8Array(1024 * 1024)); if (chunks === 30) controller.close() } }))
  }
  try {
    await expect(importPetFromPetdex('boba', { directory: root, fetchImpl })).rejects.toThrow(/large/i)
    expect(chunks).toBeLessThan(30)
  } finally { rmSync(root, { recursive: true, force: true }) }
})
