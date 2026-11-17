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
  connect?: (pipePath: string) => Promise<PipeConnection>
  launchHost?: () => Promise<void> | void
  timeoutMs?: number
}

function connectPipe(pipePath: string): Promise<PipeConnection> {
  return new Promise((resolve, reject) => {
    const socket = createConnection(pipePath)
    socket.setTimeout(150, () => socket.destroy(new Error('pipe timeout')))
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
export function launchDetachedHost(script = defaultHostScript(), pipePath = DEFAULT_HOOK_PIPE): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script, '--hook-pipe', pipePath], {
      detached: true, stdio: 'ignore', windowsHide: true,
    })
    child.once('error', reject)
    child.once('spawn', () => { child.unref(); resolve() })
  })
}

/** A single initial attempt, detached launch, then one delayed retry within a hard deadline. */
export async function sendHookEvent(event: NormalizedHookEvent, options: HookTransportOptions = {}): Promise<boolean> {
  let expired = false
  let connection: PipeConnection | undefined
  let deadline: ReturnType<typeof setTimeout> | undefined
  let retryTimer: ReturnType<typeof setTimeout> | undefined
  const pipePath = options.pipePath ?? DEFAULT_HOOK_PIPE
  const write = async () => {
    connection = await (options.connect ?? connectPipe)(pipePath)
    if (expired) { connection.close(); return false }
    try { await connection.write(`${JSON.stringify(event)}\n`); return true }
    finally { connection.close(); connection = undefined }
  }
  const deliver = async () => {
    try { return await write() } catch { /* cold host */ }
    if (expired) return false
    try {
      await (options.launchHost ?? (() => launchDetachedHost(undefined, pipePath)))()
      if (expired) return false
      await new Promise<void>(resolve => { retryTimer = setTimeout(resolve, 400) })
      if (expired) return false
      return await write()
    } catch { return false }
  }
  try {
    return await Promise.race([
      deliver(),
      new Promise<boolean>(resolve => { deadline = setTimeout(() => { expired = true; resolve(false) }, options.timeoutMs ?? 800) }),
    ])
  } finally {
    expired = true
    clearTimeout(deadline)
    clearTimeout(retryTimer)
    connection?.close()
  }
}
