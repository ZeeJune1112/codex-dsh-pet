/**
 * Desktop-pet command: import/select/list pets and simulate renderer states.
 *
 * Registered only when the optional `ctx.commands` service is present. It
 * simulates a semantic state without invoking any LLM, so developers can
 * verify the animation mapping by hand.
 */

import type { SemanticState } from './core/types'
import type { PetCatalogEntry } from './config'

const VALID_STATES: readonly SemanticState[] = [
  'STARTING',
  'IDLE',
  'THINKING',
  'WORKING',
  'CODING',
  'RUNNING_COMMAND',
  'WAITING_FOR_USER',
  'SUCCESS',
  'ERROR',
  'SLEEPING',
]

export interface CommandContext {
  commands: {
    register(definition: CommandDefinition): unknown
  }
}

/** Minimal structural shape of a `CommandDefinition`. */
interface CommandDefinition {
  name: string
  description: string
  input?: { hint: string }
  handler: (invocation: { rawInput: string; agent?: unknown; signal?: unknown }) => { kind: 'success' | 'error'; text: string } | Promise<{ kind: 'success' | 'error'; text: string }>
}

export interface PetDebugHost {
  setDebugState(state: SemanticState): void
  resetDebugState(): void
  importPet(slug: string): Promise<PetCatalogEntry>
  listPets(): PetCatalogEntry[]
  selectPet(id: string): Promise<boolean>
}

/**
 * Register the `/pet` command if the context exposes `commands`.
 * Returns a disposer (no-op if the capability is absent).
 */
export function registerPetCommand(ctx: CommandContext, host: PetDebugHost): () => void {
  if (!ctx.commands || typeof ctx.commands.register !== 'function') return () => {}

  ctx.commands.register({
    name: 'pet',
    description: 'Manage the DSH desktop pet, import from Petdex, or simulate a state.',
    input: { hint: '<state | list | import <slug> | use <id>>' },
    handler: async (invocation) => {
      const raw = (invocation.rawInput ?? '').trim()
      const [actionRaw = '', value = ''] = raw.split(/\s+/, 2)
      const action = actionRaw.toLowerCase()
      if (action === 'import') {
        if (!value) return { kind: 'error', text: 'Usage: /pet import <petdex-slug>' }
        try {
          const pet = await host.importPet(value)
          return { kind: 'success', text: `Imported and selected ${pet.displayName} (${pet.id}) from Petdex.` }
        } catch (error) {
          return { kind: 'error', text: `Petdex import failed: ${(error as Error).message}` }
        }
      }
      if (action === 'list') {
        const pets = host.listPets()
        return { kind: 'success', text: pets.map(pet => `${pet.id} - ${pet.displayName}`).join('\n') }
      }
      if (action === 'use' || action === 'select') {
        if (!value) return { kind: 'error', text: 'Usage: /pet use <pet-id>' }
        const selected = await host.selectPet(value)
        return selected
          ? { kind: 'success', text: `Selected pet ${value}.` }
          : { kind: 'error', text: `Pet "${value}" is not installed. Run /pet list.` }
      }

      const arg = raw.toUpperCase()
      if (arg === '' || arg === 'RESET' || arg === 'CLEAR') {
        host.resetDebugState()
        return { kind: 'success', text: 'Pet state reset. Commands: /pet list, /pet import <slug>, /pet use <id>.' }
      }
      if (!(VALID_STATES as string[]).includes(arg)) {
        return { kind: 'error', text: `Unknown state "${arg}". Valid states: ${VALID_STATES.join(', ')}` }
      }
      host.setDebugState(arg as SemanticState)
      return { kind: 'success', text: `Pet debug state set to ${arg}.` }
    },
  })

  return () => {
    // Command registrations are fiber-owned in Cordis; no manual disposal needed.
  }
}
