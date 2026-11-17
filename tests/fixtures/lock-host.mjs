import { createServer } from 'node:net'
import { acquireInstanceLock } from '../../src/host/persistence.ts'

const [path, pipePath] = process.argv.slice(2)
let lock
process.on('message', message => {
  if (message === 'release') { lock?.release(); process.send?.('released'); return }
  if (message === 'listen') {
    const server = createServer(socket => socket.once('data', () => socket.end('ok\n')))
    server.listen(pipePath, () => process.send?.('hook-pipe-ready'))
    return
  }
  if (message !== 'acquire') return
  try { lock = acquireInstanceLock(path); process.send?.('acquired') }
  catch { process.send?.('rejected') }
})
process.once('exit', () => lock?.release())
process.send?.('ready')
