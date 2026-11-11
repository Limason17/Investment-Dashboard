import { BUCKETS } from './buckets'
import { daysBetween, dfmt, dshort, pctPlain } from './format'
import type { BucketId, DB, LiveResult, DepotEvent, Dividend, Position, Quote, Settings, Snapshot, ViewId, WatchItem, WithId } from './types'

export interface Row {
  t: string
  p: Position
  q: Quote | undefined
  px: number | null
  val: number | null
  /** Tagesveränderung als Anteil */
  chg: number | null
  dayAbs: number | null
  /** Ø-Einstand je Stück */
  avg: number | null
  pl: number | null
  plPct: number | null
  /** Anteil am Gesamtwert */
  w: number
}

export interface Calc {
  rows: Row[]
  valuationComplete: boolean
  dailyComplete: boolean
  sec: number
  cash: number
  total: number
  day: number
  dayPct: number | null
  b: Record<BucketId, number>
  costKnown: number
  valKnownCost: number
  pl: number | null
  plPct: number | null
  lastDate: string | null
  /** Live-Stand, z. B. «Pre-Market 10:32»; sonst «Schluss 07.11.2026» */
  priceLabel: string | null
  /** true, solange eine Sitzung läuft (Pre, regulär, After, Overnight) */
  live: boolean
  settings: Settings
}

export const settingsOf = (db: DB): Settings => db.meta.settings ?? { cash: 0 }
export const wht = (db: DB) => {
  const w = Number(settingsOf(db).withholding)
  return Number.isFinite(w) ? w : 0.15
}

/** Aktuellster Kurs: Routine-Abgleich (market/latest) schlägt den gespeicherten Kurs, wenn er neuer ist. */
export function quote(db: DB, t: string): Quote | undefined {
  const a = db.prices[t]
  const b = db.market.latest?.quotes?.[t]
  if (!b) return a
  if (!a) return b
  return (b.date || '') >= (a.date || '') ? { ...a, ...b } : { ...b, ...a }
}

/** Live-Kurse als neueste Quelle einsetzen; Dividendenraten aus prices.json bleiben erhalten. */
export function withLive(db: DB, live: LiveResult | null): DB {
  if (!live || !Object.keys(live.quotes).length) return db
  const quotes: Record<string, Quote> = { ...db.market.latest?.quotes }
  for (const [t, l] of Object.entries(live.quotes)) {
    const date = new Date(l.time).toLocaleDateString('en-CA', { timeZone: 'America/New_York' })
    quotes[t] = { ...quotes[t], close: l.price, prev: l.ref, date, source: l.source, session: l.session, time: l.time }
    // Dividendenrate aus den Ausschüttungen der letzten 12 Monate; eine von Hand gepflegte Rate in prices.json bleibt bestehen.
    const dv = live.div?.[t]
    if (dv && !(db.prices[t]?.divAnnual ?? 0)) quotes[t] = { ...quotes[t], divAnnual: dv.annual, divFreq: dv.freq }
  }
  return { ...db, market: { ...db.market, latest: { ...db.market.latest, quotes, refreshedAt: live.at, by: 'Live', status: live.failures.length ? 'teilweise' : 'ok', failures: live.failures } } }
}

const SESSION: Record<string, string> = { pre: 'Pre-Market', regular: 'Live', post: 'After-Hours', overnight: 'Overnight', closed: 'Stand' }
const hhmm = (iso: string) => new Date(iso).toLocaleTimeString('de-CH', { hour: '2-digit', minute: '2-digit' })
/** Beschriftung eines Kurses: Sitzung und Uhrzeit (Ortszeit) bei Live-Kursen, sonst das Schlussdatum. */
export function quoteLabel(q: Quote | undefined, fallback?: string) {
  // Datum und Uhrzeit beide in Ortszeit: q.date ist der New Yorker Handelstag und läge nach Mitternacht einen Tag zurück.
  if (q?.session && q.time) return q.session === 'closed' ? `Stand ${dfmt(new Date(q.time).toLocaleDateString('en-CA'))} ${hhmm(q.time)}` : `${SESSION[q.session]} ${hhmm(q.time)}`
  const d = q?.date ?? fallback
  return d ? 'Schluss ' + dfmt(d) : 'Kurs fehlt'
}

