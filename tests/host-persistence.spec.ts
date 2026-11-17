import { describe, expect, it } from 'vitest'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { HostStorage, defaultHostDataDir } from '../src/host/persistence'

describe('HostStorage', () => {
  it('keeps host state under the Windows local application data directory', () => {
    expect(defaultHostDataDir({ LOCALAPPDATA: 'C:\\Users\\test\\AppData\\Local' })).toBe(
      join('C:\\Users\\test\\AppData\\Local', 'codex-dsh-pet'),
    )
  })

  it('round-trips valid state and ignores malformed values', () => {
    const root = mkdtempSync(join(tmpdir(), 'codex-dsh-pet-'))
    const storage = new HostStorage(root)
    expect(storage.load()).toEqual({ position: { x: 40, y: 40 }, scale: 1 })

    storage.save({ position: { x: 10, y: 20 }, scale: 1.5 })
    expect(storage.load()).toEqual({ position: { x: 10, y: 20 }, scale: 1.5 })

    writeFileSync(storage.statePath, JSON.stringify({ position: { x: 'bad', y: 2 }, scale: 99 }))
    expect(storage.load()).toEqual({ position: { x: 40, y: 40 }, scale: 1 })
  })
})
