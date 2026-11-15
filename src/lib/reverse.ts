/**
 * Storno: eine Buchung oder Dividende so entfernen, dass Bestand, Einstand, Topf und Cash
 * wieder dem Stand ohne sie entsprechen.
 */
import { defaultCat } from './buckets'
import { r2 } from './format'
import type { Op } from './store'
import type { DB, Dividend, Tx } from './types'

/** Datum des letzten Cash-Stands (Saldo laut Broker) oder null. */
export const lastBalance = (db: DB) => Object.values(db.transactions).filter((x) => x.type === 'korrektur' && !x.ticker && x.date).map((x) => x.date).sort().at(-1) ?? null

/**
 * Ändert eine Buchung mit diesem Datum das heutige Cash? Nein, wenn sie am oder vor dem letzten Cash-Stand liegt:
 * Der damals erfasste Saldo enthält sie schon. Gleiche Regel wie beim Import.
 */
export const movesCash = (db: DB, date: string | undefined) => {
  const bal = lastBalance(db)
  return !bal || !date || date > bal
}

/** Cash-Stand nachführen; ohne Datum (z. B. Storno eines Cash-Stands selbst) immer. */
const cashOp = (db: DB, delta: number, date?: string): Op[] => {
  const s = db.meta.settings
  if (!delta || s?.cashExcluded || !movesCash(db, date)) return []
  return [{ op: 'merge', coll: 'meta', id: 'settings', data: { cash: r2((Number(s?.cash) || 0) + delta) } }]
}

export function reverseTx(db: DB, id: string, x: Tx): Op[] {
  const ops: Op[] = [{ op: 'delete', coll: 'transactions', id }]
  const p = x.ticker ? db.positions[x.ticker] : undefined
  const sh = x.shares ?? 0
  if (x.type === 'kauf' && p && sh) {
    const paid = (x.price ?? 0) * sh + (x.fees ?? 0)
    ops.push({ op: 'merge', coll: 'positions', id: x.ticker!, data: { shares: Math.max(0, +(p.shares - sh).toFixed(6)), cost: p.cost != null ? Math.max(0, r2(p.cost - paid)) : null } })
    if (x.pot && db.pots[x.pot]) ops.push({ op: 'merge', coll: 'pots', id: x.pot, data: { used: Math.max(0, r2((db.pots[x.pot].used || 0) - paid)) } })
  }
  if (x.type === 'verkauf' && sh) {
    // Einstand des verkauften Teils = Erlös − realisierter Gewinn.
    const soldCost = x.realized != null ? x.cashDelta - x.realized : null
    if (p) ops.push({ op: 'merge', coll: 'positions', id: x.ticker!, data: { shares: +(p.shares + sh).toFixed(6), cost: p.cost != null && soldCost != null ? r2(p.cost + soldCost) : p.cost } })
    else if (x.ticker) ops.push({ op: 'set', coll: 'positions', id: x.ticker, data: { ticker: x.ticker, name: x.ticker, shares: sh, bucket: defaultCat(), cost: soldCost != null ? r2(soldCost) : null } })
  }
  // Ein Cash-Stand selbst wird immer zurückgenommen; alle anderen Buchungen nur nach dem letzten Cash-Stand.
  const balance = x.type === 'korrektur' && !x.ticker
  return [...ops, ...cashOp(db, -(x.cashDelta || 0), balance ? undefined : x.date)]
}

export function reverseDividend(db: DB, id: string, d: Dividend): Op[] {
  return [{ op: 'delete', coll: 'dividends', id }, ...(d.status === 'erhalten' ? cashOp(db, -(d.net || 0), d.payDate) : [])]
}

/** Operationen im Speicher anwenden, wie es der Server tut (für «Bearbeiten» = Storno + neue Buchung in einem Zug). */
export function applyOps(db: DB, ops: Op[]): DB {
  const out = { ...db } as unknown as Record<string, Record<string, Record<string, unknown>>>
  for (const o of ops) {
    const c = o.op === 'clear' ? {} : { ...out[o.coll] }
    if (o.op === 'delete') delete c[o.id]
    else if (o.op === 'set') c[o.id] = { ...(o.data as Record<string, unknown>) }
    else if (o.op === 'merge') c[o.id] = { ...c[o.id], ...(o.data as Record<string, unknown>) }
    out[o.coll] = c
  }
  return out as unknown as DB
}

/** Stückzahl, die die Buchungen eines Titels ergeben (Käufe, Verkäufe, Splits). */
const bookedShares = (db: DB, ticker: string) =>
  Object.values(db.transactions).reduce((n, x) => (x.ticker !== ticker ? n : x.type === 'kauf' ? n + (x.shares ?? 0) : x.type === 'verkauf' ? n - (x.shares ?? 0) : x.type === 'korrektur' ? n + (x.shares ?? 0) : n), 0)

/**
 * Nach dem Erfassen, Ändern oder Löschen einer Buchung den Titel neu durchrechnen (Durchschnittskosten):
 * Bestand, Einstand und der realisierte Gewinn späterer Verkäufe. Gilt nur, wenn die Buchungen den Bestand
 * vorher vollständig erklärten; sonst (z. B. Bestand ohne Kaufdatum importiert) bleibt es bei der einfachen Rechnung.
 * Wirft einen Fehler, wenn danach für einen Verkauf Stück fehlen.
 */
export function replayOps(before: DB, ops: Op[], ticker: string): Op[] {
  const p0 = before.positions[ticker]
  const explained = (p0 ? p0.cost != null && Math.abs(bookedShares(before, ticker) - (p0.shares || 0)) < 1e-6 : bookedShares(before, ticker) === 0)
  if (!explained) return ops
  const after = applyOps(before, ops)
  const list = Object.entries(after.transactions)
    .filter(([, x]) => x.ticker === ticker && (x.type === 'kauf' || x.type === 'verkauf' || x.type === 'korrektur'))
    .sort(([, a], [, b]) => a.date.localeCompare(b.date) || (a.type === 'korrektur' ? -1 : b.type === 'korrektur' ? 1 : 0) || (a.type === 'kauf' ? -1 : b.type === 'kauf' ? 1 : 0) || (a.createdAt ?? '').localeCompare(b.createdAt ?? ''))
  let shares = 0, cost = 0
  const extra: Op[] = []
  for (const [id, x] of list) {
    const sh = x.shares ?? 0
    if (x.type === 'kauf') {
      shares += sh
      cost += sh * (x.price ?? 0) + (x.fees ?? 0)
    } else if (x.type === 'korrektur') {
      shares += sh
    } else {
      if (shares < sh - 1e-9) throw new Error(`Das geht nicht: Für den Verkauf von ${ticker} am ${x.date.split('-').reverse().join('.')} fehlen danach Stück. Ändere oder lösche zuerst diesen Verkauf.`)
      const avg = shares ? cost / shares : 0
      const realized = r2(x.cashDelta - avg * sh)
      if (x.realized !== realized) extra.push({ op: 'merge', coll: 'transactions', id, data: { realized } })
      cost -= avg * sh
      shares -= sh
    }
  }
  shares = +shares.toFixed(6)
  const p = after.positions[ticker]
  if (p) extra.push({ op: 'merge', coll: 'positions', id: ticker, data: { shares, cost: shares > 0 ? r2(cost) : 0 } })
  return [...ops, ...extra]
}
