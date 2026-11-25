/**
 * Kursverläufe für die Charts (Tag, Woche, Monat, Jahr).
 *
 *   GET /api/chart?range=1T|1W|1M|3M|1J|5J|MAX&tickers=VTI,VXUS[&from=JJJJ-MM-TT]
 *
 *   1T   letzter Handelstag in 5-Minuten-Schritten inkl. Pre-Market und After-Hours. Kommt ohne
 *        zusätzliche Abfrage aus den Minutenkursen, die die Live-Kurse ohnehin holen.
 *   1W   5 Handelstage in 15-Minuten-Schritten (reguläre Sitzung)
 *   1M   1 Monat in Stundenschritten (reguläre Sitzung)
 *   3M   Tagesschlusskurse
 *   1J   Tagesschlusskurse
 *   5J   Wochenschlusskurse
 *   MAX  ab «from» (erstes Buchungsdatum): Tages-, Wochen- oder Monatskurse je nach Länge
 *
 * Alle Titel einer Antwort liegen auf demselben Zeitraster; Lücken sind mit dem letzten Kurs gefüllt.
 * Mit «&ohlc=1» kommen Eröffnung, Hoch und Tief je Punkt dazu (für Kerzencharts); Lücken bleiben dort leer (null).
 * Die Kurse sind splitbereinigt (wie bei Yahoo üblich), Dividenden sind nicht eingerechnet.
 * Quelle ist Yahoo Finance, eine inoffizielle Schnittstelle. Antworten werden zwischengespeichert,
 * damit die Quelle nicht öfter als nötig gefragt wird.
 */
import type { IntradayDay } from './live-quotes.ts'

export type ChartRange = '1T' | '1W' | '1M' | '3M' | '1J' | '5J' | 'MAX'

export interface ChartResult {
  range: ChartRange
  kind: 'intraday' | 'daily'
  interval: string
  at: string
  /** Zeitpunkt je Punkt, Millisekunden */
  t: number[]
  /** Handelstag je Punkt (New York), JJJJ-MM-TT; bei Wochen- und Monatskursen das Ende der Periode */
  d: string[]
  series: Record<string, number[]>
  /** Schlusskurs vor dem ersten Punkt (Vergleichsbasis des Zeitraums) */
  prev: Record<string, number | null>
  failures: string[]
  /** reguläre Sitzung des Tages (nur 1T), Millisekunden */
  session?: { open: number; close: number }
  /** nur mit «ohlc=1»: Eröffnung, Hoch, Tief je Punkt (Schluss = series); null = kein Handel in diesem Punkt */
  ohlc?: Record<string, Ohlc>
}

export interface Ohlc {
  o: (number | null)[]
  h: (number | null)[]
  l: (number | null)[]
}

interface Raw {
  /** Sekunden */
  t: number[]
  c: number[]
  /** Eröffnung, Hoch, Tief je Punkt (fehlt bei den Minutenkursen der Live-Kurse) */
  o?: number[]
  h?: number[]
  l?: number[]
  prev: number | null
}

const UA = { 'User-Agent': 'Mozilla/5.0 (depot-dashboard lokal)' }
const RANGES: ChartRange[] = ['1T', '1W', '1M', '3M', '1J', '5J', 'MAX']
const MIN = 60_000
const SPEC: Record<Exclude<ChartRange, '1T' | 'MAX'>, { q: string; interval: string; kind: 'intraday' | 'daily'; step: number; ttl: number }> = {
  // Feine Auflösung, soweit Yahoo sie liefert (5 Min. bis 60 Tage, 60 Min. bis 730 Tage zurück).
  '1W': { q: 'range=5d&interval=5m', interval: '5m', kind: 'intraday', step: 300, ttl: 2 * MIN },
  '1M': { q: 'range=1mo&interval=15m', interval: '15m', kind: 'intraday', step: 900, ttl: 10 * MIN },
  '3M': { q: 'range=3mo&interval=60m', interval: '60m', kind: 'intraday', step: 3600, ttl: 20 * MIN },
  '1J': { q: 'range=1y&interval=60m', interval: '60m', kind: 'intraday', step: 3600, ttl: 30 * MIN },
  '5J': { q: 'range=5y&interval=1d', interval: '1d', kind: 'daily', step: 0, ttl: 120 * MIN },
}

