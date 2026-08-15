import { describe, expect, it, vi } from 'vitest'
import { registerPetCommand, type PetDebugHost } from '../src/commands'

function setup() {
  let handler = async (_invocation: { rawInput: string }): Promise<{ kind: 'success' | 'error'; text: string }> => {
    throw new Error('command was not registered')
  }
  const host: PetDebugHost = {
    setDebugState: vi.fn(),
    resetDebugState: vi.fn(),
    importPet: vi.fn(async slug => ({ id: slug, displayName: 'Boba' })),
    listPets: vi.fn(() => [{ id: 'text', displayName: 'Text' }, { id: 'boba', displayName: 'Boba' }]),
    selectPet: vi.fn(async id => id === 'boba'),
  }
  registerPetCommand({
    commands: {
      register(definition) {
        handler = async invocation => definition.handler(invocation)
      },
    },
  }, host)
  return { host, run: (rawInput: string) => handler({ rawInput }) }
}

describe('/pet command', () => {
  it('imports a Petdex slug', async () => {
    const { host, run } = setup()
    const result = await run('import boba')
    expect(host.importPet).toHaveBeenCalledWith('boba')
    expect(result).toEqual({ kind: 'success', text: 'Imported and selected Boba (boba) from Petdex.' })
  })

  it('lists installed pets', async () => {
    const { run } = setup()
    expect((await run('list')).text).toContain('boba — Boba')
  })

  it('selects an installed pet', async () => {
    const { run } = setup()
    expect(await run('use boba')).toEqual({ kind: 'success', text: 'Selected pet boba.' })
  })
})
