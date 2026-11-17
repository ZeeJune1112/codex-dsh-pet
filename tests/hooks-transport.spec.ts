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
    vi.useFakeTimers()
    try {
      const result = sendHookEvent(event, { connect: () => new Promise(() => {}), timeoutMs: 40 })
      await vi.advanceTimersByTimeAsync(40)
      await expect(result).resolves.toBe(false)
    } finally { vi.useRealTimers() }
  })

  it('drops readiness after the deadline without making a late retry', async () => {
    vi.useFakeTimers()
    try {
      let ready!: () => void
      let signal!: AbortSignal
      const connect = vi.fn(async (): Promise<PipeConnection> => { throw new Error('unavailable') })
      const result = sendHookEvent(event, { connect, launchHost: value => {
        signal = value
        return new Promise<void>(resolve => { ready = resolve })
      } })
      await vi.advanceTimersByTimeAsync(800)
      await expect(result).resolves.toBe(false)
      expect(signal.aborted).toBe(true)
      ready()
      await vi.advanceTimersByTimeAsync(1)
      expect(connect).toHaveBeenCalledTimes(1)
    } finally { vi.useRealTimers() }
  })

  it('delivers a normalized event over a real local pipe', async () => {
    const pipePath = process.platform === 'win32' ? `\\\\.\\pipe\\pet-test-${randomUUID()}` : join(tmpdir(), `pet-${randomUUID()}.sock`)
    const events: NormalizedHookEvent[] = []
    const server = new HookEventServer({ pipePath, onEvent: value => { events.push(value) } })
    await server.start()
    try {
      await expect(sendHookEvent({ ...event, turnId: 't1' }, { pipePath })).resolves.toBe(true)
      expect(events).toEqual([{ ...event, turnId: 't1' }])
    } finally { await server.stop() }
  })

  it('waits for real detached pipe readiness before its single delivery attempt', async () => {
    const pipePath = process.platform === 'win32' ? `\\\\.\\pipe\\pet-test-${randomUUID()}` : join(tmpdir(), `pet-${randomUUID()}.sock`)
    const fixture = fileURLToPath(new URL('./fixtures/hook-host.mjs', import.meta.url))
    await launchDetachedHost(fixture, pipePath, 5000)
    const launchHost = vi.fn(async () => { throw new Error('already started') })
    await expect(sendHookEvent({ ...event, sessionId: 'fixture-session' }, {
      pipePath, launchHost, timeoutMs: 5000,
    })).resolves.toBe(true)
    expect(launchHost).not.toHaveBeenCalled()
  })
})
