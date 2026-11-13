/** Kennung einer Kategorie; jedes Depot legt seine Kategorien selbst fest ('cash' ist fest). */
export type BucketId = string
export type HoldingBucket = string
export interface Category { id: string; name: string }

export interface Position {
  ticker: string
  name: string
  shares: number
  bucket: HoldingBucket
  cost: number | null
  status?: string
  note?: string
  costDemo?: boolean
}

export interface Quote {
  close: number
  prev: number | null
  date: string
  source?: string
  /** Live-Kurs: Sitzung und Zeitpunkt */
  session?: LiveSession
  time?: string
  divAnnual?: number
  divFreq?: string
  /** Monate der Ausschüttungen (1–12) und letzter Betrag je Stück, für die Schätzung */
  divMonths?: number[]
  divLast?: number
  demo?: boolean
}

export interface WatchItem {
  ticker: string
  name: string
  price: number | null
  priceDate?: string
  limit: number | null
  limitCautious: number | null
  condition?: string
  conditionMet: boolean | null
  pot?: string
  limitNote?: string | null
  note?: string
}

export interface Pot {
  label: string
  budget: number
  used: number
  note?: string
  order?: number
}

export interface DepotEvent {
  date: string
  title: string
  detail?: string
  tentative?: boolean
  done?: boolean
  kind?: 'zahlen' | 'tranche' | 'stichtag' | 'pruefen' | 'termin'
  ticker?: string
  demo?: boolean
}

export interface LogEntry {
  date: string
  title: string
  text?: string
  by?: string
}

export type TxType = 'kauf' | 'verkauf' | 'einzahlung' | 'auszahlung' | 'gebuehr' | 'korrektur'

export interface Tx {
  type: TxType
  date: string
  ticker?: string
  shares?: number
  price?: number
  fees?: number
  cashDelta: number
  pot?: string | null
  note?: string
  by?: string
  realized?: number | null
  costMethod?: string
  realizedDemo?: boolean
  /** Erster Cash-Stand (vorher war Cash nicht erfasst): Startwert, keine Einzahlung */
  cashStart?: boolean
  demo?: boolean
  createdAt?: string
}

export interface Dividend {
  ticker: string
  exDate: string | null
  payDate: string
  perShare: number | null
  shares: number | null
  gross: number
  tax: number
  net: number
  status: 'erwartet' | 'erhalten'
  source?: string
  note?: string
  demo?: boolean
  payDateEstimated?: boolean
  /** Geschätzt aus den bisherigen Ausschüttungen, nicht erfasst (wird nicht gespeichert) */
  estimate?: boolean
}

export interface Snapshot {
  date: string
  total: number
  securities?: number
  cash?: number
  invested?: number
  note?: string
  demo?: boolean
}

export interface Settings {
  cash: number
  cashExcluded?: boolean
  cashEstimate?: boolean
  cashNote?: string
  cashDate?: string
  targets?: Partial<Record<BucketId, number>>
  /** Bausteine, deren Zielanteil eine harte Obergrenze ist (ohne Angabe: ETF-Kern) */
  caps?: BucketId[]
  /** Eigene Namen der alten, festen Kategorien (ältere Depots) */
  bucketNames?: Partial<Record<BucketId, string>>
  /** Eigene Kategorien in ihrer Reihenfolge; ohne Angabe die alten festen Kategorien */
  categories?: Category[]
  /** Stand der akzeptierten Nutzungsbedingungen (bei der Registrierung) */
  termsAccepted?: string
  /** Einführung gesehen */
  tourDone?: boolean
  /** Zweite Anzeigewährung neben USD */
  fx?: 'CHF' | 'EUR'
  /** Name des Brokers, nur zur Anzeige */
  broker?: string
  withholding?: number
  baseCapital?: number
  priceSource?: string
  refresh?: { at?: string; by?: string }
  openItems?: { title: string; detail?: string }[]
  rules?: { tag?: string; title: string; detail?: string }[]
  demo?: boolean
  demoNote?: string
  usdchf?: number
  usdchfDemo?: boolean
}

export interface Market {
  quotes?: Record<string, Quote>
  usdchf?: number
  refreshedAt?: string
  by?: string
  status?: string
  failures?: string[]
  tickersOk?: number
  tickersTotal?: number
}

export interface DB {
  positions: Record<string, Position>
  prices: Record<string, Quote>
  watchlist: Record<string, WatchItem>
  pots: Record<string, Pot>
  events: Record<string, DepotEvent>
  log: Record<string, LogEntry>
  transactions: Record<string, Tx>
  dividends: Record<string, Dividend>
  snapshots: Record<string, Snapshot>
  meta: { settings?: Settings }
  market: { latest?: Market }
}

export interface History {
  dates: string[]
  series: Record<string, number[]>
}

/** Zeiträume der Charts: Tag, Woche, Monat, 3 Monate, Jahr, 5 Jahre, seit Beginn */
export type RangeId = '1T' | '1W' | '1M' | '3M' | '1J' | '5J' | 'MAX'

/** Antwort von /api/chart: alle Titel auf demselben Zeitraster, Lücken gefüllt. */
export interface ChartData {
  range: RangeId
  kind: 'intraday' | 'daily'
  interval: string
  at: string
  /** Zeitpunkt je Punkt, Millisekunden */
  t: number[]
  /** Handelstag je Punkt (New York), JJJJ-MM-TT */
  d: string[]
  series: Record<string, number[]>
  /** Schlusskurs vor dem ersten Punkt */
  prev: Record<string, number | null>
  failures: string[]
  /** reguläre Sitzung des Tages (nur 1T) */
  session?: { open: number; close: number }
}

export type WithId<T> = T & { id: string }

export type ViewId = 'uebersicht' | 'positionen' | 'limits' | 'dividenden' | 'plan' | 'journal'

export type LiveSession = 'pre' | 'regular' | 'post' | 'overnight' | 'closed'
export interface LiveQuote {
  name?: string
  price: number
  ref: number | null
  regular: number
  regularDate: string
  regularPrev: number | null
  session: LiveSession
  time: string
  source: string
}
export interface LiveResult {
  at: string
  session: LiveSession
  overnight: 'aktiv' | 'kein Schlüssel' | 'fehler' | 'ruhend'
  quotes: Record<string, LiveQuote>
  failures: string[]
  /** Dividendenrate je gehaltenem Titel: Ausschüttungen der letzten 12 Monate je Stück */
  div?: Record<string, { annual: number; freq: string; months?: number[]; last?: number }>
}
