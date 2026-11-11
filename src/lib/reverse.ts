/**
 * Storno: eine Buchung oder Dividende so entfernen, dass Bestand, Einstand, Topf und Cash
 * wieder dem Stand ohne sie entsprechen.
 */
import { r2 } from './format'
import type { Op } from './store'
import type { DB, Dividend, Tx } from './types'

const cashOp = (db: DB, delta: number): Op[] => {
  const s = db.meta.settings
  if (!delta || s?.cashExcluded) return []
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
    else if (x.ticker) ops.push({ op: 'set', coll: 'positions', id: x.ticker, data: { ticker: x.ticker, name: x.ticker, shares: sh, bucket: 'aktien', cost: soldCost != null ? r2(soldCost) : null } })
  }
  return [...ops, ...cashOp(db, -(x.cashDelta || 0))]
}

export function reverseDividend(db: DB, id: string, d: Dividend): Op[] {
  return [{ op: 'delete', coll: 'dividends', id }, ...(d.status === 'erhalten' ? cashOp(db, -(d.net || 0)) : [])]
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
