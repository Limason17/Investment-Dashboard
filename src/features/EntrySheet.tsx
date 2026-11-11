import { useId, useState, type FormEvent, type ReactNode } from 'react'
import { Sheet } from '@/components/Sheet'
import { Delta, Segmented } from '@/components/ui'
import { HOLDING_BUCKETS } from '@/lib/buckets'
import { quote, wht } from '@/lib/calc'
import { commit } from '@/lib/commit'
import { CLOUD } from '@/lib/config'
import { useDepot, type EntryType } from '@/lib/context'
import { dfmt, parseNum, pctPlain, qty, r2, today, uid, usd } from '@/lib/format'
import type { ImportKind } from '@/lib/bulk'
import { ImportForm } from './ImportForm'
import { mutate, type Op } from '@/lib/store'
import { toast } from '@/lib/toast'
import type { DB } from '@/lib/types'

const TYPES: { value: EntryType; label: string }[] = [
  { value: 'kauf', label: 'Kauf' },
  { value: 'verkauf', label: 'Verkauf' },
  { value: 'dividende', label: 'Dividende' },
  { value: 'einzahlung', label: 'Ein-/Auszahlung' },
  { value: 'notiz', label: 'Notiz' },
]


function Field({ label, children, hint }: { label: string; children: (id: string) => ReactNode; hint?: string }) {
  const id = useId()
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {children(id)}
      {hint && <div className="text-[11.5px] text-muted">{hint}</div>}
    </div>
  )
}
const CalcBox = ({ children }: { children: ReactNode }) => (
  <div className="rounded-xl border border-accent/20 bg-accent/[0.07] px-3.5 py-3 text-[12.5px] leading-[1.6] text-ink-2 [&_b]:font-semibold [&_b]:text-ink">{children}</div>
)
const cashOf = (db: DB) => Number(db.meta.settings?.cash) || 0
const cashOff = (db: DB) => !!db.meta.settings?.cashExcluded
/** Cash-Stand nachführen; entfällt, solange Cash nicht erfasst wird. */
const cashOp = (db: DB, delta: number): Op | null => (cashOff(db) ? null : { op: 'merge', coll: 'meta', id: 'settings', data: { cash: r2(cashOf(db) + delta) } })

interface FormProps {
  onSaved: (msg: string) => void
  setBusy: (b: boolean) => void
  formId: string
}
function useSubmit({ onSaved, setBusy }: FormProps, save: () => Promise<string>) {
  const [err, setErr] = useState('')
  const onSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setErr('')
    setBusy(true)
    try {
      onSaved(await save())
    } catch (x) {
      setErr(x instanceof Error ? x.message : String(x))
    } finally {
      setBusy(false)
    }
  }
  return { err, onSubmit }
}
const ErrorLine = ({ err }: { err: string }) => (err ? <div role="alert" className="text-[12.5px] text-down">{err}</div> : null)