const nyDate = (ms: number) => new Date(ms).toLocaleDateString('en-CA', { timeZone: 'America/New_York' })
const noon = (date: string) => Date.parse(date + 'T12:00:00Z')
const addDays = (date: string, n: number) => new Date(noon(date) + n * 864e5).toISOString().slice(0, 10)
const round = (x: number) => Math.round(x * 10000) / 10000

/** Ende der Woche (Freitag) bzw. des Monats eines Handelstages; nie nach «today». */
function periodEnd(date: string, interval: string, today: string) {
  if (interval === '1wk') {
    const wd = new Date(noon(date)).getUTCDay() // 0 = So
    const end = addDays(date, wd === 0 ? 5 : 5 - wd)
    return end > today ? today : end
  }
  if (interval === '1mo') {
    const [y, m] = date.split('-').map(Number)
    const end = new Date(Date.UTC(y, m, 0, 12)).toISOString().slice(0, 10)
    return end > today ? today : end
  }
  return date
}

async function pool<T, R>(items: T[], n: number, fn: (x: T) => Promise<R>) {
  const out: PromiseSettledResult<R>[] = new Array(items.length)
  let k = 0
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (k < items.length) {
        const i = k++
        try {
          out[i] = { status: 'fulfilled', value: await fn(items[i]) }
        } catch (e) {
          out[i] = { status: 'rejected', reason: e }
        }
      }
    }),
  )
  return out
}

