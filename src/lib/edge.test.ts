/**
 * Randfälle aus dem Testplan vom 14.11.2026: Import, Zahlen- und Datumsformate, Anzeigewährung,
 * CSV-Export und Rechenlogik mit unvollständigen Daten.
 */
import { describe, expect, it } from 'vitest'
import { date, detectKind, LIMITS, num, parseImport, splitTable } from './bulk'
import { planImport } from './bulk-plan'
import { alerts, compute, divAnnual, fxOf, quote, wlState } from './calc'
import { csvCell } from './export'
import { addMonths, cur, daysBetween, money, parseNum, pct, pctPlain, setDisplayCurrency, sUsd, usd, weekday } from './format'
import { applyOps } from './reverse'
import { normTicker } from './ticker'
import type { DB } from './types'

const empty = (): DB => ({ positions: {}, prices: {}, watchlist: {}, pots: {}, events: {}, log: {}, transactions: {}, dividends: {}, snapshots: {}, meta: { settings: { cash: 1000, cashExcluded: false, withholding: 0.15 } }, market: {} })

describe('Zahlen in Eingabefeldern', () => {
  it('liest Schweizer, deutsche und US-Schreibweise', () => {
    expect(parseNum("1'234.50")).toBe(1234.5)
    expect(parseNum('1’234.50')).toBe(1234.5)
    expect(parseNum('1234,5')).toBe(1234.5)
    expect(parseNum('1,234.50')).toBe(1234.5)
    expect(parseNum('1.234,50')).toBe(1234.5)
    expect(parseNum(' 12 ')).toBe(12)
    expect(parseNum(7)).toBe(7)
  })
  it('liest das typografische Minus', () => {
    expect(parseNum('−5')).toBe(-5)
    expect(num('−12.50')).toBe(-12.5)
  })
  it('gibt bei Unsinn null', () => {
    expect(parseNum('')).toBeNull()
    expect(parseNum('abc')).toBeNull()
    expect(parseNum(null)).toBeNull()
    expect(parseNum('1.2.3')).toBeNull()
  })
})

describe('Datum im Import', () => {
  it('erkennt Tag/Monat/Jahr, wenn der erste Teil kein Monat sein kann', () => {
    expect(date('23/06/2026')).toBe('2026-06-23')
    expect(date('06/23/2026')).toBe('2026-06-23')
  })
  it('lehnt unmögliche Tage ab, auch Schaltjahre', () => {
    expect(date('29.02.2025')).toBeNull()
    expect(date('29.02.2024')).toBe('2024-02-29')
    expect(date('00.01.2025')).toBeNull()
  })
})

describe('Ticker', () => {
  it('schreibt Klassen-Aktien so, wie die Kursquelle sie kennt', () => {
    expect(normTicker('brk.b')).toBe('BRK-B')
    expect(normTicker('BRK/B')).toBe('BRK-B')
    expect(normTicker(' bf.a ')).toBe('BF-A')
  })
  it('lässt Börsenkürzel und Währungen stehen', () => {
    expect(normTicker('NESN.SW')).toBe('NESN.SW')
    expect(normTicker('VOD.L')).toBe('VOD.L')
    expect(normTicker('CHF=X')).toBe('CHF=X')
  })
  it('lehnt Ungültiges ab', () => {
    expect(normTicker('')).toBeNull()
    expect(normTicker('VTI ETF')).toBeNull()
    expect(normTicker('<script>')).toBeNull()
    expect(normTicker('ABCDEFGHIJKLMN')).toBeNull()
  })
  it('Import und Schwab-Export nutzen dieselbe Schreibweise', () => {
    const a = parseImport('trades', 'Datum;Art;Ticker;Stück;Preis\n2025-01-02;Kauf;BRK.B;1;400')
    const b = parseImport('trades', '"Date","Action","Symbol","Description","Quantity","Price","Fees & Comm","Amount"\n"01/03/2025","Buy","BRK/B","BERKSHIRE","1","$401.00","","-$401.00"')
    expect(a.trades[0].ticker).toBe('BRK-B')
    expect(b.trades[0].ticker).toBe('BRK-B')
  })
})

