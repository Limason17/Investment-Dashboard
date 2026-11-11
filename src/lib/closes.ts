/**
 * Schlusskurse und Tageswert eines abgeschlossenen Handelstages festhalten.
 * Ohne Abhängigkeiten: läuft im lokalen Server (data/*.json) und im Browser (Konto).
 */
interface CloseQuote { regular: number; regularPrev: number | null; regularDate: string }
interface PriceLike { date?: string; close?: number; [k: string]: unknown }
interface PosLike { shares?: number; cost?: number | null }

const round2 = (x: number) => Math.round(x * 100) / 100

export function closeUpdates(
  positions: Record<string, PosLike>,
  prices: Record<string, PriceLike>,
  snapshots: Record<string, unknown>,
  settings: { cash?: number; cashExcluded?: boolean } | undefined,
  quotes: Record<string, CloseQuote>,
) {
  const changed: Record<string, PriceLike> = {}
  for (const [t, q] of Object.entries(quotes)) {
    if (q.regularPrev == null) continue // reguläre Sitzung noch nicht vorbei
    const old = prices[t]
    if (old?.date && old.date >= q.regularDate) continue
    changed[t] = { ...old, close: q.regular, prev: q.regularPrev, date: q.regularDate, source: 'Yahoo Finance (Schlusskurs)' }
  }
  if (!Object.keys(changed).length) return null
  const all = { ...prices, ...changed }
  // Tageswert nur, wenn alle gehaltenen Titel einen Schlusskurs desselben Tages haben.
  const held = Object.entries(positions).filter(([, p]) => (p.shares ?? 0) > 0)
  const day = quotes[held[0]?.[0]]?.regularDate
  let snapshot: { date: string; total: number; securities: number; cash: number; invested: number; note: string } | null = null
  if (day && !snapshots[day] && held.every(([t]) => all[t]?.date === day)) {
    const securities = held.reduce((s, [t, p]) => s + (p.shares ?? 0) * Number(all[t].close), 0)
    const invested = held.reduce((s, [, p]) => s + (p.cost ?? 0), 0)
    const cash = settings?.cashExcluded ? 0 : Number(settings?.cash) || 0
    snapshot = { date: day, total: round2(securities + cash), securities: round2(securities), cash, invested: round2(invested), note: 'Automatisch aus Schlusskursen (Yahoo Finance)' }
  }
  return { prices: changed, snapshot }
}
