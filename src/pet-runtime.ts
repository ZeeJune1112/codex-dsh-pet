import sharp from 'sharp'
import type { PetCatalogEntry, PetConfig } from './config'
import type { SemanticState } from './core/types'
import { sliceFrame } from './renderer/FrameDecoder'
import { PetWindow } from './renderer/PetWindow'
import type { WindowBackend } from './renderer/backend/WindowBackend'
import { loadPetAtlas, scanPets } from './pets'
import { importPetFromPetdex } from './petdex'
import { importCodexPetZip } from './codex-import'
import {
  defaultPreference, loadPetState, normalizeState, quantizeScale, savePetState,
  type PetPreference, type PetState,
} from './pet-state'

export interface PetRuntimeSnapshot {
  selectedPetId: string
  order: string[]
  pets: Array<PetCatalogEntry & PetPreference>
}

export interface PetRuntimeOptions {
  config: PetConfig
  backend: WindowBackend | null
  log: { info(message: string, ...args: unknown[]): void; warn(message: string, ...args: unknown[]): void }
}

export class PetRuntime {
  private catalog: PetCatalogEntry[] = []
  private state!: PetState
  private semantic: SemanticState
  private readonly windows = new Map<string, PetWindow>()
  private readonly previewCache = new Map<string, Buffer>()
  private disposed = false
  private revision = 0

  constructor(private readonly options: PetRuntimeOptions) {
    this.semantic = options.config.startSleeping ? 'SLEEPING' : 'IDLE'
    this.refreshCatalog(true)
  }

  snapshot(): PetRuntimeSnapshot {
    const byId = new Map(this.catalog.map(p => [p.id, p]))
    return {
      selectedPetId: this.state.selectedPetId,
      order: [...this.state.order],
      pets: this.state.order.flatMap(id => {
        const entry = byId.get(id)
        return entry ? [{ ...entry, ...this.state.pets[id], position: { ...this.state.pets[id].position } }] : []
      }),
    }
  }

  async start(): Promise<void> {
    await this.reconcile()
  }

  setSemanticState(state: SemanticState): void {
    this.semantic = state
    for (const [id, petWindow] of this.windows) {
      petWindow.setState(state)
      petWindow.setVisible(this.shouldShow(id))
    }
  }

  async updatePet(id: string, patch: Partial<Pick<PetPreference, 'visible' | 'scale' | 'hideWhenIdle'>>): Promise<PetRuntimeSnapshot> {
    const pref = this.requirePet(id)
    if (typeof patch.visible === 'boolean') pref.visible = patch.visible
    if (typeof patch.hideWhenIdle === 'boolean') pref.hideWhenIdle = patch.hideWhenIdle
    if (typeof patch.scale === 'number' && Number.isFinite(patch.scale)) pref.scale = quantizeScale(patch.scale)
    this.persist()
    await this.reconcile()
    return this.snapshot()
  }

  async select(id: string): Promise<PetRuntimeSnapshot> {
    this.requirePet(id)
    this.state.selectedPetId = id
    this.persist()
    return this.snapshot()
  }

  async reorder(order: string[]): Promise<PetRuntimeSnapshot> {
    const expected = new Set(this.state.order)
    if (order.length !== expected.size || order.some(id => !expected.delete(id)) || expected.size !== 0) {
      throw new Error('order must contain every installed pet exactly once')
    }
    this.state.order = [...order]
    this.persist()
    return this.snapshot()
  }

  async importPetdex(slug: string): Promise<PetRuntimeSnapshot> {
    const entry = await importPetFromPetdex(slug)
    this.refreshCatalog(false)
    this.state.selectedPetId = entry.slug
    this.state.pets[entry.slug] = defaultPreference({ visible: true })
    this.state.order = [entry.slug, ...this.state.order.filter(id => id !== entry.slug)]
    this.previewCache.delete(entry.slug)
    this.persist()
    await this.reconcile()
    return this.snapshot()
  }

