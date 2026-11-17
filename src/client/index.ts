import type {} from '@deepseek-ai/dsh-client-locale/client'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings-plugins/client'
import { DesktopPetCard } from './DesktopPetCard'
import { en, zh, type DesktopPetKey } from './locales'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap { 'settings.desktopPet': DesktopPetKey }
}
export const NS = 'settings.desktopPet'
export const inject = ['slots', 'locale']
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-dsh-pet: dictionaries')
  ctx.slots.inject('settings.plugin.item', () => ctx.slots.register({ name: 'settings.plugin.item', id: 'dsh-pet', order: 30, locale: NS }, DesktopPetCard))
}
