/**
 * Bearbeiten-Blätter für alles, was jedes Depot selbst festlegt: Plan (Zielanteile, Obergrenzen,
 * Quellensteuer, Broker, Regeln), Cash-Töpfe, Termine und Watchlist-Titel.
 */
import { Plus, Trash2 } from 'lucide-react'
import { useId, useState, type FormEvent, type ReactNode } from 'react'
import { Sheet } from '@/components/Sheet'
import { Switch } from '@/components/ui'
import { catOf, categoriesOf, MAX_CATEGORIES, newCategoryId, PALETTE } from '@/lib/buckets'
import { isCap, targetOf } from '@/lib/calc'
import { useDepot } from '@/lib/context'
import { parseNum, r2, today, uid } from '@/lib/format'
import { mutate, type Op } from '@/lib/store'
import { toast } from '@/lib/toast'
import type { BucketId, DepotEvent, Pot } from '@/lib/types'

const TICKER = /^[A-Z0-9][A-Z0-9.\-^=]{0,11}$/

function Field({ label, hint, children }: { label: string; hint?: string; children: (id: string) => ReactNode }) {
  const id = useId()
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {children(id)}
      {hint && <div className="text-[11.5px] text-muted">{hint}</div>}
    </div>
  )
}

/** Gemeinsamer Rahmen: Formular mit Speichern, Abbrechen und optional Löschen. */
function EditSheet({ open, onClose, title, sub, save, remove, children }: {
  open: boolean
  onClose: () => void
  title: string
  sub?: string
  save: () => Promise<string>
  remove?: () => Promise<string>
  children: ReactNode
}) {
  const formId = useId()
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [armed, setArmed] = useState(false)
  const run = async (fn: () => Promise<string>) => {
    setErr('')
    setBusy(true)
    try {
      toast(await fn())
      onClose()
    } catch (x) {
      setErr(x instanceof Error ? x.message : String(x))
    } finally {
      setBusy(false)
    }
  }
  const submit = (e: FormEvent) => {
    e.preventDefault()
    void run(save)
  }
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={title}
      sub={sub}
      footer={
        <>
          {remove && (
            <button type="button" className={`btn btn-ghost mr-auto ${armed ? '!text-down' : ''}`} disabled={busy} onClick={() => (armed ? void run(remove) : setArmed(true))}>
              <Trash2 />{armed ? 'Wirklich löschen?' : 'Löschen'}
            </button>
          )}
          <button type="button" className="btn btn-ghost" onClick={onClose}>Abbrechen</button>
          <button type="submit" form={formId} className="btn btn-primary" disabled={busy}>{busy ? 'Speichert …' : 'Speichern'}</button>
        </>
      }
    >
      <form id={formId} onSubmit={submit} className="grid gap-3.5">
        {children}
        {err && <div role="alert" className="text-[12.5px] text-down">{err}</div>}
      </form>
    </Sheet>
  )
}

/* ------------------------------------------------------------------ Plan */

