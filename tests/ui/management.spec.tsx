// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import { DesktopPetCard } from '../../src/client/DesktopPetCard'
import { en } from '../../src/client/locales'

const requests: Array<{ url: string; body: any }> = []
let state: any
let root: ReturnType<typeof createRoot>
let container: HTMLDivElement
async function click(text: string) {
  const button = [...container.querySelectorAll('button')].find(button => button.textContent === text)
  expect(button, text).toBeTruthy()
  await act(async () => { button!.click() })
}
afterEach(async () => { await act(async () => root?.unmount()); container?.remove(); vi.unstubAllGlobals() })
it('renders roles and truthful feedback, sends token-aware controls, bindings, imports and explicit migration choices', async () => {
  requests.length = 0
  state = { selectedPetId: 'one', order: ['one', 'two'], migration: 'available', roles: [{ id: 'text', displayName: 'Text' }, { id: 'other', displayName: 'Other' }], pets: [
    { id: 'one', roleId: 'text', displayName: 'Text', visible: true, scale: 1, hideWhenIdle: false, position: { x: 0, y: 0 }, feedback: 'UNKNOWN', availability: 'unobserved', sessionId: 'chat-A' },
    { id: 'two', roleId: 'text', displayName: 'Text', visible: true, scale: 1, hideWhenIdle: false, position: { x: 0, y: 0 }, feedback: 'POSSIBLY_WAITING', availability: 'stale', sessionId: 'chat-B' },
  ] }
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('fetch', vi.fn(async (url: string, options?: RequestInit) => {
    const body = typeof options?.body === 'string' ? JSON.parse(options.body) : options?.body
    requests.push({ url, body })
    if (url.includes('/select?')) state = { ...state, selectedPetId: body.id }
    if (url.includes('/update?')) state = { ...state, pets: state.pets.map((pet: any) => pet.id === body.id ? { ...pet, ...body.patch } : pet) }
    if (url.includes('/bind?')) state = { ...state, pets: state.pets.map((pet: any) => pet.id === body.id ? { ...pet, sessionId: body.sessionId, feedback: body.sessionId ? 'UNKNOWN' : 'IDLE', availability: body.sessionId ? 'unobserved' : 'unbound' } : pet) }
    if (url.includes('/migrate?')) state = { ...state, migration: body.confirm ? 'completed' : 'declined' }
    if (url.includes('/import-')) {
      const roleId = url.includes('/import-petdex') ? 'petdex-role' : 'zip-role'
      state = { ...state, selectedPetId: roleId, order: [...state.order, roleId], roles: [...state.roles, { id: roleId, displayName: 'Imported pet' }],
        pets: [...state.pets, { ...state.pets[0], id: roleId, roleId, displayName: 'Imported pet', feedback: 'IDLE', availability: 'unbound', sessionId: undefined }] }
    }
    return new Response(JSON.stringify(state), { status: 200, headers: { 'content-type': 'application/json' } })
  }))
  container = document.createElement('div'); document.body.append(container); root = createRoot(container)
  await act(async () => { root.render(createElement(DesktopPetCard, { t: key => en[key], initiallyOpen: true, url: path => `/dsh-pet/${path}${path.includes('?') ? '&' : '?'}token=private` })) })
  expect(container.textContent).toContain('Unknown')
  expect(container.textContent).toContain('No event observed')
  expect(container.querySelector('img')!.src).toContain('id=text&token=private')
  await click('Hide this pet')
  expect(requests.at(-1)).toEqual({ url: '/dsh-pet/update?token=private', body: { id: 'one', patch: { visible: false } } })
  const role = container.querySelector<HTMLSelectElement>('[aria-label="Role"]')!
  await act(async () => { role.value = 'other'; role.dispatchEvent(new Event('change', { bubbles: true })) })
  expect(requests.at(-1)!.body).toEqual({ id: 'one', patch: { roleId: 'other' } })
  await click('Unbind')
  expect(container.textContent).toContain('Unbound')
  const session = container.querySelector<HTMLInputElement>('[aria-label="Chat ID"]')!
  await act(async () => { const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!; setter.call(session, 'chat-C'); session.dispatchEvent(new Event('input', { bubbles: true })) })
  await click('Bind / rebind')
  expect(requests.at(-1)!.body).toEqual({ id: 'one', sessionId: 'chat-C' })
  const tile = container.querySelector<HTMLButtonElement>('[data-instance="two"]')!
  await act(async () => tile.click())
  expect(container.textContent).toContain('Possibly waiting for permission')
  expect(container.textContent).toContain('Stale observation')
  await click('Move earlier')
  expect(requests.at(-1)!.body).toEqual({ order: ['two', 'one'] })
  await click('Not now')
  expect(requests.at(-1)!.body).toEqual({ confirm: false })
  expect(container.textContent).not.toContain('Migrate local roles')
  const slug = container.querySelector<HTMLInputElement>('#dsh-pet-slug')!
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(slug, 'boba'); slug.dispatchEvent(new Event('input', { bubbles: true })) })
  await click('Import')
  expect(requests.at(-1)).toEqual({ url: '/dsh-pet/import-petdex?token=private', body: { slug: 'boba' } })
  expect(container.querySelector('img')!.src).toContain('id=petdex-role&token=private')
  const upload = container.querySelector<HTMLInputElement>('input[type=file]')!
  const file = new File([new Uint8Array([80, 75])], 'my-pet.zip', { type: 'application/zip' })
  Object.defineProperty(upload, 'files', { value: [file], configurable: true })
  await act(async () => { upload.dispatchEvent(new Event('change', { bubbles: true })) })
  expect(requests.at(-1)!.url).toBe('/dsh-pet/import-codex?filename=my-pet.zip&token=private')
  expect(container.querySelector('img')!.src).toContain('id=zip-role&token=private')
})

it('retains the selected pet when explicit migration fails and shows an authorization error on reload', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  const state = { selectedPetId: 'one', order: ['one'], roles: [{ id: 'text', displayName: 'Existing' }], migration: 'available',
    pets: [{ id: 'one', roleId: 'text', displayName: 'Existing', visible: true, scale: 1, hideWhenIdle: false, feedback: 'IDLE', availability: 'unbound' }] }
  const fetcher = vi.fn(async (_url: string, options?: RequestInit) => options?.method === 'POST'
    ? new Response(JSON.stringify({ error: 'Migration failed; existing data retained' }), { status: 400 })
    : new Response(JSON.stringify(state)))
  vi.stubGlobal('fetch', fetcher)
  container = document.createElement('div'); document.body.append(container); root = createRoot(container)
  await act(async () => root.render(createElement(DesktopPetCard, { t: key => en[key], initiallyOpen: true })))
  await click('Confirm migration')
  expect(container.querySelector('[role=alert]')!.textContent).toContain('existing data retained')
  expect(container.querySelector('img')!.alt).toBe('Existing')
  fetcher.mockImplementation(async () => new Response(JSON.stringify({ error: 'management token required' }), { status: 401 }))
  await click('Retry')
  expect(container.querySelector('[role=alert]')!.textContent).toContain('management token required')
  expect(container.textContent).toContain('Integration unavailable')
})