describe('Import: Tabellen lesen', () => {
  it('meldet die richtige Zeilennummer auch nach Leerzeilen', () => {
    const r = parseImport('trades', 'Datum;Art;Ticker;Stück;Preis\n\n2025-01-01;Kauf;VTI;1;10\n\n\n2025-01-02;Kauf;;1;10')
    expect(r.trades).toHaveLength(1)
    expect(r.errors).toEqual([{ line: 6, msg: 'Ticker fehlt' }])
  })
  it('liest Anführungszeichen mit Trennzeichen und Zeilenumbruch in der Zelle', () => {
    const rows = splitTable('Ticker;Name\n"VTI";"Vanguard; Total ""Stock"""\n"MSFT";"Micro\nsoft"')
    expect(rows[1]).toEqual(['VTI', 'Vanguard; Total "Stock"'])
    expect(rows[2]).toEqual(['MSFT', 'Micro\nsoft'])
  })
  it('liest Komma-CSV mit US-Zahlen in Anführungszeichen', () => {
    const r = parseImport('trades', 'Date,Type,Ticker,Shares,Price,Fees\n2025-01-02,Buy,VTI,"1,000","$1,234.50",0')
    expect(r.errors).toEqual([])
    expect(r.trades[0]).toMatchObject({ shares: 1000, price: 1234.5 })
  })
  it('akzeptiert Spalten in beliebiger Reihenfolge und englische Köpfe', () => {
    const r = parseImport('dividenden', 'Ticker\tGross\tPayDate\nVTI\t2.85\t2025-06-26')
    expect(r.dividends[0]).toMatchObject({ ticker: 'VTI', gross: 2.85, payDate: '2025-06-26', tax: null })
  })
  it('nur Kopfzeile oder nur Leerzeichen ergibt nichts und keinen Fehler', () => {
    expect(parseImport('trades', 'Datum;Art;Ticker;Stück;Preis\n')).toMatchObject({ trades: [], errors: [] })
    expect(parseImport('trades', '   \n  ')).toMatchObject({ trades: [], errors: [] })
  })
  it('meldet fehlende Pflichtspalten', () => {
    const r = parseImport('trades', 'Datum;Ticker;Stück\n2025-01-01;VTI;1')
    expect(r.errors[0].msg).toMatch(/Spalte fehlt: Art, Preis/)
  })
  it('hält die Grenzen für Grösse und Zeilen ein', () => {
    const big = 'Datum;Art;Ticker;Stück;Preis\n' + '2025-01-01;Kauf;VTI;1;10\n'.repeat(LIMITS.rows + 5)
    expect(parseImport('trades', big).errors[0].msg).toMatch(/Zu viele Zeilen/)
    expect(parseImport('trades', 'x'.repeat(LIMITS.bytes + 1)).errors[0].msg).toMatch(/zu gross/)
  })
  it('kürzt überlange Notizen', () => {
    const r = parseImport('trades', `Datum;Art;Ticker;Stück;Preis;Notiz\n2025-01-01;Kauf;VTI;1;10;${'a'.repeat(1000)}`)
    expect(r.trades[0].note).toHaveLength(LIMITS.note)
  })
  it('erkennt Dateien ohne passende Kopfzeile nicht als Vorlage', () => {
    expect(detectKind('foo;bar\n1;2')).toBeNull()
  })
  it('Bestand: Summen- und Cash-Zeilen von Broker-Exporten werden übersprungen', () => {
    const r = parseImport('bestand', 'Symbol;Quantity;Cost Basis\nVTI;3;856.20\nCash & Cash Investments;;\nAccount Total;;')
    expect(r.positions).toHaveLength(1)
    expect(r.skipped).toHaveLength(2)
    expect(r.errors).toEqual([])
  })
})

