/** Beschädigte Daten (z. B. aus einer von Hand geänderten Sicherungskopie) dürfen die Berechnungen nicht zum Absturz bringen. */
import { describe, expect, it } from 'vitest'
import { alerts, compute, divAnnual, projectedDividends, watchRows, yearStats } from './calc'
import { applyCategories } from './buckets'
import { portfolioSeries, timeline } from './history'
import { sanitizeDb } from './sanitize'
import type { ChartData, DB } from './types'

/** alles durchrechnen, was die Ansichten brauchen */
function runAll(db: DB) {
  applyCategories(db.meta.settings ?? { cash: 0 })
  const c = compute(db)
  watchRows(db)
  alerts(db, c, '2026-11-14')
  divAnnual(db)
  projectedDividends(db, '2026-11-14')
  yearStats(db, '2026')
  const tl = timeline(db)
  const days = ['2025-01-02', '2025-06-02', '2026-11-13']
  const tickers = Object.keys(db.positions)
  const chart: ChartData = { range: 'MAX', kind: 'daily', interval: '1d', at: '', t: days.map((d) => Date.parse(d)), d: days, series: Object.fromEntries(tickers.map((t) => [t, [10, 11, 12]])), prev: {}, failures: [] }
  const ps = portfolioSeries(db, tl, chart)
  return { c, ps }
}

const fine = (x: unknown) => typeof x === 'number' && Number.isFinite(x)

