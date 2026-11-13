const nf2 = new Intl.NumberFormat('de-CH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const nf0 = new Intl.NumberFormat('de-CH', { maximumFractionDigits: 0 })
const nf4 = new Intl.NumberFormat('de-CH', { maximumFractionDigits: 4 })

const MINUS = '−'
const bad = (v: number | null | undefined): v is null | undefined => v == null || !Number.isFinite(v)

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
export const usd = (v: number | null | undefined) => (bad(v) ? '–' : nf2.format(v * fxRate).replace('-', MINUS))
/** Betrag in USD, ohne Umrechnung (Eingaben) */
export const usdRaw = (v: number | null | undefined) => (bad(v) ? '–' : nf2.format(v).replace('-', MINUS))
/** Ganzzahliger Betrag in der Anzeigewährung */
export const cur0 = (v: number | null | undefined) => (bad(v) ? '–' : nf0.format(v * fxRate).replace('-', MINUS))
export const int = (v: number | null | undefined) => (bad(v) ? '–' : nf0.format(v).replace('-', MINUS))
export const qty = (v: number | null | undefined) => (bad(v) ? '–' : nf4.format(v))

/** Betrag mit Vorzeichen, in der Anzeigewährung. */
export const sUsd = (v: number | null | undefined) =>
  bad(v) ? '–' : (v > 0 ? '+' : v < 0 ? MINUS : '') + nf2.format(Math.abs(v * fxRate))
/** Betrag mit Vorzeichen in USD, ohne Umrechnung (Eingaben) */
export const sUsdRaw = (v: number | null | undefined) =>
  bad(v) ? '–' : (v > 0 ? '+' : v < 0 ? MINUS : '') + nf2.format(Math.abs(v))

/** Anteil (0.123) als Prozent mit Vorzeichen. */
export const pct = (v: number | null | undefined, d = 1) =>
  bad(v) ? '–' : (v > 0 ? '+' : v < 0 ? MINUS : '') + Math.abs(v * 100).toFixed(d) + ' %'

/** Anteil (0.123) als Prozent ohne Vorzeichen. */
export const pctPlain = (v: number | null | undefined, d = 1) => (bad(v) ? '–' : (v * 100).toFixed(d).replace('-', MINUS) + ' %')

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
export const addMonths = (d: string, n: number) => {
  const x = new Date(d + 'T12:00:00Z')
  x.setUTCMonth(x.getUTCMonth() + n)
  return x.toISOString().slice(0, 10)
}

/** Eingabe wie 1'234.50 oder 1234,5 in eine Zahl wandeln. */
export const parseNum = (v: string | number | null | undefined) => {
  if (v == null || v === '') return null
  const n = parseFloat(String(v).replace(/['’\s]/g, '').replace(',', '.'))
  return Number.isFinite(n) ? n : null
}
export const r2 = (v: number) => Math.round(v * 100) / 100
export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7)

/** Achsenbeschriftung: unter 10 000 ausgeschrieben, darüber kompakt, ein Stil je Achse. */
export const axisFormatter = (ticks: number[]) => {
  const max = Math.max(...ticks.map(Math.abs))
  if (max >= 10000) return (v: number) => (v / 1000).toFixed(ticks.some((t) => t % 1000 !== 0) ? 1 : 0) + 'K'
  const dec = ticks.some((t) => Math.abs(t % 1) > 1e-9) ? (max < 10 ? 2 : 1) : 0
  return (v: number) => (dec ? v.toFixed(dec) : nf0.format(v))
}
