import { createServer } from 'node:net'

// A real detached child with delayed readiness and bounded cleanup.
const deadline = setTimeout(() => process.exit(1), 2000)
setTimeout(() => {
  const server = createServer(socket => {
    socket.once('data', data => {
      const event = JSON.parse(data.toString())
      if (event.sessionId !== 'fixture-session') return socket.destroy()
      socket.end('ok\n')
      server.close(() => { clearTimeout(deadline) })
    })
  })
  server.listen(process.argv[process.argv.indexOf('--hook-pipe') + 1])
}, 100)
