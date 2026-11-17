import { spawn } from 'node:child_process'
import { createConnection } from 'node:net'
import { createHash } from 'node:crypto'
import { homedir } from 'node:os'
import { fileURLToPath } from 'node:url'
import type { NormalizedHookEvent } from './hooks'

export const DEFAULT_HOOK_PIPE = `\\\\.\\pipe\\codex-dsh-pet-${createHash('sha256').update(homedir().toLowerCase()).digest('hex').slice(0, 20)}`

export interface PipeConnection {
  write(value: string): Promise<void>
  close(): void
}

export interface HookTransportOptions {
  pipePath?: string
  connect?: (pipePath: string, signal?: AbortSignal) => Promise<PipeConnection>
  launchHost?: (signal: AbortSignal) => Promise<void> | void
  timeoutMs?: number
}

function connectPipe(pipePath: string, signal?: AbortSignal): Promise<PipeConnection> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(new Error('pipe deadline')); return }
    const socket = createConnection(pipePath)
    const abort = () => socket.destroy(new Error('pipe deadline'))
    signal?.addEventListener('abort', abort, { once: true })
    socket.once('close', () => signal?.removeEventListener('abort', abort))
    socket.on('error', reject)
    socket.once('connect', () => resolve({
      write(value) {
        return new Promise<void>((resolveWrite, rejectWrite) => {
          socket.once('error', rejectWrite)
          socket.once('close', () => rejectWrite(new Error('pipe closed')))
          socket.once('data', data => data.toString() === 'ok\n' ? resolveWrite() : rejectWrite(new Error('invalid acknowledgement')))
          socket.write(value, error => { if (error) rejectWrite(error) })
        })
      },
      close() { socket.destroy() },
    }))
  })
}

/** Emitted hooks.js and standalone.js are siblings in lib. */
export function defaultHostScript(): string {
  return fileURLToPath(new URL('./standalone.js', import.meta.url))
}

/** Launch without a console window or inherited hook handles. */
export function launchDetachedHost(script = defaultHostScript(), pipePath = DEFAULT_HOOK_PIPE, timeoutMs = 800, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(new Error('launch deadline')); return }
    let finished = false
    const readiness = new AbortController()
    const child = spawn(process.execPath, [script, '--hook-pipe', pipePath], {
      detached: true, stdio: ['ignore', 'ignore', 'ignore', 'ipc'], windowsHide: true,
    })
    const finish = (error?: Error) => {
      if (finished) return
      finished = true
      clearTimeout(timer)
      readiness.abort()
      signal?.removeEventListener('abort', abort)
      child.removeAllListeners('message')
      child.removeAllListeners('exit')
      if (child.connected) child.disconnect()
      child.unref()
      if (error) reject(error)
      else resolve()
    }
    const abort = () => finish(new Error('launch deadline'))
    const timer = setTimeout(abort, timeoutMs)
    signal?.addEventListener('abort', abort, { once: true })
    child.once('error', finish)
    // A losing launcher cannot announce when the winner is ready; probe without sending an event.
    child.once('exit', async () => {
      while (!finished) {
        try {
          const connection = await connectPipe(pipePath, readiness.signal)
          connection.close()
          finish()
        } catch {
          if (!finished) await new Promise(resolve => setTimeout(resolve, 20))
        }
      }
    })
    child.on('message', message => { if (message === 'hook-pipe-ready') finish() })
  })
}

/** A single initial attempt, detached readiness, then one retry within a hard deadline. */
export async function sendHookEvent(event: NormalizedHookEvent, options: HookTransportOptions = {}): Promise<boolean> {
  let expired = false
  let connection: PipeConnection | undefined
  let deadline: ReturnType<typeof setTimeout> | undefined
  const launch = new AbortController()
  const pipePath = options.pipePath ?? DEFAULT_HOOK_PIPE
  const connect = () => (options.connect ?? connectPipe)(pipePath, launch.signal)
  const write = async () => {
    if (!connection) return false
    if (expired) { connection.close(); return false }
    try { await connection.write(`${JSON.stringify(event)}\n`); return true }
    finally { connection.close(); connection = undefined }
  }
  const deliver = async () => {
    try {
      connection = await connect()
    } catch {
      if (expired) return false
      try {
        await (options.launchHost ?? (signal => launchDetachedHost(undefined, pipePath, options.timeoutMs ?? 800, signal)))(launch.signal)
        if (expired) return false
        connection = await connect()
      } catch { return false }
    }
    // Once connected, a lost acknowledgement is uncertain delivery, never a cold start.
    try { return await write() } catch { return false }
  }
  try {
    return await Promise.race([
      deliver(),
      new Promise<boolean>(resolve => { deadline = setTimeout(() => { expired = true; resolve(false) }, options.timeoutMs ?? 800) }),
    ])
  } finally {
    expired = true
    clearTimeout(deadline)
    launch.abort()
    connection?.close()
  }
}
