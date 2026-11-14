/**
 * Gelesene Daten in eine Form bringen, mit der die Ansichten sicher rechnen können.
 * Beschädigte Einträge (etwa aus einer von Hand geänderten Sicherungskopie) dürfen die App nicht leer werden lassen:
 * Zahlen als Text werden zu Zahlen, unbrauchbare Einträge werden weggelassen, falsche Typen fallen auf leer zurück.
 */
import type { DB } from './types'

type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v)
const ISO = /^\d{4}-\d{2}-\d{2}/
const TX_TYPES = new Set(['kauf', 'verkauf', 'einzahlung', 'auszahlung', 'gebuehr', 'korrektur'])

/** Zahl oder null; Text wie "12.5" zählt als Zahl. Absurd grosse Werte (über 10^15) gelten als beschädigt. */
function num(v: unknown): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN
  return Number.isFinite(n) && Math.abs(n) < 1e15 ? n : null
}
const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : undefined)
const date = (v: unknown): string | null => (typeof v === 'string' && ISO.test(v) ? v.slice(0, 10) : null)

/** Felder auf Zahl (oder weglassen) bringen */
function nums(e: Obj, keys: string[], fallback: 'drop' | 'null' = 'drop') {
  for (const k of keys) {
    if (!(k in e)) continue
    const n = num(e[k])
    if (n == null) {
      if (fallback === 'null') e[k] = null
      else delete e[k]
    } else e[k] = n
  }
}
function strs(e: Obj, keys: string[]) {
  for (const k of keys) {
    if (!(k in e) || e[k] == null) continue
    const s = str(e[k])
    if (s == null) delete e[k]
    else e[k] = s
  }
}

/** Sammlung: nur Objekte als Einträge; fix() liefert den bereinigten Eintrag oder null zum Weglassen */
function coll(v: unknown, fix: (e: Obj, id: string) => Obj | null): Record<string, never> {
  const out: Obj = {}
  if (!isObj(v)) return out as Record<string, never>
  for (const [id, e] of Object.entries(v)) {
    if (!isObj(e) || id === '__proto__') continue
    const r = fix({ ...e }, id)
    if (r) out[id] = r
  }
  return out as Record<string, never>
}

function settings(v: unknown): Obj | undefined {
  if (!isObj(v)) return undefined
  const s: Obj = { ...v }
  s.cash = num(s.cash) ?? 0
  nums(s, ['withholding', 'baseCapital', 'usdchf'])
  strs(s, ['cashNote', 'cashDate', 'termsAccepted', 'broker', 'priceSource', 'demoNote'])
  if ('fx' in s && s.fx !== 'CHF' && s.fx !== 'EUR') delete s.fx
  if ('categories' in s) {
    const list = Array.isArray(s.categories) ? s.categories.filter((c): c is Obj => isObj(c) && typeof c.id === 'string' && c.id !== '' && c.id !== 'cash') : []
    const seen = new Set<string>()
    const cats = list.filter((c) => !seen.has(c.id as string) && seen.add(c.id as string)).map((c) => ({ id: c.id as string, name: str(c.name)?.trim() || (c.id as string) }))
    if (cats.length) s.categories = cats
    else delete s.categories
  }
  for (const k of ['targets', 'bucketNames'] as const) {
    if (!(k in s)) continue
    if (!isObj(s[k])) delete s[k]
    else {
      const o: Obj = {}
      for (const [id, x] of Object.entries(s[k] as Obj)) {
        const val = k === 'targets' ? num(x) : str(x)
        if (val != null) o[id] = val
      }
      s[k] = o
    }
  }
  if ('caps' in s) s.caps = Array.isArray(s.caps) ? s.caps.filter((c) => typeof c === 'string') : undefined
  for (const k of ['rules', 'openItems'] as const) {
    if (!(k in s)) continue
    s[k] = Array.isArray(s[k]) ? (s[k] as unknown[]).filter((r): r is Obj => isObj(r) && typeof r.title === 'string').map((r) => { const c = { ...r }; strs(c, ['detail', 'tag']); return c }) : undefined
  }
  if ('refresh' in s && !isObj(s.refresh)) delete s.refresh
  for (const k of Object.keys(s)) if (s[k] === undefined) delete s[k]
  return s
}

