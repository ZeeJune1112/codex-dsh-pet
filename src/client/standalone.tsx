import { createRoot } from 'react-dom/client'
import { DesktopPetCard } from './DesktopPetCard'
import { en, zh } from './locales'
import css from './standalone.module.css'

export function managementUrl(path: string): string {
  const url = new URL(`/dsh-pet/${path}`, window.location.origin)
  url.searchParams.set('token', new URLSearchParams(window.location.search).get('token') ?? '')
  return url.pathname + url.search
}
const language = navigator.language.startsWith('zh') ? zh : en
createRoot(document.getElementById('root')!).render(<div className={css.shell}><header><h1>Codex desktop pets</h1><p>{language['desktopPet.description']}</p></header><ul><DesktopPetCard t={key => language[key]} initiallyOpen url={managementUrl} /></ul></div>)
