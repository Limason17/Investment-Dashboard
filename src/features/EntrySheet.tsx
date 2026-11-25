import { useEffect, useId, useMemo, useState, type FormEvent, type ReactNode } from 'react'
import { Sheet } from '@/components/Sheet'
import { Segmented } from '@/components/ui'
import { defaultCat, HOLDING_BUCKETS } from '@/lib/buckets'
import { quote, wht } from '@/lib/calc'
import { commit } from '@/lib/commit'
import { getAccount } from '@/lib/cloud'
import { CLOUD } from '@/lib/config'
import { useDepot, type EntryType } from '@/lib/context'
import { normTicker } from '@/lib/ticker'
import { dfmt, parseNum, pctPlain, qty, r2, today, uid, usdRaw as usd } from '@/lib/format'
import { MIN_DATE, type ImportKind } from '@/lib/bulk'
import { ImportForm } from './ImportForm'
import { applyOps, emptyDepot, movesCash, replayOps, reverseTx, stornoOps } from '@/lib/reverse'
import { txLabel } from '@/lib/labels'
import { Trash2 } from 'lucide-react'
import { lookupTicker, mutate, type Op } from '@/lib/store'
import { toast } from '@/lib/toast'
import type { DB } from '@/lib/types'

const TYPES: { value: EntryType; label: string }[] = [
  { value: 'kauf', label: 'Kauf' },
  { value: 'verkauf', label: 'Verkauf' },
  { value: 'dividende', label: 'Dividende' },
  { value: 'einzahlung', label: 'Cash' },
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
/** Cash-Stand nachführen; entfällt, solange Cash nicht erfasst wird oder die Buchung im letzten Cash-Stand schon enthalten ist. */
const balanceNote = 'Das Datum liegt am oder vor deinem letzten Cash-Stand. Der Betrag ist dort schon enthalten, das Cash bleibt gleich.'
const cashOp = (db: DB, delta: number, date?: string): Op | null => (cashOff(db) || !movesCash(db, date) ? null : { op: 'merge', coll: 'meta', id: 'settings', data: { cash: r2(cashOf(db) + delta) } })

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
  // Eine Fehlermeldung gilt für die Eingabe, die sie ausgelöst hat: Sobald etwas geändert wird, verschwindet sie.
  const clearErr = () => setErr((e) => (e ? '' : e))
  return { err, setErr, clearErr, onSubmit }
}
/** Buchungsdatum: vorhanden und nicht in der Zukunft (Käufe und Zahlungen geschehen nie später als heute). */
function checkDate(d: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) throw new Error('Datum eingeben.')
  if (d > today()) throw new Error('Das Datum liegt in der Zukunft.')
  if (d < MIN_DATE) throw new Error('Das Datum liegt zu weit zurück. Stimmt das Jahr?')
}
const ErrorLine = ({ err }: { err: string }) => (err ? <div role="alert" className="text-[12.5px] text-down">{err}</div> : null)