/** Ganze Datenbank bereinigen (fehlende Sammlungen werden leer). */
export function sanitizeDb(raw: unknown): DB {
  const r: Obj = isObj(raw) ? raw : {}
  const positions = coll(r.positions, (e, id) => {
    const shares = num(e.shares)
    if (shares == null) return null
    e.shares = shares
    e.ticker = str(e.ticker) || id
    e.name = str(e.name) || (e.ticker as string)
    e.bucket = str(e.bucket) || ''
    e.cost = num(e.cost)
    strs(e, ['status', 'note'])
    return e
  })
  const prices = coll(r.prices, (e) => {
    const close = num(e.close)
    if (close == null) return null
    e.close = close
    e.prev = num(e.prev)
    e.date = str(e.date) ?? ''
    nums(e, ['divAnnual', 'divLast'])
    if ('divMonths' in e && !Array.isArray(e.divMonths)) delete e.divMonths
    if ('divByMonth' in e && !isObj(e.divByMonth)) delete e.divByMonth
    return e
  })
  const watchlist = coll(r.watchlist, (e, id) => {
    e.ticker = str(e.ticker) || id
    e.name = str(e.name) || (e.ticker as string)
    e.price = num(e.price)
    e.limit = num(e.limit)
    e.limitCautious = num(e.limitCautious)
    e.conditionMet = typeof e.conditionMet === 'boolean' ? e.conditionMet : null
    strs(e, ['condition', 'pot', 'limitNote', 'note', 'priceDate'])
    return e
  })
  const pots = coll(r.pots, (e, id) => {
    e.label = str(e.label) || id
    e.budget = num(e.budget) ?? 0
    e.used = num(e.used) ?? 0
    nums(e, ['order'])
    strs(e, ['note'])
    return e
  })
  const events = coll(r.events, (e) => {
    const d = date(e.date)
    if (!d) return null
    e.date = d
    e.title = str(e.title) || 'Termin'
    strs(e, ['detail', 'kind', 'ticker'])
    return e
  })
  const log = coll(r.log, (e) => {
    const d = date(e.date)
    if (!d) return null
    e.date = d
    e.title = str(e.title) || 'Notiz'
    strs(e, ['text', 'by'])
    return e
  })
  const transactions = coll(r.transactions, (e) => {
    const d = date(e.date)
    if (!d || !TX_TYPES.has(e.type as string)) return null
    e.date = d
    e.cashDelta = num(e.cashDelta) ?? 0
    nums(e, ['shares', 'price', 'fees'])
    if ('realized' in e) e.realized = num(e.realized)
    if ('ticker' in e) e.ticker = str(e.ticker) || undefined
    if (!e.ticker) delete e.ticker
    // Kauf und Verkauf ohne Titel oder Stückzahl sind nicht auswertbar
    if ((e.type === 'kauf' || e.type === 'verkauf') && (!e.ticker || e.shares == null)) return null
    strs(e, ['note', 'by', 'costMethod', 'createdAt'])
    return e
  })
  const dividends = coll(r.dividends, (e) => {
    const ticker = str(e.ticker)
    const payDate = date(e.payDate)
    const gross = num(e.gross)
    if (!ticker || !payDate || gross == null) return null
    e.ticker = ticker
    e.payDate = payDate
    e.exDate = date(e.exDate)
    e.gross = gross
    e.tax = num(e.tax) ?? 0
    e.net = num(e.net) ?? gross - (e.tax as number)
    e.perShare = num(e.perShare)
    e.shares = num(e.shares)
    e.status = e.status === 'erwartet' ? 'erwartet' : 'erhalten'
    strs(e, ['source', 'note'])
    return e
  })
  const snapshots = coll(r.snapshots, (e, id) => {
    const total = num(e.total)
    const d = date(e.date) ?? date(id)
    if (total == null || !d) return null
    e.total = total
    e.date = d
    nums(e, ['securities', 'cash', 'invested'])
    return e
  })
  const metaRaw = isObj(r.meta) ? r.meta : {}
  const meta: Obj = { ...metaRaw }
  const s = settings(metaRaw.settings)
  if (s) meta.settings = s
  else delete meta.settings
  const market: Obj = isObj(r.market) ? { ...r.market } : {}
  if ('latest' in market) {
    if (!isObj(market.latest)) delete market.latest
    else {
      const m: Obj = { ...market.latest }
      m.quotes = coll(m.quotes, (e) => (num(e.close) == null ? null : { ...e, close: num(e.close), prev: num(e.prev) }))
      nums(m, ['usdchf'])
      if ('failures' in m && !Array.isArray(m.failures)) delete m.failures
      market.latest = m
    }
  }
  return { positions, prices, watchlist, pots, events, log, transactions, dividends, snapshots, meta, market } as unknown as DB
}