export function PlanSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { db, c } = useDepot()
  const s = c.settings
  const pct = (id: BucketId) => (targetOf(s, id) == null ? '' : String(Math.round(targetOf(s, id)! * 1000) / 10))
  // Eigene Kategorien: Name frei, bis zu zehn, Cash ist fest
  const [cats, setCats] = useState(() => categoriesOf(s).map((x) => ({ ...x })))
  const [targets, setTargets] = useState<Record<BucketId, string>>(() => Object.fromEntries([...categoriesOf(s).map((x) => x.id), 'cash'].map((id) => [id, pct(id)])))
  const [caps, setCaps] = useState<BucketId[]>(() => [...categoriesOf(s).map((x) => x.id), 'cash'].filter((id) => isCap(s, id)))
  const [wht, setWht] = useState(String(Math.round((s.withholding ?? 0.15) * 1000) / 10))
  const [broker, setBroker] = useState(s.broker ?? '')
  const [fx, setFx] = useState<'' | 'CHF' | 'EUR'>(s.fx ?? '')
  const [rules, setRules] = useState(() => (s.rules ?? []).map((r) => ({ ...r })))
  const ids = [...cats.map((x) => x.id), 'cash']
  const sum = ids.reduce((t, id) => t + (parseNum(targets[id] ?? '') ?? 0), 0)
  const filled = ids.some((id) => (targets[id] ?? '').trim() !== '')
  // Titel je Kategorie, damit beim Löschen klar ist, wohin sie wandern
  const count = (id: string) => Object.values(db.positions).filter((p) => p.shares > 0 && catOf(p.bucket) === id).length
  const color = (i: number) => PALETTE[i % PALETTE.length]

  const save = async () => {
    const list = cats.map((x) => ({ id: x.id, name: x.name.trim().slice(0, 30) }))
    if (!list.length) throw new Error('Mindestens eine Kategorie ist nötig.')
    const empty = list.find((x) => !x.name)
    if (empty) throw new Error('Jede Kategorie braucht einen Namen.')
    const tg: Partial<Record<BucketId, number>> = {}
    for (const id of ids) {
      if (!(targets[id] ?? '').trim()) continue
      const v = parseNum(targets[id])
      const name = list.find((x) => x.id === id)?.name ?? 'Cash'
      if (v == null || v < 0 || v > 100) throw new Error(`Zielanteil für ${name} muss zwischen 0 und 100 liegen.`)
      tg[id] = r2(v)
    }
    if (Object.keys(tg).length && Math.abs(sum - 100) > 0.05) throw new Error(`Die Zielanteile ergeben ${r2(sum)} %. Sie müssen zusammen 100 % ergeben.`)
    const w = parseNum(wht)
    if (w == null || w < 0 || w > 60) throw new Error('Quellensteuer muss zwischen 0 und 60 % liegen.')
    const clean = rules.map((r) => ({ tag: r.tag?.trim() || undefined, title: r.title.trim().slice(0, 120), detail: r.detail?.trim().slice(0, 400) || undefined })).filter((r) => r.title)
    // Titel aus gelöschten Kategorien wandern in die erste Kategorie
    const keep = new Set(list.map((x) => x.id))
    const moves: Op[] = Object.entries(db.positions).filter(([, p]) => !keep.has(catOf(p.bucket)) || !keep.has(p.bucket)).map(([t]) => ({ op: 'merge', coll: 'positions', id: t, data: { bucket: keep.has(catOf(db.positions[t].bucket)) ? catOf(db.positions[t].bucket) : list[0].id } }))
    await mutate([...moves, { op: 'merge', coll: 'meta', id: 'settings', data: { categories: list, bucketNames: null, targets: tg, caps: caps.filter((id) => ids.includes(id)), withholding: w / 100, broker: broker.trim().slice(0, 40) || undefined, fx: fx || undefined, rules: clean } }])
    return 'Plan gespeichert.'
  }

  return (
    <EditSheet open={open} onClose={onClose} title="Plan und Einstellungen" sub="Kategorien, Zielanteile, Obergrenzen, Währung und Regeln" save={save}>
      <div className="grid gap-2">
        <div className="flex items-center justify-between gap-3">
          <span className="text-[13px] font-semibold">Kategorien</span>
          <button type="button" className="btn btn-sm btn-ghost" disabled={cats.length >= MAX_CATEGORIES} onClick={() => setCats((x) => [...x, { id: newCategoryId(x.map((y) => y.id)), name: '' }])}><Plus />Kategorie</button>
        </div>
        <p className="text-[12px] leading-[1.5] text-muted">Teile dein Depot so ein, wie du denkst, z. B. nach Anlageart, Region oder Strategie. Zielanteil leer lassen = kein Ziel.</p>
        {[...cats.map((x, i) => ({ ...x, i })), { id: 'cash', name: 'Cash', i: -1 }].map((x) => {
          const n = x.id === 'cash' ? 0 : count(x.id)
          return (
            <div key={x.id} className="grid grid-cols-[minmax(0,1fr)_72px_58px_32px] items-center gap-2 sm:grid-cols-[minmax(0,1fr)_84px_64px_32px] sm:gap-3">
              <span className="flex min-w-0 items-center gap-2 text-[13px]">
                <i className="swatch flex-none" style={{ background: x.id === 'cash' ? 'var(--color-cash)' : color(x.i) }} />
                {x.id === 'cash' ? <span className="truncate">Cash</span> : <input aria-label="Name der Kategorie" className="input input-sm min-w-0" maxLength={30} placeholder="Name, z. B. ETFs" value={x.name} onChange={(e) => setCats((l) => l.map((y) => (y.id === x.id ? { ...y, name: e.target.value } : y)))} />}
              </span>
              <span className="relative">
                <input aria-label={`Zielanteil ${x.name || 'neue Kategorie'} in Prozent`} className="input input-sm num !pr-7 text-right" inputMode="decimal" placeholder="–" value={targets[x.id] ?? ''} onChange={(e) => setTargets((t) => ({ ...t, [x.id]: e.target.value }))} />
                <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-[12px] text-muted">%</span>
              </span>
              {x.id === 'cash' ? <span /> : <Switch checked={caps.includes(x.id)} onChange={(v) => setCaps((l) => (v ? [...l, x.id] : l.filter((y) => y !== x.id)))} title="Zielanteil als harte Obergrenze: Warnung, sobald er überschritten ist" label={<span className="text-[12px]">max</span>} />}
              {x.id === 'cash' ? <span className="w-8" /> : (
                <button type="button" className="btn btn-ghost btn-icon btn-sm" disabled={cats.length <= 1} title={n ? `Löschen: ${n} Titel wandern zur ersten Kategorie` : 'Kategorie löschen'} aria-label="Kategorie löschen" onClick={() => setCats((l) => l.filter((y) => y.id !== x.id))}><Trash2 /></button>
              )}
            </div>
          )
        })}
        <div className={`num text-right text-[12px] ${filled && Math.abs(sum - 100) > 0.05 ? 'text-down' : 'text-muted'}`}>{filled ? `Summe ${r2(sum)} %${Math.abs(sum - 100) > 0.05 ? ' (muss 100 % sein)' : ''}` : '«max»: Zielanteil gilt als Obergrenze'}</div>
      </div>

      <div className="grid grid-cols-2 gap-3 border-t border-line pt-4">
        <Field label="Quellensteuer (%)" hint="Für Dividenden ohne angegebene Steuer">{(id) => <input id={id} className="input num" inputMode="decimal" value={wht} onChange={(e) => setWht(e.target.value)} />}</Field>
        <Field label="Broker" hint="Nur für Hinweise, z. B. Schwab">{(id) => <input id={id} className="input" maxLength={40} value={broker} onChange={(e) => setBroker(e.target.value)} />}</Field>
        <Field label="Zweite Währung" hint="Gesamtwert zusätzlich umgerechnet">{(id) => (
          <select id={id} className="input" value={fx} onChange={(e) => setFx(e.target.value as typeof fx)}>
            <option value="">keine</option>
            <option value="CHF">CHF</option>
            <option value="EUR">EUR</option>
          </select>
        )}</Field>
      </div>

      <div className="grid gap-2 border-t border-line pt-4">
        <div className="flex items-center justify-between">
          <span className="text-[13px] font-semibold">Regeln</span>
          <button type="button" className="btn btn-sm btn-ghost" onClick={() => setRules((r) => [...r, { title: '', tag: '', detail: '' }])}><Plus />Regel</button>
        </div>
        {rules.length === 0 && <p className="text-[12.5px] text-muted">Noch keine Regeln. Beispiel: «Nie mehr als 5 % in einen Einzeltitel».</p>}
        {rules.map((r, i) => (
          <div key={i} className="grid gap-2 rounded-xl border border-line p-3">
            <div className="grid grid-cols-[96px_minmax(0,1fr)_auto] gap-2">
              <input aria-label="Stichwort" className="input input-sm" placeholder="Stichwort" maxLength={20} value={r.tag ?? ''} onChange={(e) => setRules((x) => x.map((y, j) => (j === i ? { ...y, tag: e.target.value } : y)))} />
              <input aria-label="Regel" className="input input-sm" placeholder="Regel" maxLength={120} value={r.title} onChange={(e) => setRules((x) => x.map((y, j) => (j === i ? { ...y, title: e.target.value } : y)))} />
              <button type="button" className="btn btn-ghost btn-sm" aria-label="Regel entfernen" onClick={() => setRules((x) => x.filter((_, j) => j !== i))}><Trash2 /></button>
            </div>
            <input aria-label="Erklärung" className="input input-sm" placeholder="Erklärung (optional)" maxLength={400} value={r.detail ?? ''} onChange={(e) => setRules((x) => x.map((y, j) => (j === i ? { ...y, detail: e.target.value } : y)))} />
          </div>
        ))}
      </div>
      <p className="text-[12px] text-muted">{db.meta.settings?.cashExcluded ? 'Cash ist noch nicht erfasst: Obergrenzen werden erst geprüft, wenn der Cash-Stand eingetragen ist (Eintrag → Ein-/Auszahlung).' : ''}</p>
    </EditSheet>
  )
}

