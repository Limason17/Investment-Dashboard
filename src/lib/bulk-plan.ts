/**
 * Massen-Import, zweiter Schritt: aus den gelesenen Zeilen die Änderungen an der Datenbank planen.
 * Prüft gegen den Bestand (Verkauf ohne Bestand), erkennt bereits erfasste Einträge
 * und rechnet Einstand, realisierten Gewinn und Cash wie die Einzeleingabe.
 */
import type { ParseResult } from './bulk'
import { quote, wht } from './calc'
import { qty, r2, uid, usd } from './format'
import type { Op } from './store'
import type { DB } from './types'

export type ItemState = 'neu' | 'ändert' | 'doppelt' | 'fehler'
export interface PlanItem {
  line: number
  kind: 'Bestand' | 'Kauf' | 'Verkauf' | 'Dividende'
  ticker: string
  date?: string
  detail: string
  amount: number | null
  state: ItemState
  msg?: string
}
export interface Plan {
  ops: Op[]
  items: PlanItem[]
  cashDelta: number
  /** Cash-Wirkung von Einträgen bis zum letzten Cash-Stand: steckt schon im erfassten Saldo */
  cashBefore: number
  /** Datum des letzten Cash-Stands */
  balanceDate: string | null
  count: number
}

const same = (a: number | null | undefined, b: number | null | undefined, eps = 0.005) => a != null && b != null && Math.abs(a - b) < eps
const days = (a: string, b: string) => Math.abs(+new Date(a) - +new Date(b)) / 864e5

