/**
 * Wertverlauf des Depots, nachgerechnet aus den Buchungen und den Kursverläufen.
 *
 *   Wert je Zeitpunkt  = Stückzahl laut Buchungen × Kurs (+ Cash, sofern Cash erfasst wird)
 *   Netto investiert   = Käufe minus Verkaufserlöse (bzw. Ein- minus Auszahlungen, wenn Cash erfasst wird)
 *   Rendite            = zeitgewichtet: Käufe, Verkäufe und Einzahlungen verändern sie nicht
 *
 * Splits: Die Kurse sind splitbereinigt. Eine Korrektur-Buchung mit Stückzahl und ohne Geldfluss gilt
 * darum als Split, und die frühere Stückzahl wird auf den heutigen Stand umgerechnet.
 */
import { HOLDING_BUCKETS } from './buckets'
import { quote, settingsOf } from './calc'
import type { ChartData, DB, HoldingBucket } from './types'

const nyDate = (ms: number) => new Date(ms).toLocaleDateString('en-CA', { timeZone: 'America/New_York' })
const BEGIN = '0000-00-00'

export interface Timeline {
  /** je Titel: Stückzahl ab einem Datum (splitbereinigt), aufsteigend */
  steps: Record<string, { date: string; shares: number }[]>
  /** Geld, das in Wertpapiere geflossen ist: Kauf positiv, Verkauf negativ */
  trades: { date: string; ticker: string; amount: number }[]
  /** Ein- und Auszahlungen sowie Cash-Korrekturen */
  external: { date: string; amount: number }[]
  /** jede Änderung des Cash-Stands (Buchungen und erhaltene Dividenden) */
  cashMoves: { date: string; amount: number }[]
  /** erstes Datum mit Bestand; null, wenn es Bestände ohne Buchung gibt */
  first: string | null
  tickers: string[]
  /** Titel, deren Bestand nicht zu den Buchungen passt (Verlauf dort nur näherungsweise) */
  unbooked: string[]
}

export function timeline(db: DB): Timeline {
  const tx = Object.values(db.transactions).filter((x) => x.date).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
  const raw: Record<string, number> = {}
  const steps: Timeline['steps'] = {}
  const trades: Timeline['trades'] = []
  const external: Timeline['external'] = []
  const cashMoves: Timeline['cashMoves'] = []
  const mark = (t: string, date: string) => {
    const s = (steps[t] ??= [])
    const v = Math.abs(raw[t]) < 1e-9 ? 0 : raw[t]
    if (s.length && s[s.length - 1].date === date) s[s.length - 1].shares = v
    else s.push({ date, shares: v })
  }
  for (const x of tx) {
    const t = x.ticker
    const cd = x.cashDelta ?? 0
    if (t && x.shares) {
      if (x.type === 'kauf' || x.type === 'verkauf') {
        raw[t] = (raw[t] ?? 0) + (x.type === 'kauf' ? x.shares : -x.shares)
        mark(t, x.date)
        trades.push({ date: x.date, ticker: t, amount: cd ? -cd : (x.type === 'kauf' ? 1 : -1) * x.shares * (x.price ?? 0) })
      } else if (x.type === 'korrektur') {
        const before = raw[t] ?? 0
        const after = before + x.shares
        if (!cd && before > 0 && after > 0) for (const s of steps[t] ?? []) s.shares *= after / before
        raw[t] = after
        mark(t, x.date)
        if (cd) trades.push({ date: x.date, ticker: t, amount: -cd })
      }
    }
    if (cd) {
      cashMoves.push({ date: x.date, amount: cd })
      if (x.type === 'einzahlung' || x.type === 'auszahlung' || (x.type === 'korrektur' && !t)) external.push({ date: x.date, amount: cd })
    }
  }
  for (const d of Object.values(db.dividends)) if (d.status === 'erhalten' && d.payDate && d.net) cashMoves.push({ date: d.payDate, amount: d.net })
  cashMoves.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))

  // Abgleich mit dem Bestand: Was die Buchungen nicht erklären, gilt als durchgehend gehalten.
  const unbooked: string[] = []
  for (const [t, p] of Object.entries(db.positions)) {
    const have = raw[t] ?? 0
    if (Math.abs(have - (p.shares || 0)) <= 1e-6) continue
    unbooked.push(t)
    if (have > 0 && p.shares > 0) for (const s of steps[t]) s.shares *= p.shares / have
    else steps[t] = p.shares > 0 ? [{ date: BEGIN, shares: p.shares }] : []
  }
  const firsts = Object.values(steps).map((s) => s[0]?.date).filter(Boolean) as string[]
  const first = firsts.length && !firsts.includes(BEGIN) ? firsts.reduce((a, b) => (a < b ? a : b)) : null
  return { steps, trades, external, cashMoves, first, tickers: Object.keys(steps).filter((t) => steps[t].length), unbooked }
}

