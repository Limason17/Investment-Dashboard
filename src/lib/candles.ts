import type { ChartData } from './types'

/** Eine Kerze: Eröffnung, Hoch, Tief, Schluss über einen Zeitabschnitt. */
export interface Candle {
  /** Beginn des Abschnitts, Millisekunden */
  t: number
  /** letzter Handelstag im Abschnitt, JJJJ-MM-TT */
  d: string
  o: number
  h: number
  l: number
  c: number
}

/** Länge einer Kerze: Minuten innerhalb eines Tages, sonst Tag, Woche, Monat. */
export type CandleUnit = 1 | 5 | 15 | 30 | 60 | 'tag' | 'woche' | 'monat'

export const UNIT_TEXT: Record<string, string> = { 1: '1 Minute', 5: '5 Minuten', 15: '15 Minuten', 30: '30 Minuten', 60: '1 Stunde', tag: '1 Tag', woche: '1 Woche', monat: '1 Monat' }

export interface CandleSet {
  candles: Candle[]
  unit: CandleUnit
  /** Tageskerzen und länger: Achse und Tooltip nach Datum */
  kind: 'intraday' | 'daily'
  /**
   * Ohne Eröffnung/Hoch/Tief vom Kurs-Dienst (z. B. älterer Kurs-Dienst): Kerzen aus den Schlusskursen genähert,
   * Eröffnung = Schluss davor. Die Ansicht sagt das dazu.
   */
  approx: boolean
}

const MINUTES: Record<string, number> = { '1m': 1, '5m': 5, '15m': 15, '60m': 60 }

/** Montag der Woche eines Handelstages, als Schlüssel */
export function weekOf(d: string) {
  const x = new Date(d + 'T12:00:00Z')
  x.setUTCDate(x.getUTCDate() - ((x.getUTCDay() + 6) % 7))
  return x.toISOString().slice(0, 10)
}

/**
 * Kerzen eines Titels aus einem Kursverlauf. Gewählt wird die feinste Länge, bei der höchstens «max» Kerzen
 * entstehen (je nach Platz): innerhalb eines Tages 1, 5, 15, 30 oder 60 Minuten, dann Tag, Woche, Monat.
 */
export function toCandles(chart: ChartData, ticker: string, max: number): CandleSet | null {
  const s = chart.series[ticker]
  const n = s?.length ?? 0
  if (!s || n < 1) return null
  const x = chart.ohlc?.[ticker]
  const approx = !x
  // Rohpunkte mit Eröffnung, Hoch, Tief; Punkte ohne Handel (Lücke) fallen weg
  const pts: { i: number; o: number; h: number; l: number; c: number }[] = []
  for (let i = 0; i < n; i++) {
    const c = s[i]
    if (!Number.isFinite(c) || c <= 0) continue
    if (x && i < x.o.length) {
      const o = x.o[i], h = x.h[i], l = x.l[i]
      if (o == null || h == null || l == null) continue
      // Der letzte Punkt kann den Live-Kurs tragen (siehe withNow): Hoch und Tief schliessen ihn ein.
      pts.push({ i, o, h: Math.max(h, c, o), l: Math.min(l, c, o), c })
    } else if (x) {
      // Angehängter Live-Punkt ohne Kerze: zählt nur mit seinem Kurs
      pts.push({ i, o: c, h: c, l: c, c })
    } else {
      const prev = i > 0 && Number.isFinite(s[i - 1]) ? s[i - 1] : (chart.prev[ticker] ?? c)
      pts.push({ i, o: prev, h: Math.max(prev, c), l: Math.min(prev, c), c })
    }
  }
  if (!pts.length) return null

  // Erster Zeitpunkt je Tag: Minutenkerzen zählen ab dort (Eröffnung bzw. Pre-Market)
  const dayStart = new Map<string, number>()
  for (const p of pts) if (!dayStart.has(chart.d[p.i])) dayStart.set(chart.d[p.i], chart.t[p.i])

  const units: CandleUnit[] = []
  if (chart.kind === 'intraday') {
    const native = MINUTES[chart.interval] ?? (n > 1 ? Math.max(1, Math.round((chart.t[1] - chart.t[0]) / 60_000)) : 1)
    for (const m of [1, 5, 15, 30, 60] as const) if (m >= native) units.push(m)
    units.push('tag', 'woche', 'monat')
  } else if (chart.interval === '1wk') units.push('woche', 'monat')
  else if (chart.interval === '1mo') units.push('monat')
  else units.push('tag', 'woche', 'monat')

  const keyOf = (u: CandleUnit, i: number): string => {
    const d = chart.d[i]
    if (typeof u === 'number') return d + '|' + Math.floor((chart.t[i] - dayStart.get(d)!) / (u * 60_000))
    return u === 'tag' ? d : u === 'woche' ? weekOf(d) : d.slice(0, 7)
  }
  let unit = units[units.length - 1]
  for (const u of units) {
    let count = 0, last = ''
    for (const p of pts) {
      const k = keyOf(u, p.i)
      if (k !== last) { count++; last = k }
    }
    if (count <= Math.max(2, max)) { unit = u; break }
  }

  const candles: Candle[] = []
  let last = ''
  for (const p of pts) {
    const k = keyOf(unit, p.i)
    const cur = candles[candles.length - 1]
    if (cur && k === last) {
      cur.h = Math.max(cur.h, p.h)
      cur.l = Math.min(cur.l, p.l)
      cur.c = p.c
      cur.d = chart.d[p.i]
    } else {
      candles.push({ t: chart.t[p.i], d: chart.d[p.i], o: p.o, h: p.h, l: p.l, c: p.c })
      last = k
    }
  }
  return { candles, unit, kind: typeof unit === 'number' ? 'intraday' : 'daily', approx }
}

/** Kursverlauf ab Punkt «cut» (z. B. «Max» ab dem ersten Kauf), Kerzendaten eingeschlossen. */
export function sliceChart(chart: ChartData, ticker: string, cut: number): ChartData {
  const values = chart.series[ticker]
  const x = chart.ohlc?.[ticker]
  return {
    ...chart,
    t: chart.t.slice(cut),
    d: chart.d.slice(cut),
    series: { ...chart.series, [ticker]: values.slice(cut) },
    prev: { ...chart.prev, [ticker]: values[cut - 1] ?? chart.prev[ticker] },
    ...(x ? { ohlc: { ...chart.ohlc, [ticker]: { o: x.o.slice(cut), h: x.h.slice(cut), l: x.l.slice(cut) } } } : {}),
  }
}
