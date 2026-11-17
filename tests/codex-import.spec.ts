import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { zipSync } from 'fflate'
import { importCodexPetZip } from '../src/codex-import'

const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true, maxRetries: 4, retryDelay: 75 }))) })

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'dsh-pet-zip-'))
  roots.push(root)
  const source = join(import.meta.dirname, '..', 'assets', 'pets', 'text')
  return { root, files: {
    'pet.json': await readFile(join(source, 'pet.json')),
    'spritesheet.webp': await readFile(join(source, 'spritesheet.webp')),
  } }
}

describe('Codex ZIP import', () => {
  it('finds a nested pet.json and preserves Pocket Pet config', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-pet-zip-'))
    roots.push(root)
    const source = join(import.meta.dirname, '..', 'assets', 'pets', 'text')
    const [manifest, sprite] = await Promise.all([
      readFile(join(source, 'pet.json')),
      readFile(join(source, 'spritesheet.webp')),
    ])
    const zip = zipSync({
      'export/pet.json': manifest,
      'export/spritesheet.webp': sprite,
      'export/pocket-pet-config.json': new TextEncoder().encode(JSON.stringify({ version: 2, overlaySizeDp: 168 })),
    })
    const result = await importCodexPetZip(zip, 'export.zip', root)
    expect(result).toMatchObject({ id: 'text', displayName: 'Text (test)', config: { overlaySizeDp: 168 } })
    expect(JSON.parse(await readFile(join(root, 'text', 'pet.json'), 'utf8')).id).toBe('text')
  })

  it('rejects packages without pet.json', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-pet-zip-'))
    roots.push(root)
    await expect(importCodexPetZip(zipSync({ 'readme.txt': new TextEncoder().encode('no pet') }), 'bad.zip', root))
      .rejects.toThrow('pet.json')
  })

  it.each(['../escape.txt', '..\\escape.txt', '/escape.txt', '\\escape.txt', 'C:\\escape.txt', 'safe/../../escape.txt'])('rejects unsafe ZIP entry %s before writing', async name => {
    const { root, files } = await fixture()
    await expect(importCodexPetZip(zipSync({ ...files, [name]: new Uint8Array([1]) }), 'bad.zip', root)).rejects.toThrow(/unsafe/i)
    expect(await readdir(root)).toEqual([])
  })

  it('rejects a declared expansion above the limit before writing', async () => {
    const { root, files } = await fixture()
    const zip = zipSync(files)
    const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength)
    for (let offset = 0; offset + 28 < zip.length; offset++) {
      if (view.getUint32(offset, true) === 0x02014b50) {
        view.setUint32(offset + 24, 81 * 1024 * 1024, true)
        break
      }
    }
    await expect(importCodexPetZip(zip, 'large.zip', root)).rejects.toThrow(/large/i)
    expect(await readdir(root)).toEqual([])
  })

  it('rejects oversized compressed input before writing', async () => {
    const { root } = await fixture()
    await expect(importCodexPetZip(new Uint8Array(40 * 1024 * 1024 + 1), 'large.zip', root)).rejects.toThrow(/large/i)
    expect(await readdir(root)).toEqual([])
  })

  it('rejects compressed content that exceeds its declared expanded size before writing', async () => {
    const { root, files } = await fixture()
    const zip = zipSync(files)
    const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength)
    for (let offset = 0; offset + 28 < zip.length; offset++) {
      if (view.getUint32(offset, true) === 0x02014b50) {
        view.setUint32(offset + 24, 1, true)
        break
      }
    }
    await expect(importCodexPetZip(zip, 'dishonest.zip', root)).rejects.toThrow(/expanded size/i)
    expect(await readdir(root)).toEqual([])
  })

  it('rejects a concurrent same-ID import without deleting the installed role', async () => {
    const { root, files } = await fixture()
    const zip = zipSync(files)
    const results = await Promise.allSettled([importCodexPetZip(zip, 'a.zip', root), importCodexPetZip(zip, 'b.zip', root)])
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1)
    expect(results.filter(result => result.status === 'rejected')).toHaveLength(1)
    expect(await readFile(join(root, 'text', 'spritesheet.webp'))).toEqual(files['spritesheet.webp'])
    expect(await readdir(root)).toEqual(['text'])
  })
})
