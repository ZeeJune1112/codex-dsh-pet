import { describe, expect, it } from 'vitest'
import { cpSync, existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DesktopPetHost } from '../src/standalone'
import { defaultPetInstance, HostStorage } from '../src/host/persistence'
import type { WindowBackend, WindowBackendOptions, WindowHandle } from '../src/renderer/backend/WindowBackend'
import type { PetFrame } from '../src/renderer/FrameDecoder'
import { randomUUID } from 'node:crypto'
import { sendHookEvent } from '../src/integration/hooks-transport'

class FakeHandle implements WindowHandle {
  shown = true
  destroyed = false
  constructor(readonly options: WindowBackendOptions) {}
  present(_frame: PetFrame): void {}
  move(): void {}
  setAlwaysOnTop(): void {}
  show(): void { this.shown = true }
  hide(): void { this.shown = false }
  destroy(): void { this.destroyed = true }
}

function fakeBackend() {
  const handles: FakeHandle[] = []
  const backend: WindowBackend = {
    name: 'fake',
    isSupported: () => true,
    async create(options) {
      const handle = new FakeHandle(options)
      handles.push(handle)
      return handle
    },
  }
  return { backend, handles }
}

const atlas = { width: 1536, height: 1872, rgba: new Uint8Array(1536 * 1872 * 4) }

