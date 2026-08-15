/** DSH desktop pet host entry: native overlays, persistent pet library, and Web UI API. */
import type { Context } from '@deepseek-ai/cordis'
import { Config, type PetConfig } from './config'
import { PetStateMachine } from './core/PetStateMachine'
import type { NormalizedEvent, SemanticState } from './core/types'
import { createHarnessBridge, type HarnessBridge, type HarnessContext } from './integration/HarnessBridge'
import { registerPetCommand } from './commands'
import { PetRuntime } from './pet-runtime'
import { mountPetRoutes } from './routes'
import { selectBackend } from './renderer/backend/selectBackend'
import type { WebServerService } from './pet-api'

export const name = 'dsh-pet'
export const inject: string[] = []
export { Config }
export type { PetConfig }

type Disposer = () => void | Promise<void>
interface PetContext extends HarnessContext {
  effect(execute: () => Disposer, label?: string): Disposer
  inject(deps: string[], callback: (ctx: HarnessContext) => void): unknown
}

export function apply(ctx: Context, config: PetConfig): void {
  const petCtx = ctx as unknown as PetContext
  const log = petCtx.logger('dsh-pet')
  if (!config.enabled) {
    log.info('disabled by config; not starting')
    return
  }

  petCtx.effect(() => {
    let disposed = false
    let bridge: HarnessBridge | undefined
    let unregisterRoutes: (() => void) | undefined
    const backend = selectBackend() ?? null
    if (!backend) log.warn('no supported native window backend on %s; Web pet library remains available', process.platform)
    const runtime = new PetRuntime({ config, backend, log })
    const machine = new PetStateMachine({ onChange: state => runtime.setSemanticState(state) })

    bridge = createHarnessBridge(petCtx)
    void bridge.start().catch(error => log.warn('bridge start failed: %s', (error as Error)?.message ?? String(error)))
    const unsubscribe = bridge.subscribe((event: NormalizedEvent) => {
      if (!disposed) machine.onEvent(event)
    })

    const debugHost = {
      setDebugState(state: SemanticState) { runtime.setSemanticState(state) },
      resetDebugState() { runtime.setSemanticState(machine.state) },
      async importPet(slug: string) {
        const snapshot = await runtime.importPetdex(slug)
        const pet = snapshot.pets.find(item => item.id === snapshot.selectedPetId)!
        return { id: pet.id, displayName: pet.displayName }
      },
      listPets() { return runtime.snapshot().pets.map(({ id, displayName }) => ({ id, displayName })) },
      async selectPet(id: string) {
        try { await runtime.select(id); return true } catch { return false }
      },
    }
    const unregisterCommand = registerPetCommand({ commands: petCtx.get('commands') } as never, debugHost)

    petCtx.inject(['webServer'], (hostCtx) => {
      if (disposed) return
      const host = hostCtx as unknown as { webServer: WebServerService }
      unregisterRoutes?.()
      unregisterRoutes = mountPetRoutes(host, runtime)
      log.info('Web pet library mounted at /dsh-pet/*')
    })

    void runtime.start().catch(error => log.warn('dsh-pet startup failed: %s', (error as Error)?.message ?? String(error)))

    return async () => {
      disposed = true
      unregisterRoutes?.()
      unsubscribe()
      unregisterCommand?.()
      machine.dispose()
      await bridge?.stop().catch(() => {})
      await runtime.dispose()
    }
  }, 'dsh-pet runtime')
}
