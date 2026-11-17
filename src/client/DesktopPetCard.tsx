import { useEffect, useMemo, useState } from 'react'
import clsx from 'clsx'
import { IconChevronDownOutline14 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import css from './DesktopPetCard.module.css'

interface PetItem {
  id: string
  displayName: string
  visible: boolean
  scale: number
  hideWhenIdle: boolean
  position: { x: number; y: number }
}
interface PetSnapshot { selectedPetId: string; order: string[]; pets: PetItem[] }
export type DesktopPetCardProps = PropsRuntime<'settings.plugin.item'> & PropsLocale<'settings.desktopPet'>

async function api(path: string, body?: unknown): Promise<PetSnapshot> {
  const response = await fetch(`/dsh-pet/${path}`, body === undefined ? { cache: 'no-store' } : {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  })
  const value = await response.json() as PetSnapshot & { error?: string }
  if (!response.ok) throw new Error(value.error || `Request failed (${response.status})`)
  return value
}

async function uploadCodex(file: File): Promise<PetSnapshot> {
  const response = await fetch(`/dsh-pet/import-codex?filename=${encodeURIComponent(file.name)}`, {
    method: 'POST', headers: { 'content-type': 'application/zip' }, body: await file.arrayBuffer(),
  })
  const value = await response.json() as PetSnapshot & { error?: string }
  if (!response.ok) throw new Error(value.error || `Upload failed (${response.status})`)
  return value
}

export function DesktopPetCard(props: DesktopPetCardProps) {
  const { t } = props
  const [open, setOpen] = useState(false)
  const [snapshot, setSnapshot] = useState<PetSnapshot | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState('')
  const [slug, setSlug] = useState('')
  const [dragId, setDragId] = useState<string | null>(null)

  const load = async () => {
    try { setSnapshot(await api('state')); setError('') } catch (e) { setError(e instanceof Error ? e.message : String(e)) }
  }
  useEffect(() => { if (open && snapshot === null) void load() }, [open])
  const selected = useMemo(() => snapshot?.pets.find(p => p.id === snapshot.selectedPetId) ?? snapshot?.pets[0], [snapshot])

  const mutate = async (key: string, path: string, body: unknown) => {
    if (busy) return
    setBusy(key); setError('')
    try { setSnapshot(await api(path, body)) } catch (e) { setError(e instanceof Error ? e.message : String(e)) } finally { setBusy('') }
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
    setBusy('zip'); setError('')
    try { setSnapshot(await uploadCodex(file)) } catch (e) { setError(e instanceof Error ? e.message : String(e)) } finally { setBusy('') }
  }

  return (
    <li className={clsx(css.card, open && css.cardOpen)}>
      <button type="button" className={css.header} aria-expanded={open} onClick={() => setOpen(value => !value)}>
        <span className={css.headText}><span className={css.name}>{t('desktopPet.title')}</span><span className={css.description}>{t('desktopPet.description')}</span></span>
        <IconChevronDownOutline14 className={clsx(css.chevron, open && css.chevronOpen)} />
      </button>
      {open ? (
        <div className={css.body}>
          {snapshot === null && !error ? <LoadingState label={t('loading')} /> : null}
          {error ? <div className={css.error} role="alert"><span>{error}</span><button type="button" onClick={() => void load()}>{t('retry')}</button></div> : null}
          {snapshot && selected ? (
            <>
              <section className={css.stage} aria-label={t('currentPet')}>
                <div className={css.previewWrap}><img className={css.preview} src={`/dsh-pet/preview?id=${encodeURIComponent(selected.id)}`} alt={selected.displayName} /></div>
                <div className={css.currentInfo}>
                  <span className={css.currentLabel}>{t('currentPet')}</span>
                  <strong>{selected.displayName}</strong>
                  <span className={css.currentMeta}>{selected.visible ? t('showing') : t('hidden')} · {selected.scale.toFixed(2)}×</span>
                  <button type="button" className={clsx(css.primary, selected.visible && css.secondary)} disabled={Boolean(busy)} onClick={() => update(selected.id, { visible: !selected.visible })}>
                    {selected.visible ? t('hidePet') : t('showPet')}
                  </button>
                </div>
              </section>
              <section className={css.library}>
                <div className={css.sectionHead}><strong>{t('petLibrary')}</strong><span>{t('dragHint')}</span></div>
                <div className={css.petRail}>
                  {snapshot.pets.map(pet => (
                    <button type="button" key={pet.id} draggable className={clsx(css.petTile, pet.id === selected.id && css.petTileActive)} aria-pressed={pet.id === selected.id}
                      onClick={() => select(pet.id)} onDragStart={() => setDragId(pet.id)} onDragOver={event => event.preventDefault()} onDrop={() => reorder(pet.id)}>
                      <img src={`/dsh-pet/preview?id=${encodeURIComponent(pet.id)}`} alt="" />
                      <span>{pet.displayName}</span><small>{pet.visible ? t('showing') : t('hidden')}</small>
                    </button>
                  ))}
                </div>
              </section>
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
