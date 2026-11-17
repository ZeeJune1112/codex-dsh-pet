import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { runDesktopPetHost } from '../lib/standalone.js'
import { normalizeHookEvent, sendHookEvent } from '../lib/hooks.js'

const native = process.argv.includes('--native')
if (native) assert.equal(process.platform, 'win32', 'native smoke requires Windows')
const root = await mkdtemp(join(tmpdir(), 'pet-pipeline-'))
const previous = process.env.LOCALAPPDATA
const diagnostic = process.env.CODEX_PET_DIAGNOSTICS
process.env.LOCALAPPDATA = root
delete process.env.CODEX_PET_DIAGNOSTICS
const pipePath = process.platform === 'win32' ? `\\\\.\\pipe\\pet-pipeline-${randomUUID()}` : join(root, 'events.sock')
let now = 0
const handles = []
const backend = native ? undefined : {
  name: 'verification', isSupported: () => true, async create() {
    const handle = { destroyed: false, present() {}, move() {}, setAlwaysOnTop() {}, show() {}, hide() {}, destroy() { this.destroyed = true } }
    handles.push(handle)
    return handle
  },
}
let host
const options = { backend, hookPipePath: pipePath, now: () => now }
const guard = setTimeout(() => { console.error('Pipeline verification exceeded 20 seconds'); process.exit(1) }, 20_000)
const send = async (eventType, sessionId, turnId, timestamp) => {
  const event = normalizeHookEvent({ hook_event_name: eventType, session_id: sessionId, turn_id: turnId, timestamp,
    prompt: 'discarded fixture', tool_input: { secret: 'discarded fixture' } })
  assert(event)
  assert(!('prompt' in event) && !('tool_input' in event))
  assert.equal(await sendHookEvent(event, { pipePath, launchHost() { throw new Error('verification never launches an external host') } }), true)
}
const pet = session => host.getSnapshot().find(value => value.sessionId === session)
try {
  host = await runDesktopPetHost(options)
  await send('UserPromptSubmit', 'fixture-a', 'a1', 1)
  await send('PermissionRequest', 'fixture-a', 'a1', 2)
  await send('PreToolUse', 'fixture-b', 'b1', 1)
  assert.equal(pet('fixture-a').feedback, 'POSSIBLY_WAITING')
  assert.equal(pet('fixture-b').feedback, 'WORKING')
  assert.notEqual(pet('fixture-a').id, pet('fixture-b').id)
  now = 300_001
  assert.equal(pet('fixture-a').stale, true)
  assert.equal(pet('fixture-a').feedback, 'POSSIBLY_WAITING')
  await send('PostToolUse', 'fixture-a', 'a1', 3)
  await send('PreToolUse', 'fixture-b', 'b1', 2)
  await send('Interrupt', 'fixture-a', 'a1', 4)
  assert.equal(pet('fixture-a').feedback, 'INTERRUPTED')
  assert.equal(pet('fixture-b').feedback, 'WORKING')
  await host.updateInstance(pet('fixture-b').id, { scale: 1.5, visible: false })
  await host.stop()
  const disconnected = normalizeHookEvent({ hook_event_name: 'Stop', session_id: 'fixture-a', turn_id: 'a1' })
  assert.equal(await sendHookEvent(disconnected, { pipePath, launchHost() { throw new Error('deliberately unavailable') } }), false)
  host = await runDesktopPetHost(options)
  assert.equal(pet('fixture-a').feedback, 'UNKNOWN')
  assert.equal(pet('fixture-b').feedback, 'UNKNOWN')
  assert.equal(pet('fixture-b').visible, false)
  assert.equal(pet('fixture-b').scale, 1.5)
  await send('SessionEnd', 'fixture-a', undefined, 5)
  assert.equal(pet('fixture-a').feedback, 'ENDED')
  now += 60_001
  assert.equal(pet('fixture-a').sleeping, true)
  assert.equal(pet('fixture-b').sleeping, false)
  const url = new URL(host.managementUrl)
  assert.equal((await fetch(url.origin)).status, 401)
  const response = await fetch(`${url.origin}/dsh-pet/state?${url.searchParams}`)
  assert.equal(response.status, 200)
  assert.equal((await response.json()).pets.length, 2)
  console.log(`Pipeline passed (${native ? 'real Win32 windows' : 'synthetic window backend'}; real pipe, synthetic events/clock, isolated process data, no Codex Hook activation).`)
} finally {
  await host?.stop()
  clearTimeout(guard)
  if (!native) assert(handles.every(handle => handle.destroyed))
  if (previous === undefined) delete process.env.LOCALAPPDATA
  else process.env.LOCALAPPDATA = previous
  if (diagnostic === undefined) delete process.env.CODEX_PET_DIAGNOSTICS
  else process.env.CODEX_PET_DIAGNOSTICS = diagnostic
  assert(resolve(root).startsWith(resolve(tmpdir()) + sep))
  await rm(root, { recursive: true, force: true, maxRetries: 4, retryDelay: 75 })
}
