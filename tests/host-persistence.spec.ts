import { describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawn, type ChildProcess } from 'node:child_process'
import { once } from 'node:events'
import { fileURLToPath } from 'node:url'
import { acquireInstanceLock, HostStorage, defaultHostDataDir, defaultPetInstance } from '../src/host/persistence'

it.runIf(process.platform === 'win32')('owns the data directory independently of legacy PID files and never unlinks another owner file', () => {
  const path = join(mkdtempSync(join(tmpdir(), 'pet-mutex-')), 'instance.lock')
  writeFileSync(path, `${process.pid}\n`)
  const owner = acquireInstanceLock(path)
  try {
    expect(() => acquireInstanceLock(path)).toThrow(/already running/)
    writeFileSync(path, 'replacement')
  } finally { owner.release() }
  const next = acquireInstanceLock(path)
  try {
    owner.release()
    expect(() => acquireInstanceLock(path)).toThrow(/already running/)
    expect(readFileSync(path, 'utf8')).toBe('replacement')
  } finally { next.release() }
})

it.runIf(process.platform === 'win32')('grants one concurrent child owner and recovers after a process crash despite a stale PID file', async () => {
  const path = join(mkdtempSync(join(tmpdir(), 'pet-mutex-race-')), 'instance.lock')
  writeFileSync(path, '2147483647\n')
  const children: ChildProcess[] = []
  try {
    for (let index = 0; index < 3; index++) {
      const child = spawn(process.execPath, ['--experimental-transform-types', '--no-warnings',
        fileURLToPath(new URL('./fixtures/lock-host.mjs', import.meta.url)), path], {
        stdio: ['ignore', 'ignore', 'pipe', 'ipc'], windowsHide: true,
      })
      children.push(child)
      expect((await once(child, 'message'))[0]).toBe('ready')
    }
    const attempts = children.map(child => { const result = once(child, 'message'); child.send('acquire'); return result })
    const results = (await Promise.all(attempts)).map(([message]) => message)
    expect(results.filter(result => result === 'acquired')).toHaveLength(1)
    expect(results.filter(result => result === 'rejected')).toHaveLength(2)
    const winner = children[results.indexOf('acquired')]
    const exited = once(winner, 'exit')
    winner.kill('SIGKILL')
    await exited
    const survivor = children.find(child => child !== winner)!
    const recovered = once(survivor, 'message')
    survivor.send('acquire')
    expect((await recovered)[0]).toBe('acquired')
    expect(() => acquireInstanceLock(path)).toThrow(/already running/)
    const released = once(survivor, 'message')
    survivor.send('release')
    await released
    const owner = acquireInstanceLock(path)
    try {
      const oldRelease = once(survivor, 'message')
      survivor.send('release')
      await oldRelease
      expect(() => acquireInstanceLock(path)).toThrow(/already running/)
    } finally { owner.release() }
  } finally {
    await Promise.all(children.filter(child => child.exitCode === null && child.signalCode === null).map(async child => {
      const exited = once(child, 'exit'); child.kill(); await exited
    }))
  }
})

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
