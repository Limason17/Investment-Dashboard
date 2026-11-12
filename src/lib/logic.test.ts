import { describe, expect, it } from 'vitest'
import { date, detectKind, num, parseImport, template, templateFile } from './bulk'
import { planImport } from './bulk-plan'
import { closeUpdates } from './closes'
import { timeline } from './history'
import { aggregate, newPortfolioId, portfolioList } from './portfolios'
import { applyOps, reverseDividend, reverseTx } from './reverse'
import type { DB, Tx } from './types'

const empty = (): DB => ({ positions: {}, prices: {}, watchlist: {}, pots: {}, events: {}, log: {}, transactions: {}, dividends: {}, snapshots: {}, meta: { settings: { cash: 1000, cashExcluded: false, withholding: 0.15 } }, market: {} })

describe('Zahlen und Datum', () => {
  it('liest verschiedene Zahlformate', () => {
    expect(num("1'234.50")).toBe(1234.5)
    expect(num('1.234,50')).toBe(1234.5)
    expect(num('248,30')).toBe(248.3)
    expect(num('$1,234.56', true)).toBe(1234.56)
    expect(num('(12.00)')).toBe(-12)
    expect(num('')).toBeNull()
    expect(num('abc')).toBeNull()
  })
  it('liest verschiedene Datumsformate', () => {
    expect(date('2025-03-14')).toBe('2025-03-14')
    expect(date('14.03.2025')).toBe('2025-03-14')
    expect(date('3.4.25')).toBe('2025-04-03')
    expect(date('06/23/2026 as of 06/20/2026')).toBe('2026-06-23')
    expect(date('31.02.2025')).toBeNull()
    expect(date('2025-13-01')).toBeNull()
  })
})

describe('Import lesen', () => {
  it('ignoriert Kommentare und Beispiele der Vorlage', () => {
    const r = parseImport('trades', template('trades'))
    expect(r.trades).toHaveLength(0)
    expect(r.errors).toHaveLength(0)
  })
  it('liest Zeilen mit Semikolon unter einer Kopfzeile mit Tabulator', () => {
    const r = parseImport('trades', template('trades') + '2024-03-12;Kauf;VTI;6;248,30;0;etf;Start\n2025-08-11;Verkauf;NVDA;4;182,60;1;;')
    expect(r.errors).toEqual([])
    expect(r.trades.map((t) => [t.ticker, t.type, t.shares, t.price])).toEqual([['VTI', 'kauf', 6, 248.3], ['NVDA', 'verkauf', 4, 182.6]])
  })
  it('liest die Vorlagendatei mit BOM und Semikolon', () => {
    const r = parseImport('trades', templateFile('trades') + '14.03.2025;Kauf;MSFT;2;410,10;1;aktien;\r\n')
    expect(r.trades).toHaveLength(1)
    expect(r.trades[0]).toMatchObject({ date: '2025-03-14', ticker: 'MSFT', fees: 1, bucket: 'aktien' })
  })
  it('meldet Fehler mit Zeilennummer', () => {
    const r = parseImport('trades', 'Datum;Art;Ticker;Stück;Preis\n2025-01-01;Kauf;;1;10\n2025-01-02;Tausch;VTI;1;10\n2025-01-03;Kauf;VTI;-1;10')
    expect(r.errors.map((e) => e.line)).toEqual([2, 3, 4])
    expect(r.errors[0].msg).toBe('Ticker fehlt')
  })
  it('erkennt den Schwab-Export mit Quellensteuer', () => {
    const csv = [
      '"Transactions for account XXXX as of 11/11/2026"',
      '"Date","Action","Symbol","Description","Quantity","Price","Fees & Comm","Amount"',
      '"11/03/2026","Buy","MSFT","MICROSOFT","2","$410.50","","-$821.00"',
      '"10/30/2026","Qualified Dividend","VTI","VANGUARD","","","","$4.12"',
      '"10/30/2026","NRA Tax Adj","VTI","VANGUARD","","","","-$0.62"',
      '"10/28/2026","MoneyLink Transfer","","","","","","$1,000.00"',
    ].join('\n')
    expect(detectKind(csv)).toBe('trades')
    const r = parseImport('trades', csv)
    expect(r.format).toBe('schwab')
    expect(r.trades).toHaveLength(1)
    expect(r.dividends).toEqual([expect.objectContaining({ ticker: 'VTI', gross: 4.12, tax: 0.62, payDate: '2026-10-30' })])
    expect(r.skipped).toHaveLength(1)
  })
  it('erkennt die Art an der Kopfzeile', () => {
    expect(detectKind(template('dividenden'))).toBe('dividenden')
    expect(detectKind(template('bestand'))).toBe('bestand')
  })
})

