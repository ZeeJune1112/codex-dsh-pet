import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

export interface PetPosition { x: number; y: number }

export interface PetPreference {
  visible: boolean
  scale: number
  hideWhenIdle: boolean
  position: PetPosition
}

export interface PetState {
  version: 1
  selectedPetId: string
  order: string[]
  pets: Record<string, PetPreference>
}

export const PET_SCALE_MIN = 0.5
export const PET_SCALE_MAX = 4
export const PET_SCALE_STEP = 0.25
export const DEFAULT_POSITION: PetPosition = { x: 40, y: 40 }

const STATE_FILE = join(homedir(), '.dsh', 'dsh-pet', 'state.json')

export function quantizeScale(value: number): number {
  const steps = Math.round((value - PET_SCALE_MIN) / PET_SCALE_STEP)
  return Math.round(Math.min(PET_SCALE_MAX, Math.max(PET_SCALE_MIN, PET_SCALE_MIN + steps * PET_SCALE_STEP)) * 100) / 100
}

export function defaultPreference(overrides: Partial<PetPreference> = {}): PetPreference {
  return {
    visible: overrides.visible ?? false,
    scale: quantizeScale(overrides.scale ?? 1),
    hideWhenIdle: overrides.hideWhenIdle ?? false,
    position: validPosition(overrides.position) ?? { ...DEFAULT_POSITION },
  }
}

function validPosition(value: unknown): PetPosition | null {
  if (typeof value !== 'object' || value === null) return null
  const p = value as Partial<PetPosition>
  return Number.isFinite(p.x) && Number.isFinite(p.y) ? { x: Number(p.x), y: Number(p.y) } : null
}

export function normalizeState(value: unknown, catalogIds: string[], fallbackId: string): PetState {
  const raw = typeof value === 'object' && value !== null ? value as Partial<PetState> : {}
  const catalog = new Set(catalogIds)
  const order = [
    ...(Array.isArray(raw.order) ? raw.order.filter((id): id is string => typeof id === 'string' && catalog.has(id)) : []),
    ...catalogIds,
  ].filter((id, index, all) => all.indexOf(id) === index)
  const selectedPetId = typeof raw.selectedPetId === 'string' && catalog.has(raw.selectedPetId)
    ? raw.selectedPetId
    : (order[0] ?? fallbackId)
  const pets: Record<string, PetPreference> = {}
  for (const id of order) {
    const pref = raw.pets?.[id]
    pets[id] = defaultPreference(typeof pref === 'object' && pref !== null ? pref : {})
  }
  return { version: 1, selectedPetId, order, pets }
}

export function loadPetState(catalogIds: string[], fallbackId: string, legacy?: Partial<PetPreference> & { selectedPetId?: string }): PetState {
  let raw: unknown
  try { raw = JSON.parse(readFileSync(STATE_FILE, 'utf8')) } catch { raw = undefined }
  if (raw === undefined && legacy !== undefined) {
    raw = {
      selectedPetId: legacy.selectedPetId,
      order: catalogIds,
      pets: legacy.selectedPetId ? { [legacy.selectedPetId]: defaultPreference({ ...legacy, visible: legacy.visible ?? true }) } : {},
    }
  }
  return normalizeState(raw, catalogIds, fallbackId)
}

export function savePetState(state: PetState): void {
  try {
    mkdirSync(dirname(STATE_FILE), { recursive: true })
    const temp = `${STATE_FILE}.tmp`
    writeFileSync(temp, JSON.stringify(state, null, 2), 'utf8')
    renameSync(temp, STATE_FILE)
  } catch {
    // Persistence is best-effort; the running pet must stay available.
  }
}

export const petStateFile = STATE_FILE
