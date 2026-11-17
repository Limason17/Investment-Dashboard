/**
 * Massen-Import: liest eingefügte Tabellen (aus Excel, Numbers, Google Sheets oder CSV)
 * und den Transaktions-Export von Schwab. Reine Funktionen ohne Speichern; das Blatt
 * ImportForm zeigt die Vorschau und schreibt erst nach der Bestätigung.
 */
import { HOLDING_BUCKETS } from './buckets'
import { normTicker } from './ticker'
import type { HoldingBucket } from './types'

export type ImportKind = 'bestand' | 'trades' | 'dividenden'

export interface Col {
  key: string
  label: string
  required?: boolean
  example: string
  hint: string
  aliases: string[]
}

/** Spalten je Art, in der Reihenfolge der Vorlage. Ohne Kopfzeile gilt diese Reihenfolge. */
export const COLUMNS: Record<ImportKind, Col[]> = {
  bestand: [
    { key: 'ticker', label: 'Ticker', required: true, example: 'VTI', hint: 'Kürzel wie beim Broker, z. B. VTI', aliases: ['ticker', 'symbol', 'titel', 'kuerzel'] },
    { key: 'shares', label: 'Stück', required: true, example: '3', hint: 'Bruchteile erlaubt', aliases: ['stueck', 'anzahl', 'menge', 'shares', 'quantity', 'qty', 'qtyquantity'] },
    { key: 'cost', label: 'Einstand', example: '1077.00', hint: 'Einstand gesamt in USD, nicht je Stück; leer = unbekannt', aliases: ['einstand', 'kosten', 'cost', 'costbasis', 'einstandgesamt'] },
    { key: 'name', label: 'Name', example: 'Vanguard Total Stock Market ETF', hint: 'leer = Ticker', aliases: ['name', 'bezeichnung', 'description', 'beschreibung'] },
    { key: 'bucket', label: 'Kategorie', example: 'etf', hint: 'Name einer deiner Kategorien; leer = Standard', aliases: ['baustein', 'bucket', 'kategorie'] },
    { key: 'note', label: 'Notiz', example: '', hint: 'optional', aliases: ['notiz', 'note', 'bemerkung'] },
  ],
  trades: [
    { key: 'date', label: 'Datum', required: true, example: '2026-06-23', hint: '2026-06-23, 23.06.2026 oder 06/23/2026', aliases: ['datum', 'date', 'handelstag'] },
    { key: 'type', label: 'Art', required: true, example: 'Kauf', hint: 'Kauf oder Verkauf (auch Buy, Sell)', aliases: ['art', 'typ', 'type', 'action', 'aktion'] },
    { key: 'ticker', label: 'Ticker', required: true, example: 'VTI', hint: 'Kürzel wie beim Broker, z. B. VTI', aliases: ['ticker', 'symbol', 'titel', 'kuerzel'] },
    { key: 'shares', label: 'Stück', required: true, example: '1', hint: 'Bruchteile erlaubt', aliases: ['stueck', 'anzahl', 'menge', 'shares', 'quantity', 'qty'] },
    { key: 'price', label: 'Preis', required: true, example: '359.00', hint: 'Preis je Stück in USD', aliases: ['preis', 'kurs', 'price', 'preisjestueck'] },
    { key: 'fees', label: 'Gebühren', example: '0', hint: 'in USD; leer = 0', aliases: ['gebuehren', 'gebuehr', 'fees', 'feescomm', 'kommission'] },
    { key: 'bucket', label: 'Kategorie', example: 'etf', hint: 'nur für neue Titel; leer = Standard', aliases: ['baustein', 'bucket', 'kategorie'] },
    { key: 'note', label: 'Notiz', example: '', hint: 'optional', aliases: ['notiz', 'note', 'bemerkung'] },
  ],
  dividenden: [
    { key: 'payDate', label: 'Zahltag', required: true, example: '2026-06-23', hint: 'Tag der Gutschrift', aliases: ['zahltag', 'datum', 'date', 'paydate', 'zahlung'] },
    { key: 'ticker', label: 'Ticker', required: true, example: 'VXUS', hint: 'Kürzel wie beim Broker, z. B. VTI', aliases: ['ticker', 'symbol', 'titel', 'kuerzel'] },
    { key: 'gross', label: 'Brutto', required: true, example: '1.93', hint: 'Betrag gesamt vor Steuer, USD', aliases: ['brutto', 'gross', 'betrag', 'amount'] },
    { key: 'tax', label: 'Quellensteuer', example: '0.29', hint: 'USD; leer = Standardsatz', aliases: ['quellensteuer', 'steuer', 'tax', 'withholding'] },
    { key: 'exDate', label: 'Ex-Tag', example: '', hint: 'optional', aliases: ['extag', 'exdate', 'ex'] },
    { key: 'note', label: 'Notiz', example: '', hint: 'optional', aliases: ['notiz', 'note', 'bemerkung'] },
  ],
}

