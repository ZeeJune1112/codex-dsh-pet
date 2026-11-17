import { createServer, type Server, type Socket } from 'node:net'
import { normalizeHookEvent, type NormalizedHookEvent } from '../integration/hooks'

export interface HookEventServerOptions {
  pipePath: string
  onEvent: (event: NormalizedHookEvent) => void
}

/** Line-delimited JSON server for the standalone host's one-session adapter. */
export class HookEventServer {
  private server: Server | undefined
  private readonly sockets = new Set<Socket>()

  constructor(private readonly options: HookEventServerOptions) {}

  start(): Promise<void> {
    if (this.server !== undefined) return Promise.resolve()
    const server = createServer(socket => {
      this.sockets.add(socket)
      let pending = ''
      socket.setEncoding('utf8')
      socket.setTimeout(1000, () => socket.destroy())
      socket.on('data', chunk => {
        pending += chunk
        if (pending.length > 128 * 1024) {
          socket.destroy()
          return
        }
        for (;;) {
          const newline = pending.indexOf('\n')
          if (newline < 0) break
          const line = pending.slice(0, newline)
          pending = pending.slice(newline + 1)
          if (line.trim() === '') continue
          try {
            const parsed = normalizeHookEvent(JSON.parse(line))
            if (parsed) {
              this.options.onEvent(parsed)
              socket.end('ok\n')
            } else socket.destroy()
          } catch {
            socket.destroy()
          }
          return
        }
      })
      socket.once('close', () => this.sockets.delete(socket))
      socket.once('error', () => this.sockets.delete(socket))
    })
    this.server = server
    return new Promise((resolve, reject) => {
      const fail = (error: Error) => {
        this.server = undefined
        reject(error)
      }
      server.once('error', fail)
      server.listen(this.options.pipePath, () => {
        server.removeListener('error', fail)
        server.on('error', () => { /* transport failure must not crash the pet */ })
        resolve()
      })
    })
  }

  async stop(): Promise<void> {
    const server = this.server
    if (server === undefined) return
    this.server = undefined
    for (const socket of this.sockets) socket.destroy()
    this.sockets.clear()
    await new Promise<void>(resolve => server.close(() => resolve()))
  }
}