/* ------------------------------------------------------------------ Kauf / Verkauf */
function TradeForm({ type, ticker: preset, ...fp }: FormProps & { type: 'kauf' | 'verkauf'; ticker?: string }) {
  const { db } = useDepot()
  const [tk, setTk] = useState(preset ?? '')
  const [sh, setSh] = useState('')
  const [px, setPx] = useState('')
  const [fee, setFee] = useState('0')
  const [date, setDate] = useState(today())
  const [bucket, setBucket] = useState('aktien')
  const [pot, setPot] = useState('')
  const [note, setNote] = useState('')
  const listId = useId()
  const tickers = [...new Set([...Object.keys(db.positions), ...Object.keys(db.watchlist)])].sort()
  const pots = Object.entries(db.pots).map(([id, p]) => ({ id, ...p })).sort((a, b) => (a.order ?? 99) - (b.order ?? 99))

  const t = tk.trim().toUpperCase()
  const nSh = parseNum(sh), nPx = parseNum(px), nFee = parseNum(fee) || 0
  const p = db.positions[t]
  const have = p?.shares || 0
  const avg = p && p.cost != null && have ? p.cost / have : null
  const amt = nSh && nPx ? nSh * nPx : null

  const { err, onSubmit } = useSubmit(fp, async () => {
    if (!t || !nSh || !nPx || nSh <= 0 || nPx <= 0) throw new Error('Titel, Stück und Preis müssen ausgefüllt sein.')
    const a = nSh * nPx
    const createdAt = new Date().toISOString()
    if (type === 'kauf') {
      const cashDelta = -(a + nFee)
      const usedPot = pot && db.pots[pot] ? pot : null
      await commit([
        { op: 'set', coll: 'transactions', id: uid(), data: { type, date, ticker: t, shares: nSh, price: nPx, fees: nFee, cashDelta: r2(cashDelta), pot: usedPot, note, createdAt, by: 'Dashboard' } },
        p
          ? { op: 'merge', coll: 'positions', id: t, data: { shares: +(p.shares + nSh).toFixed(6), cost: p.cost != null ? r2(p.cost + a + nFee) : null } }
          : { op: 'set', coll: 'positions', id: t, data: { ticker: t, name: db.watchlist[t]?.name || t, shares: nSh, bucket, cost: r2(a + nFee), status: 'Neu gekauft ' + dfmt(date), note: '' } },
        cashOp(db, cashDelta),
        usedPot ? { op: 'merge', coll: 'pots', id: usedPot, data: { used: r2((db.pots[usedPot].used || 0) + a + nFee) } } : null,
        !quote(db, t) && { op: 'set', coll: 'prices', id: t, data: { close: nPx, prev: null, date, source: 'Kaufpreis' } },
      ])
      return `Kauf ${t} gespeichert.`
    }
    if (!p || p.shares < nSh - 1e-9) throw new Error('So viele Stück sind nicht im Bestand.')
    const cashDelta = a - nFee
    const left = +(p.shares - nSh).toFixed(6)
    await commit([
      { op: 'set', coll: 'transactions', id: uid(), data: { type, date, ticker: t, shares: nSh, price: nPx, fees: nFee, cashDelta: r2(cashDelta), realized: avg != null ? r2(cashDelta - avg * nSh) : null, note, createdAt, by: 'Dashboard' } },
      { op: 'merge', coll: 'positions', id: t, data: { shares: left, cost: avg != null ? r2(avg * left) : null } },
      cashOp(db, cashDelta),
    ])
    return `Verkauf ${t} gespeichert.`
  })

  return (
    <form id={fp.formId} onSubmit={onSubmit} className="grid gap-3.5">
      <datalist id={listId}>{tickers.map((x) => <option key={x} value={x} />)}</datalist>
      <Field label="Titel (Ticker)">{(id) => <input id={id} className="input uppercase placeholder:normal-case" list={listId} placeholder="z. B. UBER" value={tk} onChange={(e) => setTk(e.target.value)} autoFocus autoCapitalize="characters" />}</Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Stück">{(id) => <input id={id} className="input num" inputMode="decimal" value={sh} onChange={(e) => setSh(e.target.value)} />}</Field>
        <Field label="Preis je Stück (USD)">{(id) => <input id={id} className="input num" inputMode="decimal" value={px} onChange={(e) => setPx(e.target.value)} />}</Field>
        <Field label="Gebühren (USD)">{(id) => <input id={id} className="input num" inputMode="decimal" value={fee} onChange={(e) => setFee(e.target.value)} />}</Field>
        <Field label="Datum">{(id) => <input id={id} className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} />}</Field>
      </div>
      {type === 'kauf' && (
        <>
          {!p && (
            <Field label="Baustein (neuer Titel)">{(id) => (
              <select id={id} className="input" value={bucket} onChange={(e) => setBucket(e.target.value)}>
                {HOLDING_BUCKETS.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            )}</Field>
          )}
          <Field label="Aus Topf">{(id) => (
            <select id={id} className="input" value={pot} onChange={(e) => setPot(e.target.value)}>
              <option value="">kein Topf</option>
              {pots.map((x) => <option key={x.id} value={x.id}>{x.label} · frei {usd((x.budget || 0) - (x.used || 0))}</option>)}
            </select>
          )}</Field>
        </>
      )}
      <Field label="Notiz">{(id) => <input id={id} className="input" value={note} onChange={(e) => setNote(e.target.value)} />}</Field>
      <CalcBox>
        {!t || amt == null ? (
          'Titel, Stück und Preis eingeben.'
        ) : type === 'kauf' ? (
          <>
            Kaufwert <b className="num">{usd(amt)}</b> + Gebühren {usd(nFee)} = <b className="num">{usd(amt + nFee)} USD</b>{cashOff(db) ? '' : ' aus dem Cash'}.
            <br />Bestand danach: {qty(have + nSh!)} {t}{p ? '' : ' (neue Position)'}.{!cashOff(db) && <> Cash danach: <span className="num">{usd(cashOf(db) - amt - nFee)}</span>.</>}
          </>
        ) : (
          <>
            Erlös <b className="num">{usd(amt - nFee)} USD</b>{cashOff(db) ? '' : ' ins Cash'}. Bestand danach: {qty(have - nSh!)} {t}.
            {avg != null && <><br />Realisiert: <Delta value={amt - nFee - avg * nSh!} kind="usd" icon={false} className="font-semibold" /> USD gegen Ø-Einstand {usd(avg)}.</>}
            {nSh! > have + 1e-9 && <><br /><span className="font-medium text-down">Mehr als im Bestand.</span></>}
          </>
        )}
      </CalcBox>
      <ErrorLine err={err} />
    </form>
  )
}