export interface PosRow { line: number; ticker: string; shares: number; cost: number | null; name: string; bucket?: HoldingBucket; note: string }
/** time/seq: Uhrzeit und Reihenfolge im Export, damit Käufe und Verkäufe am selben Tag in der richtigen Folge gelten. */
export interface TradeRow { line: number; date: string; type: 'kauf' | 'verkauf'; ticker: string; shares: number; price: number; fees: number; bucket?: HoldingBucket; note: string; time?: string; seq?: number }
/** name: Titelname aus dem Export, wenn der Ticker fehlt (Schwab-Kontoauszug); der Ticker wird beim Planen über den Namen gesucht. */
export interface DivRow { line: number; payDate: string; exDate: string | null; ticker: string; gross: number; tax: number | null; note: string; name?: string }
/** Ein- oder Auszahlung aus dem Schwab-Export (Betrag positiv = Einzahlung). */
export interface CashRow { line: number; date: string; amount: number; note: string }
/** Aktiensplit aus dem Schwab-Export: zusätzliche Stück ohne Geldfluss (bei Zusammenlegung negativ). */
export interface SplitRow { line: number; date: string; ticker: string; shares: number }
export interface Issue { line: number; msg: string }

export interface ParseResult {
  format: 'vorlage' | 'schwab'
  positions: PosRow[]
  trades: TradeRow[]
  dividends: DivRow[]
  splits?: SplitRow[]
  cash?: CashRow[]
  errors: Issue[]
  skipped: Issue[]
}

/** Zwei Beispiele je Art, in der Reihenfolge der Spalten. In Vorlagen stehen sie als Kommentar (#) und werden nie importiert. */
export const EXAMPLES: Record<ImportKind, string[][]> = {
  trades: [
    ['2025-03-14', 'Kauf', 'VTI', '3', '285.40', '0', 'etf', 'Erster Kauf'],
    ['2025-09-02', 'Kauf', 'MSFT', '2', '410.10', '1.00', 'aktien', ''],
  ],
  dividenden: [
    ['2025-06-26', 'VTI', '2.85', '0.43', '2025-06-23', ''],
    ['2025-09-11', 'MSFT', '1.66', '0.25', '', 'Quartalsdividende'],
  ],
  bestand: [
    ['VTI', '3', '856.20', 'Vanguard Total Stock Market ETF', 'etf', ''],
    ['MSFT', '2', '821.20', 'Microsoft', 'aktien', ''],
  ],
}

/** Heute als JJJJ-MM-TT (Ortszeit); Buchungen danach sind Tippfehler. */
const todayISO = () => {
  const n = new Date()
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`
}

const TITLE: Record<ImportKind, string> = {
  trades: 'Käufe und Verkäufe: eine Zeile je Kauf oder Verkauf. Für bestehende Positionen trägst du jeden Kauf mit Datum und Preis ein.',
  dividenden: 'Dividenden: eine Zeile je erhaltene Zahlung.',
  bestand: 'Nur Bestand: eine Zeile je Titel, ohne Kaufdatum. Ohne Datum zeigt das Dashboard keinen Verlauf; besser die Vorlage Käufe nutzen.',
}

/** Kommentarzeilen: Erklärung, Spalten und zwei Beispiele. */
function commentLines(kind: ImportKind, sep: string) {
  const cols = COLUMNS[kind]
  return [
    `# ${TITLE[kind]}`,
    '# Zeilen mit # am Anfang werden nicht importiert. Die zwei Beispiele unten zeigen das Format.',
    ...(kind !== 'bestand' ? ['# Das Datum braucht es für Wertverlauf, Rendite und Charts.'] : []),
    `# Pflicht: ${cols.filter((c) => c.required).map((c) => c.label).join(', ')}. Freiwillig: ${cols.filter((c) => !c.required).map((c) => c.label).join(', ')}.`,
    ...cols.map((c) => `# ${c.label}: ${c.hint}`),
    ...EXAMPLES[kind].map((r) => '# Beispiel: ' + r.join(sep)),
  ]
}

/** Vorlage zum Kopieren: Erklärung, Kopfzeile, Beispiele als Kommentar; mit Tabulator getrennt (fügt sich in Excel in Spalten). */
export const template = (kind: ImportKind) => [...commentLines(kind, '\t'), COLUMNS[kind].map((c) => c.label).join('\t')].join('\n') + '\n'

/** Vorlage als Datei: Semikolon (öffnet sich in Excel direkt in Spalten), UTF-8 mit BOM für Umlaute. */
export const templateFile = (kind: ImportKind) => '﻿' + [...commentLines(kind, ';'), COLUMNS[kind].map((c) => c.label).join(';')].join('\r\n') + '\r\n'

export const TEMPLATE_NAME: Record<ImportKind, string> = { trades: 'vorlage-kaeufe-verkaeufe.csv', dividenden: 'vorlage-dividenden.csv', bestand: 'vorlage-bestand.csv' }

