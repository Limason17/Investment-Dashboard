import { describe, expect, it } from 'vitest'
import { date, detectKind, num, parseImport, template, templateFile } from './bulk'
import { planImport } from './bulk-plan'
import { projectedDividends } from './calc'
import { cur, setDisplayCurrency, sUsd, usd, usdRaw } from './format'
import { closeUpdates } from './closes'
import { portfolioSeries, timeline } from './history'
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

describe('Import nach erfasstem Cash-Stand', () => {
  it('ändert den Cash-Stand nur mit Einträgen nach dem Saldo-Datum', () => {
    const db = empty()
    db.transactions.c = { type: 'korrektur', date: '2026-11-13', cashDelta: 1000, cashStart: true }
    const p = planImport(db, parseImport('dividenden', 'Zahltag;Ticker;Brutto;Steuer\n2025-03-26;VTI;10;0\n2026-11-20;VTI;5;0'))
    expect(p.cashBefore).toBe(10)
    expect(p.cashDelta).toBe(5)
    expect(applyOps(db, p.ops).meta.settings!.cash).toBe(1005)
  })
})

describe('Dividenden-Schätzung', () => {
  it('schätzt die nächsten Monate aus Monaten und letztem Betrag, ohne erfasste doppelt zu zählen', () => {
    const db = empty()
    db.positions.VTI = { ticker: 'VTI', name: 'VTI', shares: 10, bucket: 'etf', cost: 1000 }
    db.prices.VTI = { close: 300, prev: 299, date: '2026-11-12', divAnnual: 4, divMonths: [3, 6, 9, 12], divLast: 1 }
    const all = projectedDividends(db, '2026-11-13')
    expect(all.map((d) => d.payDate.slice(0, 7))).toEqual(['2026-12', '2027-03'])
    expect(all[0]).toMatchObject({ gross: 10, tax: 1.5, net: 8.5, estimate: true })
    db.dividends.x = { ticker: 'VTI', exDate: null, payDate: '2026-12-29', perShare: 1, shares: 10, gross: 10, tax: 1.5, net: 8.5, status: 'erwartet' }
    expect(projectedDividends(db, '2026-11-13').map((d) => d.payDate.slice(0, 7))).toEqual(['2027-03'])
  })

  it('nimmt den Betrag aus demselben Monat des Vorjahres, wenn bekannt', () => {
    const db = empty()
    db.positions.VXUS = { ticker: 'VXUS', name: 'VXUS', shares: 10, bucket: 'etf', cost: 600 }
    db.prices.VXUS = { close: 80, prev: 80, date: '2026-11-12', divMonths: [3, 12], divLast: 0.2, divByMonth: { 3: 0.2, 12: 0.9 } }
    expect(projectedDividends(db, '2026-11-13').map((d) => d.gross)).toEqual([9, 2])
  })
})

