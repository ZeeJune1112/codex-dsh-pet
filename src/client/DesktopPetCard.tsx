import { useEffect, useMemo, useRef, useState } from 'react'
import clsx from 'clsx'
import type { DesktopPetKey } from './locales'
import css from './DesktopPetCard.module.css'

interface PetItem {
  id: string
  displayName: string
  visible: boolean
  scale: number
  hideWhenIdle: boolean
  position: { x: number; y: number }
  roleId?: string
  sessionId?: string
  feedback?: string
  availability?: string
  loadFailed?: boolean
  lastEventAt?: number
  alwaysOnTop?: boolean
  animationEnabled?: boolean
  animationSpeed?: number
  idleFrequencySec?: number
  clickThrough?: boolean
  startSleeping?: boolean
  sleeping?: boolean
}
interface PetSnapshot { selectedPetId: string; order: string[]; pets: PetItem[]; roles?: Array<{ id: string; displayName: string }>; migration?: string }
export interface DesktopPetCardProps { t(key: DesktopPetKey): string; initiallyOpen?: boolean; url?: (path: string) => string }
const defaultUrl = (path: string) => `/dsh-pet/${path}`

async function api(path: string, body: unknown, url: (path: string) => string): Promise<PetSnapshot> {
  const response = await fetch(url(path), body === undefined ? { cache: 'no-store' } : {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  })
  const value = await response.json() as PetSnapshot & { error?: string }
  if (!response.ok) throw new Error(value.error || `Request failed (${response.status})`)
  return value
}

async function uploadCodex(file: File, url: (path: string) => string): Promise<PetSnapshot> {
  const response = await fetch(url(`import-codex?filename=${encodeURIComponent(file.name)}`), {
    method: 'POST', headers: { 'content-type': 'application/zip' }, body: await file.arrayBuffer(),
  })
  const value = await response.json() as PetSnapshot & { error?: string }
  if (!response.ok) throw new Error(value.error || `Upload failed (${response.status})`)
  return value
}

