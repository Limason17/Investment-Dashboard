/**
 * Live-Kurse für gehaltene Titel und die Watchlist.
 *
 *   GET /api/live   { at, session, quotes: { VTI: { price, ref, regular, session, time, source } } }
 *
 * Quelle 1: Yahoo Finance (ohne Schlüssel). Minutenkurse inkl. Pre-Market (04:00–09:30 New York)
 *           und After-Hours (16:00–20:00).
 * Quelle 2: Alpaca, nur wenn ALPACA_KEY_ID und ALPACA_SECRET_KEY in .env.local stehen.
 *           Liefert die Overnight-Sitzung (20:00–04:00, So–Do) als Mittelkurs aus Geld und Brief.
 *
 * «ref» ist der Vergleichskurs der Tagesänderung: der letzte Schlusskurs vor dem laufenden Handelstag.
 * Die Overnight-Sitzung zählt (wie bei Schwab) schon zum nächsten Handelstag.
 * Nach Börsenschluss hält der Aufrufer (onResult) Schlusskurs und Depotwert fest, siehe src/lib/closes.ts.
 * Ohne Node-Abhängigkeiten: läuft im lokalen Server (server/depot-api.ts) und im Cloudflare Worker (worker/).
 */

export type Session = 'pre' | 'regular' | 'post' | 'overnight' | 'closed'

export interface LiveQuote {
  price: number
  ref: number | null
  /** letzter Schlusskurs der regulären Sitzung */
  regular: number
  /** Handelstag (New York) des Schlusskurses «regular» */
  regularDate: string
  /** Vortagesschluss von Yahoo, Vergleich zu «regular» */
  regularPrev: number | null
  session: Session
  /** Zeitpunkt des Kurses, ISO */
  time: string
  source: string
  /** Name des Titels laut Yahoo */
  name?: string
}

export interface LiveResult {
  at: string
  session: Session
  overnight: 'aktiv' | 'kein Schlüssel' | 'fehler' | 'ruhend'
  quotes: Record<string, LiveQuote>
  failures: string[]
  /** Dividendenrate je gehaltenem Titel: Ausschüttungen der letzten 12 Monate je Stück */
  div?: Record<string, DivRate>
}

export interface DivRate {
  annual: number
  freq: string
}

const UA = { 'User-Agent': 'Mozilla/5.0 (depot-dashboard lokal)' }
const nyDate = (ms: number) => new Date(ms).toLocaleDateString('en-CA', { timeZone: 'America/New_York' })
const nyParts = (ms: number) => {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'short', hour: 'numeric', minute: 'numeric', hourCycle: 'h23' })
      .formatToParts(new Date(ms))
      .map((x) => [x.type, x.value]),
  )
  return { wd: p.weekday as string, min: Number(p.hour) * 60 + Number(p.minute) }
}

