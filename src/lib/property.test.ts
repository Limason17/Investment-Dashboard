/**
 * Zufallstests (fester Startwert, also wiederholbar): Tausende zufällige Buchungsfolgen, Eingaben und Zahlen.
 * Geprüft werden Eigenschaften, die immer gelten müssen, statt einzelner Beispiele.
 */
import { describe, expect, it } from 'vitest'
import { parseImport, type ImportKind } from './bulk'
import { planImport } from './bulk-plan'
import { compute } from './calc'
import { parseNum, pct, qty, sUsdRaw, usdRaw } from './format'
import { portfolioSeries, timeline } from './history'
import { applyOps, reverseDividend, reverseTx } from './reverse'
import type { ChartData, DB, Tx } from './types'

/** kleiner, wiederholbarer Zufallsgenerator (mulberry32) */
function rng(seed: number) {
  return () => {
    seed |= 0
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
const pick = <T,>(r: () => number, a: T[]) => a[Math.floor(r() * a.length)]
const empty = (cash: number | null): DB => ({ positions: {}, prices: {}, watchlist: {}, pots: {}, events: {}, log: {}, transactions: {}, dividends: {}, snapshots: {}, meta: { settings: cash == null ? { cash: 0, cashExcluded: true, withholding: 0.15 } : { cash, cashExcluded: false, withholding: 0.15 } }, market: {} })
const TICKERS = ['VTI', 'MSFT', 'NVDA', 'KO', 'BRK-B']
const day = (i: number) => new Date(Date.UTC(2024, 0, 2) + i * 864e5).toISOString().slice(0, 10)

/** zufällige, gültige Folge von Käufen und Verkäufen (nie mehr verkaufen als vorhanden) */
function randomTrades(r: () => number, n: number) {
  const held: Record<string, number> = {}
  const rows: string[] = []
  for (let i = 0; i < n; i++) {
    const t = pick(r, TICKERS)
    const have = held[t] ?? 0
    const sell = have > 0 && r() < 0.35
    const sh = sell ? +(have * (r() < 0.3 ? 1 : r())).toFixed(4) || have : +(r() < 0.5 ? Math.ceil(r() * 20) : r() * 5).toFixed(4) || 1
    const price = +(5 + r() * 500).toFixed(2)
    const fee = r() < 0.5 ? 0 : +(r() * 5).toFixed(2)
    held[t] = +(have + (sell ? -sh : sh)).toFixed(6)
    rows.push([day(i), sell ? 'Verkauf' : 'Kauf', t, String(sh), String(price), String(fee)].join(';'))
  }
  return 'Datum;Art;Ticker;Stück;Preis;Gebühren\n' + rows.join('\n')
}

describe('Zufällige Buchungsfolgen', () => {
  it('Bestand, Einstand und Cash stimmen mit einem einfachen Modell überein (500 Folgen)', () => {
    const r = rng(42)
    for (let k = 0; k < 500; k++) {
      const csv = randomTrades(r, 1 + Math.floor(r() * 25))
      const parsed = parseImport('trades', csv)
      expect(parsed.errors).toEqual([])
      const db = empty(10_000)
      const plan = planImport(db, parsed)
      expect(plan.items.filter((i) => i.state === 'fehler')).toEqual([])
      const after = applyOps(db, plan.ops)
      // Modell: Durchschnittskosten
      const m: Record<string, { sh: number; cost: number }> = {}
      let cash = 10_000
      for (const t of parsed.trades) {
        const p = (m[t.ticker] ??= { sh: 0, cost: 0 })
        if (t.type === 'kauf') {
          p.sh += t.shares
          p.cost += t.shares * t.price + t.fees
          cash -= t.shares * t.price + t.fees
        } else {
          const avg = p.cost / p.sh
          p.sh -= t.shares
          p.cost = avg * p.sh
          cash += t.shares * t.price - t.fees
        }
      }
      for (const [t, p] of Object.entries(m)) {
        expect(after.positions[t].shares).toBeCloseTo(p.sh, 5)
        expect(after.positions[t].cost!).toBeCloseTo(p.cost, 0)
      }
      expect(after.meta.settings!.cash).toBeCloseTo(cash, 1)
      expect(Object.keys(after.transactions)).toHaveLength(parsed.trades.length)
    }
  })

  it('Storno aller Buchungen (neueste zuerst) führt genau zum Anfang zurück', () => {
    const r = rng(7)
    for (let k = 0; k < 300; k++) {
      const db0 = empty(5_000)
      let db = applyOps(db0, planImport(db0, parseImport('trades', randomTrades(r, 1 + Math.floor(r() * 15)))).ops)
      const txs = Object.entries(db.transactions).sort(([, a], [, b]) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0)) as [string, Tx][]
      for (const [id, tx] of txs) db = applyOps(db, reverseTx(db, id, tx))
      expect(Object.keys(db.transactions)).toHaveLength(0)
      for (const p of Object.values(db.positions)) {
        expect(p.shares).toBeCloseTo(0, 6)
        expect(p.cost ?? 0).toBeCloseTo(0, 1)
      }
      expect(db.meta.settings!.cash).toBeCloseTo(5_000, 1)
    }
  })

  it('Storno einer Dividende ist das Gegenstück zur Buchung', () => {
    const r = rng(9)
    for (let k = 0; k < 200; k++) {
      const db0 = empty(1_000)
      const gross = +(r() * 100 + 0.01).toFixed(2)
      const db1 = applyOps(db0, planImport(db0, parseImport('dividenden', `Zahltag;Ticker;Brutto\n2025-06-26;KO;${gross}`)).ops)
      const [id, d] = Object.entries(db1.dividends)[0]
      expect(db1.meta.settings!.cash).toBeCloseTo(1000 + d.net, 6)
      expect(applyOps(db1, reverseDividend(db1, id, d)).meta.settings!.cash).toBeCloseTo(1000, 6)
    }
  })

  it('Wertverlauf endet beim selben Wert wie die Übersicht, Ertrag = Wert − eingesetzt', () => {
    const r = rng(11)
    for (let k = 0; k < 200; k++) {
      const db0 = empty(r() < 0.5 ? null : 2_000)
      const csv = randomTrades(r, 2 + Math.floor(r() * 12))
      const db = applyOps(db0, planImport(db0, parseImport('trades', csv)).ops)
      if (!db0.meta.settings!.cashExcluded) db.transactions.start = { type: 'korrektur', date: '2023-12-01', cashDelta: 0, cashStart: true }
      const px: Record<string, number> = Object.fromEntries(TICKERS.map((t) => [t, +(10 + r() * 400).toFixed(2)]))
      for (const t of TICKERS) db.prices[t] = { close: px[t], prev: px[t], date: '2025-12-31' }
      const days = Array.from({ length: 60 }, (_, i) => day(i * 7))
      const chart: ChartData = { range: 'MAX', kind: 'daily', interval: '1d', at: '', t: days.map((x) => Date.parse(x + 'T21:00:00Z')), d: days, series: Object.fromEntries(TICKERS.map((t) => [t, days.map(() => px[t])])), prev: Object.fromEntries(TICKERS.map((t) => [t, px[t]])), failures: [] }
      const c = compute(db)
      const ps = portfolioSeries(db, timeline(db), chart)!
      expect(ps.value.at(-1)!).toBeCloseTo(c.total, 2)
      // konstante Kurse: Ertrag = heutiger Wert der Papiere − Käufe + Verkäufe
      const flows = Object.values(db.transactions).reduce((s, x) => s - (x.ticker ? x.cashDelta : 0), 0)
      expect(ps.gain).toBeCloseTo(c.sec - flows, 1)
      for (const v of [...ps.twr, ...ps.mwr, ...ps.value]) expect(Number.isFinite(v)).toBe(true)
    }
  })
})

describe('Import-Fuzzing', () => {
  const ALPH = ['a', 'Z', '0', '9', ';', ',', '\t', '\n', '\r\n', '"', "'", '.', '-', '/', '#', ' ', 'Kauf', 'Verkauf', 'VTI', '2025-01-02', '12.5', '1,5', '﻿', 'é', '=1+1', '<b>', '$', '(', ')', '−']
  it('stürzt bei 3000 zufälligen Eingaben nie ab und liefert nur gültige Zeilen', () => {
    const r = rng(1234)
    for (let k = 0; k < 3000; k++) {
      const kind = pick(r, ['trades', 'dividenden', 'bestand'] as ImportKind[])
      const head = r() < 0.7 ? (kind === 'trades' ? 'Datum;Art;Ticker;Stück;Preis;Gebühren\n' : kind === 'dividenden' ? 'Zahltag;Ticker;Brutto;Quellensteuer\n' : 'Ticker;Stück;Einstand\n') : ''
      const body = Array.from({ length: Math.floor(r() * 80) }, () => pick(r, ALPH)).join('')
      const res = parseImport(kind, head + body)
      for (const t of res.trades) {
        expect(/^\d{4}-\d{2}-\d{2}$/.test(t.date)).toBe(true)
        expect(t.shares > 0 && Number.isFinite(t.shares)).toBe(true)
        expect(t.price > 0 && Number.isFinite(t.price)).toBe(true)
        expect(t.fees >= 0).toBe(true)
        expect(/^[A-Z0-9][A-Z0-9.\-^=]{0,11}$/.test(t.ticker)).toBe(true)
      }
      for (const d of res.dividends) expect(d.gross > 0 && Number.isFinite(d.gross)).toBe(true)
      for (const p of res.positions) expect(p.shares >= 0 && Number.isFinite(p.shares)).toBe(true)
      // planen darf ebenfalls nie abstürzen
      expect(() => planImport(empty(0), res)).not.toThrow()
    }
  })
})

describe('Zahlen: Anzeige und Eingabe passen zusammen', () => {
  it('was angezeigt wird, liest das Eingabefeld wieder als dieselbe Zahl', () => {
    const r = rng(5)
    for (let k = 0; k < 5000; k++) {
      const v = (r() - 0.5) * 10 ** Math.floor(r() * 9)
      expect(parseNum(usdRaw(v))).toBeCloseTo(Math.round(v * 100) / 100, 2)
      expect(parseNum(sUsdRaw(v))).toBeCloseTo(Math.round(v * 100) / 100, 2)
      expect(parseNum(qty(v))).toBeCloseTo(Math.round(v * 1e4) / 1e4, 4)
      expect(pct(v)).toMatch(/^([+−]?\d+\.\d %)$/)
    }
  })
})
