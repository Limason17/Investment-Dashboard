import { describe, expect, it } from 'vitest'
import { date, detectKind, num, parseImport, template, templateFile } from './bulk'
import { clearAreas, planImport } from './bulk-plan'
import { projectedDividends } from './calc'
import { cur, setDisplayCurrency, sUsd, usd, usdRaw } from './format'
import { closeUpdates } from './closes'
import { portfolioSeries, timeline } from './history'
import { aggregate, newPortfolioId, portfolioList } from './portfolios'
import { applyOps, emptyDepot, replayOps, reverseDividend, reverseTx } from './reverse'
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
    expect(r.skipped).toHaveLength(0)
    expect(r.cash).toEqual([expect.objectContaining({ date: '2026-10-28', amount: 1000 })])
  })
  it('liest den Schwab-Kontoauszug mit Type und Description', () => {
    // Erfundene Zeilen im Aufbau des Kontoauszugs (neueste zuerst).
    const csv = [
      'Date, Type, Description, Ref Num, Misc Fees, Commissions, Amount, Balance',
      '03.11.2026 18:00,TRD,SOLD -2 KO @70.50,11,-0.01,0.00,$141.00,"$1,000.00"',
      '03.11.2026 15:00,TRD,BOT +5 KO @68.00,12,-,0.00,($340.00),"$860.00"',
      '02.11.2026 10:15,JRN,THE COCA-COLA COMPANY -0.30 US$,13,-,0.00,($0.30),"$1,200.00"',
      '02.11.2026 10:15,DOI,Qualified Dividend - THE COCA-COLA COMPANY 2.00 US$,14,-,0.00,$2.00,"$1,200.30"',
      '01.11.2026 16:00,TRD,SOLD -1 STRADDLE KO 100 20 NOV 26 70 CALL/PUT @1.95 CBOE,15,-0.02,-1.30,$195.00,"$1,198.30"',
      '01.11.2026 15:00,TRD,BOT +3 123456AB9 @10.00,16,-,0.00,($30.00),"$1,003.30"',
      '31.10.2026 08:00,RAD,SOME TRUSTXXXREVERSE SPLIT EFF -3.0 123456AB9,17,-,0.00,$0.00,"$1,033.30"',
      '31.10.2026 08:00,RAD,Reverse Split 1.0 ABCD,18,-,0.00,$0.00,"$1,033.30"',
      '30.10.2026 15:00,WIN,WIRED FUNDS RECEIVED 1000.0 US$,19,-,0.00,"$1,000.00","$1,033.30"',
      '29.10.2026 02:00,DOI,SCHWAB1 INT 09/28-10/28 0.17 US$,20,-,0.00,$0.17,"$33.30"',
      '28.10.2026 15:00,TRD,BOT +3 ABCD @11.00,21,-,0.00,($33.00),"$33.13"',
    ].join('\n')
    const r = parseImport('trades', csv)
    expect(r.format).toBe('schwab')
    expect(r.errors).toEqual([])
    // Optionen, Zins und Einzahlung werden übersprungen
    expect(r.skipped.map((s) => s.line)).toEqual([6, 11])
    expect(r.cash).toEqual([expect.objectContaining({ line: 10, date: '2026-10-30', amount: 1000 })])
    // Wertpapiernummer aus dem Reverse Split wird zum Ticker
    expect(r.trades.map((t) => [t.type, t.ticker, t.shares, t.price, t.fees])).toEqual([
      ['verkauf', 'KO', 2, 70.5, 0.01],
      ['kauf', 'KO', 5, 68, 0],
      ['kauf', 'ABCD', 3, 10, 0],
      ['kauf', 'ABCD', 3, 11, 0],
    ])
    expect(r.splits).toEqual([expect.objectContaining({ ticker: 'ABCD', shares: -2, date: '2026-10-31' })])
    expect(r.dividends).toEqual([expect.objectContaining({ ticker: '', name: 'THE COCA-COLA COMPANY', gross: 2, tax: 0.3, payDate: '2026-11-02' })])
    // Planen: Dividende über den Namen, Kauf vor Verkauf am selben Tag (Uhrzeit)
    const db = empty()
    const p = planImport(db, r, { KO: 'The Coca-Cola Company', PEP: 'PepsiCo, Inc.' })
    expect(p.items.filter((i) => i.state === 'fehler')).toEqual([])
    const after = applyOps(db, p.ops)
    expect(after.positions.KO.shares).toBe(3)
    expect(after.positions.ABCD.shares).toBe(4)
    expect(Object.values(after.dividends)[0]).toMatchObject({ ticker: 'KO', net: 1.7 })
  })
  it('ordnet Titelnamen nur eindeutig einem Ticker zu', async () => {
    const { tickerForName } = await import('./bulk')
    const names = { VTI: 'Vanguard Total Stock Market Index Fund ETF Shares', VXUS: 'Vanguard Total International Stock Index Fund ETF Shares', VTV: 'Vanguard Value Index Fund ETF Shares', UHS: 'Universal Health Services, Inc.' }
    expect(tickerForName('VANGUARD MORNINGSTAR TOTAL STOCK MARKET ETF', names)).toBe('VTI')
    expect(tickerForName('VANGUARD TOTAL INTERNATIONAL STOCK INDEX FUND ETF SHARES', names)).toBe('VXUS')
    expect(tickerForName('VANGUARD MORNINGSTAR VALUE ETF', names)).toBe('VTV')
    expect(tickerForName('UNIVERSAL HEALTH SVCS INCLASS B', names)).toBe('UHS')
    expect(tickerForName('APPLE INC', names)).toBeNull()
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
  it('merkt sich neue Titel ohne Kategorie, damit ETFs später zu «ETFs» kommen', () => {
    const db = empty()
    const after = applyOps(db, planImport(db, parseImport('trades', 'Datum;Art;Ticker;Stück;Preis;Gebühren;Kategorie\n2025-01-02;Kauf;VTI;1;100;0;\n2025-01-02;Kauf;MSFT;1;100;0;aktien')).ops)
    expect(after.positions.VTI.catAuto).toBe(true)
    expect(after.positions.MSFT.catAuto).toBeUndefined()
  })
})

