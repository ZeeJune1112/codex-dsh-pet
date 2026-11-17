import { afterEach, expect, it, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { request } from 'node:http'
import { DesktopPetHost } from '../src/standalone'
import { acquireInstanceLock, HostStorage } from '../src/host/persistence'
import { ManagementServer } from '../src/management/server'
import * as petApi from '../src/pet-api'
import sharp from 'sharp'

const cleanup: Array<() => Promise<unknown>> = []
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close() })
async function setup(now?: () => number) {
  const directory = await mkdtemp(join(tmpdir(), 'pet-management-'))
  cleanup.push(() => rm(directory, { recursive: true, force: true, maxRetries: 4 }))
  const handles: any[] = []
  const backend = { name: 'test', isSupported: () => true, async create(options: unknown) {
    const handle = { options, shown: true, destroyed: false, frames: 0, present() { this.frames++ }, move() {}, setAlwaysOnTop() {}, show() { this.shown = true }, hide() { this.shown = false }, destroy() { this.destroyed = true } }
    handles.push(handle); return handle
  } }
  const storage = new HostStorage(directory)
  const host = new DesktopPetHost({ backend, storage, hookPipePath: null, now })
  await host.start(); cleanup.push(() => host.stop())
  const server = new ManagementServer(host, { legacyDirectory: join(directory, 'legacy'), bundle: '/* management */' })
  await server.start(); cleanup.push(() => server.stop())
  const url = new URL(server.url)
  const endpoint = (path: string) => `${url.origin}${path}${path.includes('?') ? '&' : '?'}${url.searchParams}`
  const post = (path: string, body: unknown) => fetch(endpoint(`/dsh-pet/${path}`), { method: 'POST', headers: { origin: url.origin, 'content-type': 'application/json' }, body: JSON.stringify(body) })
  return { directory, storage, host, server, url, endpoint, post, handles, backend }
}
it('joins concurrent shutdowns until an accepted window creation has finished', async () => {
  const { host, server, storage, handles, backend } = await setup()
  await server.stop()
  const url = new URL(await host.startManagement())
  let release!: () => void
  let announce!: () => void
  const entered = new Promise<void>(resolve => { announce = resolve })
  const gate = new Promise<void>(resolve => { release = resolve })
  const create = backend.create
  backend.create = async options => { announce(); await gate; return create(options) }
  let first: Promise<void> | undefined
  let second: Promise<void> | undefined
  const creating = fetch(`${url.origin}/dsh-pet/create?${url.searchParams}`, {
    method: 'POST', headers: { origin: url.origin, 'content-type': 'application/json' }, body: JSON.stringify({ roleId: 'text' }),
  }).catch(() => {})
  try {
    await entered
    let firstDone = false
    let secondDone = false
    first = host.stop().then(() => { firstDone = true })
    second = host.stop().then(() => { secondDone = true })
    await new Promise(resolve => setTimeout(resolve, 50))
    expect(firstDone).toBe(false)
    expect(secondDone).toBe(false)
    expect(() => acquireInstanceLock(storage.lockPath)).toThrow(/already running/)
    release()
    await Promise.all([first, second, creating])
    expect(handles.every(handle => handle.destroyed)).toBe(true)
    const lock = acquireInstanceLock(storage.lockPath)
    lock.release()
  } finally { release(); await Promise.all([first, second, creating]) }
})

it('shuts down windows and releases ownership even when an authenticated POST body is incomplete', async () => {
  const { host, server, storage, handles } = await setup()
  await server.stop()
  const url = new URL(await host.startManagement())
  let reading!: () => void
  const startedReading = new Promise<void>(resolve => { reading = resolve })
  const readBody = petApi.readJsonBody
  const reader = vi.spyOn(petApi, 'readJsonBody').mockImplementation(async (...args) => {
    reading()
    return readBody(...args)
  })
  const req = request(`${url.origin}/dsh-pet/bind?${url.searchParams}`, {
    method: 'POST', headers: { origin: url.origin, 'content-type': 'application/json', 'content-length': '100' },
  })
  req.on('error', () => {})
  let stopping: Promise<void> | undefined
  try {
    req.write('{')
    await startedReading
    stopping = host.stop()
    await expect(Promise.race([stopping.then(() => true), new Promise(resolve => setTimeout(() => resolve(false), 500))])).resolves.toBe(true)
    expect(handles.every(handle => handle.destroyed)).toBe(true)
    const lock = acquireInstanceLock(storage.lockPath)
    lock.release()
    expect(host.managementUrl).toBeUndefined()
  } finally { req.destroy(); await stopping; reader.mockRestore() }
})