export function compute(db: DB): Calc {
  const settings = settingsOf(db)
  const rows: Row[] = []
  let sec = 0, prevSec = 0, costKnown = 0, valKnownCost = 0
  let lastDate: string | null = null
  let newest: Quote | undefined
  for (const t of Object.keys(db.positions)) {
    const p = db.positions[t]
    if (!p || !(p.shares > 0)) continue
    const q = quote(db, t)
    const px = q?.close ?? null
    const val = px != null ? p.shares * px : null
    const prev = q?.prev != null ? p.shares * q.prev : null
    if (val != null) {
      sec += val
      prevSec += prev ?? val
    }
    if (q?.date && (!lastDate || q.date > lastDate)) lastDate = q.date
    if (q?.time && (!newest?.time || q.time > newest.time)) newest = q
    if (p.cost != null && val != null) {
      costKnown += p.cost
      valKnownCost += val
    }
    const pl = p.cost != null && val != null ? val - p.cost : null
    rows.push({
      t, p, q, px, val,
      chg: q && q.prev ? q.close / q.prev - 1 : null,
      dayAbs: val != null && prev != null ? val - prev : null,
      avg: p.cost != null && p.shares ? p.cost / p.shares : null,
      pl,
      plPct: pl != null && p.cost ? pl / p.cost : null,
      w: 0,
    })
  }
  const valuationComplete = rows.length > 0 && rows.every((r) => r.px != null)
  const dailyComplete = valuationComplete && rows.every((r) => r.q?.prev != null)
  const cash = settings.cashExcluded ? 0 : Number(settings.cash) || 0
  const total = sec + cash
  const b = { etf: 0, aktien: 0, zukunft: 0, metalle: 0, cash } as Record<BucketId, number>
  for (const r of rows) {
    r.w = total ? (r.val ?? 0) / total : 0
    b[r.p.bucket || 'aktien'] += r.val ?? 0
  }
  const pl = valuationComplete && costKnown ? valKnownCost - costKnown : null
  return {
    rows, valuationComplete, dailyComplete, sec, cash, total, day: sec - prevSec, dayPct: dailyComplete && prevSec ? sec / prevSec - 1 : null, b,
    costKnown, valKnownCost, pl, plPct: pl != null && costKnown ? pl / costKnown : null, lastDate, settings,
    priceLabel: newest ? quoteLabel(newest) : lastDate ? quoteLabel(undefined, lastDate) : null,
    live: !!newest?.session && newest.session !== 'closed',
  }
}

export const targetOf = (s: Settings, id: BucketId) => (s.targets?.[id] ?? BUCKETS.find((b) => b.id === id)!.target) / 100

/* ------------------------------------------------------------------ Dividenden */
export function divAnnual(db: DB) {
  let gross = 0
  const per: { t: string; v: number; rate: number; freq?: string; px: number | null }[] = []
  for (const t of Object.keys(db.positions)) {
    const p = db.positions[t]
    const q = quote(db, t)
    if (p && p.shares > 0 && q?.divAnnual && q.divAnnual > 0) {
      const v = p.shares * q.divAnnual
      gross += v
      per.push({ t, v, rate: q.divAnnual, freq: q.divFreq, px: q.close ?? null })
    }
  }
  return { gross, net: gross * (1 - wht(db)), per: per.sort((a, b) => b.v - a.v) }
}

/* ------------------------------------------------------------------ Watchlist */
export type Tone = 'up' | 'down' | 'warn' | 'info' | 'mute'
export interface WlState {
  tone: Tone
  label: string
  /** Abstand zur Grenze als Anteil; ≤ 0 heisst unter der Grenze */
  d: number | null
}
export function wlState(w: WatchItem, px: number | null): WlState {
  if (!w.limit) return { tone: 'mute', label: 'keine Grenze', d: null }
  if (px == null) return { tone: 'mute', label: 'Kurs fehlt', d: null }
  const d = px / w.limit - 1
  if (d <= 0) return w.conditionMet === false ? { tone: 'warn', label: 'Bedingung offen', d } : { tone: 'up', label: 'unter Grenze', d }
  if (d <= 0.05) return { tone: 'warn', label: 'nahe', d }
  return { tone: 'mute', label: 'darüber', d }
}
export interface WatchRow {
  w: WatchItem
  px: number | null
  date: string | undefined
  chg: number | null
  s: WlState
}
export function watchRows(db: DB): WatchRow[] {
  return Object.values(db.watchlist)
    .map((w) => {
      const q = quote(db, w.ticker)
      const px = q?.close ?? w.price ?? null
      return { w, px, date: q?.date || w.priceDate, chg: q && q.prev ? q.close / q.prev - 1 : null, s: wlState(w, px) }
    })
    .sort((a, b) => (a.s.d ?? 9) - (b.s.d ?? 9))
}

