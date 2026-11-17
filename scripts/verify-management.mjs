import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { runDesktopPetHost } from '../lib/standalone.js'

const bundle = await readFile(new URL('../lib/management.js', import.meta.url), 'utf8')
assert(!bundle.includes('__ModuleLoader__'), 'management must run without a DSH shell')
const root = await mkdtemp(join(tmpdir(), 'pet-manager-verify-'))
const previous = process.env.LOCALAPPDATA
process.env.LOCALAPPDATA = root
const handles = []
const host = await runDesktopPetHost({ hookPipePath: null, backend: {
  name: 'verification', isSupported: () => true, async create(options) {
    const handle = { options, visible: true, destroyed: false, present() {}, move() {}, setAlwaysOnTop() {},
      show() { this.visible = true }, hide() { this.visible = false }, destroy() { this.destroyed = true } }
    handles.push(handle); return handle
  },
} })
try {
  const url = new URL(host.managementUrl)
  const endpoint = path => `${url.origin}/dsh-pet/${path}?${url.searchParams}`
  const post = (path, body) => fetch(endpoint(path), { method: 'POST', headers: { origin: url.origin, 'content-type': 'application/json' }, body: JSON.stringify(body) })
  assert.equal(url.hostname, '127.0.0.1')
  assert.equal((await fetch(url.origin)).status, 401)
  assert.equal((await fetch(url)).status, 200)
  assert.equal((await fetch(`${url.origin}/management.js?${url.searchParams}`)).status, 200)
  const discovery = execFileSync(process.execPath, [resolve('lib/standalone.js'), '--management-url'], { encoding: 'utf8', env: process.env }).trim()
  assert.equal(discovery, host.managementUrl)
  const created = await (await post('create', { roleId: 'text' })).json()
  assert.equal(created.pets.length, 2)
  const id = created.selectedPetId
  assert.equal((await post('bind', { id, sessionId: 'synthetic-management-check' })).status, 200)
  assert.equal((await post('update', { id, patch: { visible: false } })).status, 200)
  assert.equal(handles[0].visible, true)
  assert.equal(handles[1].visible, false)
  const state = await (await fetch(endpoint('state'))).json()
  assert.equal(state.pets.find(pet => pet.id === id).availability, 'unobserved')
  assert.equal((await post('quit', {})).status, 200)
  for (let i = 0; i < 100 && handles.some(handle => !handle.destroyed); i++) await new Promise(resolve => setTimeout(resolve, 10))
  assert(handles.every(handle => handle.destroyed), 'quit must close all windows')
  assert.equal(host.managementUrl, undefined)
  console.log('Management verification passed (built browser bundle/API, synthetic window backend; no Hooks activation).')
} finally {
  await host.stop()
  if (previous === undefined) delete process.env.LOCALAPPDATA
  else process.env.LOCALAPPDATA = previous
  assert(resolve(root).startsWith(resolve(tmpdir()) + '\\') || resolve(root).startsWith(resolve(tmpdir()) + '/'))
  await rm(root, { recursive: true, force: true, maxRetries: 4, retryDelay: 75 })
}