describe('DesktopPetHost', () => {
  it('routes two concurrent pipe sessions to separate windows using the same role', async () => {
    const storage = new HostStorage(mkdtempSync(join(tmpdir(), 'pet-sessions-')))
    const { backend, handles } = fakeBackend()
    const pipePath = process.platform === 'win32' ? `\\\\.\\pipe\\pet-test-${randomUUID()}` : join(tmpdir(), `pet-${randomUUID()}.sock`)
    const host = new DesktopPetHost({ backend, storage, atlas, hookPipePath: pipePath })
    await host.start()
    try {
      await Promise.all([
        sendHookEvent({ eventType: 'PermissionRequest', sessionId: 'A', turnId: 'a', timestamp: 1 }, { pipePath }),
        sendHookEvent({ eventType: 'PreToolUse', sessionId: 'B', turnId: 'b', timestamp: 1 }, { pipePath }),
      ])
      const pets = host.getSnapshot()
      expect(pets).toHaveLength(2)
      expect(new Set(pets.map(pet => pet.id)).size).toBe(2)
      expect(pets.map(pet => pet.roleId)).toEqual(['text', 'text'])
      expect(pets.find(pet => pet.sessionId === 'A')).toMatchObject({ feedback: 'POSSIBLY_WAITING', pose: 'waiting' })
      expect(pets.find(pet => pet.sessionId === 'B')).toMatchObject({ feedback: 'WORKING', pose: 'running' })
      expect(handles).toHaveLength(2)
      handles[0].options.onHover?.()
      expect(host.getSnapshot()[0].pose).toBe('jumping')
      expect(host.getSnapshot()[1].pose).toBe('running')
      handles[0].options.onDrag?.(120, 80)
      handles[0].options.onClose?.()
      expect(host.getSnapshot()[0]).toMatchObject({ visible: false, position: { x: 120, y: 80 } })
      expect(host.getSnapshot()[1]).toMatchObject({ visible: true, position: { x: 40, y: 40 } })
    } finally { await host.stop() }
    expect(handles.every(handle => handle.destroyed)).toBe(true)
  })

  it('persists drag position and scale, wires hover and right-click hide, and cleans up', async () => {
    const storage = new HostStorage(mkdtempSync(join(tmpdir(), 'codex-dsh-pet-')))
    const { backend, handles } = fakeBackend()
    const host = new DesktopPetHost({ backend, storage, atlas, hookPipePath: null })

    await host.start()
    expect(handles).toHaveLength(1)
    expect(handles[0].shown).toBe(true)

    handles[0].options.onDrag?.(120, 80)
    expect(storage.load().instances[0]).toMatchObject({ position: { x: 120, y: 80 } })

    handles[0].options.onHover?.()
    expect(host.currentPose).toBe('jumping')
    handles[0].options.onUnhover?.()
    expect(host.currentPose).toBe('idle')

    handles[0].options.onClose?.()
    expect(handles[0].shown).toBe(false)

    await host.setScale(1.5)
    expect(storage.load().instances[0].scale).toBe(1.5)
    expect(handles).toHaveLength(2)
    expect(handles[0].destroyed).toBe(true)

    await host.stop()
    expect(handles[1].destroyed).toBe(true)
    expect(existsSync(storage.lockPath)).toBe(false)
  })

  it('rejects a second host while the first owns the data directory', async () => {
    const storage = new HostStorage(mkdtempSync(join(tmpdir(), 'codex-dsh-pet-')))
    const first = new DesktopPetHost({ backend: fakeBackend().backend, storage, atlas, hookPipePath: null })
    const second = new DesktopPetHost({ backend: fakeBackend().backend, storage, atlas, hookPipePath: null })

    await first.start()
    await expect(second.start()).rejects.toThrow(/already running/)
    await first.acceptHookEvent({ eventType: 'UserPromptSubmit', sessionId: 'saved-by-first-host', turnId: 't', timestamp: 1 })
    await first.stop()
    await second.start()
    try {
      expect(second.getSnapshot()[0]).toMatchObject({ sessionId: 'saved-by-first-host', feedback: 'UNKNOWN' })
    } finally { await second.stop() }
  })

  it('rejects completed turns and conservatively handles unknown turns and missing identifiers', async () => {
    const host = new DesktopPetHost({ backend: fakeBackend().backend,
      storage: new HostStorage(mkdtempSync(join(tmpdir(), 'pet-ordering-'))), atlas, hookPipePath: null })
    await host.start()
    const event = async (eventType: string, timestamp: number, turnId?: string) => {
      await host.acceptHookEvent({ eventType, sessionId: 'A', timestamp, turnId })
      return host.getSnapshot()[0].feedback
    }
    try {
      expect(await event('UserPromptSubmit', 1, 'z-last-lexically')).toBe('THINKING')
      expect(await event('Stop', 2, 'z-last-lexically')).toBe('UNKNOWN')
      expect(await event('UserPromptSubmit', 3, 'a-next-opaque-turn')).toBe('THINKING')
      expect(await event('PermissionRequest', 99, 'z-last-lexically')).toBe('THINKING')
      expect(await event('PreToolUse', 4, 'a-next-opaque-turn')).toBe('WORKING')
      expect(await event('Stop', 100, 'unseen-turn')).toBe('UNKNOWN')
      expect(await event('PreToolUse', 101, 'a-next-opaque-turn')).toBe('WORKING')
      expect(await event('PostToolUse', 102)).toBe('UNKNOWN')
      expect(await event('PreToolUse', 103, 'a-next-opaque-turn')).toBe('WORKING')
      expect(await event('PermissionRequest', 103, 'a-next-opaque-turn')).toBe('UNKNOWN')
      expect(await event('Interrupt', 104, 'a-next-opaque-turn')).toBe('INTERRUPTED')
      expect(await event('PreToolUse', 105, 'a-next-opaque-turn')).toBe('INTERRUPTED')
      expect(await event('SessionEnd', 106)).toBe('ENDED')
      expect(await event('PreToolUse', 107, 'unseen-turn')).toBe('ENDED')
      expect(await event('SessionStart', 108)).toBe('STARTING')
      expect(await event('UserPromptSubmit', 109, 'fresh')).toBe('THINKING')
    } finally { await host.stop() }
  })

  it('keeps stale permission waiting until trusted later activity and makes silent work unknown', async () => {
    let now = 1_000
    const host = new DesktopPetHost({ backend: fakeBackend().backend,
      storage: new HostStorage(mkdtempSync(join(tmpdir(), 'pet-stale-'))), atlas, hookPipePath: null, now: () => now })
    await host.start()
    try {
      await host.acceptHookEvent({ eventType: 'PermissionRequest', sessionId: 'A', turnId: 't', timestamp: 1 })
      now += 299_999
      expect(host.getSnapshot()[0]).toMatchObject({ feedback: 'POSSIBLY_WAITING', stale: false })
      await host.acceptHookEvent({ eventType: 'PostToolUse', sessionId: 'A', timestamp: 2 })
      now += 1
      expect(host.getSnapshot()[0]).toMatchObject({ feedback: 'POSSIBLY_WAITING', stale: true, availability: 'stale', pose: 'waiting' })
      now += 300_000
      expect(host.getSnapshot()[0].feedback).toBe('POSSIBLY_WAITING')
      await host.acceptHookEvent({ eventType: 'PostToolUse', sessionId: 'A', turnId: 't', timestamp: 3 })
      expect(host.getSnapshot()[0]).toMatchObject({ feedback: 'WORKING', stale: false, availability: 'observed' })
      now += 30_000
      expect(host.getSnapshot()[0]).toMatchObject({ feedback: 'UNKNOWN', stale: true, availability: 'stale', pose: 'idle' })
    } finally { await host.stop() }
  })

  it('does not invent turn completion from conflicting timestamps or regress on a late prompt', async () => {
    const host = new DesktopPetHost({ backend: fakeBackend().backend,
      storage: new HostStorage(mkdtempSync(join(tmpdir(), 'pet-conflict-'))), atlas, hookPipePath: null })
    await host.start()
    try {
      await host.acceptHookEvent({ eventType: 'PreToolUse', sessionId: 'A', turnId: 't', timestamp: 1 })
      await host.acceptHookEvent({ eventType: 'SessionEnd', sessionId: 'A', timestamp: 1 })
      expect(host.currentSemanticState).toBe('UNKNOWN')
      await host.acceptHookEvent({ eventType: 'PreToolUse', sessionId: 'A', turnId: 't', timestamp: 2 })
      expect(host.currentSemanticState).toBe('WORKING')
      await host.acceptHookEvent({ eventType: 'UserPromptSubmit', sessionId: 'A', turnId: 't', timestamp: 3 })
      expect(host.currentSemanticState).toBe('UNKNOWN')
      await host.acceptHookEvent({ eventType: 'PermissionRequest', sessionId: 'A', timestamp: 4 })
      expect(host.currentSemanticState).toBe('POSSIBLY_WAITING')
    } finally { await host.stop() }
  })

  it('allows trusted same-turn continuation after Stop without declaring success', async () => {
    const host = new DesktopPetHost({ backend: fakeBackend().backend,
      storage: new HostStorage(mkdtempSync(join(tmpdir(), 'pet-continuation-'))), atlas, hookPipePath: null })
    await host.start()
    try {
      await host.acceptHookEvent({ eventType: 'PreToolUse', sessionId: 'A', turnId: 't', timestamp: 1 })
      await host.acceptHookEvent({ eventType: 'Stop', sessionId: 'A', turnId: 't', timestamp: 2 })
      expect(host.currentSemanticState).toBe('UNKNOWN')
      await host.acceptHookEvent({ eventType: 'PreToolUse', sessionId: 'A', turnId: 't', timestamp: 3 })
      expect(host.currentSemanticState).toBe('WORKING')
      await host.acceptHookEvent({ eventType: 'Stop', sessionId: 'A', turnId: 't', timestamp: 4 })
      await host.acceptHookEvent({ eventType: 'UserPromptSubmit', sessionId: 'A', turnId: 't', timestamp: 5 })
      expect(host.currentSemanticState).toBe('THINKING')
    } finally { await host.stop() }
  })

  it('does not undo a binding received while an instance setting update is awaiting its window', async () => {
    const storage = new HostStorage(mkdtempSync(join(tmpdir(), 'pet-update-binding-')))
    const host = new DesktopPetHost({ backend: fakeBackend().backend, storage, atlas, hookPipePath: null })
    await host.start()
    try {
      const id = host.getSnapshot()[0].id
      const resizing = host.updateInstance(id, { scale: 2 })
      await Promise.resolve()
      await host.acceptHookEvent({ eventType: 'UserPromptSubmit', sessionId: 'arrived-during-resize', turnId: 't', timestamp: 1 })
      await resizing
      expect(host.getSnapshot()[0]).toMatchObject({ id, scale: 2, sessionId: 'arrived-during-resize', feedback: 'THINKING' })
      expect(storage.load().instances[0].sessionId).toBe('arrived-during-resize')
      await Promise.all([host.updateInstance(id, { scale: 3 }), host.updateInstance(id, { visible: false })])
      expect(host.getSnapshot()[0]).toMatchObject({ scale: 3, visible: false, sessionId: 'arrived-during-resize' })
    } finally { await host.stop() }
  })

  it('loads persisted roles from the downstream data directory', async () => {
    const storage = new HostStorage(mkdtempSync(join(tmpdir(), 'pet-roles-')))
    cpSync(new URL('../assets/pets/text', import.meta.url), join(storage.directory, 'pets', 'local-only'), { recursive: true })
    storage.save({ version: 2, instances: [{ ...defaultPetInstance('one'), roleId: 'local-only' }] })
    const host = new DesktopPetHost({ backend: fakeBackend().backend, storage, hookPipePath: null })
    await host.start()
    try {
      expect(host.getSnapshot()[0]).toMatchObject({ roleId: 'local-only', feedback: 'IDLE', pose: 'idle' })
      await expect(host.updateInstance('one', { roleId: '../outside' })).rejects.toThrow(/invalid role/)
      expect(storage.load().instances[0].roleId).toBe('local-only')
    } finally { await host.stop() }
  })

  it('restores independent settings and opaque bindings, reconnects, and only explicitly rebinds', async () => {
    const storage = new HostStorage(mkdtempSync(join(tmpdir(), 'pet-restart-')))
    const pipePath = process.platform === 'win32' ? `\\\\.\\pipe\\pet-test-${randomUUID()}` : join(tmpdir(), `pet-${randomUUID()}.sock`)
    const firstBackend = fakeBackend()
    const host = new DesktopPetHost({ backend: firstBackend.backend, storage, atlas, hookPipePath: pipePath })
    await host.start()
    await sendHookEvent({ eventType: 'PermissionRequest', sessionId: 'opaque-A', turnId: 'private-turn', timestamp: 1 }, { pipePath })
    await sendHookEvent({ eventType: 'PreToolUse', sessionId: 'opaque-B', turnId: 'private-turn-B', timestamp: 1 }, { pipePath })
    const [a, b] = host.getSnapshot()
    firstBackend.handles[0].options.onDrag?.(-200, 90)
    await host.updateInstance(a.id, { scale: 1.5, visible: false })
    await host.stop()
    expect(host.getSnapshot()[0]).toMatchObject({ feedback: 'UNKNOWN', availability: 'unavailable' })
    await expect(sendHookEvent({ eventType: 'Stop', sessionId: 'opaque-A', timestamp: 2 }, { pipePath, timeoutMs: 30 })).resolves.toBe(false)
    const restarted = new DesktopPetHost({ backend: fakeBackend().backend, storage, atlas, hookPipePath: pipePath })
    await restarted.start()
    try {
      expect(restarted.getSnapshot()).toMatchObject([
        { id: a.id, roleId: 'text', sessionId: 'opaque-A', scale: 1.5, visible: false,
          position: { x: -200, y: 90 }, feedback: 'UNKNOWN', availability: 'unobserved' },
        { id: b.id, roleId: 'text', sessionId: 'opaque-B', scale: 1, visible: true,
          feedback: 'UNKNOWN', availability: 'unobserved' },
      ])
      await sendHookEvent({ eventType: 'PreToolUse', sessionId: 'opaque-B', turnId: 'resumed', timestamp: 3 }, { pipePath })
      expect(restarted.getSnapshot()[1].feedback).toBe('WORKING')
      expect(restarted.getSnapshot()[0].feedback).toBe('UNKNOWN')
      expect(() => restarted.bindInstance(a.id, 'opaque-B')).toThrow(/already bound/)
      restarted.bindInstance(a.id, null)
      expect(restarted.getSnapshot()[0]).toMatchObject({ sessionId: undefined, feedback: 'IDLE', availability: 'unbound' })
      restarted.bindInstance(a.id, 'opaque-C')
      expect(restarted.getSnapshot()[0]).toMatchObject({ sessionId: 'opaque-C', feedback: 'UNKNOWN', availability: 'unobserved' })
      await sendHookEvent({ eventType: 'UserPromptSubmit', sessionId: 'opaque-A', turnId: 'new', timestamp: 4 }, { pipePath })
      expect(restarted.getSnapshot()).toHaveLength(3)
      expect(restarted.getSnapshot()[0].sessionId).toBe('opaque-C')
      const saved = JSON.parse(readFileSync(storage.statePath, 'utf8'))
      expect(saved).toEqual({ version: 2, instances: restarted.getSnapshot().map(pet => ({
        id: pet.id, roleId: pet.roleId, sessionId: pet.sessionId, scale: pet.scale, visible: pet.visible, position: pet.position,
      })) })
      expect(readFileSync(storage.statePath, 'utf8')).not.toMatch(/private-turn|resumed|feedback|lastEvent|timestamp/)
    } finally { await restarted.stop() }
  })

  it('keeps lifecycle feedback honest and isolated from another session', async () => {
    const storage = new HostStorage(mkdtempSync(join(tmpdir(), 'pet-hooks-')))
    const host = new DesktopPetHost({ backend: fakeBackend().backend, storage, atlas, hookPipePath: null })
    await host.start()
    try {
      await host.acceptHookEvent({ eventType: 'SessionStart', sessionId: 's1', timestamp: 1 })
      expect(host.currentSemanticState).toBe('STARTING')
      expect(host.currentPose).toBe('waving')
      await host.acceptHookEvent({ eventType: 'UserPromptSubmit', sessionId: 's1', timestamp: 2, turnId: 't1' })
      expect(host.currentSemanticState).toBe('THINKING')
      await host.acceptHookEvent({ eventType: 'PreToolUse', sessionId: 's1', timestamp: 3, turnId: 't1' })
      expect(host.currentPose).toBe('running')
      await host.acceptHookEvent({ eventType: 'PermissionRequest', sessionId: 's1', timestamp: 4, turnId: 't1' })
      expect(host.currentSemanticState).toBe('POSSIBLY_WAITING')
      expect(host.currentPose).toBe('waiting')
      await host.acceptHookEvent({ eventType: 'Stop', sessionId: 'other', timestamp: 5 })
      expect(host.currentSemanticState).toBe('POSSIBLY_WAITING')
      await host.acceptHookEvent({ eventType: 'Stop', sessionId: 's1', timestamp: 6, turnId: 't1' })
      expect(host.currentSemanticState).toBe('UNKNOWN')
      await host.acceptHookEvent({ eventType: 'SessionEnd', sessionId: 's1', timestamp: 7 })
      expect(host.currentSemanticState).toBe('ENDED')
      await host.acceptHookEvent({ eventType: 'PreToolUse', sessionId: 's1', timestamp: 3, turnId: 't1' })
      expect(host.currentSemanticState).toBe('ENDED')
    } finally { await host.stop() }
  })
})