describe('Import planen', () => {
  it('bucht Käufe und Verkäufe mit Einstand, Gewinn und Cash', () => {
    const db = empty()
    const p = planImport(db, parseImport('trades', 'Datum;Art;Ticker;Stück;Preis;Gebühren\n2025-01-02;Kauf;VTI;10;100;0\n2025-02-02;Kauf;VTI;10;120;2\n2025-03-02;Verkauf;VTI;5;150;1'))
    const after = applyOps(db, p.ops)
    expect(after.positions.VTI.shares).toBe(15)
    // Einstand 2202, Schnitt 110.10; nach Verkauf von 5: 1651.5
    expect(after.positions.VTI.cost).toBe(1651.5)
    const sale = Object.values(after.transactions).find((t) => t.type === 'verkauf')!
    expect(sale.realized).toBe(198.5) // 749 − 5 × 110.10
    expect(after.meta.settings!.cash).toBe(1000 - 1000 - 1202 + 749)
  })
  it('lehnt Verkäufe ohne Bestand ab', () => {
    const p = planImport(empty(), parseImport('trades', 'Datum;Art;Ticker;Stück;Preis\n2025-01-02;Verkauf;VTI;1;100'))
    expect(p.items[0].state).toBe('fehler')
  })
  it('überspringt bereits erfasste Buchungen', () => {
    const db = empty()
    const text = 'Datum;Art;Ticker;Stück;Preis\n2025-01-02;Kauf;VTI;1;100'
    const once = applyOps(db, planImport(db, parseImport('trades', text)).ops)
    const again = planImport(once, parseImport('trades', text))
    expect(again.items[0].state).toBe('doppelt')
    expect(again.count).toBe(0)
  })
  it('bestätigt erwartete Dividenden statt sie doppelt zu buchen', () => {
    const db = empty()
    db.dividends.x = { ticker: 'VTI', exDate: null, payDate: '2025-03-28', perShare: 1, shares: 2, gross: 2, tax: 0.3, net: 1.7, status: 'erwartet' }
    const p = planImport(db, parseImport('dividenden', 'Zahltag;Ticker;Brutto\n2025-03-27;VTI;2.10'))
    const after = applyOps(db, p.ops)
    expect(Object.keys(after.dividends)).toEqual(['x'])
    expect(after.dividends.x).toMatchObject({ status: 'erhalten', gross: 2.1 })
  })
})

describe('Storno', () => {
  it('setzt Kauf vollständig zurück', () => {
    const db = empty()
    const p = planImport(db, parseImport('trades', 'Datum;Art;Ticker;Stück;Preis;Gebühren\n2025-01-02;Kauf;VTI;10;100;0\n2025-02-02;Kauf;VTI;5;120;1'))
    const after = applyOps(db, p.ops)
    const [id, tx] = Object.entries(after.transactions).find(([, t]) => t.date === '2025-02-02')! as [string, Tx]
    const back = applyOps(after, reverseTx(after, id, tx))
    expect(back.positions.VTI).toMatchObject({ shares: 10, cost: 1000 })
    expect(back.meta.settings!.cash).toBe(0)
  })
  it('setzt Verkauf mit Einstand zurück', () => {
    const db = empty()
    const after = applyOps(db, planImport(db, parseImport('trades', 'Datum;Art;Ticker;Stück;Preis\n2025-01-02;Kauf;VTI;10;100\n2025-03-02;Verkauf;VTI;4;150')).ops)
    const [id, tx] = Object.entries(after.transactions).find(([, t]) => t.type === 'verkauf')! as [string, Tx]
    const back = applyOps(after, reverseTx(after, id, tx))
    expect(back.positions.VTI).toMatchObject({ shares: 10, cost: 1000 })
  })
  it('zieht eine erhaltene Dividende vom Cash ab', () => {
    const db = empty()
    db.dividends.d = { ticker: 'VTI', exDate: null, payDate: '2025-03-28', perShare: null, shares: null, gross: 10, tax: 1.5, net: 8.5, status: 'erhalten' }
    const back = applyOps(db, reverseDividend(db, 'd', db.dividends.d))
    expect(back.dividends.d).toBeUndefined()
    expect(back.meta.settings!.cash).toBe(991.5)
  })
})