describe('Import planen: Randfälle', () => {
  it('Verkauf am selben Tag nach dem Kauf in derselben Datei', () => {
    const db = empty()
    const p = planImport(db, parseImport('trades', 'Datum;Art;Ticker;Stück;Preis\n2025-01-02;Kauf;VTI;2;100\n2025-01-02;Verkauf;VTI;2;110'))
    expect(p.items.map((i) => i.state)).toEqual(['neu', 'neu'])
    const after = applyOps(db, p.ops)
    expect(after.positions.VTI).toMatchObject({ shares: 0, cost: 0 })
    expect(after.meta.settings!.cash).toBe(1020)
  })
  it('Bruchteile ohne Rundungsfehler', () => {
    const db = empty()
    const p = planImport(db, parseImport('trades', 'Datum;Art;Ticker;Stück;Preis\n2025-01-02;Kauf;VTI;0.1;100\n2025-01-03;Kauf;VTI;0.2;100\n2025-01-04;Verkauf;VTI;0.3;100'))
    expect(p.items.every((i) => i.state === 'neu')).toBe(true)
    expect(applyOps(db, p.ops).positions.VTI.shares).toBe(0)
  })
  it('Cash bleibt unverändert, solange Cash nicht erfasst wird', () => {
    const db = empty()
    db.meta.settings = { cash: 0, cashExcluded: true }
    const p = planImport(db, parseImport('trades', 'Datum;Art;Ticker;Stück;Preis\n2025-01-02;Kauf;VTI;1;100'))
    expect(p.ops.some((o) => o.coll === 'meta')).toBe(false)
  })
  it('Dividende ohne Steuerangabe nimmt den eingestellten Satz', () => {
    const db = empty()
    db.meta.settings!.withholding = 0.3
    const p = planImport(db, parseImport('dividenden', 'Zahltag;Ticker;Brutto\n2025-06-26;KO;10'))
    const d = Object.values(applyOps(db, p.ops).dividends)[0]
    expect(d).toMatchObject({ gross: 10, tax: 3, net: 7, status: 'erhalten' })
  })
  it('neuer Titel bekommt den Kaufpreis als vorläufigen Kurs', () => {
    const db = empty()
    const p = planImport(db, parseImport('trades', 'Datum;Art;Ticker;Stück;Preis\n2025-01-02;Kauf;NEW;1;12.5\n2025-02-02;Kauf;NEW;1;13'))
    expect(applyOps(db, p.ops).prices.NEW).toMatchObject({ close: 13, source: 'Kaufpreis' })
  })
})

describe('Anzeigewährung: Randfälle', () => {
  it('zeigt nie «−0.00»', () => {
    setDisplayCurrency('USD', 1)
    expect(usd(-0.001)).toBe('0.00')
    expect(sUsd(-0.004)).toBe('0.00')
    expect(pct(-0.00001)).toBe('0.0 %')
    expect(pctPlain(-0.00001)).toBe('0.0 %')
    expect(sUsd(-0.006)).toBe('−0.01')
  })
  it('Tausendertrennung und Vorzeichen', () => {
    setDisplayCurrency('EUR', 0.5)
    expect(usd(2_469_000)).toMatch(/^1.234.500\.00$/)
    expect(money(-10)).toBe('−5.00 EUR')
    expect(sUsd(10)).toBe('+5.00')
    setDisplayCurrency('USD', 1)
  })
  it('ungültige Werte und Kurse', () => {
    setDisplayCurrency('CHF', 0)
    expect(cur()).toBe('CHF')
    expect(usd(100)).toBe('100.00') // Kurs 0 gilt nicht
    setDisplayCurrency('USD', 1)
    expect(usd(NaN)).toBe('–')
    expect(usd(Infinity)).toBe('–')
    expect(usd(undefined)).toBe('–')
  })
  it('ohne Devisenkurs bleibt die Anzeige in USD', () => {
    const db = empty()
    db.meta.settings!.fx = 'CHF'
    expect(fxOf(db)).toBeNull()
    db.prices['CHF=X'] = { close: 0.8, prev: 0.81, date: '2026-11-13' }
    expect(fxOf(db)).toEqual({ code: 'CHF', rate: 0.8 })
    db.positions.VTI = { ticker: 'VTI', name: 'VTI', shares: 2, bucket: 'etf', cost: 100 }
    db.prices.VTI = { close: 100, prev: 100, date: '2026-11-13' }
    const c = compute(db)
    expect(cur()).toBe('CHF')
    expect(c.total).toBe(1200) // gerechnet wird immer in USD
    expect(usd(c.total)).toBe('960.00')
    setDisplayCurrency('USD', 1)
  })
})

