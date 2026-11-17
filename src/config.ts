/**
 * Plugin configuration.
 *
 * The entry `Config` schema is a Schemastery object (satisfying the Standard
 * Schema interface Cordis expects) so `cordis.yml` can provide overrides and
 * invalid values fail loudly at load time. The entry config seeds the private
 * per-pet state on first run; later UI changes are persisted independently.
 */

import z from '@deepseek-ai/schemastery'

/** One entry in the runtime-scanned pet catalog. */
export interface PetCatalogEntry {
  /** Directory name under `assets/pets/<id>/` (also the pet id). */
  id: string
  /** Human label shown in the settings picker. */
  displayName: string
}

export interface PetConfig {
  /** Composition-level master switch; when false the plugin loads but shows nothing. */
  enabled: boolean
  /** Keep the pet above other windows. */
  alwaysOnTop: boolean
  /** Integer scale multiplier applied to the 192×208 atlas cells. */
  petScale: number
  /** Which pet to display (a directory name under `assets/pets/`). */
  petId: string
  /** Hide the pet while no task is running; show it again on activity. */
  hideWhenIdle: boolean
  /** Run the frame animation. When false, a single static frame is shown. */
  animationEnabled: boolean
  /** Seconds (>=8) between randomized idle variations. */
  idleFrequencySec: number
  /** Pass pointer events through the window (Windows only). */
  clickThrough: boolean
  /** Start in the sleeping state. */
  startSleeping: boolean
  /** Global animation speed multiplier. */
  animationSpeed: number
}

export const Config: z<PetConfig> = z.object({
  enabled: z.boolean().default(true),
  alwaysOnTop: z.boolean().default(true),
  petScale: z.number().step(0.25).min(0.5).max(4).default(1),
  petId: z.string().default('text'),
  hideWhenIdle: z.boolean().default(false),
  animationEnabled: z.boolean().default(true),
  idleFrequencySec: z.natural().min(8).default(20),
  clickThrough: z.boolean().default(false),
  startSleeping: z.boolean().default(false),
  animationSpeed: z.number().min(0.25).max(4).default(1),
})

export const DEFAULT_CONFIG: PetConfig = {
  enabled: true,
  alwaysOnTop: true,
  petScale: 1,
  petId: 'text',
  hideWhenIdle: false,
  animationEnabled: true,
  idleFrequencySec: 20,
  clickThrough: false,
  startSleeping: false,
  animationSpeed: 1,
}