export function planImport(db: DB, p: ParseResult): Plan {
  const ops: Op[] = []
  const items: PlanItem[] = []
  let cashDelta = 0
  let cashBefore = 0
  // Letzter Cash-Stand (Saldo laut Broker): Was davor geschah, ist darin schon enthalten.
  const balanceDate = Object.values(db.transactions).filter((x) => x.type === 'korrektur' && !x.ticker && x.date).map((x) => x.date).sort().at(-1) ?? null
  const addCash = (date: string, v: number) => {
    if (balanceDate && date <= balanceDate) cashBefore += v
    else cashDelta += v
  }
  const createdAt = new Date().toISOString()
  const by = p.format === 'schwab' ? 'Schwab-Import' : 'Massen-Import'

  // Bestand: setzt Stück und Einstand je Titel; Transaktionen und Cash bleiben unverändert.
  for (const r of p.positions) {
    const old = db.positions[r.ticker]
    const unchanged = old && same(old.shares, r.shares, 1e-6) && (r.cost == null || same(old.cost, r.cost))
    items.push({ line: r.line, kind: 'Bestand', ticker: r.ticker, detail: `${r.shares} Stück`, amount: r.cost, state: unchanged ? 'doppelt' : old ? 'ändert' : 'neu' })
    if (unchanged) continue
    ops.push(
      old
        ? { op: 'merge', coll: 'positions', id: r.ticker, data: { shares: r.shares, ...(r.cost != null ? { cost: r2(r.cost) } : {}), ...(r.bucket ? { bucket: r.bucket } : {}), ...(r.name !== r.ticker ? { name: r.name } : {}), ...(r.note ? { note: r.note } : {}) } }
        : { op: 'set', coll: 'positions', id: r.ticker, data: { ticker: r.ticker, name: r.name, shares: r.shares, bucket: r.bucket ?? 'aktien', cost: r.cost == null ? null : r2(r.cost), status: 'Massen-Import', note: r.note } },
    )
  }

  // Käufe und Verkäufe: in Datumsfolge auf den Bestand anwenden.
  const pos = new Map(Object.entries(db.positions).map(([t, x]) => [t, { shares: x.shares, cost: x.cost, isNew: false, name: x.name, bucket: x.bucket }]))
  const existing = Object.values(db.transactions)
  const priced = new Set<string>()
  const trades = [...p.trades].sort((a, b) => a.date.localeCompare(b.date) || a.line - b.line)
  for (const r of trades) {
    const amt = r.shares * r.price
    const item: PlanItem = { line: r.line, kind: r.type === 'kauf' ? 'Kauf' : 'Verkauf', ticker: r.ticker, date: r.date, detail: `${qty(r.shares)} × ${usd(r.price)}`, amount: r.type === 'kauf' ? -(amt + r.fees) : amt - r.fees, state: 'neu' }
    items.push(item)
    if (existing.some((x) => x.type === r.type && x.date === r.date && x.ticker === r.ticker && same(x.shares, r.shares, 1e-6) && same(x.price, r.price, 0.0001))) {
      item.state = 'doppelt'
      continue
    }
    const cur = pos.get(r.ticker)
    if (r.type === 'kauf') {
      const cashD = -(amt + r.fees)
      if (cur) {
        cur.shares = +(cur.shares + r.shares).toFixed(6)
        cur.cost = cur.cost != null ? r2(cur.cost + amt + r.fees) : null
      } else pos.set(r.ticker, { shares: r.shares, cost: r2(amt + r.fees), isNew: true, name: r.ticker, bucket: r.bucket ?? 'aktien' })
      ops.push({ op: 'set', coll: 'transactions', id: uid(), data: { type: 'kauf', date: r.date, ticker: r.ticker, shares: r.shares, price: r.price, fees: r.fees, cashDelta: r2(cashD), pot: null, note: r.note, createdAt, by } })
      addCash(r.date, cashD)
      if (!quote(db, r.ticker)) priced.add(r.ticker)
    } else {
      if (!cur || cur.shares < r.shares - 1e-9) {
        item.state = 'fehler'
        item.msg = `nur ${cur?.shares ?? 0} Stück im Bestand`
        continue
      }
      const avg = cur.cost != null && cur.shares ? cur.cost / cur.shares : null
      const cashD = amt - r.fees
      cur.shares = +(cur.shares - r.shares).toFixed(6)
      cur.cost = avg != null ? r2(avg * cur.shares) : null
      ops.push({ op: 'set', coll: 'transactions', id: uid(), data: { type: 'verkauf', date: r.date, ticker: r.ticker, shares: r.shares, price: r.price, fees: r.fees, cashDelta: r2(cashD), realized: avg != null ? r2(cashD - avg * r.shares) : null, note: r.note, createdAt, by } })
      addCash(r.date, cashD)
    }
  }
  const touched = new Set(trades.map((r) => r.ticker))
  for (const t of touched) {
    const cur = pos.get(t)
    if (!cur) continue
    const old = db.positions[t]
    if (cur.isNew) ops.push({ op: 'set', coll: 'positions', id: t, data: { ticker: t, name: db.watchlist[t]?.name || t, shares: cur.shares, bucket: cur.bucket, cost: cur.cost, status: 'Massen-Import', note: '' } })
    else if (old && (old.shares !== cur.shares || old.cost !== cur.cost)) ops.push({ op: 'merge', coll: 'positions', id: t, data: { shares: cur.shares, cost: cur.cost } })
  }
  // Neue Titel ohne Kurs: letzten Kaufpreis als vorläufigen Kurs, bis die Live-Kurse kommen.
  for (const t of priced) {
    const last = trades.filter((r) => r.ticker === t && r.type === 'kauf').at(-1)!
    ops.push({ op: 'set', coll: 'prices', id: t, data: { close: last.price, prev: null, date: last.date, source: 'Kaufpreis' } })
  }

  // Dividenden: bestätigt passende erwartete Zahlungen, erkennt bereits erhaltene.
  const w = wht(db)
  const divs = Object.entries(db.dividends)
  const used = new Set<string>()
  for (const r of p.dividends) {
    const tax = r.tax ?? r2(r.gross * w)
    const net = r2(r.gross - tax)
    const item: PlanItem = { line: r.line, kind: 'Dividende', ticker: r.ticker, date: r.payDate, detail: `brutto ${usd(r.gross)}, Steuer ${usd(tax)}`, amount: net, state: 'neu' }
    items.push(item)
    if (divs.some(([, d]) => d.status === 'erhalten' && d.ticker === r.ticker && d.payDate === r.payDate && same(d.gross, r.gross))) {
      item.state = 'doppelt'
      continue
    }
    const expected = divs.find(([id, d]) => !used.has(id) && d.status === 'erwartet' && d.ticker === r.ticker && days(d.payDate, r.payDate) <= 7)
    if (expected) {
      used.add(expected[0])
      item.state = 'ändert'
      item.msg = 'bestätigt erwartete Zahlung'
    }
    const from = expected?.[1]
    ops.push({
      op: 'set', coll: 'dividends', id: expected?.[0] ?? `${r.ticker}-${r.payDate}-${uid().slice(-4)}`,
      data: { ticker: r.ticker, exDate: r.exDate ?? from?.exDate ?? null, payDate: r.payDate, perShare: from?.perShare ?? null, shares: from?.shares ?? db.positions[r.ticker]?.shares ?? null, gross: r2(r.gross), tax: r2(tax), net, status: 'erhalten', source: by, note: r.note },
    })
    addCash(r.payDate, net)
  }

  // Cash einmal nachführen; entfällt, solange Cash nicht erfasst wird.
  const s = db.meta.settings
  if (cashDelta && !s?.cashExcluded) ops.push({ op: 'merge', coll: 'meta', id: 'settings', data: { cash: r2((Number(s?.cash) || 0) + cashDelta) } })
  return { ops, items, cashDelta: r2(cashDelta), cashBefore: r2(cashBefore), balanceDate, count: items.filter((i) => i.state === 'neu' || i.state === 'ändert').length }
}