/* ------------------------------------------------------------------ Dividende */
function DividendForm({ fromId, ...fp }: FormProps & { fromId?: string }) {
  const { db } = useDepot()
  const from = fromId ? db.dividends[fromId] : undefined
  const [tk, setTk] = useState(from?.ticker ?? '')
  const [gross, setGross] = useState(from?.gross != null ? from.gross.toFixed(2) : '')
  const [tax, setTax] = useState(from?.tax != null ? from.tax.toFixed(2) : '')
  const [pay, setPay] = useState(from?.payDate ?? today())
  const [ex, setEx] = useState(from?.exDate ?? '')
  const [note, setNote] = useState('')
  const w = wht(db)
  const g = parseNum(gross)
  const tx = parseNum(tax) ?? (g != null ? r2(g * w) : null)

  const { err, onSubmit } = useSubmit(fp, async () => {
    const t = tk.trim().toUpperCase()
    if (!t || g == null || g <= 0 || tx == null) throw new Error('Titel und Bruttobetrag eingeben.')
    await commit([
      {
        op: 'set', coll: 'dividends', id: fromId || uid(),
        data: { ticker: t, exDate: ex || null, payDate: pay || today(), gross: r2(g), tax: r2(tx), net: r2(g - tx), status: 'erhalten', source: 'Eintrag im Dashboard', note, perShare: from?.perShare ?? null, shares: from?.shares ?? db.positions[t]?.shares ?? null },
      },
      cashOp(db, g - tx),
    ])
    return `Dividende ${t} ${usd(g - tx)} USD gespeichert.`
  })

  return (
    <form id={fp.formId} onSubmit={onSubmit} className="grid gap-3.5">
      <Field label="Titel (Ticker)">{(id) => <input id={id} className="input uppercase" value={tk} onChange={(e) => setTk(e.target.value)} autoFocus={!from} />}</Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Brutto gesamt (USD)">{(id) => <input id={id} className="input num" inputMode="decimal" value={gross} onChange={(e) => setGross(e.target.value)} autoFocus={!!from} />}</Field>
        <Field label="Quellensteuer (USD)" hint={`leer = ${pctPlain(w, 0)} angenommen`}>{(id) => <input id={id} className="input num" inputMode="decimal" value={tax} onChange={(e) => setTax(e.target.value)} />}</Field>
        <Field label="Zahltag">{(id) => <input id={id} className="input" type="date" value={pay} onChange={(e) => setPay(e.target.value)} />}</Field>
        <Field label="Ex-Tag (optional)">{(id) => <input id={id} className="input" type="date" value={ex} onChange={(e) => setEx(e.target.value)} />}</Field>
      </div>
      <Field label="Notiz">{(id) => <input id={id} className="input" value={note} onChange={(e) => setNote(e.target.value)} />}</Field>
      <CalcBox>
        {g == null || tx == null ? 'Bruttobetrag aus der Schwab-Buchung eingeben.' : <>Netto <b className="num">{usd(g - tx)} USD</b>{cashOff(db) ? ' wird als erhalten gebucht.' : ' wird dem Cash gutgeschrieben.'}</>}
      </CalcBox>
      <ErrorLine err={err} />
    </form>
  )
}