describe('Rechnen mit unvollständigen Daten', () => {
  it('Titel ohne Kurs: Wert unvollständig, kein Gewinn behauptet', () => {
    const db = empty()
    db.positions.A = { ticker: 'A', name: 'A', shares: 1, bucket: 'aktien', cost: 50 }
    db.positions.B = { ticker: 'B', name: 'B', shares: 1, bucket: 'aktien', cost: 50 }
    db.prices.A = { close: 60, prev: 55, date: '2026-11-13' }
    const c = compute(db)
    expect(c.valuationComplete).toBe(false)
    expect(c.pl).toBeNull()
    expect(c.dayPct).toBeNull()
    expect(c.total).toBe(1060)
  })
  it('nur Cash, keine Titel: Gesamtwert ist das Cash', () => {
    const db = empty()
    db.meta.settings = { cash: 5000, cashExcluded: false }
    const c = compute(db)
    expect(c.valuationComplete).toBe(true)
    expect(c.total).toBe(5000)
  })
  it('verkaufte Positionen (0 Stück) zählen nicht', () => {
    const db = empty()
    db.positions.A = { ticker: 'A', name: 'A', shares: 0, bucket: 'aktien', cost: 0 }
    expect(compute(db).rows).toHaveLength(0)
  })
  it('neuerer Live-Kurs schlägt den gespeicherten, älterer nicht', () => {
    const db = empty()
    db.prices.A = { close: 10, prev: 9, date: '2026-11-12', divAnnual: 1 }
    db.market.latest = { quotes: { A: { close: 11, prev: 10, date: '2026-11-13' } } }
    expect(quote(db, 'A')).toMatchObject({ close: 11, divAnnual: 1 })
    db.market.latest = { quotes: { A: { close: 8, prev: 7, date: '2026-11-01' } } }
    expect(quote(db, 'A')!.close).toBe(10)
  })
  it('Dividendenrate: nur gehaltene Titel', () => {
    const db = empty()
    db.positions.A = { ticker: 'A', name: 'A', shares: 10, bucket: 'aktien', cost: 0 }
    db.positions.B = { ticker: 'B', name: 'B', shares: 0, bucket: 'aktien', cost: 0 }
    db.prices.A = { close: 10, prev: 10, date: '2026-11-13', divAnnual: 0.5 }
    db.prices.B = { close: 10, prev: 10, date: '2026-11-13', divAnnual: 5 }
    expect(divAnnual(db)).toMatchObject({ gross: 5, net: 4.25 })
  })
  it('Watchlist-Grenze', () => {
    expect(wlState({ ticker: 'X', limit: 100 } as never, 99).tone).toBe('up')
    expect(wlState({ ticker: 'X', limit: 100, conditionMet: false } as never, 99).label).toBe('Bedingung offen')
    expect(wlState({ ticker: 'X', limit: 100 } as never, 104).label).toBe('nahe')
    expect(wlState({ ticker: 'X', limit: 100 } as never, null).label).toBe('Kurs fehlt')
    expect(wlState({ ticker: 'X' } as never, 50).label).toBe('keine Grenze')
  })
})