/* ------------------------------------------------------------------ Cash-Topf */

export function PotSheet({ id, open, onClose }: { id: string | null; open: boolean; onClose: () => void }) {
  const { db } = useDepot()
  const p: Pot | undefined = id ? db.pots[id] : undefined
  const [label, setLabel] = useState(p?.label ?? '')
  const [budget, setBudget] = useState(p ? String(p.budget) : '')
  const [used, setUsed] = useState(p ? String(p.used ?? 0) : '0')
  const [note, setNote] = useState(p?.note ?? '')

  const save = async () => {
    const b = parseNum(budget), u = parseNum(used) ?? 0
    if (!label.trim()) throw new Error('Name eingeben.')
    if (b == null || b < 0) throw new Error('Budget eingeben.')
    if (u < 0) throw new Error('Eingesetzt darf nicht negativ sein.')
    const order = p?.order ?? Object.keys(db.pots).length + 1
    await mutate([{ op: 'set', coll: 'pots', id: id ?? uid(), data: { label: label.trim().slice(0, 60), budget: r2(b), used: r2(u), note: note.trim().slice(0, 200), order } }])
    return p ? 'Topf gespeichert.' : 'Topf angelegt.'
  }
  const remove = id ? async () => {
    await mutate([{ op: 'delete', coll: 'pots', id }])
    return 'Topf gelöscht. Käufe aus diesem Topf bleiben gebucht.'
  } : undefined

  return (
    <EditSheet open={open} onClose={onClose} title={p ? 'Topf bearbeiten' : 'Neuer Topf'} sub="Ein Budget für geplante Käufe, z. B. «Nachkäufe 2026»" save={save} remove={remove}>
      <Field label="Name">{(id) => <input id={id} className="input" maxLength={60} value={label} onChange={(e) => setLabel(e.target.value)} autoFocus />}</Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Budget (USD)">{(id) => <input id={id} className="input num" inputMode="decimal" value={budget} onChange={(e) => setBudget(e.target.value)} />}</Field>
        <Field label="Eingesetzt (USD)" hint="Käufe aus dem Topf zählen automatisch dazu">{(id) => <input id={id} className="input num" inputMode="decimal" value={used} onChange={(e) => setUsed(e.target.value)} />}</Field>
      </div>
      <Field label="Notiz">{(id) => <input id={id} className="input" maxLength={200} value={note} onChange={(e) => setNote(e.target.value)} />}</Field>
    </EditSheet>
  )
}

