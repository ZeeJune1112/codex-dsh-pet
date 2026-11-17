import { describe, expect, it, vi } from 'vitest'
import sharp from 'sharp'
import { loadPet } from '../src/renderer/codex-pet/PetLoader'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/** A decoder stub that returns a 1536×1872 atlas (v1) without sharp. */
function fakeDecoder(width: number, height: number) {
  return async () => ({ rgba: new Uint8Array(width * height * 4), width, height })
}

function makePetDir() {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-pet-'))
  mkdirSync(dir, { recursive: true })
  writeFileSync(
    join(dir, 'pet.json'),
    JSON.stringify({ id: 'test', spritesheetPath: 'sheet.webp', spriteVersionNumber: 1 }),
  )
  return dir
}

describe('loadPet', () => {
  it.each([[2048, 2048], [1000, 1872], [1536, 1800], [1536, 2289]])('rejects an invalid %dx%d image before requesting raw allocation', async (width, height) => {
    const dir = makePetDir()
    writeFileSync(join(dir, 'sheet.webp'), await sharp({ create: { width, height, channels: 4, background: '#00000000' } }).png().toBuffer())
    const raw = vi.spyOn(sharp.prototype, 'raw')
    await expect(loadPet({ directory: dir })).rejects.toThrow(/width|height|pixel/i)
    expect(raw).not.toHaveBeenCalled()
  })

  it.each([1, 2] as const)('decodes the complete supported v%d atlas within the pixel budget', async version => {
    const dir = makePetDir()
    const height = version === 1 ? 1872 : 2288
    writeFileSync(join(dir, 'pet.json'), JSON.stringify({ id: 'native', spriteVersionNumber: version, spritesheetPath: 'sheet.png' }))
    writeFileSync(join(dir, 'sheet.png'), await sharp({ create: { width: 1536, height, channels: 4, background: '#00000000' } }).png().toBuffer())
    const loaded = await loadPet({ directory: dir })
    expect(loaded).toMatchObject({ version, atlasWidth: 1536, atlasHeight: height })
    expect(loaded.rgba.byteLength).toBe(1536 * height * 4)
  })

  it('loads a v1 pet manifest and atlas', async () => {
    const dir = makePetDir()
    const loaded = await loadPet({ directory: dir, decoder: fakeDecoder(1536, 1872) })
    expect(loaded.manifest.id).toBe('test')
    expect(loaded.version).toBe(1)
    expect(loaded.atlasWidth).toBe(1536)
    expect(loaded.atlasHeight).toBe(1872)
    expect(loaded.rgba.length).toBe(1536 * 1872 * 4)
  })

  it('rejects a sprite sheet whose width breaks the contract', async () => {
    const dir = makePetDir()
    await expect(loadPet({ directory: dir, decoder: fakeDecoder(1000, 1872) })).rejects.toThrow(/width/)
  })

  it('rejects a manifest missing id', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-pet-'))
    writeFileSync(join(dir, 'pet.json'), JSON.stringify({ spritesheetPath: 'sheet.webp' }))
    await expect(loadPet({ directory: dir, decoder: fakeDecoder(1536, 1872) })).rejects.toThrow(/id/)
  })

  it('defaults spriteVersionNumber to 1 when absent', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-pet-'))
    writeFileSync(join(dir, 'pet.json'), JSON.stringify({ id: 'v1', spritesheetPath: 'sheet.webp' }))
    const loaded = await loadPet({ directory: dir, decoder: fakeDecoder(1536, 1872) })
    expect(loaded.version).toBe(1)
  })
})