describe('CSV-Export', () => {
  it('setzt Text mit Trennzeichen, Anführungszeichen oder Umbruch in Anführungszeichen', () => {
    expect(csvCell('Berkshire; Hathaway')).toBe('"Berkshire; Hathaway"')
    expect(csvCell('Say "hi"')).toBe('"Say ""hi"""')
    expect(csvCell('a\nb')).toBe('"a\nb"')
    expect(csvCell('VTI')).toBe('VTI')
    expect(csvCell(12.5)).toBe('12.5')
    expect(csvCell(null)).toBe('')
  })
  it('entschärft Text, den Excel als Formel ausführen würde', () => {
    expect(csvCell('=HYPERLINK("http://x")')).toBe(`"'=HYPERLINK(""http://x"")"`)
    expect(csvCell('+41 Notiz')).toBe("'+41 Notiz")
    expect(csvCell('@SUM(A1)')).toBe("'@SUM(A1)")
    expect(csvCell(-12.5)).toBe('-12.5') // echte Zahlen bleiben Zahlen
  })
})

describe('Kurse nach Änderungen', () => {
  it('holt den Devisenkurs sofort, wenn die Anzeigewährung wechselt', async () => {
    const { needsQuotes } = await import('./store')
    expect(needsQuotes([{ op: 'merge', coll: 'meta', id: 'settings', data: { fx: 'CHF' } }])).toBe('force')
    expect(needsQuotes([{ op: 'merge', coll: 'meta', id: 'settings', data: { fx: null } }])).toBe('force')
    expect(needsQuotes([{ op: 'merge', coll: 'meta', id: 'settings', data: { cash: 5 } }])).toBeNull()
  })
})

describe('Import: Plausibilität', () => {
  it('lehnt Daten in der Zukunft und Steuer über dem Bruttobetrag ab', () => {
    const t = parseImport('trades', 'Datum;Art;Ticker;Stück;Preis\n2099-01-02;Kauf;VTI;1;10')
    expect(t.errors[0].msg).toMatch(/Zukunft/)
    const d = parseImport('dividenden', 'Zahltag;Ticker;Brutto;Quellensteuer\n2025-06-26;KO;2.70;15\n2099-06-26;KO;2.70;0.4')
    expect(d.errors.map((e) => e.msg)).toEqual([expect.stringMatching(/grösser als der Bruttobetrag/), expect.stringMatching(/Zukunft/)])
  })
  it('lehnt Daten vor 1970 ab (Tippfehler im Jahr)', () => {
    expect(parseImport('trades', 'Datum;Art;Ticker;Stück;Preis\n1026-01-02;Kauf;VTI;1;10').errors[0].msg).toMatch(/zu weit zurück/)
    expect(parseImport('dividenden', 'Zahltag;Ticker;Brutto\n1900-06-26;KO;2.70').errors[0].msg).toMatch(/zu weit zurück/)
    expect(parseImport('trades', 'Datum;Art;Ticker;Stück;Preis\n1970-01-02;Kauf;VTI;1;10').errors).toEqual([])
  })
})