/** Overnight-Fenster: So–Do 20:00 bis Mo–Fr 04:00 New York (Feiertage nicht berücksichtigt). */
function inOvernight(ms: number) {
  const { wd, min } = nyParts(ms)
  if (min >= 20 * 60) return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu'].includes(wd)
  if (min < 4 * 60) return ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'].includes(wd)
  return false
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- fremde JSON-Antworten, Felder werden einzeln geprüft
async function getJson(url: string, headers: Record<string, string> = UA, ms = 12000): Promise<any> {
  const r = await fetch(url, { headers, signal: AbortSignal.timeout(ms) })
  if (!r.ok) throw new Error('HTTP ' + r.status)
  return r.json()
}

/** Minutenkurse des laufenden (oder letzten) Handelstages; Grundlage des Tages-Charts. */
export interface IntradayDay {
  /** Sekunden */
  t: number[]
  c: number[]
  /** letzter Schlusskurs vor diesem Handelstag */
  ref: number | null
  /** reguläre Sitzung, Sekunden */
  regular: [number, number]
}

interface YahooQuote extends LiveQuote {
  /** Grenzen der Sitzungen des Chart-Tages, Sekunden */
  periods: { pre: [number, number]; regular: [number, number]; post: [number, number] }
  /** Minutenkurse des Chart-Tages ohne Lücken */
  bars: { t: number[]; c: number[] }
}

const DAY_QUERY = 'range=1d&interval=1m&includePrePost=true'

async function yahoo(t: string): Promise<YahooQuote> {
  const j = await getJson(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(t)}?${DAY_QUERY}`)
  return parseChart(j?.chart?.result?.[0])
}

/**
 * Bis zu 20 Titel in einer einzigen Anfrage (gleiche Felder wie der Chart-Endpunkt). Das macht «Aktualisieren»
 * um ein Mehrfaches schneller als eine Anfrage je Titel; was hier fehlt, wird einzeln nachgeholt.
 */
const BATCH = 20
async function yahooBatch(tickers: string[]): Promise<Record<string, YahooQuote>> {
  const j = await getJson(`https://query1.finance.yahoo.com/v7/finance/spark?symbols=${tickers.map(encodeURIComponent).join(',')}&${DAY_QUERY}`, UA, 8000)
  const out: Record<string, YahooQuote> = {}
  for (const x of (j?.spark?.result ?? []) as { symbol?: string; response?: unknown[] }[]) {
    try {
      if (x.symbol) out[x.symbol.toUpperCase()] = parseChart(x.response?.[0])
    } catch {
      /* dieser Titel wird einzeln nachgeholt */
    }
  }
  return out
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- fremde JSON-Antwort, Felder werden einzeln geprüft
function parseChart(r: any): YahooQuote {
  const m = r?.meta
  if (!m || typeof m.regularMarketPrice !== 'number') throw new Error('keine Daten')
  const ts: number[] = r.timestamp ?? []
  const cl: (number | null)[] = r.indicators?.quote?.[0]?.close ?? []
  let i = cl.length - 1
  while (i >= 0 && cl[i] == null) i--
  const ctp = m.currentTradingPeriod
  const periods = {
    pre: [ctp.pre.start, ctp.pre.end] as [number, number],
    regular: [ctp.regular.start, ctp.regular.end] as [number, number],
    post: [ctp.post.start, ctp.post.end] as [number, number],
  }
  const now = Date.now() / 1000
  const session: Session =
    now >= periods.pre[0] && now < periods.pre[1] ? 'pre'
    : now >= periods.regular[0] && now < periods.regular[1] ? 'regular'
    : now >= periods.post[0] && now < periods.post[1] ? 'post'
    : 'closed'
  // Neuester Kurs: letzte Minutenkerze (Pre/After) oder der reguläre Kurs, je nachdem was jünger ist.
  const barT = i >= 0 ? ts[i] : 0
  const regT: number = m.regularMarketTime ?? 0
  const useBar = i >= 0 && barT > regT
  const price = useBar ? (cl[i] as number) : m.regularMarketPrice
  const time = (useBar ? barT : regT) * 1000
  // Schlusskurs-Tag: ist die reguläre Sitzung des Chart-Tages vorbei, ist regularMarketPrice dessen Schluss.
  const regularDone = now >= periods.regular[1]
  const regularDate = nyDate((regularDone ? periods.regular[0] : regT) * 1000)
  const bars = { t: [] as number[], c: [] as number[] }
  for (let k = 0; k < ts.length; k++) {
    const v = cl[k]
    if (typeof v === 'number' && v > 0) {
      bars.t.push(ts[k])
      bars.c.push(round(v))
    }
  }
  return {
    bars,
    price: round(price),
    ref: typeof m.chartPreviousClose === 'number' ? m.chartPreviousClose : null,
    regular: m.regularMarketPrice,
    regularDate,
    regularPrev: typeof m.chartPreviousClose === 'number' && regularDone ? m.chartPreviousClose : null,
    session,
    time: new Date(time).toISOString(),
    source: 'Yahoo Finance',
    ...(typeof (m.longName ?? m.shortName) === 'string' ? { name: String(m.longName ?? m.shortName).slice(0, 80) } : {}),
    periods,
  }
}

async function alpacaOvernight(tickers: string[], key: string, secret: string) {
  const h = { 'APCA-API-KEY-ID': key, 'APCA-API-SECRET-KEY': secret, Accept: 'application/json' }
  const j = await getJson(`https://data.alpaca.markets/v2/stocks/quotes/latest?symbols=${tickers.map(encodeURIComponent).join(',')}&feed=overnight`, h)
  const out: Record<string, { price: number; time: string }> = {}
  for (const [t, q] of Object.entries((j?.quotes ?? {}) as Record<string, { ap?: number; bp?: number; t?: string }>)) {
    const ap = q.ap ?? 0, bp = q.bp ?? 0
    // Nur brauchbare, frische Quotes (beide Seiten, Spanne unter 3 %, jünger als 30 Minuten).
    if (!(ap > 0 && bp > 0) || ap < bp || (ap - bp) / bp > 0.03) continue
    if (!q.t || Date.now() - Date.parse(q.t) > 30 * 60_000) continue
    out[t] = { price: round((ap + bp) / 2), time: q.t }
  }
  return out
}

const round = (x: number) => Math.round(x * 10000) / 10000

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

/** Welche Titel abgefragt werden und was mit dem Ergebnis geschieht. */
export interface QuoteSource {
  tickers: () => { held: string[]; watch: string[] }
  onResult?: (res: LiveResult) => void
}

export function liveQuotes(src: QuoteSource, env: Record<string, string | undefined>) {
  const key = env.ALPACA_KEY_ID?.trim(), secret = env.ALPACA_SECRET_KEY?.trim()
  let cache: { at: number; res: LiveResult } | null = null
  let running: Promise<LiveResult> | null = null
  /** Minutenkurse je Titel aus der letzten Abfrage (für den Tages-Chart, siehe market-charts.ts) */
  const intraday: Record<string, IntradayDay> = {}

  /**
   * Dividendenraten der gehaltenen Titel: Summe der Ausschüttungen der letzten 12 Monate je Stück (Yahoo).
   * Läuft im Hintergrund, höchstens zweimal am Tag oder wenn ein neuer Titel dazukommt; bremst die Kurse nicht.
   */
  const div: Record<string, DivRate> = {}
  let divState = { key: '', at: 0, busy: false }
  async function refreshDividends(held: string[]) {
    const key = held.join(',')
    if (divState.busy || (divState.key === key && Date.now() - divState.at < 12 * 3600_000)) return
    divState.busy = true
    try {
      const since = Date.now() / 1000 - 366 * 86400
      const rs = await pool(held, 6, async (t) => {
        const j = await getJson(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(t)}?range=2y&interval=1mo&events=div`)
        if (!j?.chart?.result?.[0]) throw new Error('keine Daten')
        const all = Object.values((j.chart.result[0].events?.dividends ?? {}) as Record<string, { amount?: number; date?: number }>)
        let list = all.filter((e) => typeof e.amount === 'number' && e.amount > 0 && (e.date ?? 0) >= since).sort((a, b) => (a.date ?? 0) - (b.date ?? 0))
        // Verschiebt sich ein Zahltag um wenige Tage, fallen fünf statt vier (13 statt 12) Zahlungen ins Fenster.
        if (list.length === 5 || list.length === 13) list = list.slice(1)
        return list.map((e) => e.amount as number)
      })
      let ok = 0
      rs.forEach((r, i) => {
        if (r.status !== 'fulfilled') return
        ok++
        const n = r.value.length
        if (!n) delete div[held[i]]
        else div[held[i]] = { annual: round(r.value.reduce((s, x) => s + x, 0)), freq: n >= 11 ? 'monatlich' : n >= 3 ? 'quartalsweise' : n === 2 ? 'halbjährlich' : 'jährlich' }
      })
      if (ok) divState = { key, at: Date.now(), busy: true }
    } catch {
      /* Dividendenraten sind eine Zugabe */
    } finally {
      divState.busy = false
    }
  }

  async function refresh(): Promise<LiveResult> {
    const { held, watch } = src.tickers()
    // Dividendenraten parallel zu den Kursen; fehlen sie noch (z. B. neuer Kurs-Dienst), wird darauf gewartet.
    const divJob = refreshDividends([...held].sort())
    const tickers = [...new Set([...held, ...watch])].sort()
    const quotes: Record<string, LiveQuote> = {}
    const failures: string[] = []
    const take = (t: string, v: YahooQuote) => {
      const { periods, bars, ...q } = v
      quotes[t] = q
      intraday[t] = { ...bars, ref: q.ref, regular: periods.regular }
    }
    // Zuerst gebündelt, dann einzeln, was fehlt (oder alles, falls die gebündelte Abfrage ausfällt).
    const groups = Array.from({ length: Math.ceil(tickers.length / BATCH) }, (_, i) => tickers.slice(i * BATCH, (i + 1) * BATCH))
    for (const r of await Promise.allSettled(groups.map(yahooBatch))) {
      if (r.status !== 'fulfilled') continue
      for (const t of tickers) if (!quotes[t] && r.value[t.toUpperCase()]) take(t, r.value[t.toUpperCase()])
    }
    const rest = tickers.filter((t) => !quotes[t])
    const ys = await pool(rest, 8, yahoo)
    ys.forEach((r, i) => {
      if (r.status === 'fulfilled') take(rest[i], r.value)
      else failures.push(`${rest[i]} (${r.reason instanceof Error ? r.reason.message : r.reason})`)
    })
    let session: Session = Object.values(quotes)[0]?.session ?? 'closed'
    let overnight: LiveResult['overnight'] = 'ruhend'
    if (inOvernight(Date.now())) {
      if (!key || !secret) overnight = 'kein Schlüssel'
      else {
        try {
          const on = await alpacaOvernight(Object.keys(quotes), key, secret)
          for (const [t, o] of Object.entries(on)) {
            const q = quotes[t]
            // Overnight gehört zum nächsten Handelstag: Vergleich mit dem letzten Schlusskurs.
            quotes[t] = { ...q, price: o.price, ref: q.regular, time: o.time, session: 'overnight', source: 'Alpaca Overnight (Mittelkurs)' }
          }
          overnight = 'aktiv'
          if (Object.keys(on).length) session = 'overnight'
        } catch {
          overnight = 'fehler'
        }
      }
    }
    if (held.length && !Object.keys(div).length) await divJob.catch(() => {})
    const res: LiveResult = { at: new Date().toISOString(), session, overnight, quotes, failures }
    try {
      src.onResult?.(res)
    } catch {
      /* Festhalten ist optional */
    }
    return res
  }

  /** Höchstens alle 15 Sekunden bei den Quellen nachfragen, egal wie viele Fenster offen sind. «force» (Aktualisieren-Knopf) wartet nur 3 Sekunden. */
  async function get(force = false): Promise<LiveResult> {
    if (!(cache && Date.now() - cache.at < (force ? 3_000 : 15_000))) {
      running ??= refresh().finally(() => (running = null))
      const res = await running
      cache = { at: Date.now(), res }
    }
    return { ...cache.res, div: { ...div } }
  }
  return Object.assign(get, { intraday: () => intraday })
}