/** Art einer ausgefüllten Vorlage an der Kopfzeile erkennen. */
export function detectKind(text: string): ImportKind | null {
  const rows = splitTable(text.replace(/^﻿/, '')).filter((r) => r.length && !isComment(r)).slice(0, 8)
  for (const r of rows) {
    const n = new Set(r.map(norm))
    if (n.has('action') && n.has('symbol')) return 'trades' // Schwab-Export
    if (n.has('brutto') || n.has('zahltag') || n.has('gross')) return 'dividenden'
    if ((n.has('art') || n.has('type')) && (n.has('preis') || n.has('price'))) return 'trades'
    if ((n.has('stueck') || n.has('shares') || n.has('quantity')) && !n.has('datum') && !n.has('date')) return 'bestand'
  }
  return null
}

const isComment = (r: string[]) => (r.find((c) => c !== '') ?? '').startsWith('#')

/** Grenzen gegen Tippfehler und übergrosse Dateien. */
export const LIMITS = { bytes: 2_000_000, rows: 5000, note: 300 }

/* ------------------------------------------------------------------ Tabelle lesen */

/** Trennzeichen aus der ersten Zeile: Tabulator (Excel), sonst Semikolon, sonst Komma. */
function delimiter(text: string): string {
  // Kommentarzeilen der Vorlage (#) zählen nicht.
  const first = text.replace(/^﻿/, '').split(/\r?\n/).find((l) => l.trim() && !l.trimStart().startsWith('#')) ?? ''
  if (first.includes('\t')) return '\t'
  const semi = first.split(';').length, comma = first.split(',').length
  return semi >= comma && semi > 1 ? ';' : ','
}

/**
 * Zeilen mit einem anderen Trennzeichen als die Kopfzeile angleichen: z. B. Kopfzeile aus der kopierten
 * Vorlage (Tabulator) und darunter von Hand getippte Zeilen mit Semikolon.
 */
function unifyDelimiters(text: string, d: string) {
  const others = ['\t', ';', ','].filter((x) => x !== d)
  return text
    .split(/\r?\n/)
    .map((l) => {
      if (!l.trim() || l.trimStart().startsWith('#') || l.includes('"') || l.includes(d)) return l
      const o = others.find((x) => l.includes(x) && !(x === ',' && d === ';'))
      return o ? l.split(o).join(d) : l
    })
    .join('\n')
}

/** Zerlegt Text in Zeilen und Zellen; beachtet Anführungszeichen wie in CSV. Leere Zeilen bleiben als [] stehen, damit Zeilennummern stimmen. */
export function splitTable(text: string, d = delimiter(text)): string[][] {
  text = unifyDelimiters(text, d)
  const rows: string[][] = []
  let row: string[] = [], cell = '', q = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (q) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++ }
      else if (ch === '"') q = false
      else cell += ch
    } else if (ch === '"' && cell.trim() === '') { q = true; cell = '' }
    else if (ch === d) { row.push(cell.trim()); cell = '' }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++
      row.push(cell.trim()); cell = ''
      rows.push(row.some((c) => c !== '') ? row : [])
      row = []
    } else cell += ch
  }
  row.push(cell.trim())
  if (row.some((c) => c !== '')) rows.push(row)
  return rows
}

const norm = (s: string) =>
  s.toLowerCase().replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/[^a-z0-9]/g, '')

/** Zahl aus «1'234.50», «1.234,50», «1234,5», «$1,234.56» oder «(12.00)». thousandsComma: Komma ist Tausendertrenner (US-Format). */
export function num(raw: string | undefined, thousandsComma = false): number | null {
  return parseNumber(raw, thousandsComma)
}
function parseNumber(raw: string | undefined, thousandsComma: boolean): number | null {
  if (raw == null) return null
  let s = raw.replace(/[\s'’$€]|USD|CHF/gi, '').replace(/^[−–]/, '-')
  if (!s || s === '-' || s === '--') return null
  let neg = false
  if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1) }
  const lastDot = s.lastIndexOf('.'), lastComma = s.lastIndexOf(',')
  if (lastDot >= 0 && lastComma >= 0) s = lastComma > lastDot ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '')
  else if (lastComma >= 0) s = thousandsComma ? s.replace(/,/g, '') : s.replace(',', '.')
  const n = Number(s)
  if (!Number.isFinite(n)) return null
  return neg ? -n : n
}

/** Datum als JJJJ-MM-TT aus «2026-06-23», «23.06.2026», «23.6.26» oder «06/23/2026» (US, auch «… as of …»). */
/** Frühestes Buchungsdatum: schützt vor Tippfehlern im Jahr (z. B. 1026 statt 2026). */
export const MIN_DATE = '1970-01-01'

export function date(raw: string | undefined): string | null {
  if (!raw) return null
  const s = raw.trim().split(/\s+as of\s+/i)[0]
  const pad = (n: string) => n.padStart(2, '0')
  const year = (y: string) => (y.length === 2 ? '20' + y : y)
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/)
  let out: string | null = null
  if (m) out = `${m[1]}-${pad(m[2])}-${pad(m[3])}`
  else if ((m = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{2}|\d{4})$/))) out = `${year(m[3])}-${pad(m[2])}-${pad(m[1])}`
  // Schrägstrich: US-Format Monat/Tag; kann der erste Teil kein Monat sein (23/06/2026), dann Tag/Monat.
  else if ((m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/))) out = +m[1] > 12 ? `${year(m[3])}-${pad(m[2])}-${pad(m[1])}` : `${year(m[3])}-${pad(m[1])}-${pad(m[2])}`
  if (!out) return null
  const d = new Date(out + 'T12:00:00Z')
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== out ? null : out
}