describe('Schwab-Export: weitere Arten', () => {
  const head = '"Date","Action","Symbol","Description","Quantity","Price","Fees & Comm","Amount"'
  it('bucht Aktiensplits, damit spätere Verkäufe passen', () => {
    const csv = [head,
      '"07/15/2024","Sell","NVDA","NVIDIA CORP","50","$120.00","","$6,000.00"',
      '"06/10/2024","Stock Split","NVDA","NVIDIA CORP","90","","",""',
      '"01/05/2024","Buy","NVDA","NVIDIA CORP","10","$490.00","","-$4,900.00"',
    ].join('\n')
    const db = { positions: {}, prices: {}, watchlist: {}, pots: {}, events: {}, log: {}, transactions: {}, dividends: {}, snapshots: {}, meta: { settings: { cash: 0, cashExcluded: true } }, market: {} } as DB
    const r = parseImport('trades', csv)
    expect(r.splits).toEqual([expect.objectContaining({ ticker: 'NVDA', shares: 90, date: '2024-06-10' })])
    const p = planImport(db, r)
    expect(p.items.map((i) => [i.kind, i.state])).toEqual([['Kauf', 'neu'], ['Split', 'neu'], ['Verkauf', 'neu']])
    const after = applyOps(db, p.ops)
    expect(after.positions.NVDA).toMatchObject({ shares: 50, cost: 2450 })
    // derselbe Export ein zweites Mal: alles schon vorhanden
    expect(planImport(after, parseImport('trades', csv)).count).toBe(0)
  })
  it('Rückerstattung der Quellensteuer verringert die Steuer', () => {
    const csv = [head,
      '"10/30/2026","Qualified Dividend","KO","COCA COLA","","","","$10.00"',
      '"10/30/2026","NRA Tax Adj","KO","COCA COLA","","","","-$3.00"',
      '"11/05/2026","NRA Tax Adj","KO","COCA COLA","","","","$1.50"',
    ].join('\n')
    expect(parseImport('trades', csv).dividends[0]).toMatchObject({ gross: 10, tax: 1.5 })
  })
  it('Optionen, Leerverkäufe und Überweisungen werden übersprungen, nicht falsch gebucht', () => {
    const csv = [head,
      '"10/01/2026","Buy to Open","AAPL 12/20/2026 200.00 C","CALL","1","$5.00","$0.65","-$500.65"',
      '"10/02/2026","Sell Short","TSLA","TESLA","1","$200.00","","$200.00"',
      '"10/03/2026","Wire Received","","","","","","$5,000.00"',
      '"10/04/2026","Credit Interest","","","","","","$0.12"',
    ].join('\n')
    const r = parseImport('trades', csv)
    expect(r.trades).toEqual([])
    expect(r.dividends).toEqual([])
    expect(r.skipped).toHaveLength(4)
  })
})

describe('Hinweis bei negativem Cash', () => {
  const base = (cash: number, cashExcluded = false): DB => ({ positions: { VTI: { ticker: 'VTI', name: 'VTI', shares: 10, bucket: 'etf', cost: 2000 } }, prices: { VTI: { close: 200, prev: 200, date: '2026-11-13' } }, watchlist: {}, pots: {}, events: {}, log: {}, transactions: {}, dividends: {}, snapshots: {}, meta: { settings: { cash, cashExcluded, withholding: 0.15 } }, market: {} })
  const has = (db: DB) => alerts(db, compute(db), '2026-11-14').some((a) => a.title === 'Cash ist negativ')
  it('warnt, wenn der erfasste Cash-Stand unter null liegt', () => {
    expect(has(base(-500))).toBe(true)
    expect(has(base(0))).toBe(false)
    expect(has(base(-0.2))).toBe(false)
  })
  it('schweigt, solange Cash nicht erfasst ist', () => expect(has(base(-500, true))).toBe(false))
})

describe('Kalender: Monatsende, Jahreswechsel, Zeitumstellung', () => {
  it('Monate addieren bleibt im richtigen Monat', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28')
    expect(addMonths('2028-01-31', 1)).toBe('2028-02-29')
    expect(addMonths('2026-03-31', 3)).toBe('2026-06-30')
    expect(addMonths('2026-12-01', 1)).toBe('2027-01-01')
    expect(addMonths('2027-01-01', -11)).toBe('2026-02-01')
    expect(addMonths('2026-11-15', -12)).toBe('2025-11-15')
  })
  it('Tage zählen über Zeitumstellung und Jahreswechsel', () => {
    expect(daysBetween('2026-03-07', '2026-03-09')).toBe(2) // USA: Sommerzeit ab 8. März
    expect(daysBetween('2026-03-28', '2026-03-30')).toBe(2) // Europa: 29. März
    expect(daysBetween('2026-10-31', '2026-11-02')).toBe(2)
    expect(daysBetween('2026-12-31', '2027-01-01')).toBe(1)
    expect(daysBetween('2024-02-28', '2024-03-01')).toBe(2)
    expect(weekday('2026-11-14')).toBe(weekday('2026-11-21'))
  })
})
