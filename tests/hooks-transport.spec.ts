import { describe, expect, it, vi } from 'vitest'
import { launchDetachedHost, sendHookEvent, type PipeConnection } from '../src/integration/hooks-transport'
import { fileURLToPath } from 'node:url'
import { HookEventServer } from '../src/host/hook-server'
import { randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { NormalizedHookEvent } from '../src/integration/hooks'

const event: NormalizedHookEvent = { eventType: 'SessionStart', sessionId: 's1', timestamp: 1 }

describe('hook pipe transport', () => {
  it('writes one normalized JSON line to the named pipe', async () => {
    const writes: string[] = []
    const connect = vi.fn(async (): Promise<PipeConnection> => ({
      write: async value => { writes.push(value) },
      close: () => {},
    }))
    await expect(sendHookEvent(event, { pipePath: 'pipe', connect, launchHost: async () => {} })).resolves.toBe(true)
    expect(connect).toHaveBeenCalledTimes(1)
    expect(writes).toEqual([`${JSON.stringify(event)}\n`])
  })

  it('launches the detached host once and retries once after a pipe failure', async () => {
    let attempts = 0
    const connect = vi.fn(async (): Promise<PipeConnection> => {
      attempts += 1
      if (attempts === 1) throw new Error('pipe unavailable')
      return { write: async () => {}, close: () => {} }
    })
    const launchHost = vi.fn(async () => {})
    await expect(sendHookEvent(event, { pipePath: 'pipe', connect, launchHost })).resolves.toBe(true)
    expect(connect).toHaveBeenCalledTimes(2)
    expect(launchHost).toHaveBeenCalledTimes(1)
  })

  it('swallows pipe and launch failures so the hook remains nonblocking', async () => {
    const connect = vi.fn(async (): Promise<PipeConnection> => { throw new Error('pipe unavailable') })
    const launchHost = vi.fn(async () => { throw new Error('spawn unavailable') })
    await expect(sendHookEvent(event, { pipePath: 'pipe', connect, launchHost })).resolves.toBe(false)
    expect(connect).toHaveBeenCalledTimes(1)
    expect(launchHost).toHaveBeenCalledTimes(1)
  })

  it('bounds a stalled connection and still resolves false', async () => {
    const start = Date.now()
    await expect(sendHookEvent(event, {
      connect: () => new Promise(() => {}), timeoutMs: 40,
    })).resolves.toBe(false)
    expect(Date.now() - start).toBeLessThan(500)
  })

  it('delivers a normalized event over a real local pipe', async () => {
    const pipePath = process.platform === 'win32' ? `\\\\.\\pipe\\pet-test-${randomUUID()}` : join(tmpdir(), `pet-${randomUUID()}.sock`)
    const events: NormalizedHookEvent[] = []
    const server = new HookEventServer({ pipePath, onEvent: value => events.push(value) })
    await server.start()
    try {
      await expect(sendHookEvent({ ...event, turnId: 't1' }, { pipePath })).resolves.toBe(true)
      expect(events).toEqual([{ ...event, turnId: 't1' }])
    } finally { await server.stop() }
  })

  it('retries after a real detached host becomes ready', async () => {
    const pipePath = process.platform === 'win32' ? `\\\\.\\pipe\\pet-test-${randomUUID()}` : join(tmpdir(), `pet-${randomUUID()}.sock`)
    const fixture = fileURLToPath(new URL('./fixtures/hook-host.mjs', import.meta.url))
    await expect(sendHookEvent({ ...event, sessionId: 'fixture-session' }, {
      pipePath, launchHost: () => launchDetachedHost(fixture, pipePath),
    })).resolves.toBe(true)
  })
})