/* ------------------------------------------------------------------ Listen mit Id */
export const withIds = <T,>(rec: Record<string, T>): WithId<T>[] => Object.entries(rec).map(([id, v]) => ({ ...v, id }))
export const eventsSorted = (db: DB): WithId<DepotEvent>[] => withIds(db.events).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
export const upcomingEvents = (db: DB, now: string) => eventsSorted(db).filter((e) => !e.done && (e.date >= now || daysBetween(e.date, now) <= 21))
export const dividendsList = (db: DB): WithId<Dividend>[] => withIds(db.dividends)
export const snapshotsSorted = (db: DB): Snapshot[] =>
  Object.entries(db.snapshots)
    .map(([id, s]) => ({ ...s, date: s.date || id }))
    .filter((s) => s.total > 0)
    .sort((a, b) => (a.date < b.date ? -1 : 1))

/* ------------------------------------------------------------------ Hinweise der Übersicht */
export interface Attention {
  tone: 'down' | 'warn' | 'up' | 'info' | 'mute'
  kind: 'Achtung' | 'Prüfen' | 'Grenze' | 'Offen' | 'Bald'
  title: string
  detail: string
  goto?: ViewId
  ticker?: string
}

/** ETF-Kern gegen den harten Deckel; ohne Cash-Stand nicht beurteilbar. */
export function etfCap(c: Calc): { w: number; cap: number; state: 'ueber' | 'nahe' | 'ok' } | null {
  if (!c.valuationComplete || c.settings.cashExcluded || !c.total) return null
  const w = c.b.etf / c.total
  const cap = targetOf(c.settings, 'etf')
  return { w, cap, state: w > cap ? 'ueber' : w > cap - 0.02 ? 'nahe' : 'ok' }
}

/** Nur was heute eine Handlung braucht: veraltete Kurse, verletzter Deckel, Dividenden zum Bestätigen. */
export function alerts(db: DB, c: Calc, now: string): Attention[] {
  const out: Attention[] = []
  if (c.lastDate && daysBetween(c.lastDate, now) > 4) {
    out.push({ tone: 'warn', kind: 'Prüfen', title: 'Kurse sind nicht aktuell', detail: `Letzter Kurs vom ${dfmt(c.lastDate)}. «Aktualisieren» holt sie neu.` })
  }
  const fails = db.market.latest?.failures ?? []
  if (fails.length) out.push({ tone: 'warn', kind: 'Prüfen', title: `${fails.length} Titel ohne Live-Kurs`, detail: fails.map((f) => f.split(' ')[0]).join(', ') + ': Es gilt der letzte gespeicherte Kurs.' })
  const etf = etfCap(c)
  if (etf?.state === 'ueber') out.push({ tone: 'down', kind: 'Achtung', goto: 'plan', title: 'ETF-Deckel überschritten', detail: `ETF-Kern bei ${pctPlain(etf.w)} (Deckel ${pctPlain(etf.cap, 0)}). Keine weiteren ETF-Käufe.` })
  else if (etf?.state === 'nahe') out.push({ tone: 'warn', kind: 'Prüfen', goto: 'plan', title: 'ETF-Kern nahe am Deckel', detail: `${pctPlain(etf.w)} von maximal ${pctPlain(etf.cap, 0)}.` })
  const pend = dividendsList(db).filter((d) => d.status === 'erwartet' && d.payDate && d.payDate <= now)
  if (pend.length) {
    out.push({ tone: 'info', kind: 'Offen', goto: 'dividenden', title: `${pend.length} Dividende${pend.length > 1 ? 'n' : ''} zu bestätigen`, detail: pend.map((d) => d.ticker + ' ' + dshort(d.payDate)).join(', ') + ': Betrag aus Schwab eintragen.' })
  }
  return out
}

/** Ergebnis des laufenden Jahres aus den Buchungen: realisierte Verkäufe und erhaltene Dividenden. */
export function yearStats(db: DB, year: string) {
  const sales = Object.values(db.transactions).filter((t) => t.type === 'verkauf' && t.realized != null && t.date.startsWith(year))
  const divs = Object.values(db.dividends).filter((d) => d.status === 'erhalten' && (d.payDate || '').startsWith(year))
  return {
    sales: sales.length,
    realized: sales.reduce((s, t) => s + (t.realized ?? 0), 0),
    fifo: sales.some((t) => t.costMethod),
    divCount: divs.length,
    divNet: divs.reduce((s, d) => s + (d.net || 0), 0),
  }
}
