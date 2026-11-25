import { describe, expect, it } from 'vitest'
import { sliceChart, toCandles, weekOf } from './candles'
import type { ChartData } from './types'

const H = 3600_000
/** Zwei Handelstage mit je drei Stundenkerzen */
function hourly(withOhlc: boolean): ChartData {
  const d = ['2026-11-23', '2026-11-23', '2026-11-23', '2026-11-24', '2026-11-24', '2026-11-24']
  const t0 = Date.parse('2026-11-23T14:30:00Z'), t1 = Date.parse('2026-11-24T14:30:00Z')
  const t = [t0, t0 + H, t0 + 2 * H, t1, t1 + H, t1 + 2 * H]
  return {
    range: '1W', kind: 'intraday', interval: '60m', at: '', t, d, failures: [],
    series: { X: [10, 11, 10.5, 12, 11, 11.5] },
    prev: { X: 9.5 },
    ...(withOhlc ? { ohlc: { X: { o: [9.8, 10, 11, 11.8, 12, 11], h: [10.2, 11.4, 11.1, 12.5, 12.1, 11.6], l: [9.7, 9.9, 10.4, 11.5, 10.8, 10.9] } } } : {}),
  }
}

describe('toCandles', () => {
  it('nimmt die feinste Länge, die in die Breite passt', () => {
    expect(toCandles(hourly(true), 'X', 10)!.unit).toBe(60)
    const day = toCandles(hourly(true), 'X', 2)!
    expect(day.unit).toBe('tag')
    expect(day.kind).toBe('daily')
    // Eröffnung = erste, Hoch = höchstes, Tief = tiefstes, Schluss = letzter Wert des Tages
    expect(day.candles[0]).toMatchObject({ d: '2026-11-23', o: 9.8, h: 11.4, l: 9.7, c: 10.5 })
    expect(day.candles[1]).toMatchObject({ d: '2026-11-24', o: 11.8, h: 12.5, l: 10.8, c: 11.5 })
    expect(day.approx).toBe(false)
  })

  it('nähert Kerzen aus Schlusskursen, wenn Eröffnung/Hoch/Tief fehlen', () => {
    const r = toCandles(hourly(false), 'X', 2)!
    expect(r.approx).toBe(true)
    expect(r.candles[0]).toMatchObject({ o: 9.5, h: 11, l: 9.5, c: 10.5 })
  })

  it('übernimmt einen angehängten Live-Kurs in die letzte Kerze', () => {
    const c = hourly(true)
    const live = { ...c, t: [...c.t, c.t[5] + H], d: [...c.d, '2026-11-24'], series: { X: [...c.series.X, 13] } }
    const day = toCandles(live, 'X', 2)!
    expect(day.candles[1]).toMatchObject({ h: 13, c: 13 })
  })

  it('lässt Punkte ohne Handel weg', () => {
    const c = hourly(true)
    c.ohlc!.X.o[1] = null
    c.ohlc!.X.h[1] = null
    c.ohlc!.X.l[1] = null
    expect(toCandles(c, 'X', 10)!.candles).toHaveLength(5)
  })
})

describe('Hilfen', () => {
  it('weekOf liefert den Montag', () => {
    expect(weekOf('2026-11-27')).toBe('2026-11-23')
    expect(weekOf('2026-11-23')).toBe('2026-11-23')
  })
  it('sliceChart schneidet Kerzendaten mit', () => {
    const s = sliceChart(hourly(true), 'X', 3)
    expect(s.t).toHaveLength(3)
    expect(s.ohlc!.X.o).toEqual([11.8, 12, 11])
    expect(s.prev.X).toBe(10.5)
  })
})