/* ------------------------------------------------------------------ Ein-/Auszahlung, Cash-Korrektur */
function CashForm(fp: FormProps) {
  const { db } = useDepot()
  const [dir, setDir] = useState<'einzahlung' | 'auszahlung' | 'korrektur'>('einzahlung')
  const [amt, setAmt] = useState('')
  const [date, setDate] = useState(today())
  const [note, setNote] = useState('')
  const cash = cashOf(db)
  const off = cashOff(db)
  const a = parseNum(amt)
  const after = a == null ? null : dir === 'korrektur' ? a : dir === 'einzahlung' ? cash + a : cash - a

  const { err, onSubmit } = useSubmit(fp, async () => {
    if (a == null || after == null) throw new Error('Betrag eingeben.')
    if (off && dir !== 'korrektur') throw new Error('Cash ist derzeit nicht erfasst. Trage zuerst mit «Cash-Stand korrigieren» den Saldo von Schwab ein.')
    await commit(
      [
        { op: 'set', coll: 'transactions', id: uid(), data: { type: dir, date, cashDelta: r2(after - cash), note, createdAt: new Date().toISOString(), by: 'Dashboard' } },
        { op: 'merge', coll: 'meta', id: 'settings', data: { cash: r2(after), ...(dir === 'korrektur' ? { cashEstimate: false, cashExcluded: false, cashNote: 'Saldo laut Schwab ' + dfmt(date), cashDate: date } : {}) } },
      ],
      dir === 'korrektur' ? 0 : after - cash,
    )
    return 'Cash aktualisiert.'
  })

  return (
    <form id={fp.formId} onSubmit={onSubmit} className="grid gap-3.5">
      <Field label="Richtung">{(id) => (
        <select id={id} className="input" value={dir} onChange={(e) => setDir(e.target.value as typeof dir)}>
          <option value="einzahlung">Einzahlung aufs Konto</option>
          <option value="auszahlung">Auszahlung vom Konto</option>
          <option value="korrektur">Cash-Stand korrigieren (Saldo von Schwab)</option>
        </select>
      )}</Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label={dir === 'korrektur' ? 'Neuer Saldo (USD)' : 'Betrag (USD)'}>{(id) => <input id={id} className="input num" inputMode="decimal" value={amt} onChange={(e) => setAmt(e.target.value)} autoFocus />}</Field>
        <Field label="Datum">{(id) => <input id={id} className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} />}</Field>
      </div>
      <Field label="Notiz">{(id) => <input id={id} className="input" value={note} onChange={(e) => setNote(e.target.value)} />}</Field>
      <CalcBox>
        {off && dir !== 'korrektur' ? <>Cash ist derzeit nicht erfasst. Mit «Cash-Stand korrigieren» trägst du den Saldo von Schwab ein, danach zählt Cash wieder mit.</> : after == null ? <>{off ? 'Cash ist derzeit nicht erfasst.' : <>Aktuelles Cash: <b className="num">{usd(cash)} USD</b>.</>}</> : <>Cash danach <b className="num">{usd(after)} USD</b>{dir === 'korrektur' ? ' (die Schätzung wird damit ersetzt)' : ''}.</>}
      </CalcBox>
      <ErrorLine err={err} />
    </form>
  )
}