const ticker = (raw: string | undefined) => normTicker(raw)

const BUCKET_WORDS: [HoldingBucket, string[]][] = [
  ['etf', ['etf', 'etfkern', 'kern', 'fonds']],
  ['aktien', ['aktien', 'aktie', 'einzelaktien', 'stock', 'stocks']],
  ['zukunft', ['zukunft', 'future']],
  ['metalle', ['metalle', 'metall', 'metallekrypto', 'krypto', 'crypto', 'gold']],
]
/** Kategorie aus dem Text (Name, Kurzname oder Kennung der eigenen Kategorien); undefined = leer, null = unbekannt. */
function bucket(raw: string | undefined): HoldingBucket | null | undefined {
  const n = norm(raw ?? '')
  if (!n) return undefined
  const own = HOLDING_BUCKETS.find((b) => [b.id, b.name, b.short].some((x) => norm(x) === n))
  if (own) return own.id
  const legacy = BUCKET_WORDS.find(([, words]) => words.includes(n))?.[0]
  return legacy && HOLDING_BUCKETS.some((b) => b.id === legacy) ? legacy : null
}

function tradeType(raw: string | undefined): 'kauf' | 'verkauf' | null {
  const n = norm(raw ?? '')
  if (['kauf', 'k', 'buy', 'b', 'kaufen', 'reinvestshares'].includes(n)) return 'kauf'
  if (['verkauf', 'v', 'sell', 's', 'verkaufen'].includes(n)) return 'verkauf'
  return null
}

/** Ordnet die Spalten zu: per Kopfzeile (Reihenfolge frei) oder, ohne Kopfzeile, nach der Vorlage. */
function mapColumns(rows: string[][], cols: Col[]): { start: number; idx: Record<string, number> } {
  // Kopfzeile in den ersten Zeilen suchen (Vorlagen haben Kommentare, Exporte oft eine Titelzeile davor).
  let best = { row: -1, hits: 0, idx: {} as Record<string, number> }
  rows.slice(0, 25).forEach((r, ri) => {
    const idx: Record<string, number> = {}
    r.forEach((cell, ci) => {
      const n = norm(cell)
      const c = cols.find((c) => !(c.key in idx) && (c.aliases.includes(n) || norm(c.label) === n))
      if (c) idx[c.key] = ci
    })
    const hits = Object.keys(idx).length
    if (hits >= 2 && hits > best.hits) best = { row: ri, hits, idx }
  })
  if (best.row >= 0) return { start: best.row + 1, idx: best.idx }
  return { start: 0, idx: Object.fromEntries(cols.map((c, i) => [c.key, i])) }
}

/* ------------------------------------------------------------------ Schwab */

const SCHWAB_DIV = /dividend|div reinvest|cap gain|qual div|non-qual/i
const SCHWAB_TAX = /nra|withholding|foreign tax/i
const SCHWAB_SPLIT = /stock split|reverse split/i

/**
 * Zahlenformat einer Schwab-Datei: US («1,234.56») oder europäisch («1.234,56», «150,25»).
 * Europäisch, wenn Zahlen mit Komma und 1–2 Nachkommastellen oder «Punkt vor Komma» überwiegen.
 * Gibt zurück, ob das Komma Tausendertrenner ist (US).
 */