describe('Wertverlauf', () => {
  it('zählt den ersten Cash-Stand nicht als Einzahlung', () => {
    const db = empty()
    db.transactions.k = { type: 'kauf', date: '2025-01-02', ticker: 'VTI', shares: 1, price: 100, cashDelta: -100 }
    db.transactions.c = { type: 'korrektur', date: '2025-06-01', cashDelta: 2500 }
    const tl = timeline(db)
    expect(tl.cashStart).toBe('2025-06-01')
    expect(tl.external).toEqual([])
  })
  it('zählt Einzahlungen nach dem Start weiterhin als Zufluss', () => {
    const db = empty()
    db.transactions.c = { type: 'korrektur', date: '2025-06-01', cashDelta: 2500, cashStart: true }
    db.transactions.e = { type: 'einzahlung', date: '2025-07-01', cashDelta: 500 }
    expect(timeline(db).external).toEqual([{ date: '2025-07-01', amount: 500 }])
  })
})

describe('Schlusskurse', () => {
  it('schreibt Schlusskurs und Tageswert nur bei vollständigen Kursen', () => {
    const q = { VTI: { regular: 300, regularPrev: 298, regularDate: '2026-11-11' } }
    const u = closeUpdates({ VTI: { shares: 2, cost: 500 } }, {}, {}, { cash: 100 }, q)!
    expect(u.prices.VTI).toMatchObject({ close: 300, date: '2026-11-11' })
    expect(u.snapshot).toMatchObject({ date: '2026-11-11', total: 700, securities: 600, invested: 500 })
    expect(closeUpdates({ VTI: { shares: 2 } }, { VTI: { date: '2026-11-11', close: 300 } }, {}, undefined, q)).toBeNull()
  })
})

describe('Portfolios', () => {
  it('führt eine Liste mit Hauptportfolio', () => {
    expect(portfolioList(null).map((p) => p.id)).toEqual(['main'])
    expect(portfolioList({ b: { name: 'B', order: 2 }, a: { name: 'A', order: 1 }, 'BAD ID': { name: 'x', order: 0 } }).map((p) => p.id)).toEqual(['main', 'a', 'b'])
  })
  it('bildet gültige, eindeutige IDs', () => {
    const list = portfolioList({ 'saeule-3a': { name: 'Säule 3a', order: 1 } })
    expect(newPortfolioId('Säule 3a', list)).toBe('saeule-3a-2')
    expect(newPortfolioId('Crème Brûlée!', list)).toBe('creme-brulee')
    expect(newPortfolioId('all', list)).toBe('all-2')
  })
  it('zählt Positionen und Cash in der Gesamtansicht zusammen', () => {
    const a = empty(), b = empty()
    a.positions.VTI = { ticker: 'VTI', name: 'VTI', shares: 3, bucket: 'etf', cost: 900 }
    b.positions.VTI = { ticker: 'VTI', name: 'VTI', shares: 2, bucket: 'etf', cost: 620 }
    b.meta.settings = { cash: 50, cashExcluded: false }
    const all = aggregate([{ info: { id: 'main', name: 'A', order: 0 }, db: a }, { info: { id: 'b', name: 'B', order: 1 }, db: b }])
    expect(all.positions.VTI).toMatchObject({ shares: 5, cost: 1520 })
    expect(all.meta.settings).toMatchObject({ cash: 1050, cashExcluded: false })
  })
})
