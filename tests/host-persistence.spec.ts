import { describe, expect, it } from 'vitest'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { HostStorage, defaultHostDataDir, defaultPetInstance } from '../src/host/persistence'

describe('HostStorage', () => {
  it('keeps host state under the Windows local application data directory', () => {
    expect(defaultHostDataDir({ LOCALAPPDATA: 'C:\\Users\\test\\AppData\\Local' })).toBe(
      join('C:\\Users\\test\\AppData\\Local', 'codex-dsh-pet'),
    )
  })

  it('round-trips valid state and ignores malformed values', () => {
    const root = mkdtempSync(join(tmpdir(), 'codex-dsh-pet-'))
    const storage = new HostStorage(root)
    expect(storage.load()).toEqual({ version: 2, instances: [defaultPetInstance('default')] })

    storage.save({ version: 2, instances: [{ ...defaultPetInstance('pet'), position: { x: 10, y: 20 }, scale: 1.5, sessionId: 'opaque' }] })
    expect(storage.load().instances).toEqual([{ id: 'pet', roleId: 'text', position: { x: 10, y: 20 }, scale: 1.5, visible: true, sessionId: 'opaque' }])

    writeFileSync(storage.statePath, JSON.stringify({ position: { x: 'bad', y: 2 }, scale: 99 }))
    expect(storage.load()).toEqual({ version: 2, instances: [defaultPetInstance('default')] })
  })

  it('migrates old position/scale and rejects duplicate bindings without replacing saved configuration', () => {
    const storage = new HostStorage(mkdtempSync(join(tmpdir(), 'pet-migration-')))
    writeFileSync(storage.statePath, JSON.stringify({ position: { x: -100, y: 20 }, scale: 1.5 }))
    const migrated = storage.load()
    expect(migrated).toEqual({ version: 2, instances: [{ id: 'default', roleId: 'text', position: { x: -100, y: 20 }, scale: 1.5, visible: true }] })
    storage.save(migrated)
    expect(() => storage.save({ version: 2, instances: [
      { ...defaultPetInstance('one'), sessionId: 'same' }, { ...defaultPetInstance('two'), sessionId: 'same' },
    ] })).toThrow(/invalid host state/)
    expect(storage.load()).toEqual(migrated)
  })
})