it('authenticates HTML, script, preview and API on a random loopback listener and rejects foreign origins/hosts', async () => {
  const { url, endpoint, post } = await setup()
  expect(url.hostname).toBe('127.0.0.1'); expect(Number(url.port)).toBeGreaterThan(0)
  expect(url.searchParams.get('token')!.length).toBeGreaterThanOrEqual(43)
  for (const path of ['/', '/management.js', '/dsh-pet/state', '/dsh-pet/preview?id=text', '/dsh-pet/update', '/dsh-pet/select',
    '/dsh-pet/reorder', '/dsh-pet/import-petdex', '/dsh-pet/import-codex', '/dsh-pet/create', '/dsh-pet/bind', '/dsh-pet/migrate', '/dsh-pet/quit']) {
    expect((await fetch(`${url.origin}${path}`)).status).toBe(401)
    expect((await fetch(`${url.origin}${path}${path.includes('?') ? '&' : '?'}token=wrong`)).status).toBe(401)
  }
  const html = await fetch(endpoint('/'))
  expect(html.status).toBe(200)
  expect(html.headers.get('referrer-policy')).toBe('no-referrer')
  expect(html.headers.get('cache-control')).toBe('no-store')
  expect(await html.text()).toContain('management.js?token=')
  expect((await fetch(endpoint('/management.js'))).status).toBe(200)
  expect((await fetch(endpoint('/dsh-pet/preview?id=text'))).headers.get('content-type')).toBe('image/png')
  expect((await fetch(endpoint('/dsh-pet/update'), { method: 'POST', headers: { origin: 'https://evil.example' }, body: '{}' })).status).toBe(403)
  const badHost = await new Promise<number>(resolve => {
    const req = request(endpoint('/dsh-pet/state'), { headers: { host: 'evil.example' } }, response => { response.resume(); resolve(response.statusCode!) }); req.end()
  })
  expect(badHost).toBe(403)
  expect((await post('update', null)).status).toBe(400)
  expect((await post('state', {})).status).toBe(405)
  const state: any = await (await fetch(endpoint('/dsh-pet/state'))).json()
  expect(state.pets[0]).toMatchObject({ roleId: 'text', feedback: 'IDLE', availability: 'unbound' })
})
it('imports a ZIP into a rendered instance and keeps role reuse, bindings and settings independent', async () => {
  const { post, endpoint, url, host, handles, storage } = await setup()
  const { readFile } = await import('node:fs/promises')
  const { zipSync } = await import('fflate')
  const manifest = JSON.parse(await readFile(new URL('../assets/pets/text/pet.json', import.meta.url), 'utf8'))
  const zip = zipSync({ 'pet.json': Buffer.from(JSON.stringify({ ...manifest, id: 'local-role', displayName: 'Local role' })), 'spritesheet.webp': await readFile(new URL('../assets/pets/text/spritesheet.webp', import.meta.url)) })
  const imported = await fetch(endpoint('/dsh-pet/import-codex?filename=local.zip'), { method: 'POST', headers: { origin: url.origin }, body: zip })
  expect(imported.status).toBe(200)
  const state: any = await imported.json()
  const id = state.selectedPetId
  expect(state.roles).toContainEqual({ id: 'local-role', displayName: 'Local role' })
  expect(state.pets.find((pet: any) => pet.id === id)).toMatchObject({ roleId: 'local-role', visible: true, feedback: 'IDLE' })
  expect(handles.length).toBe(2); expect(handles[1].frames).toBeGreaterThan(0)
  expect((await fetch(endpoint('/dsh-pet/preview?id=local-role'))).status).toBe(200)
  const created: any = await (await post('create', { roleId: 'local-role' })).json()
  const other = created.selectedPetId
  expect(other).not.toBe(id)
  expect((await post('bind', { id, sessionId: 'chat-A' })).status).toBe(200)
  expect((await post('bind', { id: other, sessionId: 'chat-B' })).status).toBe(200)
  expect((await post('bind', { id, sessionId: 'chat-B' })).status).toBe(400)
  const updated: any = await (await post('update', { id, patch: { visible: false, scale: 1.5, hideWhenIdle: true, alwaysOnTop: false, animationSpeed: 2, clickThrough: true, animationEnabled: false, idleFrequencySec: 8, startSleeping: true } })).json()
  expect(updated.pets.find((pet: any) => pet.id === id)).toMatchObject({ visible: false, scale: 1.5, sessionId: 'chat-A', alwaysOnTop: false, animationSpeed: 2 })
  expect(host.getSnapshot().find(pet => pet.id === other)).toMatchObject({ visible: true, scale: 1, sessionId: 'chat-B' })
  expect(handles.at(-1).options).toMatchObject({ alwaysOnTop: false, clickThrough: true })
  expect((await post('bind', { id, sessionId: null })).status).toBe(200)
  expect(host.getSnapshot().find(pet => pet.id === id)).toMatchObject({ feedback: 'IDLE', availability: 'unbound', pose: 'idle' })
  await post('update', { id, patch: { visible: true } })
  expect(handles.at(-1).shown).toBe(false)
  await post('bind', { id, sessionId: 'chat-C' })
  expect(handles.at(-1).shown).toBe(true)
  expect(host.getSnapshot().find(pet => pet.id === id)).toMatchObject({ feedback: 'UNKNOWN', availability: 'unobserved' })
  const order = [...created.order].reverse()
  expect((await post('reorder', { order })).status).toBe(200)
  expect(((await (await post('select', { id })).json()) as any).selectedPetId).toBe(id)
  expect(storage.load().instances.map(pet => pet.id)).toEqual(order)
  expect(storage.load().selectedInstanceId).toBe(id)
})

