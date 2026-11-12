/**
 * Portfolio-Wechsel (Aufklappmenü) und Verwaltung: anlegen, umbenennen, sortieren, löschen.
 */
import { ArrowDown, ArrowUp, Check, ChevronsUpDown, Layers, Plus, Settings2 } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useId, useRef, useState, type FormEvent } from 'react'
import clsx from 'clsx'
import { Sheet } from '@/components/Sheet'
import { ConfirmDelete } from '@/components/ui'
import { ALL, MAIN } from '@/lib/portfolios'
import { createPortfolio, deletePortfolio, movePortfolio, renamePortfolio, setPortfolio, useStore } from '@/lib/store'
import { toast } from '@/lib/toast'

/** Kurze Initialen als Kennzeichen eines Portfolios */
const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || '·'

/**
 * Portfolio-Wechsel als eigenes Aufklappmenü: aktuelles Portfolio mit Häkchen, Gesamtansicht,
 * Neu anlegen und Verwalten. Schliesst bei Klick daneben und mit Esc; Pfeiltasten wählen.
 */
export function PortfolioSwitcher({ onManage, className, compact, sub }: { onManage: () => void; className?: string; compact?: boolean; sub?: string }) {
  const { portfolios, portfolio } = useStore()
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const listId = useId()
  const current = portfolio === ALL ? { name: 'Alle Portfolios', id: ALL } : portfolios.find((p) => p.id === portfolio) ?? portfolios[0]

  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false)
        root.current?.querySelector<HTMLButtonElement>('button')?.focus()
      }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault()
        const items = [...(root.current?.querySelectorAll<HTMLButtonElement>('[data-item]') ?? [])]
        const i = items.indexOf(document.activeElement as HTMLButtonElement)
        items[(i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus()
      }
    }
    document.addEventListener('pointerdown', onDown)
    document.addEventListener('keydown', onKey)
    // Fokus auf den gewählten Eintrag
    requestAnimationFrame(() => root.current?.querySelector<HTMLButtonElement>('[data-item][aria-checked="true"]')?.focus())
    return () => {
      document.removeEventListener('pointerdown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const pick = (id: string) => {
    setOpen(false)
    if (id !== portfolio) void setPortfolio(id)
  }
  const item = 'flex w-full items-center gap-2.5 rounded-[9px] px-2.5 py-2 text-left text-[13px] outline-none transition-colors hover:bg-white/[0.06] focus-visible:bg-white/[0.08]'

  return (
    <div ref={root} data-tour="portfolio" className={clsx('relative', className)}>
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => setOpen((o) => !o)}
        className={clsx('flex w-full items-center gap-2.5 rounded-[11px] border text-left transition-colors hover:border-line-2', compact ? 'h-[42px] bg-white/[0.02] pl-1 pr-2' : 'h-10 bg-white/[0.03] pl-1.5 pr-2.5', open ? 'border-line-2 bg-white/[0.05]' : compact ? 'border-transparent' : 'border-line')}
      >
        <span className={clsx('grid size-7 flex-none place-items-center rounded-[8px] text-[11px] font-semibold', portfolio === ALL ? 'bg-accent/20 text-accent-2' : 'bg-white/[0.07] text-ink-2')}>
          {portfolio === ALL ? <Layers className="size-3.5" /> : initials(current?.name ?? '')}
        </span>
        <span className="min-w-0 flex-1 leading-tight">
          <span className="block truncate text-[13px] font-medium text-ink">{current?.name}</span>
          <span className="block truncate text-[11px] text-muted">{sub ?? (portfolio === ALL ? 'Gesamtansicht · nur ansehen' : portfolios.length > 1 ? `Portfolio · ${portfolios.length} insgesamt` : 'Portfolio')}</span>
        </span>
        <ChevronsUpDown className="size-3.5 flex-none text-muted" />
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            id={listId}
            role="menu"
            aria-label="Portfolio wählen"
            initial={{ opacity: 0, y: -4, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.98 }}
            transition={{ duration: 0.14, ease: [0.22, 1, 0.36, 1] }}
            className="absolute left-0 top-[calc(100%+6px)] z-50 w-full min-w-[260px] origin-top rounded-[14px] border border-line-2 bg-[#101218] p-1.5 shadow-[0_18px_50px_-10px_rgb(0_0_0/0.8),inset_0_1px_0_rgb(255_255_255/0.05)]"
          >
            <div className="px-2.5 pb-1 pt-1.5 text-[10.5px] font-medium uppercase tracking-[0.08em] text-faint">Portfolios</div>
            <div className="max-h-[50vh] overflow-y-auto">
              {portfolios.map((p) => (
                <button key={p.id} type="button" role="menuitemradio" aria-checked={p.id === portfolio} data-item className={item} onClick={() => pick(p.id)}>
                  <span className="grid size-6 flex-none place-items-center rounded-[7px] bg-white/[0.07] text-[10px] font-semibold text-ink-2">{initials(p.name)}</span>
                  <span className="min-w-0 flex-1 truncate text-ink">{p.name}</span>
                  {p.id === portfolio && <Check className="size-4 flex-none text-accent-2" />}
                </button>
              ))}
              {portfolios.length > 1 && (
                <button type="button" role="menuitemradio" aria-checked={portfolio === ALL} data-item className={item} onClick={() => pick(ALL)}>
                  <span className="grid size-6 flex-none place-items-center rounded-[7px] bg-accent/15 text-accent-2"><Layers className="size-3.5" /></span>
                  <span className="min-w-0 flex-1 truncate text-ink">Alle Portfolios <span className="text-muted">· Gesamt</span></span>
                  {portfolio === ALL && <Check className="size-4 flex-none text-accent-2" />}
                </button>
              )}
            </div>
            <div className="my-1.5 h-px bg-line" />
            <button type="button" role="menuitem" data-item className={clsx(item, 'text-ink-2')} onClick={() => { setOpen(false); onManage() }}>
              <span className="grid size-6 flex-none place-items-center"><Plus className="size-4" /></span>Neues Portfolio
            </button>
            <button type="button" role="menuitem" data-item className={clsx(item, 'text-ink-2')} onClick={() => { setOpen(false); onManage() }}>
              <span className="grid size-6 flex-none place-items-center"><Settings2 className="size-4" /></span>Verwalten
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

export function PortfoliosSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { portfolios, portfolio } = useStore()
  const [names, setNames] = useState<Record<string, string>>({})
  const [fresh, setFresh] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  const run = async (fn: () => Promise<unknown>, msg: string) => {
    setErr('')
    setBusy(true)
    try {
      await fn()
      toast(msg)
    } catch (x) {
      setErr(x instanceof Error ? x.message : String(x))
    } finally {
      setBusy(false)
    }
  }
  const create = (e: FormEvent) => {
    e.preventDefault()
    void run(async () => {
      await createPortfolio(fresh)
      location.hash = 'uebersicht'
      setFresh('')
      onClose()
    }, `Portfolio «${fresh.trim()}» angelegt und geöffnet.`)
  }

  return (
    <Sheet open={open} onClose={onClose} title="Portfolios" sub="Getrennte Depots, z. B. je Broker oder für Kinder. Jedes hat eigene Positionen, Cash, Plan und Watchlist.">
      <div className="grid gap-5">
        <ul className="grid gap-2">
          {portfolios.map((p, i) => {
            const v = names[p.id] ?? p.name
            const changed = v.trim() !== p.name
            return (
              <li key={p.id} className={clsx('grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 rounded-xl border px-3 py-2.5', p.id === portfolio ? 'border-accent/40 bg-accent/[0.06]' : 'border-line')}>
                <form
                  className="flex min-w-0 items-center gap-2"
                  onSubmit={(e) => {
                    e.preventDefault()
                    if (changed) void run(() => renamePortfolio(p.id, v), 'Umbenannt.')
                  }}
                >
                  <input aria-label={`Name von ${p.name}`} className="input input-sm min-w-0" maxLength={40} value={v} onChange={(e) => setNames((n) => ({ ...n, [p.id]: e.target.value }))} />
                  {changed && <button type="submit" className="btn btn-sm btn-primary" disabled={busy}>OK</button>}
                </form>
                <div className="flex items-center">
                  <button type="button" className="btn btn-ghost btn-sm" aria-label="Nach oben" disabled={busy || i === 0} onClick={() => void run(() => movePortfolio(p.id, -1), 'Reihenfolge gespeichert.')}><ArrowUp /></button>
                  <button type="button" className="btn btn-ghost btn-sm" aria-label="Nach unten" disabled={busy || i === portfolios.length - 1} onClick={() => void run(() => movePortfolio(p.id, 1), 'Reihenfolge gespeichert.')}><ArrowDown /></button>
                  {p.id !== MAIN && <ConfirmDelete label={`Portfolio «${p.name}» mit allen Daten löschen`} onConfirm={() => void run(() => deletePortfolio(p.id), `«${p.name}» gelöscht.`)} />}
                </div>
                {p.id !== portfolio && (
                  <button type="button" className="col-span-2 w-fit text-[12px] text-muted underline decoration-line-2 underline-offset-4 hover:text-ink" onClick={() => { void setPortfolio(p.id); onClose() }}>Öffnen</button>
                )}
              </li>
            )
          })}
        </ul>
        <p className="-mt-2 text-[12px] text-muted">Löschen entfernt das Portfolio mit allen Daten. Lade vorher unter «Konto» eine Sicherungskopie herunter, falls du die Daten brauchst. Das Hauptportfolio bleibt immer.</p>

        <form onSubmit={create} className="grid gap-2 border-t border-line pt-4">
          <label htmlFor="new-portfolio" className="text-[13px] font-semibold">Neues Portfolio</label>
          <div className="flex gap-2">
            <input id="new-portfolio" className="input min-w-0 flex-1" maxLength={40} placeholder="z. B. Säule 3a, Kinder, Krypto" value={fresh} onChange={(e) => setFresh(e.target.value)} />
            <button type="submit" className="btn btn-primary" disabled={busy || !fresh.trim()}><Plus />Anlegen</button>
          </div>
        </form>
        {portfolios.length > 1 && <p className="text-[12px] text-muted">«Alle Portfolios (Gesamt)» in der Auswahl zählt alle zusammen. Dort siehst du alles, änderst aber nichts.</p>}
        {err && <div role="alert" className="text-[12.5px] text-down">{err}</div>}
      </div>
    </Sheet>
  )
}