export function DesktopPetCard(props: DesktopPetCardProps) {
  const { t, url = defaultUrl } = props
  const [open, setOpen] = useState(props.initiallyOpen ?? false)
  const [snapshot, setSnapshot] = useState<PetSnapshot | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState('')
  const [slug, setSlug] = useState('')
  const [dragId, setDragId] = useState<string | null>(null)
  const [sessionId, setSessionId] = useState('')
  const [exited, setExited] = useState(false)
  const [unavailable, setUnavailable] = useState(false)
  const revision = useRef(0)

  const load = async () => {
    const requested = revision.current
    try {
      const value = await api('state', undefined, url)
      if (requested === revision.current) { setSnapshot(value); setError(''); setUnavailable(false) }
    } catch (e) { if (requested === revision.current) { setError(e instanceof Error ? e.message : String(e)); setUnavailable(true) } }
  }
  useEffect(() => { if (open && snapshot === null) void load() }, [open])
  const selected = useMemo(() => snapshot?.pets.find(p => p.id === snapshot.selectedPetId) ?? snapshot?.pets[0], [snapshot])
  useEffect(() => { setSessionId(selected?.sessionId ?? '') }, [selected?.id, selected?.sessionId])
  useEffect(() => {
    if (!open || !snapshot?.roles || busy || exited) return
    const timer = setInterval(() => { if (!document.querySelector('input:focus')) void load() }, 2000)
    return () => clearInterval(timer)
  }, [open, Boolean(snapshot?.roles), busy, exited])

  const mutate = async (key: string, path: string, body: unknown) => {
    if (busy) return
    revision.current++
    setBusy(key); setError('')
    try { setSnapshot(await api(path, body, url)); if (path === 'quit') setExited(true) } catch (e) { setError(e instanceof Error ? e.message : String(e)) } finally { setBusy('') }
  }
  const select = (id: string) => { void mutate(`select:${id}`, 'select', { id }) }
  const update = (id: string, patch: Partial<PetItem>) => { void mutate(`update:${id}`, 'update', { id, patch }) }
  const reorder = (targetId: string) => {
    if (!snapshot || !dragId || dragId === targetId) return
    const order = snapshot.order.filter(id => id !== dragId)
    order.splice(order.indexOf(targetId), 0, dragId)
    setDragId(null)
    void mutate('reorder', 'reorder', { order })
  }
  const importPet = () => {
    const normalized = slug.trim().toLowerCase()
    if (!normalized) return
    void mutate('import', 'import-petdex', { slug: normalized }).then(() => setSlug(''))
  }
  const importFile = async (file: File | undefined) => {
    if (!file || busy) return
    revision.current++
    setBusy('zip'); setError('')
    try { setSnapshot(await uploadCodex(file, url)) } catch (e) { setError(e instanceof Error ? e.message : String(e)) } finally { setBusy('') }
  }

  return (
    <li className={clsx(css.card, open && css.cardOpen)}>
      <button type="button" className={css.header} aria-expanded={open} onClick={() => setOpen(value => !value)}>
        <span className={css.headText}><span className={css.name}>{t('desktopPet.title')}</span><span className={css.description}>{t('desktopPet.description')}</span></span>
        <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true" className={clsx(css.chevron, open && css.chevronOpen)}><path d="m3 5 4 4 4-4" fill="none" stroke="currentColor" /></svg>
      </button>
      {open ? (
        <div className={css.body}>
          {exited ? <p role="status">{t('hostStopped')}</p> : null}
          {snapshot === null && !error ? <LoadingState label={t('loading')} /> : null}
          {error ? <div className={css.error} role="alert"><span>{error}</span><button type="button" onClick={() => void load()}>{t('retry')}</button></div> : null}
          {snapshot && selected && !exited ? (
            <>
              <section className={css.stage} aria-label={t('currentPet')}>
                <div className={css.previewWrap}><img className={css.preview} src={url(`preview?id=${encodeURIComponent(selected.roleId ?? selected.id)}`)} alt={selected.displayName} /></div>
                <div className={css.currentInfo}>
                  <span className={css.currentLabel}>{t('currentPet')}</span>
                  <strong>{selected.displayName}</strong>
                  <span className={css.currentMeta}>{selected.visible ? (selected.sleeping && selected.hideWhenIdle ? t('sleepHidden') : t('showing')) : t('hidden')} · {selected.scale.toFixed(2)}×</span>
                  <button type="button" className={clsx(css.primary, selected.visible && css.secondary)} disabled={Boolean(busy)} onClick={() => update(selected.id, { visible: !selected.visible })}>
                    {selected.visible ? t('hidePet') : t('showPet')}
                  </button>
                </div>
              </section>
              {snapshot.roles ? <section className={css.management} aria-label={t('instanceSettings')}>
                {selected.loadFailed ? <p role="alert">{t('roleUnavailable')}</p> : null}
                <label>{t('role')}<select aria-label={t('role')} value={selected.roleId} disabled={Boolean(busy)} onChange={event => update(selected.id, { roleId: event.target.value })}>
                  {!snapshot.roles.some(role => role.id === selected.roleId) ? <option value={selected.roleId} disabled>{selected.displayName}</option> : null}
                  {snapshot.roles.map(role => <option key={role.id} value={role.id}>{role.displayName}</option>)}
                </select></label>
                <button type="button" disabled={Boolean(busy)} onClick={() => void mutate('create', 'create', { roleId: selected.roleId })}>{t('newInstance')}</button>
                <p>{t('instanceId')}: <code>{selected.id}</code></p>
                <p role="status">{t(`feedback.${selected.feedback}` as DesktopPetKey)}{selected.sleeping ? ` · ${t('sleeping')}` : ''} · {t(`availability.${unavailable ? 'unavailable' : selected.availability}` as DesktopPetKey)}</p>
                <small>{selected.lastEventAt ? `${t('lastEvent')}: ${new Date(selected.lastEventAt).toLocaleString()}` : t('noEventHint')}</small>
                <small>{t('trustHint')}</small>
                <label>{t('chatId')}<input aria-label={t('chatId')} value={sessionId} maxLength={256} disabled={Boolean(busy)} onChange={event => setSessionId(event.target.value)} /></label>
                <div className={css.managementActions}>
                  <button type="button" disabled={Boolean(busy) || !sessionId.trim()} onClick={() => void mutate('bind', 'bind', { id: selected.id, sessionId: sessionId.trim() })}>{t('bind')}</button>
                  <button type="button" disabled={Boolean(busy) || !selected.sessionId} onClick={() => void mutate('unbind', 'bind', { id: selected.id, sessionId: null })}>{t('unbind')}</button>
                </div>
              </section> : null}
              <section className={css.library}>
                <div className={css.sectionHead}><strong>{t('petLibrary')}</strong><span>{t('dragHint')}</span></div>
                <div className={css.petRail}>
                  {snapshot.pets.map(pet => (
                    <button type="button" key={pet.id} data-instance={pet.id} draggable disabled={Boolean(busy)} className={clsx(css.petTile, pet.id === selected.id && css.petTileActive)} aria-pressed={pet.id === selected.id}
                      onClick={() => select(pet.id)} onDragStart={() => setDragId(pet.id)} onDragOver={event => event.preventDefault()} onDrop={() => reorder(pet.id)}>
                      <img src={url(`preview?id=${encodeURIComponent(pet.roleId ?? pet.id)}`)} alt="" />
                      <span>{pet.displayName}</span><small>{pet.visible ? (pet.sleeping && pet.hideWhenIdle ? t('sleepHidden') : t('showing')) : t('hidden')}</small>{snapshot.roles ? <small>{pet.sessionId ?? t('availability.unbound')} · {pet.id.slice(0, 8)}</small> : null}
                    </button>
                  ))}
                </div>
                {snapshot.roles ? <div className={css.managementActions}>{[-1, 1].map(direction => <button type="button" key={direction} disabled={Boolean(busy) || snapshot.order.indexOf(selected.id) + direction < 0 || snapshot.order.indexOf(selected.id) + direction >= snapshot.order.length} onClick={() => {
                  const order = [...snapshot.order]; const from = order.indexOf(selected.id); const to = from + direction
                  ;[order[from], order[to]] = [order[to], order[from]]
                  void mutate('reorder', 'reorder', { order })
                }}>{t(direction < 0 ? 'moveEarlier' : 'moveLater')}</button>)}</div> : null}
              </section>
              {snapshot.roles ? <details className={css.management}><summary>{t('animationSettings')}</summary>
                {(['alwaysOnTop', 'animationEnabled', 'clickThrough', 'startSleeping'] as const).map(key => <label key={key} className={css.toggleRow}><span>{t(key)}</span><input type="checkbox" disabled={Boolean(busy)} checked={selected[key] ?? (key === 'alwaysOnTop' || key === 'animationEnabled')} onChange={event => update(selected.id, { [key]: event.target.checked })} /></label>)}
                <label>{t('animationSpeed')}<input aria-label={t('animationSpeed')} type="number" min="0.25" max="4" step="0.25" value={selected.animationSpeed ?? 1} disabled={Boolean(busy)} onChange={event => update(selected.id, { animationSpeed: Number(event.target.value) })} /></label>
                <label>{t('idleFrequencySec')}<input type="number" min="8" max="3600" value={selected.idleFrequencySec ?? 20} disabled={Boolean(busy)} onChange={event => update(selected.id, { idleFrequencySec: Number(event.target.value) })} /></label>
              </details> : null}
              <section className={css.controls}>
                <label className={css.controlLabel} htmlFor="dsh-pet-scale">{t('size')}</label>
                <div className={css.rangeRow}>
                  <input id="dsh-pet-scale" type="range" min="0.5" max="4" step="0.25" value={selected.scale} disabled={Boolean(busy)}
                    onChange={event => setSnapshot(localPatch(snapshot, selected.id, { scale: Number(event.target.value) }))}
                    onPointerUp={event => update(selected.id, { scale: Number((event.target as HTMLInputElement).value) })}
                    onKeyUp={event => update(selected.id, { scale: Number((event.target as HTMLInputElement).value) })} />
                  <output>{selected.scale.toFixed(2)}×</output>
                </div>
                <label className={css.toggleRow}>
                  <span><strong>{t('hideWhenIdle')}</strong><small>{t('hideWhenIdleHint')}</small></span>
                  <input type="checkbox" checked={selected.hideWhenIdle} disabled={Boolean(busy)} onChange={event => update(selected.id, { hideWhenIdle: event.target.checked })} />
                </label>
              </section>
              {snapshot.migration === 'available' ? <section className={css.management}>
                <strong>{t('migrationTitle')}</strong><p>{t('migrationHint')}</p>
                <div className={css.managementActions}><button type="button" disabled={Boolean(busy)} onClick={() => void mutate('migrate', 'migrate', { confirm: true })}>{t('migrate')}</button><button type="button" disabled={Boolean(busy)} onClick={() => void mutate('decline', 'migrate', { confirm: false })}>{t('decline')}</button></div>
              </section> : null}
              <section className={css.importer}>
                <div><strong>{t('importTitle')}</strong><span>{t('importHint')}</span></div>
                <div className={css.importRow}>
                  <label htmlFor="dsh-pet-slug">{t('petdexSlug')}</label>
                  <input id="dsh-pet-slug" value={slug} placeholder="usagi" disabled={Boolean(busy)} onChange={event => setSlug(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') importPet() }} />
                  <button type="button" className={css.primary} disabled={Boolean(busy) || !slug.trim()} onClick={importPet}>{busy === 'import' ? t('importing') : t('import')}</button>
                </div>
                <a href="https://petdex.dev/" target="_blank" rel="noreferrer">{t('browsePetdex')}</a>
                <div className={css.zipRow}>
                  <span>{t('codexZipHint')}</span>
                  <label className={css.secondary}>{busy === 'zip' ? t('importing') : t('chooseZip')}<input type="file" accept=".zip,application/zip" disabled={Boolean(busy)} onChange={event => { void importFile(event.target.files?.[0]); event.target.value = '' }} /></label>
                </div>
              </section>
              {snapshot.roles ? <button type="button" disabled={Boolean(busy)} onClick={() => void mutate('quit', 'quit', {})}>{t('quit')}</button> : null}
            </>
          ) : null}
        </div>
      ) : null}
    </li>
  )
}

function localPatch(snapshot: PetSnapshot, id: string, patch: Partial<PetItem>): PetSnapshot {
  return { ...snapshot, pets: snapshot.pets.map(pet => pet.id === id ? { ...pet, ...patch } : pet) }
}
function LoadingState({ label }: { label: string }) {
  return <div className={css.loading} role="status"><div /><div /><span>{label}</span></div>
}