async function yahooChart(t: string, q: string): Promise<Raw> {
  const r = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(t)}?${q}`, { headers: UA, signal: AbortSignal.timeout(15000) })
  if (!r.ok) throw new Error('HTTP ' + r.status)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- fremde JSON-Antwort, Felder werden einzeln geprüft
  const j: any = await r.json()
  const res = j?.chart?.result?.[0]
  const ts: number[] = res?.timestamp ?? []
  const qt = res?.indicators?.quote?.[0] ?? {}
  const cl: (number | null)[] = qt.close ?? []
  const op: (number | null)[] = qt.open ?? [], hi: (number | null)[] = qt.high ?? [], lo: (number | null)[] = qt.low ?? []
  const o: number[] = [], h: number[] = [], l: number[] = []
  const out: Raw = { t: [], c: [], o, h, l, prev: typeof res?.meta?.chartPreviousClose === 'number' ? res.meta.chartPreviousClose : null }
  const ok = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x) && x > 0
  for (let i = 0; i < ts.length; i++) {
    const v = cl[i]
    if (ok(v)) {
      out.t.push(ts[i])
      out.c.push(round(v))
      // Fehlt ein Wert, gilt der Schluss; Hoch und Tief schliessen Eröffnung und Schluss immer ein.
      const a = op[i], b = hi[i], z = lo[i]
      const ov = ok(a) ? a : v
      o.push(round(ov))
      h.push(round(Math.max(ok(b) ? b : v, ov, v)))
      l.push(round(Math.min(ok(z) ? z : v, ov, v)))
    }
  }
  if (!out.t.length) throw new Error('keine Daten')
  return out
}

/**
 * Mehrere Titel auf ein gemeinsames Raster legen: Schlüssel je Punkt, letzter Kurs je Schlüssel, Lücken gefüllt.
 * Mit «withOhlc» zusätzlich Eröffnung (erste), Hoch (höchstes) und Tief (tiefstes) je Schlüssel; Lücken bleiben null.
 */
function align(raws: Record<string, Raw>, keyOf: (sec: number) => number | string, withOhlc = false) {
  const keys = new Set<number | string>()
  const maps: Record<string, Map<number | string, number>> = {}
  const bars: Record<string, Map<number | string, { o: number; h: number; l: number }>> = {}
  for (const [t, r] of Object.entries(raws)) {
    const m = new Map<number | string, number>()
    const b = new Map<number | string, { o: number; h: number; l: number }>()
    for (let i = 0; i < r.t.length; i++) {
      const k = keyOf(r.t[i])
      m.set(k, r.c[i])
      keys.add(k)
      if (withOhlc) {
        const o = r.o?.[i] ?? r.c[i], h = r.h?.[i] ?? r.c[i], l = r.l?.[i] ?? r.c[i]
        const x = b.get(k)
        if (x) {
          x.h = Math.max(x.h, h)
          x.l = Math.min(x.l, l)
        } else b.set(k, { o, h, l })
      }
    }
    maps[t] = m
    bars[t] = b
  }
  const grid = [...keys].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
  const series: Record<string, number[]> = {}
  for (const [t, m] of Object.entries(maps)) {
    const out: number[] = new Array(grid.length)
    let last: number | null = raws[t].prev
    let firstIdx = -1
    for (let i = 0; i < grid.length; i++) {
      const v = m.get(grid[i])
      if (v != null) {
        last = v
        if (firstIdx < 0) firstIdx = i
      }
      out[i] = last ?? NaN
    }
    // Ohne Vergleichskurs: Anfang mit dem ersten bekannten Kurs füllen.
    if (firstIdx > 0 && Number.isNaN(out[0])) for (let i = 0; i < firstIdx; i++) out[i] = out[firstIdx]
    series[t] = out
  }
  let ohlc: Record<string, Ohlc> | undefined
  if (withOhlc) {
    ohlc = {}
    for (const [t, b] of Object.entries(bars)) {
      const x: Ohlc = { o: [], h: [], l: [] }
      for (const k of grid) {
        const v = b.get(k)
        x.o.push(v ? v.o : null)
        x.h.push(v ? v.h : null)
        x.l.push(v ? v.l : null)
      }
      ohlc[t] = x
    }
  }
  return { grid, series, ohlc }
}

export function marketCharts(live: { (force?: boolean): Promise<unknown>; intraday: () => Record<string, IntradayDay> }) {
  const cache = new Map<string, { at: number; raw: Raw }>()
  const inflight = new Map<string, Promise<Raw>>()

  /** Ein Titel, eine Abfrage; bei Fehlern gilt die letzte bekannte Antwort weiter. */
  function load(t: string, q: string, ttl: number): Promise<Raw> {
    const key = t + '|' + q
    const hit = cache.get(key)
    if (hit && Date.now() - hit.at < ttl) return Promise.resolve(hit.raw)
    let p = inflight.get(key)
    if (!p) {
      p = yahooChart(t, q)
        .then((raw) => {
          cache.set(key, { at: Date.now(), raw })
          return raw
        })
        .catch((e) => {
          if (hit) return hit.raw
          throw e
        })
        .finally(() => inflight.delete(key))
      inflight.set(key, p)
    }
    return p
  }

  async function loadAll(tickers: string[], q: string, ttl: number) {
    const raws: Record<string, Raw> = {}
    const failures: string[] = []
    const rs = await pool(tickers, 6, (t) => load(t, q, ttl))
    rs.forEach((r, i) => {
      if (r.status === 'fulfilled') raws[tickers[i]] = r.value
      else failures.push(`${tickers[i]} (${r.reason instanceof Error ? r.reason.message : r.reason})`)
    })
    return { raws, failures }
  }

  return async function chart(rangeIn: string, tickersIn: string[], from?: string, withOhlc = false): Promise<ChartResult> {
    const range = (RANGES.includes(rangeIn as ChartRange) ? rangeIn : '1M') as ChartRange
    const tickers = [...new Set(tickersIn.map((t) => t.trim().toUpperCase()).filter((t) => /^[A-Z0-9.^=-]{1,12}$/.test(t)))].slice(0, 80).sort()
    const at = new Date().toISOString()
    const today = nyDate(Date.now())
    const prevOf = (raws: Record<string, Raw>) => Object.fromEntries(Object.entries(raws).map(([t, r]) => [t, r.prev]))

    if (range === '1T' && withOhlc) {
      // Kerzen brauchen Eröffnung, Hoch und Tief je Minute. Die Live-Kurse haben nur Schlusskurse, darum eigene Abfrage.
      await live().catch(() => null)
      const reg = Object.values(live.intraday())[0]?.regular
      const { raws, failures } = await loadAll(tickers, 'range=1d&interval=1m&includePrePost=true', MIN)
      const { grid, series, ohlc } = align(raws, (s) => s - (s % 60), true)
      const t = (grid as number[]).map((s) => s * 1000)
      return {
        range, kind: 'intraday', interval: '1m', at, t, d: t.map(nyDate), series, ohlc, prev: prevOf(raws), failures,
        ...(reg ? { session: { open: reg[0] * 1000, close: reg[1] * 1000 } } : {}),
      }
    }

    if (range === '1T') {
      await live().catch(() => null)
      const day = live.intraday()
      const raws: Record<string, Raw> = {}
      const missing: string[] = []
      for (const t of tickers) {
        const b = day[t]
        if (b && b.t.length) raws[t] = { t: b.t, c: b.c, prev: b.ref }
        else missing.push(t)
      }
      // Titel ausserhalb der Live-Liste (z. B. bereits verkauft) einzeln nachladen.
      const extra = await loadAll(missing, 'range=1d&interval=1m&includePrePost=true', MIN)
      Object.assign(raws, extra.raws)
      // Minutenraster: so fein, wie Yahoo die Kurse des Tages liefert.
      const { grid, series } = align(raws, (s) => s - (s % 60))
      const t = (grid as number[]).map((s) => s * 1000)
      const reg = Object.values(day)[0]?.regular
      return {
        range, kind: 'intraday', interval: '1m', at, t, d: t.map(nyDate), series, prev: prevOf(raws), failures: extra.failures,
        ...(reg ? { session: { open: reg[0] * 1000, close: reg[1] * 1000 } } : {}),
      }
    }

    let q: string, interval: string, kind: 'intraday' | 'daily', step: number, ttl: number
    if (range === 'MAX') {
      const start = from && /^\d{4}-\d{2}-\d{2}$/.test(from) ? from : addDays(today, -5 * 365)
      const days = Math.max(1, Math.round((noon(today) - noon(start)) / 864e5))
      // Bis knapp 2 Jahre stündlich (Grenze von Yahoo: 730 Tage), danach täglich bzw. wöchentlich.
      interval = days <= 700 ? '60m' : days <= 2300 ? '1d' : '1wk'
      // Eine Woche Vorlauf, damit Yahoo den Schlusskurs davor mitliefert; Tagesgrenze, damit der Zwischenspeicher greift.
      q = `period1=${Math.floor(noon(addDays(start, -7)) / 1000)}&period2=${Math.floor(noon(addDays(today, 2)) / 1000)}&interval=${interval}`
      kind = interval === '60m' ? 'intraday' : 'daily'
      step = interval === '60m' ? 3600 : 0
      ttl = interval === '60m' ? 20 * MIN : interval === '1d' ? 30 * MIN : 360 * MIN
    } else ({ q, interval, kind, step, ttl } = SPEC[range])

    const { raws, failures } = await loadAll(tickers, q, ttl)
    if (kind === 'intraday') {
      // Kerzen beginnen zur halben Stunde (09:30 New York): Raster am ersten Zeitpunkt ausrichten.
      const first = Object.values(raws)[0]?.t[0] ?? 0
      const off = first % step
      const { grid, series, ohlc } = align(raws, (s) => s - ((((s - off) % step) + step) % step), withOhlc)
      const t = (grid as number[]).map((s) => s * 1000)
      return { range, kind, interval, at, t, d: t.map(nyDate), series, ...(ohlc ? { ohlc } : {}), prev: prevOf(raws), failures }
    }
    const { grid, series, ohlc } = align(raws, (s) => periodEnd(nyDate(s * 1000), interval, today), withOhlc)
    let d = grid as string[]
    if (range === 'MAX' && from) {
      // Vorlauf wieder abschneiden; der letzte Kurs davor wird zur Vergleichsbasis.
      const cut = d.findIndex((x) => x >= from)
      if (cut > 0) {
        for (const [t, s] of Object.entries(series)) {
          raws[t].prev = Number.isFinite(s[cut - 1]) ? s[cut - 1] : raws[t].prev
          series[t] = s.slice(cut)
          const x = ohlc?.[t]
          if (ohlc && x) ohlc[t] = { o: x.o.slice(cut), h: x.h.slice(cut), l: x.l.slice(cut) }
        }
        d = d.slice(cut)
      }
    }
    return { range, kind, interval, at, t: d.map(noon), d, series, ...(ohlc ? { ohlc } : {}), prev: prevOf(raws), failures }
  }
}