it('declines migration without writes, then migrates validated roles/settings once and preserves existing bindings', async () => {
  const { directory, post, endpoint, host, storage } = await setup()
  const { mkdir, cp, readFile, writeFile, readdir } = await import('node:fs/promises')
  const legacy = join(directory, 'legacy')
  await mkdir(join(legacy, 'pets'), { recursive: true })
  await cp(new URL('../assets/pets/text', import.meta.url), join(legacy, 'pets', 'migrated'), { recursive: true })
  const settings = { version: 1, selectedPetId: 'migrated', order: ['migrated'], pets: { migrated: { visible: true, scale: 1.62, hideWhenIdle: true, position: { x: -20, y: 120 } } } }
  await writeFile(join(legacy, 'state.json'), JSON.stringify(settings))
  const id = host.getSnapshot()[0].id
  await post('bind', { id, sessionId: 'keep-this-chat' })
  const before = await readFile(storage.statePath, 'utf8')
  const files = await readdir(directory)
  expect((await (await fetch(endpoint('/dsh-pet/state'))).json() as any).migration).toBe('available')
  expect((await post('migrate', { confirm: false })).status).toBe(200)
  expect(await readFile(storage.statePath, 'utf8')).toBe(before)
  expect(await readdir(directory)).toEqual(files)
  expect((await post('migrate', { confirm: true })).status).toBe(200)
  const state = await (await fetch(endpoint('/dsh-pet/state'))).json() as any
  expect(state.migration).toBe('completed')
  expect(state.pets.find((pet: any) => pet.roleId === 'migrated')).toMatchObject({ scale: 1.5, position: { x: -20, y: 120 }, hideWhenIdle: true, availability: 'unbound' })
  expect(host.getSnapshot()[0].sessionId).toBe('keep-this-chat')
  expect(JSON.parse(await readFile(join(legacy, 'state.json'), 'utf8'))).toEqual(settings)
  const after = await readFile(storage.statePath, 'utf8')
  await post('migrate', { confirm: true })
  expect(await readFile(storage.statePath, 'utf8')).toBe(after)
})
it.each([false, true])('migrates legacy preferences as a separate instance even when the role already exists (configured: %s)', async configured => {
  const { directory, post, host, storage } = await setup()
  const { mkdir, writeFile, readFile } = await import('node:fs/promises')
  const original = host.getSnapshot()[0].id
  if (configured) {
    await host.updateInstance(original, { scale: 3 })
    host.bindInstance(original, 'keep-downstream-chat')
  }
  const before = host.getSnapshot()[0]
  const legacy = join(directory, 'legacy')
  await mkdir(legacy)
  const preferences = { scale: 2, position: { x: 310, y: 270 }, visible: false, hideWhenIdle: true }
  await writeFile(join(legacy, 'state.json'), JSON.stringify({ version: 1, selectedPetId: 'text', order: ['text'], pets: { text: preferences } }))
  const response = await post('migrate', { confirm: true })
  expect(response.status).toBe(200)
  const state = await response.json() as any
  expect(state.migration).toBe('completed')
  expect(state.pets).toHaveLength(2)
  expect(host.getSnapshot().find(pet => pet.id === original)).toEqual(before)
  expect(state.pets.find((pet: any) => pet.id !== original)).toMatchObject({ roleId: 'text', ...preferences, availability: 'unbound' })
  const saved = await readFile(storage.statePath, 'utf8')
  expect(storage.load().instances.find(pet => pet.id !== original)).toMatchObject(preferences)
  expect((await post('migrate', { confirm: true })).status).toBe(200)
  expect(await readFile(storage.statePath, 'utf8')).toBe(saved)
})

