import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { zipSync } from 'fflate'
import { importCodexPetZip } from '../src/codex-import'

const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true, maxRetries: 4, retryDelay: 75 }))) })

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
})