  async importCodexZip(bytes: Uint8Array, filename?: string): Promise<PetRuntimeSnapshot> {
    const imported = await importCodexPetZip(bytes, filename)
    this.refreshCatalog(false)
    const overlaySize = typeof imported.config?.overlaySizeDp === 'number' ? imported.config.overlaySizeDp : 112
    this.state.selectedPetId = imported.id
    this.state.pets[imported.id] = defaultPreference({ visible: true, scale: overlaySize / 112 })
    this.state.order = [imported.id, ...this.state.order.filter(id => id !== imported.id)]
    this.previewCache.delete(imported.id)
    this.persist()
    await this.reconcile()
    return this.snapshot()
  }

  async preview(id: string): Promise<Buffer> {
    this.requirePet(id)
    const cached = this.previewCache.get(id)
    if (cached) return cached
    const atlas = await loadPetAtlas(id)
    const frame = sliceFrame(atlas, 'idle', 0)
    const png = await sharp(frame.rgba, { raw: { width: frame.width, height: frame.height, channels: 4 } })
      .png({ compressionLevel: 9 })
      .toBuffer()
    this.previewCache.set(id, png)
    return png
  }

  async dispose(): Promise<void> {
    this.disposed = true
    await Promise.all([...this.windows.values()].map(window => window.destroy().catch(() => {})))
    this.windows.clear()
  }

  private requirePet(id: string): PetPreference {
    const pref = this.state.pets[id]
    if (!pref) throw new Error(`unknown pet: ${id}`)
    return pref
  }

  private refreshCatalog(initial: boolean): void {
    this.catalog = scanPets()
    const ids = this.catalog.map(p => p.id)
    if (initial) {
      this.state = loadPetState(ids, this.options.config.petId, {
        selectedPetId: this.options.config.petId,
        visible: this.options.config.enabled,
        scale: this.options.config.petScale,
        hideWhenIdle: this.options.config.hideWhenIdle,
      })
    } else {
      this.state = normalizeState(this.state, ids, this.options.config.petId)
    }
  }

  private persist(): void {
    savePetState(this.state)
  }

  private shouldShow(id: string): boolean {
    const pref = this.state.pets[id]
    return pref.visible && !(pref.hideWhenIdle && this.semantic === 'SLEEPING')
  }

  private async reconcile(): Promise<void> {
    const revision = ++this.revision
    if (this.disposed) return
    const desired = new Set(this.state.order.filter(id => this.state.pets[id].visible))
    for (const [id, petWindow] of this.windows) {
      if (desired.has(id)) continue
      this.windows.delete(id)
      await petWindow.destroy().catch(() => {})
    }
    if (!this.options.backend) return
    for (const id of desired) {
      const pref = this.state.pets[id]
      const existing = this.windows.get(id)
      if (existing) {
        await existing.setScale(pref.scale)
        existing.setVisible(this.shouldShow(id))
        continue
      }
      try {
        const atlas = await loadPetAtlas(id)
        if (this.disposed || revision !== this.revision) return
        let petWindow: PetWindow
        petWindow = new PetWindow({
          backend: this.options.backend,
          atlas,
          scale: pref.scale,
          alwaysOnTop: this.options.config.alwaysOnTop,
          animationEnabled: this.options.config.animationEnabled,
          idleFrequencySec: this.options.config.idleFrequencySec,
          clickThrough: this.options.config.clickThrough,
          position: pref.position,
          onDrag: (x, y) => {
            const current = this.state.pets[id]
            if (!current) return
            current.position = { x, y }
            this.persist()
          },
          onHover: () => petWindow.playJump(),
          onUnhover: () => petWindow.endHover(),
          onClose: () => { void this.updatePet(id, { visible: false }) },
        })
        await petWindow.open()
        petWindow.setState(this.semantic)
        petWindow.setVisible(this.shouldShow(id))
        this.windows.set(id, petWindow)
        this.options.log.info('pet window created (%s)', id)
      } catch (error) {
        this.options.log.warn('failed to create pet %s: %s', id, (error as Error)?.message ?? String(error))
      }
    }
  }
}
