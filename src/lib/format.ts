const nf2 = new Intl.NumberFormat('de-CH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const nf0 = new Intl.NumberFormat('de-CH', { maximumFractionDigits: 0 })
const nf4 = new Intl.NumberFormat('de-CH', { maximumFractionDigits: 4 })
const nf8 = new Intl.NumberFormat('de-CH', { maximumFractionDigits: 8 })
/** Kurse unter 1 (z. B. Penny-Aktien): bis 4 Stellen, damit 0.0042 nicht zu «0.00» wird */
const nfSmall = new Intl.NumberFormat('de-CH', { minimumFractionDigits: 2, maximumFractionDigits: 4 })
const price2 = (x: number) => (x !== 0 && Math.abs(x) < 1 ? nfSmall.format(rd(x, 4)) : nf2.format(rd(x, 2)))

const MINUS = '−'
const bad = (v: number | null | undefined): v is null | undefined => v == null || !Number.isFinite(v)
/** Auf d Stellen gerundet; was zu 0 rundet, ist 0 (nie «−0.00»). */
const rd = (v: number, d: number) => {
  const r = Number(v.toFixed(d))
  return r === 0 ? 0 : r
}

/*
 * Anzeigewährung: Alle Daten bleiben in USD gespeichert. Beim Anzeigen rechnet usd()/sUsd() zum aktuellen Kurs um
 * (Plan → Ziele → Anzeigewährung). Eingabefelder und ihre Vorschau bleiben in USD (usdRaw/sUsdRaw).
 */
let fxRate = 1
let fxCode = 'USD'
export function setDisplayCurrency(code: string, rate: number) {
  fxCode = code
  fxRate = rate > 0 ? rate : 1
}
/** Kürzel der Anzeigewährung, z. B. USD oder CHF */
export const cur = () => fxCode
/** Umrechnungsfaktor von USD in die Anzeigewährung */
export const curRate = () => fxRate

/** Betrag mit zwei Nachkommastellen in der Anzeigewährung, Schweizer Tausendertrennung. */
export const usd = (v: number | null | undefined) => (bad(v) ? '–' : nf2.format(rd(v * fxRate, 2)).replace('-', MINUS))
/** Kurs je Stück in der Anzeigewährung: wie usd(), unter 1 aber bis zu vier Stellen (0.0042) */
export const px = (v: number | null | undefined) => (bad(v) ? '–' : price2(v * fxRate).replace('-', MINUS))
/** Kurs je Stück in USD ohne Umrechnung, unter 1 bis zu vier Stellen */
export const pxRaw = (v: number | null | undefined) => (bad(v) ? '–' : price2(v).replace('-', MINUS))
/** Kurs je Stück mit Währung, z. B. «0.0042 USD» */
export const pxMoney = (v: number | null | undefined) => (bad(v) ? '–' : px(v) + ' ' + fxCode)
/** Betrag in USD, ohne Umrechnung (Eingaben) */
export const usdRaw = (v: number | null | undefined) => (bad(v) ? '–' : nf2.format(rd(v, 2)).replace('-', MINUS))
/** Betrag mit Währung, z. B. «1'250.50 USD» (für Text und Beschriftungen) */
export const money = (v: number | null | undefined) => (bad(v) ? '–' : usd(v) + ' ' + fxCode)
/** Ganzzahliger Betrag in der Anzeigewährung */
export const cur0 = (v: number | null | undefined) => (bad(v) ? '–' : nf0.format(rd(v * fxRate, 0)).replace('-', MINUS))
export const int = (v: number | null | undefined) => (bad(v) ? '–' : nf0.format(rd(v, 0)).replace('-', MINUS))
export const qty = (v: number | null | undefined) => (bad(v) ? '–' : v !== 0 && Math.abs(v) < 0.01 ? nf8.format(v) : nf4.format(v))

/** Betrag mit Vorzeichen, in der Anzeigewährung. */
export const sUsd = (v: number | null | undefined) => (bad(v) ? '–' : signed(rd(v * fxRate, 2), nf2))
/** Betrag mit Vorzeichen in USD, ohne Umrechnung (Eingaben) */
export const sUsdRaw = (v: number | null | undefined) => (bad(v) ? '–' : signed(rd(v, 2), nf2))
function signed(r: number, nf: Intl.NumberFormat) {
  return (r > 0 ? '+' : r < 0 ? MINUS : '') + nf.format(Math.abs(r))
}

/** Anteil (0.123) als Prozent mit Vorzeichen. */
export const pct = (v: number | null | undefined, d = 1) => {
  if (bad(v)) return '–'
  const r = rd(v * 100, d)
  return (r > 0 ? '+' : r < 0 ? MINUS : '') + Math.abs(r).toFixed(d) + ' %'
}

/** Anteil (0.123) als Prozent ohne Vorzeichen. */
export const pctPlain = (v: number | null | undefined, d = 1) => (bad(v) ? '–' : rd(v * 100, d).toFixed(d).replace('-', MINUS) + ' %')

export const sign = (v: number | null | undefined): 'up' | 'down' | 'flat' => (bad(v) || v === 0 ? 'flat' : v > 0 ? 'up' : 'down')

const pad = (n: number) => String(n).padStart(2, '0')
export const today = () => {
  const d = new Date()
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}
export const dfmt = (d: string | null | undefined) => {
  if (!d) return '–'
  const [y, m, dd] = d.slice(0, 10).split('-')
  return `${dd}.${m}.${y}`
}
export const dshort = (d: string | null | undefined) => {
  if (!d) return '–'
  const [, m, dd] = d.slice(0, 10).split('-')
  return `${dd}.${m}.`
}
export const MONTHS = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez']
const WEEKDAYS = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa']
export const weekday = (d: string) => WEEKDAYS[new Date(d + 'T12:00:00Z').getUTCDay()]
export const dlong = (d: string) => `${weekday(d)}, ${dfmt(d)}`
/** Uhrzeit (Ortszeit) eines Zeitpunkts in Millisekunden. */
export const hhmm = (ms: number) => {
  const x = new Date(ms)
  return `${pad(x.getHours())}:${pad(x.getMinutes())}`
}
export const daysBetween = (a: string, b: string) =>
  Math.round((new Date(b + 'T12:00:00Z').getTime() - new Date(a + 'T12:00:00Z').getTime()) / 864e5)
/** Monate addieren; der Tag wird aufs Monatsende begrenzt (31. Januar + 1 Monat = 28./29. Februar, nicht 3. März). */
export const addMonths = (d: string, n: number) => {
  const x = new Date(d + 'T12:00:00Z')
  const day = x.getUTCDate()
  x.setUTCDate(1)
  x.setUTCMonth(x.getUTCMonth() + n)
  const last = new Date(Date.UTC(x.getUTCFullYear(), x.getUTCMonth() + 1, 0)).getUTCDate()
  x.setUTCDate(Math.min(day, last))
  return x.toISOString().slice(0, 10)
}

/**
 * Eingabe in eine Zahl wandeln: 1'234.50, 1234,5, 1,234.50 (US) und 1.234,50 (DE); das spätere Zeichen
 * von Punkt und Komma ist das Dezimalzeichen. Alles andere (z. B. «1.2.3» oder «12abc») ergibt null.
 */
export const parseNum = (v: string | number | null | undefined) => {
  if (v == null || v === '') return null
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  let s = v.replace(/['’\s]/g, '').replace(/^[−–]/, '-')
  const dot = s.lastIndexOf('.'), comma = s.lastIndexOf(',')
  if (dot >= 0 && comma >= 0) s = comma > dot ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '')
  else if (comma >= 0) s = s.replace(',', '.')
  return /^[-+]?(\d+\.?\d*|\.\d+)$/.test(s) ? Number(s) : null
}
export const r2 = (v: number) => Math.round(v * 100) / 100
export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7)

/** Achsenbeschriftung: unter 10 000 ausgeschrieben, darüber kompakt, ein Stil je Achse. */
export const axisFormatter = (ticks: number[]) => {
  const max = Math.max(...ticks.map(Math.abs))
  // Abstand der Striche bestimmt die Nachkommastellen: 0.0042 / 0.0044 bleiben unterscheidbar
  const step = ticks.length > 1 ? Math.min(...ticks.slice(1).map((t, i) => Math.abs(t - ticks[i])).filter((x) => x > 0)) : max || 1
  const decFor = (s: number) => Math.max(0, Math.min(6, Math.ceil(-Math.log10(s) - 1e-9)))
  if (max >= 1e9) return (v: number) => (v / 1e9).toFixed(decFor(step / 1e9)) + 'B'
  if (max >= 1e6) return (v: number) => (v / 1e6).toFixed(decFor(step / 1e6)) + 'M'
  if (max >= 10000) return (v: number) => (v / 1000).toFixed(ticks.some((t) => t % 1000 !== 0) ? 1 : 0) + 'K'
  const dec = ticks.some((t) => Math.abs(t % 1) > 1e-9) ? Math.max(max < 10 ? 2 : 1, decFor(step)) : 0
  return (v: number) => (dec ? v.toFixed(dec) : nf0.format(v))
}