describe('Import nach erfasstem Cash-Stand', () => {
  it('ändert den Cash-Stand nur mit Einträgen nach dem Saldo-Datum', () => {
    const db = empty()
    db.transactions.c = { type: 'korrektur', date: '2026-11-01', cashDelta: 1000, cashStart: true }
    const p = planImport(db, parseImport('dividenden', 'Zahltag;Ticker;Brutto;Steuer\n2025-03-26;VTI;10;0\n2026-11-10;VTI;5;0'))
    expect(p.cashBefore).toBe(10)
    expect(p.cashDelta).toBe(5)
    expect(applyOps(db, p.ops).meta.settings!.cash).toBe(1005)
  })
})

describe('Bereiche ersetzen', () => {
  const history = 'Datum;Art;Ticker;Stück;Preis;Gebühren\n2025-01-02;Kauf;VTI;10;100;0\n2025-02-02;Kauf;VTI;10;120;2\n2025-03-02;Verkauf;VTI;5;150;1'
  const divs = 'Zahltag;Ticker;Brutto;Steuer\n2025-03-26;VTI;10;1.5'
  it('zählt einen erneut importierten Verlauf nicht doppelt ins Cash', () => {
    const db = empty()
    db.transactions.e = { type: 'einzahlung', date: '2024-12-30', cashDelta: 500 }
    const once = applyOps(db, planImport(db, parseImport('trades', history)).ops)
    const withDiv = applyOps(once, planImport(once, parseImport('dividenden', divs)).ops)
    const cash = withDiv.meta.settings!.cash
    const t = clearAreas(withDiv, ['positions', 'transactions', 'prices', 'snapshots'])
    const again = applyOps(withDiv, [...t.ops, ...planImport(t.base, parseImport('trades', history)).ops])
    expect(again.meta.settings!.cash).toBe(cash)
    expect(again.positions.VTI).toMatchObject({ shares: 15, cost: 1651.5 })
    // Einzahlung bleibt, Käufe und Verkäufe sind nicht doppelt
    expect(again.transactions.e).toBeDefined()
    expect(Object.values(again.transactions).filter((x) => x.type === 'kauf')).toHaveLength(2)
    const d = clearAreas(again, ['dividends'])
    const again2 = applyOps(again, [...d.ops, ...planImport(d.base, parseImport('dividenden', divs)).ops])
    expect(again2.meta.settings!.cash).toBe(cash)
  })
  it('ändert das Cash nur um die Differenz, wenn der neue Verlauf abweicht', () => {
    const db = empty()
    const once = applyOps(db, planImport(db, parseImport('trades', history)).ops)
    const cash = once.meta.settings!.cash
    const t = clearAreas(once, ['positions', 'transactions', 'prices', 'snapshots'])
    const fixed = history.replace('2025-02-02;Kauf;VTI;10;120;2', '2025-02-02;Kauf;VTI;10;110;2')
    const after = applyOps(once, [...t.ops, ...planImport(t.base, parseImport('trades', fixed)).ops])
    expect(after.meta.settings!.cash).toBe(cash + 100)
  })
  it('lässt Einträge vor dem letzten Cash-Stand aus dem Cash heraus', () => {
    const db = empty()
    const once = applyOps(db, planImport(db, parseImport('trades', history)).ops)
    once.transactions.s = { type: 'korrektur', date: '2025-06-01', cashDelta: 0 }
    once.meta.settings!.cash = 3000
    const t = clearAreas(once, ['positions', 'transactions', 'prices', 'snapshots'])
    expect(t.ops.some((o) => o.coll === 'meta')).toBe(false)
    const after = applyOps(once, [...t.ops, ...planImport(t.base, parseImport('trades', history)).ops])
    expect(after.meta.settings!.cash).toBe(3000)
    expect(after.transactions.s).toBeDefined()
  })
})