/* ------------------------------------------------------------------ Kauf / Verkauf */
function TradeForm({ type, ticker: preset, fromId, ...fp }: FormProps & { type: 'kauf' | 'verkauf'; ticker?: string; fromId?: string }) {
  const { db: current } = useDepot()
  // Bearbeiten = Storno der alten Buchung und neue Buchung in einem Zug; gerechnet wird auf dem Stand ohne die alte.
  const old = fromId ? current.transactions[fromId] : undefined
  const undo = useMemo(() => (old && fromId ? reverseTx(current, fromId, old) : []), [current, old, fromId])
  const db = useMemo(() => (undo.length ? applyOps(current, undo) : current), [current, undo])
  const [tk, setTk] = useState(old?.ticker ?? preset ?? '')
  const [sh, setSh] = useState(old?.shares != null ? String(old.shares) : '')
  const [px, setPx] = useState(old?.price != null ? String(old.price) : '')
  const [fee, setFee] = useState(old?.fees != null ? String(old.fees) : '0')
  const [date, setDate] = useState(old?.date ?? today())
  const [bucket, setBucket] = useState(defaultCat)
  // Kategorie nicht selbst gewählt: ETFs kommen nach dem ersten Kurs von selbst zu «ETFs».
  const [bucketPicked, setBucketPicked] = useState(false)
  const [pot, setPot] = useState(old?.pot ?? '')
  const [note, setNote] = useState(old?.note ?? '')
  const listId = useId()
  const tickers = [...new Set([...Object.keys(db.positions), ...Object.keys(db.watchlist)])].sort()
  const pots = Object.entries(db.pots).map(([id, p]) => ({ id, ...p })).sort((a, b) => (a.order ?? 99) - (b.order ?? 99))

  const t = normTicker(tk) ?? ''
  const nSh = parseNum(sh), nPx = parseNum(px), nFee = parseNum(fee) || 0
  const p = db.positions[t]
  // Beim Bearbeiten: heutiger Bestand ohne die alte Buchung (ungekürzt, auch wenn spätere Verkäufe folgen)
  const have = old && old.ticker === t ? (current.positions[t]?.shares || 0) - (old.type === 'kauf' ? 1 : -1) * (old.shares ?? 0) : p?.shares || 0
  const avg = p && p.cost != null && p.shares ? p.cost / p.shares : null
  const amt = nSh && nPx ? nSh * nPx : null
  // Gewählter Topf: was danach noch frei ist (beim Bearbeiten ist die alte Buchung schon herausgerechnet)
  const potNow = pot ? db.pots[pot] : undefined
  const potLeft = potNow && amt != null ? (potNow.budget || 0) - (potNow.used || 0) - amt - nFee : null
  // Buchung am oder vor dem letzten Cash-Stand: im erfassten Saldo schon enthalten, Cash bleibt.
  const moves = !cashOff(db) && movesCash(db, date)
  const inBalance = !cashOff(db) && !moves
  // Titel neu durchrechnen (auch den alten Titel, wenn beim Bearbeiten der Ticker wechselt): spätere Verkäufe stimmen so weiter.
  // Neuer Titel ohne Kurs: beim Kurs-Dienst nachfragen, ob es den Ticker gibt (Tippfehler früh erkennen).
  const [look, setLook] = useState<{ t: string; r: Awaited<ReturnType<typeof lookupTicker>> } | null>(null)
  const needLook = type === 'kauf' && !!t && !p && !quote(db, t)
  useEffect(() => {
    if (!needLook) return
    let alive = true
    const id = setTimeout(() => void lookupTicker(t).then((r) => alive && setLook({ t, r })), 600)
    return () => {
      alive = false
      clearTimeout(id)
    }
  }, [needLook, t])
  const lookNow = needLook && look?.t === t ? look.r : null
  const replay = (ops: (Op | null | false)[]) => {
    let out = ops.filter((o): o is Op => !!o)
    for (const x of new Set([t, old?.ticker].filter((y): y is string => !!y))) out = replayOps(current, out, x)
    return out
  }

  const { err, clearErr, onSubmit } = useSubmit(fp, async () => {
    if (tk.trim() && !t) throw new Error('Ticker ungültig, z. B. MSFT oder BRK-B.')
    if (!t || nSh == null || nPx == null) throw new Error('Titel, Stück und Preis müssen ausgefüllt sein.')
    if (nSh <= 0) throw new Error('Stück müssen grösser als 0 sein.')
    if (nPx <= 0) throw new Error('Preis muss grösser als 0 sein.')
    if (fee.trim() && (parseNum(fee) == null || nFee < 0)) throw new Error('Gebühren prüfen: eine Zahl ab 0.')
    checkDate(date)
    const a = nSh * nPx
    const createdAt = new Date().toISOString()
    if (type === 'kauf') {
      const cashDelta = -(a + nFee)
      const usedPot = pot && db.pots[pot] ? pot : null
      await commit(replay([
        ...undo,
        { op: 'set', coll: 'transactions', id: fromId ?? uid(), data: { type, date, ticker: t, shares: nSh, price: nPx, fees: nFee, cashDelta: r2(cashDelta), pot: usedPot, note, createdAt: old?.createdAt ?? createdAt, by: 'Dashboard' } },
        p
          ? { op: 'merge', coll: 'positions', id: t, data: { shares: +(p.shares + nSh).toFixed(6), cost: p.cost != null ? r2(p.cost + a + nFee) : null } }
          : { op: 'set', coll: 'positions', id: t, data: { ticker: t, name: db.watchlist[t]?.name || t, shares: nSh, bucket, ...(bucketPicked ? {} : { catAuto: true }), cost: r2(a + nFee), status: 'Neu gekauft ' + dfmt(date), note: '' } },
        cashOp(db, cashDelta, date),
        usedPot ? { op: 'merge', coll: 'pots', id: usedPot, data: { used: r2((db.pots[usedPot].used || 0) + a + nFee) } } : null,
        !quote(db, t) && { op: 'set', coll: 'prices', id: t, data: { close: nPx, prev: null, date, source: 'Kaufpreis' } },
      ]))
      return `Kauf ${t} gespeichert.`
    }
    if (!p || p.shares < nSh - 1e-9) throw new Error('So viele Stück sind nicht im Bestand.')
    const cashDelta = a - nFee
    const left = +(p.shares - nSh).toFixed(6)
    await commit(replay([
      ...undo,
      { op: 'set', coll: 'transactions', id: fromId ?? uid(), data: { type, date, ticker: t, shares: nSh, price: nPx, fees: nFee, cashDelta: r2(cashDelta), realized: avg != null ? r2(cashDelta - avg * nSh) : null, note, createdAt: old?.createdAt ?? createdAt, by: 'Dashboard' } },
      { op: 'merge', coll: 'positions', id: t, data: { shares: left, cost: avg != null ? r2(avg * left) : null } },
      cashOp(db, cashDelta, date),
    ]))
    return `Verkauf ${t} gespeichert.`
  })

  return (
    <form id={fp.formId} onSubmit={onSubmit} onChange={clearErr} className="grid gap-3.5">
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
            <Field label="Kategorie (neuer Titel)">{(id) => (
              <select id={id} className="input" value={bucket} onChange={(e) => (setBucket(e.target.value), setBucketPicked(true))}>
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
            Kaufwert <b className="num">{usd(amt)}</b> + Gebühren {usd(nFee)} = <b className="num">{usd(amt + nFee)} USD</b>{moves ? ' aus dem Cash' : ''}.
            {potNow && <><br />Topf «{potNow.label}»: frei danach <span className={`num ${potLeft! < -0.005 ? 'font-medium text-warn' : ''}`}>{usd(potLeft!)} USD</span>{potLeft! < -0.005 ? ' (Kauf grösser als der Topf)' : ''}.</>}
            <br />Bestand danach: {qty(have + nSh!)} {t}{p ? '' : ' (neue Position)'}.{moves && <> Cash danach: <span className="num">{usd(cashOf(db) - amt - nFee)}</span>.</>}
            {inBalance && <><br />{balanceNote}</>}
            {lookNow?.found && <><br />Gefunden: {lookNow.name || t}{lookNow.price != null && lookNow.price > 0 ? <>, Kurs <span className="num">{usd(lookNow.price)}</span> USD</> : ''}.</>}
            {lookNow && !lookNow.found && <><br /><span className="font-medium text-warn">Zu «{t}» findet der Kurs-Dienst keinen Kurs. Ticker prüfen; ohne Kurs gilt der Kaufpreis als Bewertung.</span></>}
          </>
        ) : nSh! > have + 1e-9 ? (
          // Mehr als vorhanden: kein negativer Bestand und kein Ergebnis für Stück, die es nicht gibt
          <span className="font-medium text-down">{have > 0 ? <>Im Bestand sind nur {qty(have)} {t}. Weniger Stück eingeben.</> : <>{t} ist nicht im Bestand.</>}</span>
        ) : (
          <>
            Erlös <b className="num">{usd(amt - nFee)} USD</b>{moves ? ' ins Cash' : ''}. Bestand danach: {qty(have - nSh!)} {t}{have - nSh! < 1e-9 ? ' (Position geschlossen)' : ''}.
            {inBalance && <><br />{balanceNote}</>}
            {avg != null && <><br />Realisiert: <b className={`num font-semibold ${amt - nFee - avg * nSh! >= 0 ? 'text-up' : 'text-down'}`}>{usd(Math.abs(amt - nFee - avg * nSh!))}</b> USD gegen Ø-Einstand {usd(avg)}.</>}
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
  // Erwartete Zahlung bestätigen, deren Zahltag noch kommt: heute vorschlagen (früher gutgeschrieben).
  const [pay, setPay] = useState(from?.status === 'erwartet' && from.payDate > today() ? today() : from?.payDate ?? today())
  const [ex, setEx] = useState(from?.exDate ?? '')
  const [note, setNote] = useState(from?.note ?? '')
  const w = wht(db)
  const g = parseNum(gross)
  const tx = parseNum(tax) ?? (g != null ? r2(g * w) : null)
  // Tippfehler früh zeigen: Titel, der weder im Bestand ist noch je gebucht wurde (ein verkaufter Titel kann noch zahlen)
  const tNorm = normTicker(tk)
  const unknown = !!tNorm && !db.positions[tNorm] && !Object.values(db.transactions).some((x) => x.ticker === tNorm) && !Object.values(db.dividends).some((d) => d.ticker === tNorm)
  const exLate = !!ex && !!pay && ex > pay

  const { err, clearErr, onSubmit } = useSubmit(fp, async () => {
    const t = normTicker(tk)
    if (tk.trim() && !t) throw new Error('Ticker ungültig, z. B. MSFT oder BRK-B.')
    if (!t || g == null || g <= 0 || tx == null) throw new Error('Titel und Bruttobetrag eingeben.')
    if (tax.trim() && parseNum(tax) == null) throw new Error('Quellensteuer prüfen: ein Betrag in USD, leer = Standardsatz.')
    if (tx < 0 || tx > g) throw new Error('Die Quellensteuer muss zwischen 0 und dem Bruttobetrag liegen (ein Betrag in USD, kein Prozentsatz).')
    if (pay) checkDate(pay)
    if (ex && pay && ex > pay) throw new Error('Der Ex-Tag liegt nach dem Zahltag. Bitte die Daten prüfen.')
    await commit([
      {
        op: 'set', coll: 'dividends', id: fromId || uid(),
        data: { ticker: t, exDate: ex || null, payDate: pay || today(), gross: r2(g), tax: r2(tx), net: r2(g - tx), status: 'erhalten', source: 'Eintrag im Dashboard', note, perShare: from?.perShare ?? null, shares: from?.shares ?? db.positions[t]?.shares ?? null },
      },
      // Schon erhaltene Dividende ändern: nur die Differenz geht ins Cash. Zahlungen bis zum letzten Cash-Stand stecken schon im Saldo.
      cashOp(db, (movesCash(db, pay || today()) ? g - tx : 0) - (from?.status === 'erhalten' && movesCash(db, from.payDate) ? from.net || 0 : 0)),
    ])
    return `Dividende ${t} ${usd(g - tx)} USD gespeichert.`
  })

  return (
    <form id={fp.formId} onSubmit={onSubmit} onChange={clearErr} className="grid gap-3.5">
      <Field label="Titel (Ticker)">{(id) => <input id={id} className="input uppercase" value={tk} onChange={(e) => setTk(e.target.value)} autoFocus={!from} />}</Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Brutto gesamt (USD)">{(id) => <input id={id} className="input num" inputMode="decimal" value={gross} onChange={(e) => setGross(e.target.value)} autoFocus={!!from} />}</Field>
        <Field label="Quellensteuer (USD)" hint={`leer = ${pctPlain(w, 0)} angenommen`}>{(id) => <input id={id} className="input num" inputMode="decimal" value={tax} onChange={(e) => setTax(e.target.value)} />}</Field>
        <Field label="Zahltag">{(id) => <input id={id} className="input" type="date" value={pay} onChange={(e) => setPay(e.target.value)} />}</Field>
        <Field label="Ex-Tag (optional)">{(id) => <input id={id} className="input" type="date" value={ex} onChange={(e) => setEx(e.target.value)} />}</Field>
      </div>
      <Field label="Notiz">{(id) => <input id={id} className="input" value={note} onChange={(e) => setNote(e.target.value)} />}</Field>
      <CalcBox>
        {g == null || tx == null ? 'Bruttobetrag aus der Buchung des Brokers eingeben.' : tx > g ? 'Die Quellensteuer ist höher als der Bruttobetrag. Bitte prüfen.' : g <= 0 ? 'Bruttobetrag muss grösser als 0 sein.' : <>Netto <b className="num">{usd(g - tx)} USD</b>{cashOff(db) || !movesCash(db, pay || today()) ? ' wird als erhalten gebucht.' : ' wird dem Cash gutgeschrieben.'}{!cashOff(db) && !movesCash(db, pay || today()) && <><br />{balanceNote}</>}</>}
        {unknown && <><br /><span className="font-medium text-warn">{tNorm} ist nicht im Depot und wurde nie gebucht. Ticker prüfen.</span></>}
        {exLate && <><br /><span className="font-medium text-down">Der Ex-Tag liegt nach dem Zahltag.</span></>}
      </CalcBox>
      <ErrorLine err={err} />
    </form>
  )
}

/* ------------------------------------------------------------------ Ein-/Auszahlung, Cash-Korrektur */
function CashForm({ fromId, ...fp }: FormProps & { fromId?: string }) {
  // Bearbeiten = alte Buchung stornieren und neu buchen, in einem Zug (wie bei Kauf und Verkauf)
  const { db: current } = useDepot()
  const old = fromId ? current.transactions[fromId] : undefined
  const undo = useMemo(() => (old && fromId ? reverseTx(current, fromId, old) : []), [current, old, fromId])
  const db = useMemo(() => (undo.length ? applyOps(current, undo) : current), [current, undo])
  const off = cashOff(db)
  // Neues, leeres Depot: Die erste Einzahlung startet das Cash bei 0, ein Cash-Stand vorher ist nicht nötig.
  const fresh = off && emptyDepot(db)
  const oldDir = old && (old.type === 'einzahlung' || old.type === 'auszahlung' || old.type === 'korrektur') ? old.type : null
  const [dir, setDirRaw] = useState<'einzahlung' | 'auszahlung' | 'korrektur'>(oldDir ?? (off && !fresh ? 'korrektur' : 'einzahlung'))
  // Beim Bearbeiten: Betrag bzw. der damals eingetragene Saldo
  const [amt, setAmt] = useState(old ? String(oldDir === 'korrektur' ? r2(cashOf(db) + (old.cashDelta || 0)) : Math.abs(old.cashDelta || 0)) : '')
  const [date, setDate] = useState(old?.date ?? today())
  const [note, setNote] = useState(old?.note ?? '')
  const cash = off ? 0 : cashOf(db)
  const a = parseNum(amt)
  const after = a == null ? null : dir === 'korrektur' ? a : dir === 'einzahlung' ? cash + a : cash - a
  const blocked = off && dir !== 'korrektur' && !(fresh && dir === 'einzahlung')
  const blockedText = fresh
    ? 'Es ist noch kein Cash erfasst, also gibt es nichts auszuzahlen. Erfasse zuerst eine Einzahlung oder trage mit «Cash-Stand eintragen» den Saldo laut Broker ein.'
    : 'Cash ist derzeit nicht erfasst. Trage zuerst mit «Cash-Stand eintragen» den Saldo laut Broker ein, danach zählen Ein- und Auszahlungen mit.'

  const { err, setErr, clearErr, onSubmit } = useSubmit(fp, async () => {
    if (a == null || after == null) throw new Error('Betrag eingeben.')
    if (dir !== 'korrektur' && a <= 0) throw new Error('Betrag muss grösser als 0 sein.')
    checkDate(date)
    if (blocked) throw new Error(blockedText)
    const start = off && dir === 'einzahlung'
    await commit(
      [
        ...undo,
        { op: 'set', coll: 'transactions', id: fromId ?? uid(), data: { type: dir, date, cashDelta: r2(after - cash), note, createdAt: old?.createdAt ?? new Date().toISOString(), by: 'Dashboard', ...(dir === 'korrektur' && off ? { cashStart: true } : {}) } },
        {
          op: 'merge', coll: 'meta', id: 'settings', data: {
            cash: r2(after),
            ...(dir === 'korrektur' ? { cashEstimate: false, cashExcluded: false, cashNote: 'Saldo laut Broker ' + dfmt(date), cashDate: date } : {}),
            ...(start ? { cashEstimate: false, cashExcluded: false } : {}),
          },
        },
      ],
      dir === 'korrektur' ? 0 : after - cash,
    )
    return 'Cash aktualisiert.'
  })
  const setDir = (d: typeof dir) => {
    setDirRaw(d)
    setErr('')
  }

  return (
    <form id={fp.formId} onSubmit={onSubmit} onChange={clearErr} className="grid gap-3.5">
      <Field label="Richtung">{(id) => (
        <select id={id} className="input" value={dir} onChange={(e) => setDir(e.target.value as typeof dir)}>
          <option value="einzahlung">Einzahlung aufs Konto</option>
          <option value="auszahlung">Auszahlung vom Konto</option>
          <option value="korrektur">Cash-Stand eintragen (Saldo laut Broker)</option>
        </select>
      )}</Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label={dir === 'korrektur' ? 'Neuer Saldo (USD)' : 'Betrag (USD)'}>{(id) => <input id={id} className="input num" inputMode="decimal" value={amt} onChange={(e) => setAmt(e.target.value)} autoFocus />}</Field>
        <Field label="Datum">{(id) => <input id={id} className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} />}</Field>
      </div>
      <Field label="Notiz">{(id) => <input id={id} className="input" value={note} onChange={(e) => setNote(e.target.value)} />}</Field>
      <CalcBox>
        {blocked ? (
          <>
            {blockedText}{' '}
            <button type="button" className="font-semibold text-accent underline underline-offset-2" onClick={() => setDir('korrektur')}>Zu «Cash-Stand eintragen» wechseln</button>
          </>
        ) : after == null ? (
          <>{off ? (fresh ? 'Noch kein Cash erfasst. Die erste Einzahlung startet das Cash bei 0 USD.' : 'Cash ist derzeit nicht erfasst.') : <>Aktuelles Cash: <b className="num">{usd(cash)} USD</b>.</>}</>
        ) : (
          <>Cash danach <b className="num">{usd(after)} USD</b>{dir === 'korrektur' && !off ? ' (ersetzt den bisherigen Stand)' : ''}.</>
        )}
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
  const { err, clearErr, onSubmit } = useSubmit(fp, async () => {
    if (!title.trim()) throw new Error('Titel eingeben.')
    await mutate([{ op: 'set', coll: 'log', id: uid(), data: { date, title: title.trim(), text: text.trim(), by: (CLOUD ? getAccount().user?.name : 'LiAd') || undefined } }])
    return 'Notiz gespeichert.'
  })
  return (
    <form id={fp.formId} onSubmit={onSubmit} onChange={clearErr} className="grid gap-3.5">
      <Field label="Titel">{(id) => <input id={id} className="input" placeholder="z. B. Nachkauf verschoben" value={title} onChange={(e) => setTitle(e.target.value)} autoFocus />}</Field>
      <Field label="Text">{(id) => <textarea id={id} className="input" value={text} onChange={(e) => setText(e.target.value)} />}</Field>
      <Field label="Datum">{(id) => <input id={id} className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} />}</Field>
      <ErrorLine err={err} />
    </form>
  )
}

/* ------------------------------------------------------------------ Blatt */
export function EntrySheet({ open, type: initial, fromId, ticker, kind, text, onClose }: { open: boolean; type: EntryType; fromId?: string; ticker?: string; kind?: ImportKind; text?: string; onClose: () => void }) {
  // Das Blatt wird bei jedem Öffnen neu aufgebaut (key in App), darum genügt der Startwert.
  const [type, setType] = useState<EntryType>(initial)
  // Aus einem Titel heraus (Kauf / Verkauf): nur diese zwei Arten zur Wahl
  const tradeOnly = !!ticker && !fromId && (initial === 'kauf' || initial === 'verkauf')
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
  const { db: current } = useDepot()
  const confirming = type === 'dividende' && !!fromId && current.dividends[fromId]?.status === 'erwartet'
  const editing = !!fromId && !confirming
  // Löschen einer Buchung geschieht hier im Bearbeiten (im Journal gibt es nur den Stift)
  const tx = fromId && type !== 'dividende' ? current.transactions[fromId] : undefined
  const [delArmed, setDelArmed] = useState(false)
  const remove = () => {
    const ops = stornoOps(current, fromId!)
    mutate(ops)
      .then(() => { onClose(); toast(ops.some((o) => o.coll === 'meta') ? 'Buchung gelöscht. Bestand und Cash sind zurückgesetzt.' : 'Buchung gelöscht.') })
      .catch((e) => toast('Nicht gelöscht: ' + e.message))
  }
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={type === 'import' ? 'Positionen hochladen' : type === 'buchung' ? 'Buchung' : confirming ? 'Dividende bestätigen' : editing ? 'Eintrag bearbeiten' : tradeOnly ? `${ticker} kaufen oder verkaufen` : 'Neuer Eintrag'}
      sub={CLOUD ? 'Wird in deinem Konto gespeichert. Es werden nie Orders platziert.' : 'Wird nur lokal auf diesem Rechner gespeichert. Es werden nie Orders platziert.'}
      footer={
        <>
          {tx && editing && (
            <button type="button" className="btn btn-ghost mr-auto text-down" onClick={() => (delArmed ? remove() : setDelArmed(true))}>
              <Trash2 /> {delArmed ? 'Wirklich löschen?' : 'Löschen'}
            </button>
          )}
          <button type="button" className="btn btn-ghost" onClick={onClose}>{type === 'buchung' ? 'Schliessen' : 'Abbrechen'}</button>
          {type !== 'buchung' && <button type="submit" form={formId} className="btn btn-primary" disabled={busy}>{busy ? 'Speichert …' : type === 'import' ? 'Übernehmen' : 'Speichern'}</button>}
        </>
      }
    >
      {!confirming && !editing && type !== 'import' && <Segmented className="mb-5 flex w-full [&>button]:flex-1 [&>button]:px-1" label="Art des Eintrags" value={type} onChange={setType} options={tradeOnly ? TYPES.slice(0, 2) : TYPES} />}
      {type === 'kauf' && <TradeForm key="kauf" type="kauf" ticker={ticker} fromId={fromId} {...fp} />}
      {type === 'verkauf' && <TradeForm key="verkauf" type="verkauf" ticker={ticker} fromId={fromId} {...fp} />}
      {type === 'dividende' && <DividendForm key={fromId ?? 'neu'} fromId={fromId} {...fp} />}
      {type === 'einzahlung' && <CashForm fromId={fromId} {...fp} />}
      {type === 'buchung' && tx && (
        <div className="grid gap-2 text-[13px]">
          <div className="grid grid-cols-[110px_minmax(0,1fr)] gap-y-1.5">
            <span className="text-muted">Art</span><span>{txLabel(tx)}</span>
            <span className="text-muted">Datum</span><span className="num">{dfmt(tx.date)}</span>
            {tx.ticker && <><span className="text-muted">Titel</span><span className="tk">{tx.ticker}</span></>}
            {tx.shares != null && <><span className="text-muted">Stück</span><span className="num">{qty(tx.shares)}</span></>}
            {!!tx.cashDelta && <><span className="text-muted">Betrag</span><span className="num">{usd(tx.cashDelta)} USD</span></>}
            {tx.note && <><span className="text-muted">Notiz</span><span>{tx.note}</span></>}
          </div>
          <p className="mt-2 text-[12.5px] text-muted">Diese Art Buchung lässt sich nicht bearbeiten, nur löschen.</p>
        </div>
      )}
      {type === 'notiz' && <NoteForm {...fp} />}
      {type === 'import' && <ImportForm formId={formId} initial={kind ?? 'trades'} initialText={text} setBusy={setBusy} onSaved={fp.onSaved} />}
      {!confirming && !editing && (
        <button type="button" className="mt-5 text-[12.5px] text-muted underline decoration-line-2 underline-offset-4 hover:text-ink" onClick={() => setType(type === 'import' ? 'kauf' : 'import')}>
          {type === 'import' ? 'Zurück zum einzelnen Eintrag' : 'Viele Einträge auf einmal? Positionen hochladen'}
        </button>
      )}
    </Sheet>
  )
}