it.each(['invalid-sprite', 'oversized-sprite', 'escape', 'junction', 'save-failure'])('preserves old data and existing downstream roles/bindings when migration fails: %s', async failure => {
  const { directory, post, host, storage } = await setup()
  const { mkdir, cp, readFile, writeFile, readdir, symlink } = await import('node:fs/promises')
  const { vi } = await import('vitest')
  const legacy = join(directory, 'legacy')
  await mkdir(join(legacy, 'pets'), { recursive: true })
  await cp(new URL('../assets/pets/text', import.meta.url), join(legacy, 'pets', 'migration-failure'), { recursive: true })
  await cp(new URL('../assets/pets/text', import.meta.url), join(directory, 'pets', 'existing'), { recursive: true })
  const existing = await readFile(join(directory, 'pets', 'existing', 'spritesheet.webp'))
  const manifestPath = join(legacy, 'pets', 'migration-failure', 'pet.json')
  if (failure === 'invalid-sprite') await writeFile(join(legacy, 'pets', 'migration-failure', 'spritesheet.webp'), 'invalid image')
  if (failure === 'oversized-sprite') await writeFile(join(legacy, 'pets', 'migration-failure', 'spritesheet.webp'),
    await sharp({ create: { width: 2048, height: 2048, channels: 4, background: '#00000000' } }).png().toBuffer())
  if (failure === 'escape') await writeFile(manifestPath, JSON.stringify({ id: 'bad', spritesheetPath: '../../outside.webp' }))
  if (failure === 'junction') {
    await mkdir(join(directory, 'outside'))
    await symlink(join(directory, 'outside'), join(legacy, 'pets', 'migration-failure', 'linked'), 'junction')
  }
  await post('bind', { id: host.getSnapshot()[0].id, sessionId: 'existing-chat' })
  const before = await readFile(storage.statePath, 'utf8')
  const oldManifest = await readFile(manifestPath, 'utf8')
  const save = failure === 'save-failure' ? vi.spyOn(storage, 'save').mockImplementationOnce(() => { throw new Error('disk full') }) : undefined
  const raw = failure === 'oversized-sprite' ? vi.spyOn(sharp.prototype, 'raw') : undefined
  const response = await post('migrate', { confirm: true })
  save?.mockRestore()
  if (raw) { expect(raw).not.toHaveBeenCalled(); raw.mockRestore() }
  expect(response.status).toBe(400)
  expect(await readFile(storage.statePath, 'utf8')).toBe(before)
  expect(await readFile(manifestPath, 'utf8')).toBe(oldManifest)
  expect(await readFile(join(directory, 'pets', 'existing', 'spritesheet.webp'))).toEqual(existing)
  expect(await readdir(join(directory, 'pets'))).toEqual(['existing'])
  expect(host.getSnapshot()).toHaveLength(1)
  expect(host.getSnapshot()[0].sessionId).toBe('existing-chat')
  expect((await readdir(directory)).some(name => name.startsWith('.migration'))).toBe(false)
})

it('hides after sixty seconds of unbound idle, wakes on activity and never sleeps unknown or permission-waiting chats', async () => {
  let now = 1_000
  const { post, host, handles } = await setup(() => now)
  const id = host.getSnapshot()[0].id
  await post('update', { id, patch: { hideWhenIdle: true } })
  now += 59_999
  expect(host.getSnapshot()[0]).toMatchObject({ feedback: 'IDLE', sleeping: false })
  expect(handles[0].shown).toBe(true)
  now++
  expect(host.getSnapshot()[0]).toMatchObject({ feedback: 'IDLE', sleeping: true })
  expect(handles[0].shown).toBe(false)
  await host.acceptHookEvent({ eventType: 'UserPromptSubmit', sessionId: 'sleep-test', turnId: 't', timestamp: 1 })
  expect(handles[0].shown).toBe(true)
  now += 60_000
  expect(host.getSnapshot()[0]).toMatchObject({ feedback: 'UNKNOWN', sleeping: false })
  expect(handles[0].shown).toBe(true)
  await host.acceptHookEvent({ eventType: 'PermissionRequest', sessionId: 'sleep-test', turnId: 't', timestamp: 2 })
  now += 300_000
  expect(host.getSnapshot()[0]).toMatchObject({ feedback: 'POSSIBLY_WAITING', stale: true, sleeping: false })
  expect(handles[0].shown).toBe(true)
  await host.acceptHookEvent({ eventType: 'SessionEnd', sessionId: 'sleep-test', timestamp: 3 })
  now += 60_000
  expect(host.getSnapshot()[0]).toMatchObject({ feedback: 'ENDED', sleeping: true })
  expect(handles[0].shown).toBe(false)
})