/* ------------------------------------------------------------------ Termin */

const KINDS: { value: NonNullable<DepotEvent['kind']>; label: string }[] = [
  { value: 'termin', label: 'Termin' },
  { value: 'zahlen', label: 'Quartalszahlen' },
  { value: 'tranche', label: 'Geplanter Kauf' },
  { value: 'stichtag', label: 'Stichtag' },
  { value: 'pruefen', label: 'Prüfen' },
]

export function EventSheet({ id, open, onClose }: { id: string | null; open: boolean; onClose: () => void }) {
  const { db } = useDepot()
  const e: DepotEvent | undefined = id ? db.events[id] : undefined
  const [title, setTitle] = useState(e?.title ?? '')
  const [date, setDate] = useState(e?.date ?? today())
  const [kind, setKind] = useState<NonNullable<DepotEvent['kind']>>(e?.kind ?? 'termin')
  const [ticker, setTicker] = useState(e?.ticker ?? '')
  const [detail, setDetail] = useState(e?.detail ?? '')
  const [tentative, setTentative] = useState(!!e?.tentative)

  const save = async () => {
    const t = ticker.trim().toUpperCase()
    if (!title.trim()) throw new Error('Titel eingeben.')
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('Datum eingeben.')
    if (t && !TICKER.test(t)) throw new Error('Ticker ungültig.')
    await mutate([{ op: 'set', coll: 'events', id: id ?? uid(), data: { title: title.trim().slice(0, 100), date, kind, ticker: t || undefined, detail: detail.trim().slice(0, 300) || undefined, tentative: tentative || undefined, done: e?.done || undefined } }])
    return e ? 'Termin gespeichert.' : 'Termin angelegt.'
  }
  const remove = id ? async () => {
    await mutate([{ op: 'delete', coll: 'events', id }])
    return 'Termin gelöscht.'
  } : undefined

  return (
    <EditSheet open={open} onClose={onClose} title={e ? 'Termin bearbeiten' : 'Neuer Termin'} save={save} remove={remove}>
      <Field label="Titel">{(id) => <input id={id} className="input" maxLength={100} placeholder="z. B. Quartalszahlen Microsoft" value={title} onChange={(x) => setTitle(x.target.value)} autoFocus />}</Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Datum">{(id) => <input id={id} className="input" type="date" value={date} onChange={(x) => setDate(x.target.value)} />}</Field>
        <Field label="Art">{(id) => (
          <select id={id} className="input" value={kind} onChange={(x) => setKind(x.target.value as typeof kind)}>
            {KINDS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
          </select>
        )}</Field>
        <Field label="Ticker (optional)">{(id) => <input id={id} className="input uppercase" maxLength={12} value={ticker} onChange={(x) => setTicker(x.target.value)} />}</Field>
        <Switch className="mt-6 self-start text-[13px]" checked={tentative} onChange={setTentative} label="Datum unbestätigt" />
      </div>
      <Field label="Notiz">{(id) => <textarea id={id} className="input" maxLength={300} value={detail} onChange={(x) => setDetail(x.target.value)} />}</Field>
    </EditSheet>
  )
}

/* ------------------------------------------------------------------ Watchlist-Titel hinzufügen */

export function WatchAddSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { db } = useDepot()
  const [ticker, setTicker] = useState('')
  const [name, setName] = useState('')
  const [limit, setLimit] = useState('')
  const [note, setNote] = useState('')

  const save = async () => {
    const t = ticker.trim().toUpperCase()
    if (!TICKER.test(t)) throw new Error('Ticker eingeben, z. B. MSFT.')
    if (db.watchlist[t]) throw new Error(`${t} ist schon auf der Watchlist.`)
    const l = parseNum(limit)
    if (limit.trim() && (l == null || l <= 0)) throw new Error('Grenze muss eine positive Zahl sein.')
    const ops: Op[] = [{ op: 'set', coll: 'watchlist', id: t, data: { ticker: t, name: name.trim().slice(0, 80) || db.positions[t]?.name || t, price: null, limit: l, limitCautious: null, conditionMet: null, note: note.trim().slice(0, 300) } }]
    await mutate(ops)
    return `${t} beobachtet. Der Kurs kommt mit der nächsten Aktualisierung.`
  }

  return (
    <EditSheet open={open} onClose={onClose} title="Titel beobachten" sub="Mit Kaufgrenze: Das Dashboard zeigt, wann der Kurs sie erreicht." save={save}>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Ticker">{(id) => <input id={id} className="input uppercase" maxLength={12} placeholder="MSFT" value={ticker} onChange={(e) => setTicker(e.target.value)} autoFocus />}</Field>
        <Field label="Kaufgrenze (USD, optional)">{(id) => <input id={id} className="input num" inputMode="decimal" value={limit} onChange={(e) => setLimit(e.target.value)} />}</Field>
      </div>
      <Field label="Name (optional)">{(id) => <input id={id} className="input" maxLength={80} placeholder="Microsoft" value={name} onChange={(e) => setName(e.target.value)} />}</Field>
      <Field label="Notiz">{(id) => <input id={id} className="input" maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} />}</Field>
    </EditSheet>
  )
}