/** Den neuesten (Live-)Kurs als letzten Punkt einsetzen, damit der Chart dort endet, wo die Kennzahl steht. */
export function withNow(db: DB, chart: ChartData): ChartData {
  const n = chart.t.length
  if (!n) return chart
  let nowT = 0
  const px: Record<string, number> = {}
  for (const tk of Object.keys(chart.series)) {
    const q = quote(db, tk)
    if (q?.time && q.close > 0) {
      px[tk] = q.close
      nowT = Math.max(nowT, Date.parse(q.time))
    }
  }
  if (!nowT) return chart
  const nowD = nyDate(nowT)
  const lastT = chart.t[n - 1]
  const lastD = chart.d[n - 1]
  const step = chart.kind === 'intraday' ? (n > 1 ? chart.t[1] - chart.t[0] : 300_000) : 0
  if (nowD < lastD || (chart.kind === 'intraday' && nowT < lastT - step)) return chart
  const append = chart.kind === 'daily' ? nowD > lastD : nowT - lastT > Math.max(step / 2, 150_000)
  const series: Record<string, number[]> = {}
  for (const [tk, s] of Object.entries(chart.series)) {
    const v = px[tk] ?? s[n - 1]
    series[tk] = append ? [...s, v] : [...s.slice(0, n - 1), v]
  }
  if (!append) return { ...chart, series }
  return { ...chart, t: [...chart.t, nowT], d: [...chart.d, nowD], series }
}

/** Kursveränderung eines Titels über den Zeitraum, gemessen am Schlusskurs davor. */
export function rangeChange(chart: ChartData | null, t: string): number | null {
  const s = chart?.series[t]
  if (!chart || !s || !s.length) return null
  const base = chart.prev[t] ?? s[0]
  return base > 0 ? s[s.length - 1] / base - 1 : null
}

export interface PortfolioSeries {
  kind: 'intraday' | 'daily'
  t: number[]
  d: string[]
  value: number[]
  /** Netto investiert (bzw. Einzahlungen netto) als Niveau */
  invested: number[]
  /** zeitgewichtete Rendite, kumuliert ab der Basis */
  twr: number[]
  /** Ertrag in USD seit Beginn des Zeitraums, je Punkt (Wertänderung abzüglich der Zuflüsse) */
  pl: number[]
  /**
   * Ertrag im Verhältnis zum Kapital, das im Zeitraum gearbeitet hat (Anfangswert plus Zuflüsse, nach Zeit gewichtet).
   * Hat immer dasselbe Vorzeichen wie der Ertrag in USD; die zeitgewichtete Rendite kann davon abweichen.
   */
  mwr: number[]
  /** Wert unmittelbar vor dem Zeitraum; null, wenn das Depot erst im Zeitraum beginnt */
  base: number | null
  /** Ertrag im Zeitraum: Wertänderung abzüglich der Zuflüsse */
  gain: number
  buckets: Record<HoldingBucket, { value: number[]; twr: number[] }>
  /** Vergleichsindex: kumulierte Kursrendite je Punkt */
  bench: number[] | null
  /** gehaltene Titel ohne Kursverlauf (zum letzten bekannten Kurs bewertet) */
  approx: string[]
  cashTracked: boolean
  session?: { open: number; close: number }
}

