import { describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
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
