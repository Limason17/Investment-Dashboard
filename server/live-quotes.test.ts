/**
 * Live-Kurse mit nachgebautem Yahoo: Sitzungen, Vergleichskurs, Schlusskurs, Overnight-Fenster und Sommerzeit.
 * Zeiten in UTC; New York ist im November UTC−5 (EST), im März nach der Umstellung UTC−4 (EDT).
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { liveQuotes } from './live-quotes.ts'

const S = (iso: string) => Date.parse(iso) / 1000
/** Yahoo-Chart eines Handelstages; day = New Yorker Datum, off = Abstand zu UTC in Stunden */
function chart(day: string, off: number, o: { price: number; prevClose: number; regT: string; bars?: [string, number][]; noPeriods?: boolean }) {
  const at = (h: number) => S(`${day}T00:00:00Z`) + (h + off) * 3600
  const bars = o.bars ?? []
  return {
    meta: {
      regularMarketPrice: o.price, chartPreviousClose: o.prevClose, regularMarketTime: S(o.regT), longName: 'Test Inc.',
      ...(o.noPeriods ? {} : { currentTradingPeriod: { pre: { start: at(4), end: at(9.5) }, regular: { start: at(9.5), end: at(16) }, post: { start: at(16), end: at(20) } } }),
    },
    timestamp: bars.map(([t]) => S(t)),
    indicators: { quote: [{ close: bars.map(([, c]) => c) }] },
  }
}
type Fx = Record<string, ReturnType<typeof chart>>
function mockYahoo(fx: Fx) {
  vi.stubGlobal('fetch', vi.fn(async (u: string) => {
    const url = new URL(String(u))
    if (url.pathname.includes('/spark')) {
      const syms = (url.searchParams.get('symbols') ?? '').split(',')
      return Response.json({ spark: { result: syms.filter((s) => fx[s]).map((s) => ({ symbol: s, response: [fx[s]] })) } })
    }
    if (url.searchParams.get('events') === 'div') return Response.json({ chart: { result: [{ events: {} }] } })
    const t = decodeURIComponent(url.pathname.split('/').pop()!)
    return fx[t] ? Response.json({ chart: { result: [fx[t]] } }) : new Response('{}', { status: 404 })
  }))
}
const run = (held: string[], watch: string[] = [], env = {}) => liveQuotes({ tickers: () => ({ held, watch }) }, env)(true)
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

describe('Live-Kurse', () => {
  it('reguläre Sitzung: Kurs, Vergleich mit gestern, noch kein Schlusskurs', async () => {
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-11-13T15:00:00Z'))
    mockYahoo({ VTI: chart('2026-11-13', 5, { price: 301, prevClose: 300, regT: '2026-11-13T14:59:30Z' }) })
    const r = await run(['VTI'])
    expect(r.session).toBe('regular')
    expect(r.quotes.VTI).toMatchObject({ price: 301, ref: 300, regularPrev: null, session: 'regular', name: 'Test Inc.' })
  })
  it('After-Hours: neuester Minutenkurs, Schlusskurs des Tages steht fest', async () => {
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-11-13T22:00:00Z'))
    mockYahoo({ VTI: chart('2026-11-13', 5, { price: 302, prevClose: 300, regT: '2026-11-13T21:00:00Z', bars: [['2026-11-13T21:58:00Z', 302.5]] }) })
    const q = (await run(['VTI'])).quotes.VTI
    expect(q).toMatchObject({ price: 302.5, session: 'post', regular: 302, regularPrev: 300, regularDate: '2026-11-13' })
  })
  it('Pre-Market am Montag: Vergleich mit dem Freitagsschluss, nicht mit Donnerstag', async () => {
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-11-16T10:00:00Z'))
    mockYahoo({ VTI: chart('2026-11-16', 5, { price: 302, prevClose: 300, regT: '2026-11-13T21:00:00Z', bars: [['2026-11-16T09:59:00Z', 304]] }) })
    const q = (await run(['VTI'])).quotes.VTI
    expect(q).toMatchObject({ price: 304, ref: 302, session: 'pre', regularPrev: null })
  })
  it('Wochenende mit CHF-Anzeige: die Sitzung richtet sich nach den Aktien, nicht nach dem Devisenkurs', async () => {
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-11-14T15:00:00Z'))
    const fxDay = { ...chart('2026-11-14', 5, { price: 0.8, prevClose: 0.81, regT: '2026-11-14T14:59:00Z' }) }
    fxDay.meta.currentTradingPeriod = { pre: { start: S('2026-11-14T00:00:00Z'), end: S('2026-11-14T00:00:00Z') }, regular: { start: S('2026-11-14T00:00:00Z'), end: S('2026-11-14T23:59:00Z') }, post: { start: S('2026-11-14T23:59:00Z'), end: S('2026-11-14T23:59:00Z') } }
    mockYahoo({ 'CHF=X': fxDay, VTI: chart('2026-11-13', 5, { price: 302, prevClose: 300, regT: '2026-11-13T21:00:00Z' }) })
    const r = await run(['VTI'], ['CHF=X'])
    expect(r.quotes['CHF=X'].session).toBe('regular')
    expect(r.session).toBe('closed')
  })
  it('ohne Handelszeiten (manche Fonds, Devisen) kein Ausfall', async () => {
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-11-13T22:00:00Z'))
    mockYahoo({ VFIAX: chart('2026-11-13', 5, { price: 600, prevClose: 595, regT: '2026-11-13T22:00:00Z', noPeriods: true }) })
    const r = await run(['VFIAX'])
    expect(r.failures).toEqual([])
    expect(r.quotes.VFIAX).toMatchObject({ price: 600, ref: 595, regularDate: '2026-11-13' })
  })
  it('Ausfall eines Titels: die anderen kommen trotzdem', async () => {
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-11-13T15:00:00Z'))
    mockYahoo({ VTI: chart('2026-11-13', 5, { price: 301, prevClose: 300, regT: '2026-11-13T14:59:30Z' }) })
    const r = await run(['VTI', 'GIBTSNICHT'])
    expect(Object.keys(r.quotes)).toEqual(['VTI'])
    expect(r.failures).toEqual([expect.stringMatching(/^GIBTSNICHT/)])
  })
  it.each([
    ['Sonntag 20:30 New York (Winterzeit)', '2026-11-16T01:30:00Z', 'kein Schlüssel'],
    ['Samstag 21:00 New York', '2026-11-15T02:00:00Z', 'ruhend'],
    ['Freitag 21:00 New York', '2026-11-14T02:00:00Z', 'ruhend'],
    ['Sonntag 20:30 New York (Sommerzeit, 8. März)', '2026-03-09T00:30:00Z', 'kein Schlüssel'],
    ['Montag 03:59 New York (Sommerzeit)', '2026-03-09T07:59:00Z', 'kein Schlüssel'],
    ['Montag 04:01 New York (Sommerzeit)', '2026-03-09T08:01:00Z', 'ruhend'],
  ])('Overnight-Fenster: %s', async (_, now, state) => {
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date(now))
    mockYahoo({ VTI: chart('2026-11-13', 5, { price: 301, prevClose: 300, regT: '2026-11-13T21:00:00Z' }) })
    expect((await run(['VTI'])).overnight).toBe(state)
  })
})