/** Rendite eines Schritts: Zuflüsse zählen zum Tagesbeginn, Abflüsse zum Tagesende. */
const stepReturn = (prev: number, v: number, flow: number) =>
  flow >= 0 && prev + flow > 0 ? v / (prev + flow) - 1 : prev > 0 ? (v - flow) / prev - 1 : 0

export function portfolioSeries(db: DB, tl: Timeline, chart: ChartData, benchTicker = 'VTI'): PortfolioSeries | null {
  const n = chart.t.length
  if (!n) return null
  const settings = settingsOf(db)
  const cashTracked = !settings.cashExcluded
  const cashNow = cashTracked ? Number(settings.cash) || 0 : 0
  const firstCash = cashTracked ? tl.cashMoves[0]?.date : undefined
  const first = tl.first && firstCash && firstCash < tl.first ? firstCash : tl.first
  const s0 = first ? chart.d.findIndex((x) => x >= first) : 0
  if (s0 < 0) return null
  const start = chart.d[s0]

  const bucketOfT = (t: string): HoldingBucket => db.positions[t]?.bucket ?? 'aktien'
  const ids = HOLDING_BUCKETS.map((b) => b.id as HoldingBucket)
  const approx: string[] = []
  const lastTrade: Record<string, number> = {}
  for (const x of Object.values(db.transactions)) if (x.ticker && x.price) lastTrade[x.ticker] = x.price
  const fallback = (t: string) => quote(db, t)?.close ?? lastTrade[t] ?? 0
  const priceAt = (t: string, i: number) => {
    const s = chart.series[t]
    return s ? s[i] : fallback(t)
  }

  // Stand unmittelbar vor dem Zeitraum
  const ptr: Record<string, number> = {}
  const held: Record<string, number> = {}
  let baseSec = 0
  const bBase = Object.fromEntries(ids.map((id) => [id, 0])) as Record<HoldingBucket, number>
  for (const t of tl.tickers) {
    const st = tl.steps[t]
    let k = 0
    while (k < st.length && st[k].date < start) k++
    ptr[t] = k
    held[t] = k > 0 ? st[k - 1].shares : 0
    if (held[t] > 0) {
      const p = chart.series[t] ? (chart.prev[t] ?? chart.series[t][s0]) : fallback(t)
      baseSec += held[t] * p
      bBase[bucketOfT(t)] += held[t] * p
    }
  }
  // Cash am Ende eines Tages = heutiger Stand minus alle späteren Bewegungen
  let cp = tl.cashMoves.length
  let cashAfter = 0
  const cashAt = (date: string) => {
    while (cp > 0 && tl.cashMoves[cp - 1].date > date) cashAfter += tl.cashMoves[--cp].amount
    while (cp < tl.cashMoves.length && tl.cashMoves[cp].date <= date) cashAfter -= tl.cashMoves[cp++].amount
    return cashNow - cashAfter
  }
  const before = (list: { date: string; amount: number }[]) => list.reduce((s, f) => (f.date < start ? s + f.amount : s), 0)
  const flows = cashTracked ? tl.external : tl.trades
  let invested = before(flows)
  let baseCash = 0
  if (cashTracked) {
    // Cash vor dem Zeitraum: Stand am Ende des Vortags
    const dayBefore = new Date(Date.parse(start + 'T12:00:00Z') - 864e5).toISOString().slice(0, 10)
    baseCash = cashAt(dayBefore)
  }
  const baseTotal = baseSec + baseCash
  const base = baseTotal > 1e-9 ? baseTotal : null

  const t: number[] = [], d: string[] = [], value: number[] = [], inv: number[] = [], twr: number[] = []
  const buckets = Object.fromEntries(ids.map((id) => [id, { value: [] as number[], twr: [] as number[] }])) as PortfolioSeries['buckets']
  let fp = 0
  while (fp < flows.length && flows[fp].date < start) fp++
  let tp = 0
  while (tp < tl.trades.length && tl.trades[tp].date < start) tp++
  let prevV = baseTotal, cum = 1, gainFlows = 0
  const pl: number[] = [], mwr: number[] = []
  const seen: { t: number; amount: number }[] = []
  // Zeitpunkt des Anfangswerts: ein Schritt vor dem ersten Punkt
  const t0 = chart.t[s0] - (s0 + 1 < n ? chart.t[s0 + 1] - chart.t[s0] : 864e5)
  const bPrev = { ...bBase }
  const bCum = Object.fromEntries(ids.map((id) => [id, 1])) as Record<HoldingBucket, number>

  for (let i = s0; i < n; i++) {
    const date = chart.d[i]
    let sec = 0
    const bv = Object.fromEntries(ids.map((id) => [id, 0])) as Record<HoldingBucket, number>
    for (const tk of tl.tickers) {
      const st = tl.steps[tk]
      while (ptr[tk] < st.length && st[ptr[tk]].date <= date) held[tk] = st[ptr[tk]++].shares
      if (held[tk] > 0) {
        if (!chart.series[tk] && !approx.includes(tk)) approx.push(tk)
        const v = held[tk] * priceAt(tk, i)
        sec += v
        bv[bucketOfT(tk)] += v
      }
    }
    let f = 0
    while (fp < flows.length && flows[fp].date <= date) f += flows[fp++].amount
    const bf = Object.fromEntries(ids.map((id) => [id, 0])) as Record<HoldingBucket, number>
    while (tp < tl.trades.length && tl.trades[tp].date <= date) {
      bf[bucketOfT(tl.trades[tp].ticker)] += tl.trades[tp].amount
      tp++
    }
    const v = sec + (cashTracked ? cashAt(date) : 0)
    cum *= 1 + stepReturn(prevV, v, f)
    prevV = v
    invested += f
    gainFlows += f
    // Zuflüsse arbeiten ab dem Punkt davor (sie zählen zum Beginn des Schritts).
    if (f) seen.push({ t: i > s0 ? chart.t[i - 1] : t0, amount: f })
    const g = v - baseTotal - gainFlows
    const span = chart.t[i] - t0
    let cap = baseTotal
    for (const fl of seen) cap += fl.amount * (span > 0 ? (chart.t[i] - fl.t) / span : 1)
    const floor = (baseTotal + seen.reduce((s, fl) => s + Math.max(fl.amount, 0), 0)) * 0.1
    if (!(cap > floor)) cap = Math.max(floor, 0)
    pl.push(g)
    mwr.push(cap > 1e-6 ? g / cap : 0)
    t.push(chart.t[i])
    d.push(date)
    value.push(v)
    inv.push(invested)
    twr.push(cum - 1)
    for (const id of ids) {
      bCum[id] *= 1 + stepReturn(bPrev[id], bv[id], bf[id])
      bPrev[id] = bv[id]
      buckets[id].value.push(bv[id])
      buckets[id].twr.push(bCum[id] - 1)
    }
  }
  if (!value.length) return null

  let bench: number[] | null = null
  const bs = chart.series[benchTicker]
  if (bs) {
    const b0 = s0 > 0 ? bs[s0 - 1] : (chart.prev[benchTicker] ?? bs[s0])
    if (b0 > 0) bench = bs.slice(s0).map((p) => p / b0 - 1)
  }
  return {
    kind: chart.kind, t, d, value, invested: inv, twr, pl, mwr, base, gain: value[value.length - 1] - baseTotal - gainFlows,
    buckets, bench, approx, cashTracked, session: chart.session,
  }
}

/** Titel, die ab «since» irgendwann gehalten wurden (ohne Datum: alle je gehaltenen). */
export function heldSince(tl: Timeline, since: string | null): string[] {
  if (!since) return tl.tickers
  return tl.tickers.filter((t) => {
    const st = tl.steps[t]
    let k = 0
    while (k < st.length && st[k].date <= since) k++
    return (k > 0 && st[k - 1].shares > 0) || st.slice(k).some((s) => s.shares > 0)
  })
}