function usNumbers(cells: string[]): boolean {
  let eu = 0, us = 0
  for (const raw of cells) {
    const v = (raw ?? '').replace(/[\s'’$€]|USD|US\$/gi, '')
    if (/\d\.\d{3},\d/.test(v) || /^[-−(]?\d+,\d{1,2}\)?$/.test(v)) eu++
    else if (/\d,\d{3}\.\d/.test(v) || /^[-−(]?\d+\.\d{1,2}\)?$/.test(v)) us++
  }
  return !(eu > us)
}
const NUM_IN_TEXT = /-?\d[\d.,]*\d|\d/g

/** Transaktions-Export von Schwab: Spalten Date, Action, Symbol, Quantity, Price, Fees & Comm, Amount. */
function parseSchwab(rows: string[][], headerRow: number): ParseResult {
  const h = rows[headerRow].map(norm)
  const at = (k: string) => h.indexOf(k)
  const c = { date: at('date'), action: at('action'), symbol: at('symbol'), qty: at('quantity'), price: at('price'), fees: at('feescomm'), amount: at('amount'), desc: at('description') }
  const res: ParseResult = { format: 'schwab', positions: [], trades: [], dividends: [], splits: [], cash: [], errors: [], skipped: [] }
  const us = usNumbers(rows.slice(headerRow + 1).flatMap((r) => [r[c.qty], r[c.price], r[c.fees], r[c.amount]]))
  const n = (raw: string | undefined) => num(raw, us)
  const divs = new Map<string, DivRow>()
  const taxes: { key: string; t: string; d: string; amt: number; line: number }[] = []
  rows.slice(headerRow + 1).forEach((r, i) => {
    if (!r.length) return
    const line = headerRow + i + 2
    const action = r[c.action] ?? ''
    const d = date(r[c.date])
    const t = ticker(r[c.symbol])
    const amount = n(r[c.amount])
    if (!d) {
      if (!/total/i.test(r.join(' '))) res.skipped.push({ line, msg: 'Zeile ohne Datum' })
      return
    }
    const type = tradeType(action)
    if (type) {
      const shares = Math.abs(n(r[c.qty]) ?? NaN), price = n(r[c.price])
      if (!t || !shares || !price) return void res.errors.push({ line, msg: `${action}: Ticker, Stück oder Preis fehlt` })
      res.trades.push({ line, date: d, type, ticker: t, shares, price, fees: Math.abs(n(r[c.fees]) ?? 0), note: 'Schwab-Export' })
    } else if (SCHWAB_SPLIT.test(action) && t && n(r[c.qty])) {
      res.splits!.push({ line, date: d, ticker: t, shares: n(r[c.qty])! })
    } else if (SCHWAB_TAX.test(action) && t && amount != null) {
      // Abzug negativ, Rückerstattung (z. B. «NRA Tax Adj» mit positivem Betrag) positiv
      taxes.push({ key: t + d, t, d, amt: -amount, line })
    } else if (SCHWAB_DIV.test(action) && t && amount != null && amount > 0) {
      const key = t + d
      const prev = divs.get(key)
      if (prev) prev.gross = Math.round((prev.gross + amount) * 100) / 100
      else divs.set(key, { line, payDate: d, exDate: null, ticker: t, gross: amount, tax: null, note: 'Schwab-Export' })
    } else if (!t && amount && /moneylink|wire|funds (received|paid|sent)|deposit|withdraw|ach (in|out)/i.test(action)) {
      res.cash!.push({ line, date: d, amount, note: 'Schwab-Export: ' + action })
    } else res.skipped.push({ line, msg: `${action || 'ohne Art'}${t ? ' ' + t : ''}: wird nicht importiert` })
  })
  // Quellensteuer der Dividende zuordnen: gleicher Titel, gleicher Tag, sonst nächste Zahlung innert 10 Tagen.
  for (const x of taxes) {
    let div = divs.get(x.key)
    if (!div) {
      const near = [...divs.values()].filter((v) => v.ticker === x.t && Math.abs(+new Date(v.payDate) - +new Date(x.d)) <= 10 * 864e5)
      div = near.sort((a, b) => Math.abs(+new Date(a.payDate) - +new Date(x.d)) - Math.abs(+new Date(b.payDate) - +new Date(x.d)))[0]
    }
    // Erst alle Abzüge und Rückerstattungen addieren, dann begrenzen: Die Reihenfolge im Export spielt keine Rolle.
    if (div) div.tax = Math.round(((div.tax ?? 0) + x.amt) * 100) / 100
    else res.skipped.push({ line: x.line, msg: `Quellensteuer ${x.t} ohne passende Dividende` })
  }
  res.dividends = [...divs.values()].map((v) => ({ ...v, tax: Math.min(v.gross, Math.max(0, v.tax ?? 0)) }))
  return res
}

/* ------------------------------------------------------------------ Schwab-Kontoauszug (Type / Description) */

/** Wörter, die in Titelnamen nichts unterscheiden (Rechtsform, Fondsart, Zusätze). */
const NAME_STOP = new Set(['THE', 'INC', 'INCLASS', 'CLASS', 'CL', 'A', 'B', 'C', 'CORP', 'CORPORATION', 'CO', 'COMPANY', 'LTD', 'PLC', 'SA', 'AG', 'NV', 'ETF', 'ETFS', 'SHARES', 'SHS', 'FUND', 'INDEX', 'TRUST', 'TR', 'MORNINGSTAR', 'HOLDINGS', 'HLDGS', 'US', 'USD'])
const NAME_ALIAS: Record<string, string> = { SVCS: 'SERVICES', SVC: 'SERVICE', INTL: 'INTERNATIONAL', TECH: 'TECHNOLOGIES', GRP: 'GROUP', NASDAQ100: 'NASDAQ' }
const nameWords = (s: string) =>
  new Set(s.toUpperCase().replace(/[^A-Z0-9 ]+/g, ' ').split(/\s+/).map((w) => NAME_ALIAS[w] ?? w).filter((w) => w && !NAME_STOP.has(w)))

/**
 * Ticker zu einem Titelnamen aus dem Schwab-Kontoauszug, z. B. «VANGUARD TOTAL STOCK MARKET INDEX FUND ETF SHARES» → VTI.
 * names: Ticker → Name (z. B. von Yahoo). Nimmt den Namen mit der grössten Wortüberdeckung, nur wenn er eindeutig ist.
 */
export function tickerForName(name: string, names: Record<string, string>): string | null {
  const a = nameWords(name)
  if (!a.size) return null
  let best: { t: string; s: number } | null = null, tie = false
  for (const [t, n] of Object.entries(names)) {
    const b = nameWords(n)
    if (!b.size || n.toUpperCase() === t) continue
    let inter = 0
    for (const w of a) if (b.has(w)) inter++
    const s = inter / (a.size + b.size - inter)
    if (best && Math.abs(s - best.s) < 1e-9) tie = tie || best.t !== t
    else if (!best || s > best.s) { best = { t, s }; tie = false }
  }
  return best && best.s >= 0.5 && !tie ? best.t : null
}

const INTL_TRADE = /^(BOT|SOLD)\s+([+-]?[\d.,]+)\s+(.+?)\s+@\s*(-?[\d.,]*\d)(?:\s+\S+)?$/i
const INTL_ASSIGN = /^(BOT|SOLD)\s+([+-]?[\d.,]+)\s+(\S+)\s+UPON\b/i
const INTL_AMOUNT = /\s(-?[\d.,]+)\s+US\$$/i
const INTL_REV_OLD = /REVERSE\s*SPLIT\s+EFF\s+(-?[\d.]+)\s+(\S+)$/i
const INTL_REV_NEW = /^Reverse Split\s+([\d.]+)\s+(\S+)$/i

/**
 * Kontoauszug von Schwab (z. B. Schwab International): Spalten Date, Type, Description, Misc Fees, Commissions, Amount.
 * Käufe/Verkäufe stehen in der Beschreibung («BOT +1 VXUS @82.62»), Dividenden mit Titelname statt Ticker
 * («Qualified Dividend - INTUIT 0.97 US$»), die Quellensteuer als JRN-Zeile mit gleichem Namen.
 */
function parseSchwabStatement(rows: string[][], headerRow: number): ParseResult {
  const h = rows[headerRow].map(norm)
  const at = (k: string) => h.indexOf(k)
  const c = { date: at('date'), type: at('type'), desc: at('description'), misc: at('miscfees'), comm: at('commissions'), amount: at('amount') }
  const res: ParseResult = { format: 'schwab', positions: [], trades: [], dividends: [], splits: [], cash: [], errors: [], skipped: [] }
  const body = rows.slice(headerRow + 1).map((r, i) => ({ r, line: headerRow + i + 2 })).filter(({ r }) => r.length > 1)
  const day = (r: string[]) => date((r[c.date] ?? '').trim().split(/\s+/)[0])
  // Zahlenformat aus den Betragsspalten und den Zahlen in der Beschreibung («BOT +2 PEP @150,25»)
  const us = usNumbers(body.flatMap(({ r }) => [r[c.misc], r[c.comm], r[c.amount], ...((r[c.desc] ?? '').match(NUM_IN_TEXT) ?? [])]))
  const money = (raw: string | undefined) => num(raw, us)

  // Zusammenlegung (Reverse Split): alte Stück unter der Wertpapiernummer, neue unter dem Ticker, gleicher Tag.
  const alias = new Map<string, string>()
  const olds = new Map<string, { id: string; shares: number; line: number }>()
  for (const { r, line } of body) {
    const m = (r[c.desc] ?? '').trim().match(INTL_REV_OLD), d = day(r)
    if (m && d) olds.set(d, { id: m[2].toUpperCase(), shares: Number(m[1]), line })
  }
  for (const { r, line } of body) {
    const m = (r[c.desc] ?? '').trim().match(INTL_REV_NEW), d = day(r)
    const t = m ? ticker(m[2]) : null
    const old = d ? olds.get(d) : undefined
    if (!m || !d || !t) continue
    if (!old) {
      res.skipped.push({ line, msg: `Reverse Split ${t}: alte Stück fehlen im Export` })
      continue
    }
    if (old.id !== t) alias.set(old.id, t)
    res.splits!.push({ line, date: d, ticker: t, shares: +(Number(m[1]) - Math.abs(old.shares)).toFixed(6) })
    olds.delete(d)
  }
  const sym = (raw: string) => alias.get(raw.toUpperCase()) ?? ticker(raw)

  const divs = new Map<string, DivRow>()
  const taxes: { key: string; amt: number; line: number; name: string }[] = []
  // Kontoauszüge stehen meist neueste zuerst; seq zählt in Zeitfolge.
  const newestFirst = (day(body[0]?.r ?? []) ?? '') > (day(body.at(-1)?.r ?? []) ?? '')
  for (const [bi, { r, line }] of body.entries()) {
    const type = (r[c.type] ?? '').trim().toUpperCase()
    const desc = (r[c.desc] ?? '').trim()
    const d = day(r)
    const amount = money(r[c.amount])
    if (!d) {
      res.skipped.push({ line, msg: 'Zeile ohne Datum' })
      continue
    }
    const fees = Math.abs(money(r[c.misc]) ?? 0) + Math.abs(money(r[c.comm]) ?? 0)
    if (type === 'TRD' || type === 'EXP') {
      const m = desc.match(INTL_TRADE), a = desc.match(INTL_ASSIGN)
      const what = m?.[3].trim() ?? a?.[3] ?? ''
      // Optionen («STRADDLE SOFI 100 …», «BITO 100 (Weeklys) …») kann das Dashboard nicht abbilden.
      if (!(m || a) || /\s/.test(what)) {
        res.skipped.push({ line, msg: `Option oder Kombination: wird nicht importiert${amount ? ` (Cash ${amount > 0 ? '+' : ''}${amount.toFixed(2)} USD)` : ''}` })
        continue
      }
      const t = sym(what)
      const shares = Math.abs(num((m ?? a)![2], us) ?? NaN)
      // Zuteilung aus Option: Preis = Betrag / Stück
      const price = m ? num(m[4], us) : amount != null && shares ? Math.abs(amount) / shares : null
      if (!t || !shares || !price || price <= 0) {
        res.errors.push({ line, msg: `${desc.slice(0, 60)}: Ticker, Stück oder Preis nicht lesbar` })
        continue
      }
      res.trades.push({ line, date: d, type: /^BOT/i.test(desc) ? 'kauf' : 'verkauf', ticker: t, shares, price: Math.round(price * 1e6) / 1e6, fees: Math.round(fees * 100) / 100, note: a ? 'Schwab-Export (Zuteilung)' : 'Schwab-Export', time: (r[c.date] ?? '').trim().split(/\s+/)[1] ?? '', seq: newestFirst ? body.length - bi : bi })
    } else if ((type === 'DOI' || type === 'JRN') && amount != null) {
      if (/\bINT(EREST)?\b/.test(desc) && /SCHWAB|INTEREST/i.test(desc)) {
        res.skipped.push({ line, msg: `Zins ${amount.toFixed(2)} USD: wird nicht importiert` })
        continue
      }
      const name = desc.replace(INTL_AMOUNT, '').replace(/^(non-)?qualified\s+div(idend)?\s*-\s*/i, '').trim()
      const key = name.toUpperCase() + '|' + d
      if (type === 'DOI' && amount > 0) {
        const prev = divs.get(key)
        if (prev) prev.gross = Math.round((prev.gross + amount) * 100) / 100
        else divs.set(key, { line, payDate: d, exDate: null, ticker: '', name, gross: amount, tax: null, note: 'Schwab-Export' })
      } else taxes.push({ key, amt: -amount, line, name })
    } else if (type === 'RAD' && (INTL_REV_OLD.test(desc) || INTL_REV_NEW.test(desc))) {
      /* oben als Split gelesen */
    } else if (type === 'WIN' || type === 'WOUT' || /WIRED|TRANSFER|MONEYLINK/i.test(desc)) {
      if (amount) res.cash!.push({ line, date: d, amount, note: 'Schwab-Export: ' + desc.slice(0, 60) })
      else res.skipped.push({ line, msg: `Ein-/Auszahlung ohne Betrag: wird nicht importiert` })
    } else res.skipped.push({ line, msg: `${type || 'ohne Art'} ${desc.slice(0, 50)}: wird nicht importiert` })
  }
  for (const x of taxes) {
    const div = divs.get(x.key)
    if (div) div.tax = Math.round(((div.tax ?? 0) + x.amt) * 100) / 100
    else res.skipped.push({ line: x.line, msg: `Buchung ${x.name} ${(-x.amt).toFixed(2)} USD ohne passende Dividende` })
  }
  res.dividends = [...divs.values()].map((v) => ({ ...v, tax: Math.min(v.gross, Math.max(0, v.tax ?? 0)) }))
  return res
}

/* ------------------------------------------------------------------ Hauptfunktion */

export function parseImport(kind: ImportKind, text: string): ParseResult {
  const res: ParseResult = { format: 'vorlage', positions: [], trades: [], dividends: [], errors: [], skipped: [] }
  if (!text.trim()) return res
  if (text.length > LIMITS.bytes) {
    res.errors.push({ line: 0, msg: 'Die Datei ist zu gross (höchstens 2 MB).' })
    return res
  }
  // Kommentarzeilen (#) bleiben als leere Zeilen stehen, damit die Zeilennummern stimmen.
  const rows = splitTable(text.replace(/^﻿/, '')).map((r) => (isComment(r) ? [] : r))
  if (rows.filter((r) => r.length).length > LIMITS.rows + 1) {
    res.errors.push({ line: 0, msg: `Zu viele Zeilen (höchstens ${LIMITS.rows}). Teile die Datei auf.` })
    return res
  }
  const schwabHeader = rows.slice(0, 25).findIndex((r) => {
    const n = r.map(norm)
    return n.includes('date') && n.includes('action') && n.includes('symbol') && n.includes('amount')
  })
  if (schwabHeader >= 0) return parseSchwab(rows, schwabHeader)
  const statementHeader = rows.slice(0, 25).findIndex((r) => {
    const n = r.map(norm)
    return n.includes('date') && n.includes('type') && n.includes('description') && n.includes('amount')
  })
  if (statementHeader >= 0) return parseSchwabStatement(rows, statementHeader)

  const cols = COLUMNS[kind]
  const { start, idx } = mapColumns(rows, cols)
  const missing = cols.filter((c) => c.required && !(c.key in idx))
  if (missing.length) {
    res.errors.push({ line: start, msg: `Spalte fehlt: ${missing.map((c) => c.label).join(', ')}` })
    return res
  }
  // Komma-getrennte Dateien (Export aus englischem Excel oder Google Sheets) schreiben Zahlen im US-Format: 1,000.50.
  const us = delimiter(text) === ','
  const num = (raw: string | undefined) => parseNumber(raw, us)
  const get = (r: string[], k: string) => (k in idx ? (r[idx[k]] ?? '').trim().slice(0, k === 'note' || k === 'name' ? LIMITS.note : 64) : '')

  rows.slice(start).forEach((r, i) => {
    if (!r.length) return
    const line = start + i + 1
    const t = ticker(get(r, 'ticker'))
    const err = (msg: string) => res.errors.push({ line, msg })
    if (kind === 'bestand') {
      const rawT = get(r, 'ticker')
      // Summen- und Cash-Zeilen aus Broker-Exporten still überspringen.
      if (!t) return void (/(total|cash|summe|gesamt)/i.test(rawT) ? res.skipped.push({ line, msg: `«${rawT}» übersprungen` }) : err(`Ticker «${rawT}» ungültig`))
      const shares = num(get(r, 'shares'))
      if (shares == null || shares < 0) return void err('Stück fehlt oder ungültig')
      const b = bucket(get(r, 'bucket'))
      if (b === null) return void err(`Kategorie «${get(r, 'bucket')}» unbekannt`)
      const costRaw = get(r, 'cost')
      const cost = num(costRaw)
      if (costRaw && cost == null) return void err(`Einstand «${costRaw}» ungültig`)
      res.positions.push({ line, ticker: t, shares, cost: cost == null ? null : Math.abs(cost), name: get(r, 'name') || t, bucket: b, note: get(r, 'note') })
    } else if (kind === 'trades') {
      const d = date(get(r, 'date'))
      const type = tradeType(get(r, 'type'))
      const shares = num(get(r, 'shares')), price = num(get(r, 'price')), fees = num(get(r, 'fees')) ?? 0
      const b = bucket(get(r, 'bucket'))
      if (!d) return void err(`Datum «${get(r, 'date')}» ungültig`)
      if (d > todayISO()) return void err(`Datum ${d} liegt in der Zukunft`)
      if (d < MIN_DATE) return void err(`Datum ${d} liegt zu weit zurück`)
      if (!type) return void err(`Art «${get(r, 'type')}» unbekannt (Kauf oder Verkauf)`)
      if (!t) return void err(get(r, 'ticker') ? `Ticker «${get(r, 'ticker')}» ungültig` : 'Ticker fehlt')
      if (!shares || shares <= 0) return void err('Stück fehlt oder ungültig')
      if (!price || price <= 0) return void err('Preis fehlt oder ungültig')
      if (get(r, 'fees') && num(get(r, 'fees')) == null) return void err(`Gebühr «${get(r, 'fees')}» ungültig`)
      if (fees < 0) return void err('Gebühr darf nicht negativ sein')
      if (b === null) return void err(`Kategorie «${get(r, 'bucket')}» unbekannt`)
      res.trades.push({ line, date: d, type, ticker: t, shares: Math.abs(shares), price, fees, bucket: b, note: get(r, 'note') })
    } else {
      const d = date(get(r, 'payDate'))
      const gross = num(get(r, 'gross'))
      const taxRaw = get(r, 'tax')
      const tax = num(taxRaw)
      const exRaw = get(r, 'exDate')
      const ex = date(exRaw)
      if (!d) return void err(`Zahltag «${get(r, 'payDate')}» ungültig`)
      if (!t) return void err(get(r, 'ticker') ? `Ticker «${get(r, 'ticker')}» ungültig` : 'Ticker fehlt')
      if (!gross || gross <= 0) return void err('Bruttobetrag fehlt oder ungültig')
      if (d > todayISO()) return void err(`Zahltag ${d} liegt in der Zukunft`)
      if (d < MIN_DATE) return void err(`Zahltag ${d} liegt zu weit zurück`)
      if (taxRaw && tax == null) return void err(`Quellensteuer «${taxRaw}» ungültig`)
      if (tax != null && Math.abs(tax) > gross) return void err('Quellensteuer grösser als der Bruttobetrag (Betrag in USD, kein Prozentsatz)')
      if (exRaw && !ex) return void err(`Ex-Tag «${exRaw}» ungültig`)
      res.dividends.push({ line, payDate: d, exDate: ex, ticker: t, gross, tax: tax == null ? null : Math.abs(tax), note: get(r, 'note') })
    }
  })
  return res
}