describe('Anzeigewährung', () => {
  it('rechnet Anzeigen um, Eingaben nicht', () => {
    setDisplayCurrency('CHF', 0.8)
    expect([cur(), usd(100), sUsd(-50), usdRaw(100)]).toEqual(['CHF', '80.00', '−40.00', '100.00'])
    setDisplayCurrency('USD', 1)
    expect(usd(100)).toBe('100.00')
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
  it('zählt den ersten Cash-Stand nicht als Einzahlung, Käufe davor aber als Geld von aussen', () => {
    const db = empty()
    db.transactions.k = { type: 'kauf', date: '2025-01-02', ticker: 'VTI', shares: 1, price: 100, cashDelta: -100 }
    db.transactions.c = { type: 'korrektur', date: '2025-06-01', cashDelta: 2500 }
    const tl = timeline(db)
    expect(tl.cashStart).toBe('2025-06-01')
    expect(tl.external).toEqual([{ date: '2025-01-02', amount: 100 }])
  })
  it('zählt Einzahlungen nach dem Start weiterhin als Zufluss', () => {
    const db = empty()
    db.transactions.c = { type: 'korrektur', date: '2025-06-01', cashDelta: 2500, cashStart: true }
    db.transactions.e = { type: 'einzahlung', date: '2025-07-01', cashDelta: 500 }
    expect(timeline(db).external).toEqual([{ date: '2025-07-01', amount: 500 }])
  })
})

describe('Wertverlauf gegen echte Zahlen', () => {
  const days = ['2025-01-02', '2025-01-03', '2025-01-06']
  const chart = (closes: number[]) => ({ range: 'MAX' as const, kind: 'daily' as const, interval: '1d', at: '', t: days.map((d) => Date.parse(d + 'T21:00:00Z')), d: days, series: { VTI: closes }, prev: { VTI: closes[0] }, failures: [] })

  it('ohne Cash: Wert = Stück × Kurs, eingesetzt = Käufe', () => {
    const db = empty()
    db.meta.settings = { cash: 0, cashExcluded: true }
    db.positions.VTI = { ticker: 'VTI', name: 'VTI', shares: 10, bucket: 'etf', cost: 1000 }
    db.transactions.k = { type: 'kauf', date: days[0], ticker: 'VTI', shares: 10, price: 100, cashDelta: -1000 }
    const ps = portfolioSeries(db, timeline(db), chart([100, 110, 120]))!
    expect(ps.value).toEqual([1000, 1100, 1200])
    expect(ps.invested).toEqual([1000, 1000, 1000])
    expect(ps.gain).toBeCloseTo(200)
    expect(ps.twr.at(-1)).toBeCloseTo(0.2)
    expect(ps.mwr.at(-1)).toBeCloseTo(0.2) // seit Beginn: Ertrag / eingesetztes Geld
  })

  it('Cash erst später erfasst: zählt von Anfang an mit, Gewinn nur aus Kursen', () => {
    const db = empty()
    db.meta.settings = { cash: 500, cashExcluded: false }
    db.positions.VTI = { ticker: 'VTI', name: 'VTI', shares: 10, bucket: 'etf', cost: 1000 }
    db.transactions.k = { type: 'kauf', date: days[0], ticker: 'VTI', shares: 10, price: 100, cashDelta: -1000 }
    db.transactions.c = { type: 'korrektur', date: days[1], cashDelta: 500, cashStart: true }
    const ps = portfolioSeries(db, timeline(db), chart([100, 110, 120]))!
    expect(ps.value).toEqual([1500, 1600, 1700]) // Gesamtwert mit Cash, wie oben angezeigt
    expect(ps.invested).toEqual([1500, 1500, 1500])
    expect(ps.gain).toBeCloseTo(200) // nur der Kursgewinn, nicht das Cash
  })

  it('Verkauf mit Cash: Erlös bleibt im Depot, kein Zu- oder Abfluss', () => {
    const db = empty()
    db.meta.settings = { cash: 1100, cashExcluded: false }
    db.positions.VTI = { ticker: 'VTI', name: 'VTI', shares: 0, bucket: 'etf', cost: 0 }
    db.transactions.e = { type: 'einzahlung', date: days[0], cashDelta: 1000 }
    db.transactions.k = { type: 'kauf', date: days[0], ticker: 'VTI', shares: 10, price: 100, cashDelta: -1000 }
    db.transactions.v = { type: 'verkauf', date: days[2], ticker: 'VTI', shares: 10, price: 110, cashDelta: 1100 }
    const ps = portfolioSeries(db, timeline(db), chart([100, 105, 110]))!
    expect(ps.value).toEqual([1000, 1050, 1100])
    expect(ps.invested).toEqual([1000, 1000, 1000])
    expect(ps.gain).toBeCloseTo(100)
  })
})

describe('Rendite seit Beginn', () => {
  it('teilt den Ertrag durch das insgesamt eingesetzte Geld, auch bei späteren Käufen', () => {
    const db = empty()
    db.meta.settings = { cash: 0, cashExcluded: true }
    db.positions.VTI = { ticker: 'VTI', name: 'VTI', shares: 20, bucket: 'etf', cost: 3100 }
    db.transactions.a = { type: 'kauf', date: '2025-01-02', ticker: 'VTI', shares: 10, price: 100, cashDelta: -1000 }
    db.transactions.b = { type: 'kauf', date: '2025-01-06', ticker: 'VTI', shares: 10, price: 210, cashDelta: -2100 }
    const ch = { range: 'MAX' as const, kind: 'daily' as const, interval: '1d', at: '', t: ['2025-01-02', '2025-01-03', '2025-01-06'].map((d) => Date.parse(d + 'T21:00:00Z')), d: ['2025-01-02', '2025-01-03', '2025-01-06'], series: { VTI: [100, 200, 210] }, prev: { VTI: 100 }, failures: [] }
    const ps = portfolioSeries(db, timeline(db), ch)!
    expect(ps.gain).toBeCloseTo(1100)
    expect(ps.mwr.at(-1)).toBeCloseTo(1100 / 3100)
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