/* ------------------------------------------------------------------ Notiz */
function NoteForm(fp: FormProps) {
  const [title, setTitle] = useState('')
  const [text, setText] = useState('')
  const [date, setDate] = useState(today())
  const { err, onSubmit } = useSubmit(fp, async () => {
    if (!title.trim()) throw new Error('Titel eingeben.')
    await mutate([{ op: 'set', coll: 'log', id: uid(), data: { date, title: title.trim(), text: text.trim(), by: 'LiAd' } }])
    return 'Notiz gespeichert.'
  })
  return (
    <form id={fp.formId} onSubmit={onSubmit} className="grid gap-3.5">
      <Field label="Titel">{(id) => <input id={id} className="input" placeholder="z. B. Uber 2. Tranche verschoben" value={title} onChange={(e) => setTitle(e.target.value)} autoFocus />}</Field>
      <Field label="Text">{(id) => <textarea id={id} className="input" value={text} onChange={(e) => setText(e.target.value)} />}</Field>
      <Field label="Datum">{(id) => <input id={id} className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} />}</Field>
      <ErrorLine err={err} />
    </form>
  )
}

/* ------------------------------------------------------------------ Blatt */
export function EntrySheet({ open, type: initial, fromId, ticker, kind, onClose }: { open: boolean; type: EntryType; fromId?: string; ticker?: string; kind?: ImportKind; onClose: () => void }) {
  // Das Blatt wird bei jedem Öffnen neu aufgebaut (key in App), darum genügt der Startwert.
  const [type, setType] = useState<EntryType>(initial)
  const [busy, setBusy] = useState(false)
  const formId = useId()
  const fp: FormProps = {
    formId,
    setBusy,
    onSaved: (msg) => {
      onClose()
      toast(msg)
    },
  }
  const confirming = type === 'dividende' && !!fromId
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={type === 'import' ? 'Massen-Import' : confirming ? 'Dividende bestätigen' : 'Neuer Eintrag'}
      sub={CLOUD ? 'Wird in deinem Konto gespeichert. Es werden nie Orders platziert.' : 'Wird nur lokal auf diesem Rechner gespeichert. Es werden nie Orders platziert.'}
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose}>Abbrechen</button>
          <button type="submit" form={formId} className="btn btn-primary" disabled={busy}>{busy ? 'Speichert …' : type === 'import' ? 'Übernehmen' : 'Speichern'}</button>
        </>
      }
    >
      {!confirming && type !== 'import' && <Segmented className="mb-5 flex w-full [&>button]:flex-1 [&>button]:px-1" label="Art des Eintrags" value={type} onChange={setType} options={TYPES} />}
      {type === 'kauf' && <TradeForm key="kauf" type="kauf" ticker={ticker} {...fp} />}
      {type === 'verkauf' && <TradeForm key="verkauf" type="verkauf" ticker={ticker} {...fp} />}
      {type === 'dividende' && <DividendForm key={fromId ?? 'neu'} fromId={fromId} {...fp} />}
      {type === 'einzahlung' && <CashForm {...fp} />}
      {type === 'notiz' && <NoteForm {...fp} />}
      {type === 'import' && <ImportForm formId={formId} initial={kind ?? 'trades'} setBusy={setBusy} onSaved={fp.onSaved} />}
      {!confirming && (
        <button type="button" className="mt-5 text-[12.5px] text-muted underline decoration-line-2 underline-offset-4 hover:text-ink" onClick={() => setType(type === 'import' ? 'kauf' : 'import')}>
          {type === 'import' ? 'Zurück zum einzelnen Eintrag' : 'Viele Einträge auf einmal? Massen-Import öffnen'}
        </button>
      )}
    </Sheet>
  )
}
