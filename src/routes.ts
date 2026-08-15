import type { IncomingMessage, ServerResponse } from 'node:http'
import type { PetRuntime } from './pet-runtime'
import { readJsonBody, readRawBody, sameOrigin, sendJson, type WebServerService } from './pet-api'

interface RouteHost { webServer: WebServerService }

function method(request: IncomingMessage, response: ServerResponse, expected: 'GET' | 'POST'): boolean {
  if (request.method === expected) return true
  response.writeHead(405, { allow: expected })
  response.end()
  return false
}

export function mountPetRoutes(host: RouteHost, runtime: PetRuntime): () => void {
  const handlePost = (fn: (body: Record<string, unknown>) => Promise<unknown>) => async (request: IncomingMessage, response: ServerResponse) => {
    if (!method(request, response, 'POST')) return
    if (!sameOrigin(request)) return sendJson(response, 403, { error: 'same-origin request required' })
    try {
      const body = await readJsonBody(request) as Record<string, unknown>
      sendJson(response, 200, await fn(body))
    } catch (error) {
      sendJson(response, 400, { error: error instanceof Error ? error.message : String(error) })
    }
  }

  const disposers = [
    host.webServer.register({
      kind: 'exact', path: '/dsh-pet/state', handler: (_request, response) => sendJson(response, 200, runtime.snapshot()),
    }),
    host.webServer.register({
      kind: 'exact', path: '/dsh-pet/preview', handler: async (request, response) => {
        if (!method(request, response, 'GET')) return
        try {
          const id = new URL(request.url ?? '', 'http://localhost').searchParams.get('id') ?? ''
          const png = await runtime.preview(id)
          response.writeHead(200, { 'cache-control': 'private, max-age=3600', 'content-type': 'image/png' })
          response.end(png)
        } catch (error) {
          sendJson(response, 404, { error: error instanceof Error ? error.message : String(error) })
        }
      },
    }),
    host.webServer.register({
      kind: 'exact', path: '/dsh-pet/update', handler: handlePost(async body => {
        if (typeof body.id !== 'string') throw new Error('id is required')
        const patch = typeof body.patch === 'object' && body.patch !== null ? body.patch : {}
        return runtime.updatePet(body.id, patch)
      }),
    }),
    host.webServer.register({
      kind: 'exact', path: '/dsh-pet/select', handler: handlePost(async body => {
        if (typeof body.id !== 'string') throw new Error('id is required')
        return runtime.select(body.id)
      }),
    }),
    host.webServer.register({
      kind: 'exact', path: '/dsh-pet/reorder', handler: handlePost(async body => {
        if (!Array.isArray(body.order) || !body.order.every(id => typeof id === 'string')) throw new Error('order is required')
        return runtime.reorder(body.order)
      }),
    }),
    host.webServer.register({
      kind: 'exact', path: '/dsh-pet/import-petdex', handler: handlePost(async body => {
        if (typeof body.slug !== 'string') throw new Error('Petdex slug is required')
        return runtime.importPetdex(body.slug)
      }),
    }),
    host.webServer.register({
      kind: 'exact', path: '/dsh-pet/import-codex', handler: async (request, response) => {
        if (!method(request, response, 'POST')) return
        if (!sameOrigin(request)) return sendJson(response, 403, { error: 'same-origin request required' })
        try {
          const filename = new URL(request.url ?? '', 'http://localhost').searchParams.get('filename') ?? 'codex-pet.zip'
          const bytes = await readRawBody(request, 50 * 1024 * 1024)
          sendJson(response, 200, await runtime.importCodexZip(bytes, filename))
        } catch (error) {
          sendJson(response, 400, { error: error instanceof Error ? error.message : String(error) })
        }
      },
    }),
  ]
  return () => { for (const dispose of disposers) dispose() }
}
