import { compute, snapshotsSorted } from './calc'
import { r2, today } from './format'
import { mutate, type Op } from './store'

/** Änderungen schreiben und den heutigen Tagespunkt des Wertverlaufs nachführen. flow = Ein-/Auszahlung (zählt ins investierte Kapital). */
export async function commit(ops: (Op | null | false | undefined)[], flow = 0) {
  const db = await mutate(ops.filter(Boolean) as Op[])
  const c = compute(db)
  if (!c.valuationComplete || c.settings.cashExcluded) return
  const now = today()
  const snaps = snapshotsSorted(db)
  const base = db.snapshots[now]?.invested ?? snaps[snaps.length - 1]?.invested
  await mutate([{
    op: 'set', coll: 'snapshots', id: now,
    data: { date: now, total: r2(c.total), securities: r2(c.sec), cash: r2(c.cash), ...(base != null ? { invested: r2(base + flow) } : {}), note: 'Eintrag im Dashboard' },
  }])
}
