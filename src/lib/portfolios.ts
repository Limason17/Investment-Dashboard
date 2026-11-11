/**
 * Mehrere Portfolios je Konto (bzw. je lokalem Ordner).
 * «main» ist das erste Portfolio und liegt am bisherigen Ort; weitere liegen daneben.
 * «all» ist die Gesamtansicht: alle Portfolios zusammengezählt, nur zum Ansehen.
 */
import type { DB, Position, Quote, Settings, Snapshot } from './types'

export interface PortfolioInfo { id: string; name: string; order: number }
export type PortfolioMap = Record<string, { name: string; order: number }>

export const MAIN = 'main'
export const ALL = 'all'
export const PID = /^[a-z0-9][a-z0-9-]{0,39}$/
export const MAX_PORTFOLIOS = 20

/** Liste aus der gespeicherten Map; das Hauptportfolio gibt es immer. */
export function portfolioList(map: PortfolioMap | null | undefined): PortfolioInfo[] {
  const m: PortfolioMap = { [MAIN]: { name: 'Hauptportfolio', order: 0 }, ...(map ?? {}) }
  return Object.entries(m)
    .filter(([id, p]) => PID.test(id) && id !== ALL && p && typeof p.name === 'string')
    .map(([id, p]) => ({ id, name: p.name.slice(0, 40) || id, order: Number(p.order) || 0 }))
    .sort((a, b) => a.order - b.order || a.name.localeCompare(b.name))
}
export const toMap = (list: PortfolioInfo[]): PortfolioMap => Object.fromEntries(list.map((p, i) => [p.id, { name: p.name, order: i }]))

/** Neue, kurze ID aus dem Namen (nur a–z, 0–9, -), eindeutig in der Liste. */
export function newPortfolioId(name: string, list: PortfolioInfo[]) {
  const base = name.toLowerCase().replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss').normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24) || 'portfolio'
  let id = base === MAIN || base === ALL ? base + '-2' : base
  for (let i = 2; list.some((p) => p.id === id); i++) id = `${base}-${i}`
  return id
}

const r2 = (v: number) => Math.round(v * 100) / 100

/** Gesamtansicht: Positionen je Ticker addiert, Buchungen und Termine aller Portfolios, Cash summiert. */
export function aggregate(parts: { info: PortfolioInfo; db: DB }[]): DB {
  const out: DB = { positions: {}, prices: {}, watchlist: {}, pots: {}, events: {}, log: {}, transactions: {}, dividends: {}, snapshots: {}, meta: {}, market: {} }
  const tag = (pid: string, id: string) => `${pid}:${id}`
  const quotes: Record<string, Quote> = {}
  let cash = 0, anyCash = false
  for (const { info, db } of parts) {
    for (const [t, p] of Object.entries(db.positions)) {
      const o: Position | undefined = out.positions[t]
      out.positions[t] = o
        ? { ...o, shares: +(o.shares + (p.shares || 0)).toFixed(6), cost: o.cost != null && p.cost != null ? r2(o.cost + p.cost) : o.shares && !p.shares ? o.cost : p.shares && !o.shares ? p.cost : null }
        : { ...p }
    }
    for (const [t, q] of Object.entries(db.prices)) if (!out.prices[t] || (q.date ?? '') > (out.prices[t].date ?? '')) out.prices[t] = q
    for (const [t, q] of Object.entries(db.market.latest?.quotes ?? {})) if (!quotes[t] || (q.time ?? q.date ?? '') > (quotes[t].time ?? quotes[t].date ?? '')) quotes[t] = q
    for (const [t, w] of Object.entries(db.watchlist)) out.watchlist[t] ??= w
    for (const [id, x] of Object.entries(db.pots)) out.pots[tag(info.id, id)] = { ...x, label: `${x.label} · ${info.name}` }
    for (const [id, x] of Object.entries(db.events)) out.events[tag(info.id, id)] = x
    for (const [id, x] of Object.entries(db.log)) out.log[tag(info.id, id)] = { ...x, by: x.by ? `${x.by} · ${info.name}` : info.name }
    for (const [id, x] of Object.entries(db.transactions)) out.transactions[tag(info.id, id)] = { ...x, note: x.note ? `${info.name}: ${x.note}` : info.name }
    for (const [id, x] of Object.entries(db.dividends)) out.dividends[tag(info.id, id)] = x
    for (const [d, s] of Object.entries(db.snapshots)) {
      const o: Snapshot | undefined = out.snapshots[d]
      out.snapshots[d] = o
        ? { date: d, total: r2(o.total + s.total), securities: r2((o.securities ?? 0) + (s.securities ?? 0)), cash: r2((o.cash ?? 0) + (s.cash ?? 0)), ...(o.invested != null && s.invested != null ? { invested: r2(o.invested + s.invested) } : {}) }
        : { ...s }
    }
    const st = db.meta.settings
    if (st && !st.cashExcluded) {
      cash += Number(st.cash) || 0
      anyCash = true
    }
  }
  const first: Settings = parts.find((p) => p.info.id === MAIN)?.db.meta.settings ?? parts[0]?.db.meta.settings ?? { cash: 0 }
  out.meta = { settings: { ...first, cash: r2(cash), cashExcluded: !anyCash, rules: first.rules, openItems: [] } }
  out.market = { latest: { quotes } }
  return out
}
