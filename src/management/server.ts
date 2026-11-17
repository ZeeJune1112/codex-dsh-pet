import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { randomBytes, timingSafeEqual } from 'node:crypto'
import { readFile, rm, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import sharp from 'sharp'
import type { DesktopPetHost } from '../standalone'
import { loadPetAtlas, scanPets } from '../pets'
import { sliceFrame } from '../renderer/FrameDecoder'
import { mountPetRoutes } from '../routes'
import { readJsonBody, sendJson, type WebServerService } from '../pet-api'
import { importCodexPetZip } from '../codex-import'
import { importPetFromPetdex } from '../petdex'
import { defaultPetInstance } from '../host/persistence'
import { quantizeScale } from '../pet-state'
import { hasLegacyData, migrateLegacy } from './migration'

export interface ManagementOptions { legacyDirectory?: string; bundle?: string; onQuit?: () => Promise<void> }
export class ManagementServer {
  private readonly token = randomBytes(32).toString('base64url')
  private readonly routes = new Map<string, Parameters<WebServerService['register']>[0]['handler']>()
  private origin = ''
  private mutations: Promise<unknown> = Promise.resolve()
  private migrationDeclined = false
  private readonly server = createServer((request, response) => { void this.handle(request, response) })
  private readonly petsDirectory: string
  readonly legacyDirectory: string
  constructor(private readonly host: DesktopPetHost, private readonly options: ManagementOptions = {}) {
    this.petsDirectory = join(host.dataDirectory, 'pets')
    this.legacyDirectory = options.legacyDirectory ?? join(homedir(), '.dsh', 'dsh-pet')
    mountPetRoutes({ webServer: { register: route => { this.routes.set(route.path, route.handler); return () => { this.routes.delete(route.path) } } } }, {
      snapshot: () => this.snapshot(), preview: id => this.preview(id),
      updatePet: async (id, patch) => { await host.updateInstance(id, patch); return this.snapshot() },
      select: async id => { host.selectInstance(id); return this.snapshot() },
      reorder: async order => { host.reorderInstances(order); return this.snapshot() },
      importPetdex: async slug => {
        const entry = await importPetFromPetdex(slug, { directory: this.petsDirectory })
        await this.createImportedInstance(entry.slug)
        return this.snapshot()
      },
      importCodexZip: async (bytes, filename) => {
        const entry = await importCodexPetZip(bytes, filename, this.petsDirectory)
        await this.createImportedInstance(entry.id, typeof entry.config?.overlaySizeDp === 'number' ? quantizeScale(entry.config.overlaySizeDp / 112) : 1)
        return this.snapshot()
      },
    })
    this.post('bind', async body => {
      if (typeof body.id !== 'string' || (body.sessionId !== null && typeof body.sessionId !== 'string')) throw new Error('instance and session binding required')
      host.bindInstance(body.id, body.sessionId)
    })
    this.post('create', async body => {
      if (typeof body.roleId !== 'string' || !scanPets(undefined, this.petsDirectory).some(role => role.id === body.roleId)) throw new Error('unknown role')
      const settings = { ...defaultPetInstance(), roleId: body.roleId }
      await host.addInstances([settings], { selectedId: settings.id })
    })
    this.post('migrate', async body => {
      if (typeof body.confirm !== 'boolean') throw new Error('explicit migration confirmation required')
      if (body.confirm) await migrateLegacy(host, this.legacyDirectory)
      else this.migrationDeclined = true
    })
    this.post('quit', async () => {
      setImmediate(() => { void (this.options.onQuit?.() ?? this.stop().then(() => this.host.stop())).catch(() => {}) })
    })
  }
  private async createImportedInstance(roleId: string, scale = 1): Promise<void> {
    const settings = { ...defaultPetInstance(), roleId, scale }
    try { await this.host.addInstances([settings], { selectedId: settings.id }) }
    catch (error) { await rm(join(this.petsDirectory, roleId), { recursive: true, force: true }); throw error }
  }
  private post(path: string, action: (body: Record<string, unknown>) => Promise<void>): void {
    this.routes.set(`/dsh-pet/${path}`, async (request, response) => {
      if (request.method !== 'POST') { response.writeHead(405, { allow: 'POST' }); response.end(); return }
      try {
        const body = await readJsonBody(request)
        if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('JSON object required')
        await action(body as Record<string, unknown>)
        sendJson(response, 200, this.snapshot())
      } catch (error) { sendJson(response, 400, { error: error instanceof Error ? error.message : 'operation failed' }) }
    })
  }
  get url(): string { return `${this.origin}/?token=${this.token}` }
  snapshot() {
    const roles = scanPets(undefined, this.petsDirectory)
    const pets = this.host.getSnapshot().map(pet => ({ ...pet, hideWhenIdle: pet.hideWhenIdle ?? false,
      displayName: roles.find(role => role.id === pet.roleId)?.displayName ?? pet.roleId }))
    return { selectedPetId: this.host.managementSettings.selectedInstanceId ?? pets[0]?.id ?? '', order: pets.map(pet => pet.id), pets, roles,
      migration: this.host.managementSettings.migrationCompleted ? 'completed' : this.migrationDeclined ? 'declined' : hasLegacyData(this.legacyDirectory) ? 'available' : 'absent' }
  }
  private async preview(id: string): Promise<Buffer> {
    if (!scanPets(undefined, this.petsDirectory).some(role => role.id === id)) throw new Error('unknown role')
    const frame = sliceFrame(await loadPetAtlas(id, this.petsDirectory), 'idle', 0)
    return sharp(frame.rgba, { raw: { width: frame.width, height: frame.height, channels: 4 } }).png().toBuffer()
  }
  private async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    response.setHeader('Cache-Control', 'no-store')
    response.setHeader('Referrer-Policy', 'no-referrer')
    response.setHeader('X-Content-Type-Options', 'nosniff')
    try {
      if (request.headers.host !== new URL(this.origin).host) return sendJson(response, 403, { error: 'invalid Host' })
      const url = new URL(request.url ?? '/', this.origin)
      const token = Buffer.from(url.searchParams.get('token') ?? '')
      const expected = Buffer.from(this.token)
      if (token.length !== expected.length || !timingSafeEqual(token, expected)) return sendJson(response, 401, { error: 'management token required' })
      if (request.method !== 'GET' && request.headers.origin !== this.origin) return sendJson(response, 403, { error: 'same-origin request required' })
      if (url.pathname === '/' || url.pathname === '/management.js') {
        if (request.method !== 'GET') { response.writeHead(405, { allow: 'GET' }); response.end(); return }
        if (url.pathname === '/') {
          response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'")
          response.setHeader('Content-Type', 'text/html; charset=utf-8')
          response.end(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><title>Codex desktop pets</title></head><body><main id="root"></main><script type="module" src="/management.js?token=${this.token}"></script></body></html>`)
        } else {
          response.setHeader('Content-Type', 'text/javascript; charset=utf-8')
          response.end(this.options.bundle ?? await readFile(new URL('./management.js', import.meta.url), 'utf8'))
        }
        return
      }
      const route = this.routes.get(url.pathname)
      if (!route) return sendJson(response, 404, { error: 'not found' })
      if (request.method === 'GET') await route(request, response)
      else {
        const run = () => route(request, response)
        this.mutations = this.mutations.then(run, run)
        await this.mutations
      }
    } catch { if (!response.headersSent) sendJson(response, 500, { error: 'management request failed' }); else response.end() }
  }
  async start(): Promise<void> {
    await new Promise<void>((resolve, reject) => { this.server.once('error', reject); this.server.listen(0, '127.0.0.1', () => { this.server.removeListener('error', reject); resolve() }) })
    const address = this.server.address()
    if (!address || typeof address === 'string') throw new Error('management listener unavailable')
    this.origin = `http://127.0.0.1:${address.port}`
    try { await writeFile(join(this.host.dataDirectory, 'management.json'), JSON.stringify({ url: this.url, pid: process.pid }), { mode: 0o600 }) }
    catch (error) { await this.stop(); throw error }
  }
  async stop(): Promise<void> {
    if (!this.server.listening) return
    await this.mutations.catch(() => {})
    this.server.closeAllConnections()
    await new Promise<void>((resolve, reject) => this.server.close(error => error ? reject(error) : resolve()))
    await rm(join(this.host.dataDirectory, 'management.json'), { force: true })
  }
}