describe('Daten bereinigen', () => {
  it('lässt gültige Einträge unverändert', () => {
    const raw = {
      positions: { VTI: { ticker: 'VTI', name: 'Vanguard', shares: 2, bucket: 'etf', cost: 500, note: 'x' } },
      transactions: { a: { type: 'kauf', date: '2025-01-02', ticker: 'VTI', shares: 2, price: 250, fees: 0, cashDelta: -500 } },
      dividends: { d: { ticker: 'VTI', exDate: null, payDate: '2025-03-28', perShare: 1, shares: 2, gross: 2, tax: 0.3, net: 1.7, status: 'erhalten' } },
      meta: { settings: { cash: 100, withholding: 0.15, categories: [{ id: 'etf', name: 'ETFs' }], targets: { etf: 100 }, caps: ['etf'], fx: 'CHF', rules: [{ title: 'R', detail: 'd' }] } },
    }
    const s = sanitizeDb(structuredClone(raw))
    expect(s.positions).toEqual(raw.positions)
    expect(s.transactions).toEqual(raw.transactions)
    expect(s.dividends).toEqual(raw.dividends)
    expect(s.meta.settings).toEqual(raw.meta.settings)
    expect(s.watchlist).toEqual({})
  })

  it('macht aus Zahlen als Text Zahlen und lässt Unbrauchbares weg', () => {
    const s = sanitizeDb({
      positions: { X: { ticker: 'X', shares: 'abc' }, Y: null, Z: { shares: '3', cost: 'teuer' }, A: [1] },
      transactions: { a: { note: 'ohne alles' }, b: { type: 'kauf', ticker: 'VTI', shares: '1', price: 'x', date: '2025-01-02', cashDelta: 'y' }, c: { type: 'zauber', date: '2025-02-02' }, d: { type: 'kauf', date: '2025-01-02', cashDelta: -5 } },
      dividends: { a: { ticker: 'VTI', gross: null, payDate: '2025-01-01' }, b: { ticker: 'KO', payDate: '2025-04-01', gross: '10', status: 'komisch' } },
      snapshots: { '2025-01-02': { total: 'x' }, '2025-02-03': { total: '1000' }, kaputt: null },
      watchlist: { W: { limit: 'tief' }, Z: null },
      events: { e: { title: null, date: 'bald' }, f: { title: 5, date: '2026-12-01' } },
      pots: { p: { label: null, budget: 'x' } },
      meta: { settings: { cash: 'viel', categories: 'foo', targets: 5, caps: 'etf', rules: 'keine', fx: 'XYZ' } },
      market: 'kaputt',
    })
    expect(Object.keys(s.positions)).toEqual(['Z'])
    expect(s.positions.Z).toMatchObject({ ticker: 'Z', name: 'Z', shares: 3, cost: null, bucket: '' })
    expect(s.transactions).toEqual({ b: { type: 'kauf', ticker: 'VTI', shares: 1, date: '2025-01-02', cashDelta: 0 } })
    expect(s.dividends.b).toMatchObject({ gross: 10, tax: 0, net: 10, status: 'erhalten' })
    expect(Object.keys(s.dividends)).toEqual(['b'])
    expect(s.snapshots).toEqual({ '2025-02-03': { total: 1000, date: '2025-02-03' } })
    expect(s.watchlist.W).toMatchObject({ ticker: 'W', name: 'W', limit: null })
    expect(s.events).toEqual({ f: { title: '5', date: '2026-12-01' } })
    expect(s.pots.p).toMatchObject({ label: 'p', budget: 0, used: 0 })
    expect(s.meta.settings).toEqual({ cash: 0 })
    expect(s.market).toEqual({})
  })

  it('übersteht 2000 zufällig beschädigte Datenbanken ohne Absturz und mit endlichen Summen', () => {
    let seed = 99
    const r = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff)
    const junk = [null, undefined, 'abc', '12', '', 0, -1, 1e308, NaN, true, [], [1, 'x'], {}, { a: 1 }, '2025-01-02', 'kauf', 'VTI']
    const j = () => junk[Math.floor(r() * junk.length)]
    const entry = (keys: string[]) => (r() < 0.1 ? j() : Object.fromEntries(keys.map((k) => [k, r() < 0.6 ? undefined : j()]).filter(([, v]) => v !== undefined)))
    const many = (keys: string[], good: () => object) => (r() < 0.1 ? j() : Object.fromEntries(Array.from({ length: Math.floor(r() * 5) }, (_, i) => [String.fromCharCode(65 + i), r() < 0.5 ? good() : entry(keys)])))
    for (let k = 0; k < 2000; k++) {
      const raw = {
        positions: many(['ticker', 'name', 'shares', 'bucket', 'cost'], () => ({ ticker: 'VTI', name: 'V', shares: 1 + r() * 5, bucket: 'etf', cost: 100 })),
        transactions: many(['type', 'date', 'ticker', 'shares', 'price', 'fees', 'cashDelta', 'realized'], () => ({ type: 'kauf', date: '2025-01-02', ticker: 'VTI', shares: 1, price: 100, fees: 0, cashDelta: -100 })),
        dividends: many(['ticker', 'payDate', 'gross', 'tax', 'net', 'status', 'exDate', 'shares'], () => ({ ticker: 'VTI', payDate: '2025-06-01', gross: 2, tax: 0.3, net: 1.7, status: 'erhalten', exDate: null, perShare: null, shares: null })),
        snapshots: many(['date', 'total', 'cash'], () => ({ date: '2025-02-01', total: 1000 })),
        watchlist: many(['ticker', 'limit', 'price', 'name'], () => ({ ticker: 'KO', name: 'KO', price: 60, limit: 55, limitCautious: null, conditionMet: null })),
        events: many(['date', 'title', 'done'], () => ({ date: '2026-12-01', title: 'T' })),
        pots: many(['label', 'budget', 'used'], () => ({ label: 'P', budget: 100, used: 0 })),
        log: many(['date', 'title', 'text'], () => ({ date: '2026-01-01', title: 'L' })),
        prices: many(['close', 'prev', 'date', 'divAnnual', 'divMonths'], () => ({ close: 100, prev: 99, date: '2026-11-13' })),
        meta: r() < 0.1 ? j() : { settings: r() < 0.2 ? j() : entry(['cash', 'cashExcluded', 'categories', 'targets', 'caps', 'rules', 'fx', 'withholding', 'bucketNames', 'openItems']) },
        market: r() < 0.5 ? j() : { latest: r() < 0.3 ? j() : { quotes: many(['close', 'prev'], () => ({ close: 50, prev: 49 })), usdchf: j() } },
      }
      const db = sanitizeDb(raw)
      const { c } = runAll(db)
      expect(fine(c.total)).toBe(true)
      expect(fine(c.sec)).toBe(true)
    }
  })
})

describe('Fehlermeldungen der Datenbank', async () => {
  const { writeError } = await import('./cloud')
  it('übersetzt Netzwerk-, Rechte-, Anmelde- und Grössenfehler', () => {
    expect(writeError(new Error('Request failed with error: Failed to fetch')).message).toMatch(/Keine Verbindung/)
    expect(writeError({ code: 'unavailable', message: 'x' }).message).toMatch(/Keine Verbindung/)
    expect(writeError({ code: 'permission-denied', message: 'x' }).message).toMatch(/Speichern nicht erlaubt/)
    expect(writeError({ code: 'unauthenticated', message: 'x' }).message).toMatch(/Anmeldung ist abgelaufen/)
    expect(writeError(new Error('Document exceeds the maximum allowed size')).message).toMatch(/höchstens 1 MB/)
    expect(writeError(new Error('etwas anderes')).message).toBe('etwas anderes')
  })
})
