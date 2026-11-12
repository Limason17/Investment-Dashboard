/**
 * Portfolio-Wechsel (Auswahlfeld) und Verwaltung: anlegen, umbenennen, sortieren, löschen.
 */
import { ArrowDown, ArrowUp, ChevronsUpDown, Plus } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import clsx from 'clsx'
import { Sheet } from '@/components/Sheet'
import { ConfirmDelete } from '@/components/ui'
import { ALL, MAIN } from '@/lib/portfolios'
import { createPortfolio, deletePortfolio, movePortfolio, renamePortfolio, setPortfolio, useStore } from '@/lib/store'
import { toast } from '@/lib/toast'

const MANAGE = '__manage'

export function PortfolioSwitcher({ onManage, className }: { onManage: () => void; className?: string }) {
  const { portfolios, portfolio } = useStore()
  return (
    <label data-tour="portfolio" className={clsx('relative flex items-center', className)}>
      <span className="sr-only">Portfolio wählen</span>
      <select
        className="h-9 w-full cursor-pointer appearance-none truncate rounded-[10px] border border-line bg-white/[0.03] pl-3 pr-8 text-[13px] font-medium text-ink transition-colors hover:border-line-2"
        value={portfolio}
        onChange={(e) => {
          if (e.target.value === MANAGE) return onManage()
          void setPortfolio(e.target.value)
        }}
      >
        {portfolios.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        {portfolios.length > 1 && <option value={ALL}>Alle Portfolios (Gesamt)</option>}
        <option value={MANAGE}>Portfolios verwalten …</option>
      </select>
      <ChevronsUpDown className="pointer-events-none absolute right-2.5 size-3.5 text-muted" />
    </label>
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