describe('Ältere Buchung ändern oder löschen', () => {
  const base = () => {
    const db = empty()
    db.positions.KO = { ticker: 'KO', name: 'KO', shares: 10, bucket: 'aktien', cost: 2000 }
    db.transactions.a = { type: 'kauf', date: '2026-02-02', ticker: 'KO', shares: 10, price: 100, fees: 0, cashDelta: -1000 }
    db.transactions.b = { type: 'kauf', date: '2026-03-02', ticker: 'KO', shares: 10, price: 200, fees: 0, cashDelta: -2000 }
    db.transactions.s = { type: 'verkauf', date: '2026-04-01', ticker: 'KO', shares: 10, price: 250, fees: 0, cashDelta: 2500, realized: 1000 }
    db.positions.KO.cost = 1500
    return db
  }
  it('rechnet Einstand und späteren Verkauf neu, wenn ein früher Kauf geändert wird', () => {
    const db = base()
    const ops = [...reverseTx(db, 'a', db.transactions.a), { op: 'set', coll: 'transactions', id: 'a', data: { ...db.transactions.a, price: 110, cashDelta: -1100 } } as const]
    const after = applyOps(db, replayOps(db, ops, 'KO'))
    expect(after.positions.KO).toMatchObject({ shares: 10, cost: 1550 })
    expect(after.transactions.s.realized).toBe(950)
  })
  it('verhindert das Löschen eines Kaufs, dessen Stück schon verkauft sind', () => {
    const db = base()
    db.transactions.s.shares = 15
    db.transactions.s.cashDelta = 3750
    db.positions.KO.shares = 5
    db.positions.KO.cost = 750
    expect(() => replayOps(db, reverseTx(db, 'b', db.transactions.b), 'KO')).toThrow(/fehlen danach Stück/)
  })
  it('lässt Titel ohne vollständige Buchungen bei der einfachen Rechnung', () => {
    const db = base()
    db.positions.KO.shares = 30 // 20 Stück ohne Kaufdatum importiert
    const ops = reverseTx(db, 'a', db.transactions.a)
    expect(replayOps(db, ops, 'KO')).toEqual(ops)
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
  it('lässt das Cash, wenn die Buchung im letzten Cash-Stand schon enthalten ist', () => {
    const db = empty()
    const after = applyOps(db, planImport(db, parseImport('trades', 'Datum;Art;Ticker;Stück;Preis\n2025-01-02;Kauf;VTI;10;100\n2025-03-02;Kauf;VTI;5;120')).ops)
    after.transactions.bal = { type: 'korrektur', date: '2025-02-15', cashDelta: 0 } as Tx
    after.meta.settings = { ...after.meta.settings, cash: 500 }
    const [early] = Object.entries(after.transactions).find(([, t]) => t.date === '2025-01-02')! as [string, Tx]
    const [late, lateTx] = Object.entries(after.transactions).find(([, t]) => t.date === '2025-03-02')! as [string, Tx]
    // Kauf vor dem Cash-Stand: Bestand zurück, Cash bleibt 500.
    expect(applyOps(after, reverseTx(after, early, after.transactions[early])).meta.settings!.cash).toBe(500)
    // Kauf nach dem Cash-Stand: Cash bekommt den Kaufbetrag zurück.
    expect(applyOps(after, reverseTx(after, late, lateTx)).meta.settings!.cash).toBe(1100)
    // Ein Cash-Stand selbst wird immer zurückgenommen.
    after.transactions.bal.cashDelta = 200
    expect(applyOps(after, reverseTx(after, 'bal', after.transactions.bal)).meta.settings!.cash).toBe(300)
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

  it('ohne Cash: erhaltene Dividenden zählen zum Ertrag (wie mit erfasstem Cash)', () => {
    const db = empty()
    db.meta.settings = { cash: 0, cashExcluded: true }
    db.positions.VTI = { ticker: 'VTI', name: 'VTI', shares: 10, bucket: 'etf', cost: 1000 }
    db.transactions.k = { type: 'kauf', date: days[0], ticker: 'VTI', shares: 10, price: 100, cashDelta: -1000 }
    db.dividends.d = { ticker: 'VTI', exDate: null, payDate: days[1], perShare: null, shares: null, gross: 12, tax: 2, net: 10, status: 'erhalten' }
    const ps = portfolioSeries(db, timeline(db), chart([100, 110, 120]))!
    expect(ps.gain).toBeCloseTo(210)
    expect(ps.mwr.at(-1)).toBeCloseTo(0.21)
    expect(ps.invested).toEqual([1000, 1000, 1000]) // «Eingezahlt» bleibt bei den Käufen
    expect(ps.buckets.etf.pl.at(-1)).toBeCloseTo(210)
    // Mit erfasstem Cash steckt dieselbe Dividende im Cash-Stand: gleicher Ertrag
    db.meta.settings = { cash: 10, cashExcluded: false }
    db.transactions.s = { type: 'korrektur', date: days[0], cashDelta: 0, cashStart: true }
    expect(portfolioSeries(db, timeline(db), chart([100, 110, 120]))!.gain).toBeCloseTo(210)
  })

  it('Kauf kurz vor Ende des Zeitraums: Rendite wie seit Kauf, nicht aufgebläht', () => {
    const db = empty()
    db.meta.settings = { cash: 0, cashExcluded: true }
    db.positions.VTI = { ticker: 'VTI', name: 'VTI', shares: 10, bucket: 'etf', cost: 1000 }
    db.transactions.k = { type: 'kauf', date: days[2], ticker: 'VTI', shares: 10, price: 100, cashDelta: -1000 }
    const ps = portfolioSeries(db, timeline(db), { ...chart([90, 95, 110]), range: '1M' as 'MAX' })!
    expect(ps.mwr.at(-1)).toBeCloseTo(0.1)
    expect(ps.buckets.etf.mwr.at(-1)).toBeCloseTo(0.1)
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

  it('neues Konto: erste Einzahlung ohne Cash-Stand startet bei 0, Kauf danach zieht ab', () => {
    const db = empty()
    db.meta.settings = { cash: 0, cashExcluded: true }
    expect(emptyDepot(db)).toBe(true)
    // so schreibt das Formular die erste Einzahlung in einem leeren Depot
    db.transactions.e = { type: 'einzahlung', date: days[0], cashDelta: 10000 }
    db.meta.settings = { cash: 10000, cashExcluded: false }
    expect(emptyDepot(db)).toBe(false)
    db.positions.VTI = { ticker: 'VTI', name: 'VTI', shares: 10, bucket: 'etf', cost: 1000 }
    db.transactions.k = { type: 'kauf', date: days[1], ticker: 'VTI', shares: 10, price: 100, cashDelta: -1000 }
    db.meta.settings.cash = 9000
    const ps = portfolioSeries(db, timeline(db), chart([100, 110, 120]))!
    expect(ps.value).toEqual([10000, 10100, 10200])
    expect(ps.invested).toEqual([10000, 10000, 10000])
    expect(ps.gain).toBeCloseTo(200)
  })

  it('leeres Depot erkennt Titel, Buchungen und Dividenden', () => {
    const a = empty()
    expect(emptyDepot(a)).toBe(true)
    a.positions.X = { ticker: 'X', name: 'X', shares: 0, bucket: 'etf', cost: 0 }
    expect(emptyDepot(a)).toBe(true) // ganz verkaufter Titel ohne Buchung zählt nicht
    a.positions.X.shares = 1
    expect(emptyDepot(a)).toBe(false)
    const b = empty()
    b.dividends.d = { ticker: 'X', payDate: '2025-01-01', gross: 1, tax: 0, net: 1, status: 'erhalten' } as DB['dividends'][string]
    expect(emptyDepot(b)).toBe(false)
  })

  it('nur Cash, keine Titel: Verlauf beginnt mit dem ersten Cash-Eintrag', () => {
    const db = empty()
    db.meta.settings = { cash: 5000, cashExcluded: false }
    db.transactions.c = { type: 'korrektur', date: days[1], cashDelta: 5000, cashStart: true }
    const ps = portfolioSeries(db, timeline(db), chart([100, 110, 120]))!
    expect(ps.value).toEqual([5000, 5000])
    expect(ps.gain).toBeCloseTo(0)
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
    // Kategorie gleich gerechnet wie das Depot
    expect(ps.buckets.etf.pl.at(-1)).toBeCloseTo(1100)
    expect(ps.buckets.etf.mwr.at(-1)).toBeCloseTo(1100 / 3100)
  })

  // Live-Test 17.11.: Kategorie zeigte +323 % statt +47.6 %, weil Verkaufserlöse den Nenner senkten
  const days4 = ['2026-10-05', '2026-10-06', '2026-10-12', '2026-11-02']
  const ch4 = (series: Record<string, number[]>) => ({ range: 'MAX' as const, kind: 'daily' as const, interval: '1d', at: '', t: days4.map((d) => Date.parse(d + 'T21:00:00Z')), d: days4, series, prev: {}, failures: [] })
  it('Teil- und Vollverkauf: Kategorie-Rendite = Ertrag / alle Käufe', () => {
    const db = empty()
    db.meta.settings = { cash: 7748, cashExcluded: false }
    db.transactions.e = { type: 'einzahlung', date: '2026-10-05', cashDelta: 10000 }
    db.positions.AAPL = { ticker: 'AAPL', name: 'AAPL', shares: 9, bucket: 'aktien', cost: 1860.6 }
    db.transactions.a1 = { type: 'kauf', date: '2026-10-05', ticker: 'AAPL', shares: 10, price: 200, fees: 1, cashDelta: -2001 }
    db.transactions.m1 = { type: 'kauf', date: '2026-10-06', ticker: 'MSFT', shares: 5, price: 400, cashDelta: -2000 }
    db.transactions.a2 = { type: 'kauf', date: '2026-10-12', ticker: 'AAPL', shares: 5, price: 220, cashDelta: -1100 }
    db.transactions.s1 = { type: 'verkauf', date: '2026-11-02', ticker: 'AAPL', shares: 6, price: 350, fees: 1, cashDelta: 2099 }
    db.transactions.s2 = { type: 'verkauf', date: '2026-11-02', ticker: 'MSFT', shares: 5, price: 450, cashDelta: 2250 }
    db.positions.MSFT = { ticker: 'MSFT', name: 'MSFT', shares: 0, bucket: 'aktien', cost: 0 }
    const ps = portfolioSeries(db, timeline(db), ch4({ AAPL: [200, 205, 220, 353.61], MSFT: [400, 400, 410, 450] }))!
    const gain = 9 * 353.61 - (2001 + 2000 + 1100) + (2099 + 2250)
    expect(ps.buckets.aktien.pl.at(-1)).toBeCloseTo(gain)
    expect(ps.buckets.aktien.mwr.at(-1)).toBeCloseTo(gain / 5101) // ≈ +47.6 %
    expect(ps.value.at(-1)).toBeCloseTo(9 * 353.61 + 7748)
  })
  it('ganz verkaufte Kategorie mit Gewinn: Rendite positiv, nicht 0', () => {
    const db = empty()
    db.meta.settings = { cash: 0, cashExcluded: true }
    db.positions.MSFT = { ticker: 'MSFT', name: 'MSFT', shares: 0, bucket: 'aktien', cost: 0 }
    db.transactions.m1 = { type: 'kauf', date: '2026-10-06', ticker: 'MSFT', shares: 5, price: 400, cashDelta: -2000 }
    db.transactions.s2 = { type: 'verkauf', date: '2026-11-02', ticker: 'MSFT', shares: 5, price: 450, cashDelta: 2250 }
    db.positions.VTI = { ticker: 'VTI', name: 'VTI', shares: 1, bucket: 'etf', cost: 100 }
    db.transactions.v = { type: 'kauf', date: '2026-10-05', ticker: 'VTI', shares: 1, price: 100, cashDelta: -100 }
    const ps = portfolioSeries(db, timeline(db), ch4({ MSFT: [400, 400, 410, 450], VTI: [100, 100, 100, 100] }))!
    expect(ps.buckets.aktien.pl.at(-1)).toBeCloseTo(250)
    expect(ps.buckets.aktien.mwr.at(-1)).toBeCloseTo(0.125)
    // Depot ohne Cash: ebenso Ertrag / alle Käufe
    expect(ps.mwr.at(-1)).toBeCloseTo(250 / 2100)
  })
})

describe('Rendite und Betrag passen zusammen', () => {
  it('früh Gewinn, dann grosser Kauf mit Verlust: Prozent und Betrag haben dasselbe Vorzeichen', () => {
    const db = empty()
    db.meta.settings = { cash: 0, cashExcluded: true }
    db.positions.VTI = { ticker: 'VTI', name: 'VTI', shares: 110, bucket: 'etf', cost: 13000 }
    db.transactions.a = { type: 'kauf', date: '2025-01-02', ticker: 'VTI', shares: 10, price: 100, cashDelta: -1000 }
    db.transactions.b = { type: 'kauf', date: '2025-01-06', ticker: 'VTI', shares: 100, price: 120, cashDelta: -12000 }
    const days = ['2025-01-02', '2025-01-03', '2025-01-06', '2025-01-07']
    const ch = { range: 'MAX' as const, kind: 'daily' as const, interval: '1d', at: '', t: days.map((d) => Date.parse(d + 'T21:00:00Z')), d: days, series: { VTI: [100, 120, 120, 115] }, prev: { VTI: 100 }, failures: [] }
    const ps = portfolioSeries(db, timeline(db), ch)!
    expect(ps.gain).toBeCloseTo(110 * 115 - 13000)
    expect(ps.twr.at(-1)!).toBeGreaterThan(0) // zeitgewichtet wäre positiv
    expect(Math.sign(ps.mwr.at(-1)!)).toBe(Math.sign(ps.gain)) // angezeigt wird die passende Rendite
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

describe('Alle Portfolios: Start-Cash eines weiteren Portfolios ist Einsatz, kein Gewinn', () => {
  const days = ['2026-09-30', '2026-10-01', '2026-11-01', '2026-11-02']
  const chart = { range: 'MAX' as const, kind: 'daily' as const, interval: '1d', at: '', t: days.map((d) => Date.parse(d + 'T21:00:00Z')), d: days, series: { VOO: [500, 500, 520, 550], KO: [60, 60, 60, 70] }, prev: {}, failures: [] }
  const main = (): DB => {
    const db = empty()
    db.meta.settings = { cash: 8500, cashExcluded: false }
    db.transactions.c = { type: 'korrektur', date: days[0], cashDelta: 0, cashStart: true }
    db.transactions.e = { type: 'einzahlung', date: days[1], cashDelta: 10000 }
    db.transactions.k = { type: 'kauf', date: days[1], ticker: 'VOO', shares: 3, price: 500, cashDelta: -1500 }
    db.positions.VOO = { ticker: 'VOO', name: 'VOO', shares: 3, bucket: 'etf', cost: 1500 }
    return db
  }
  const second = (): DB => {
    const db = empty()
    db.meta.settings = { cash: 880, cashExcluded: false }
    db.transactions.c = { type: 'korrektur', date: days[2], cashDelta: 1000, cashStart: true }
    db.transactions.k = { type: 'kauf', date: days[3], ticker: 'KO', shares: 2, price: 60, cashDelta: -120 }
    db.positions.KO = { ticker: 'KO', name: 'KO', shares: 2, bucket: 'aktien', cost: 120 }
    return db
  }
  const info = (id: string) => ({ id, name: id, order: 0 })

  it('Gewinn gesamt = Summe der Gewinne der einzelnen Portfolios', () => {
    const a = portfolioSeries(main(), timeline(main()), chart)!
    const b = portfolioSeries(second(), timeline(second()), chart)!
    const all = aggregate([{ info: info('main'), db: main() }, { info: info('zwei'), db: second() }])
    const s = portfolioSeries(all, timeline(all), chart)!
    expect(a.gain).toBeCloseTo(3 * 50)
    expect(b.gain).toBeCloseTo(2 * 10)
    expect(s.gain).toBeCloseTo(a.gain + b.gain) // vorher +1000 zu viel
    expect(s.value.at(-1)).toBeCloseTo(8500 + 3 * 550 + 880 + 2 * 70)
    expect(s.invested.at(-1)).toBeCloseTo(11000)
    expect(s.mwr.at(-1)).toBeCloseTo(170 / 11000)
    // kein Sprung am Tag, an dem das zweite Portfolio startet
    expect(s.pl[s.d.indexOf(days[2])]).toBeCloseTo(3 * 20)
  })

  it('Portfolio ohne erfasstes Cash: Käufe sind Geld von aussen, Dividenden bewegen kein Cash', () => {
    const b = second()
    b.meta.settings = { cash: 0, cashExcluded: true }
    delete b.transactions.c
    b.dividends.d = { ticker: 'KO', exDate: null, payDate: days[3], perShare: 0.5, shares: 2, gross: 1, tax: 0, net: 1, status: 'erhalten' }
    const all = aggregate([{ info: info('main'), db: main() }, { info: info('zwei'), db: b }])
    const s = portfolioSeries(all, timeline(all), chart)!
    expect(s.value.at(-1)).toBeCloseTo(8500 + 3 * 550 + 2 * 70)
    // Die Dividende bewegt kein Cash, zählt aber zum Ertrag (wie im Portfolio selbst)
    expect(s.gain).toBeCloseTo(150 + 20 + 1)
    // Cash nur teilweise erfasst: Obergrenzen sind dann nicht beurteilbar
    expect(all.meta.settings?.cashPartial).toBe(true)
  })
})

describe('Import: Live-Test 17.11.', () => {
  const head = '"Date","Action","Symbol","Description","Quantity","Price","Fees & Comm","Amount"'
  it('negative Gebühr in der Vorlage wird gemeldet, nicht still umgedreht', () => {
    const r = parseImport('trades', 'Datum;Art;Ticker;Stück;Preis;Gebühr\n2026-10-01;Kauf;AMD;1;100;−2')
    expect(r.trades).toHaveLength(0)
    expect(r.errors[0].msg).toBe('Gebühr darf nicht negativ sein')
  })
  it('Steuerrückerstattung zählt unabhängig von der Reihenfolge im Export', () => {
    const csv = [head,
      '"11/05/2026","NRA Tax Adj","KO","COCA COLA","","","","$0.26"',
      '"11/01/2026","NRA Tax Adj","KO","COCA COLA","","","","-$0.77"',
      '"11/01/2026","Qualified Dividend","KO","COCA COLA","","","","$5.10"',
    ].join('\n')
    const r = parseImport('trades', csv)
    expect(r.dividends).toEqual([expect.objectContaining({ ticker: 'KO', gross: 5.1, tax: 0.51 })])
  })
  it('Schwab-Export im europäischen Zahlenformat', () => {
    const csv = [head.replace(/,/g, ';'),
      '"03.11.2026";"Buy";"PEP";"PEPSICO";"2";"150,25";"0,50";"-301,00"',
      '"02.11.2026";"Qualified Dividend";"KO";"COCA COLA";"";"";"";"2,71"',
      '"01.11.2026";"Sell";"MSFT";"MICROSOFT";"1";"1.150,00";"";"1.150,00"',
    ].join('\n')
    const r = parseImport('trades', csv)
    expect(r.trades.map((t) => [t.ticker, t.price, t.fees])).toEqual([['PEP', 150.25, 0.5], ['MSFT', 1150, 0]])
    expect(r.dividends[0].gross).toBe(2.71)
  })
  it('US-Format bleibt US, auch mit Tausendertrenner', () => {
    const csv = [head, '"11/03/2026","Buy","MSFT","MICROSOFT","2","$1,410.50","$0.50","-$2,821.50"'].join('\n')
    expect(parseImport('trades', csv).trades[0]).toMatchObject({ price: 1410.5, fees: 0.5 })
  })
  it('Schwab-Kontoauszug im europäischen Zahlenformat', () => {
    const csv = [
      'Date; Type; Description; Ref Num; Misc Fees; Commissions; Amount; Balance',
      '03.11.2026 15:00;TRD;BOT +2 PEP @150,25;12;-0,50;0,00;-301,00;699,00',
      '02.11.2026 10:15;WIN;WIRED FUNDS RECEIVED 1.000,00 US$;19;-;0,00;1.000,00;1.000,00',
    ].join('\n')
    const r = parseImport('trades', csv)
    expect(r.trades[0]).toMatchObject({ ticker: 'PEP', shares: 2, price: 150.25, fees: 0.5 })
    expect(r.cash).toEqual([expect.objectContaining({ amount: 1000 })])
  })
  it('Einzahlungen aus dem Export werden zu Cash-Buchungen, beim zweiten Import nicht doppelt', () => {
    const csv = [head,
      '"10/28/2026","MoneyLink Transfer","","","","","","$1,000.00"',
      '"10/29/2026","Wire Funds Received","","","","","","$500.00"',
      '"10/30/2026","MoneyLink Transfer","","","","","","-$200.00"',
    ].join('\n')
    const db = empty()
    const plan = planImport(db, parseImport('trades', csv))
    expect(plan.cashDelta).toBe(1300)
    expect(plan.items.map((i) => i.kind)).toEqual(['Einzahlung', 'Einzahlung', 'Auszahlung'])
    const after = applyOps(db, plan.ops)
    expect(after.meta.settings!.cash).toBe(2300)
    const again = planImport(after, parseImport('trades', csv))
    expect(again.count).toBe(0)
    expect(again.cashDelta).toBe(0)
  })
})
