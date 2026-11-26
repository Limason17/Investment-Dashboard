import { describe, expect, it } from 'vitest'
import { periodsSince } from './periods'

describe('periodsSince', () => {
  it('bis 1 Jahr: Monate ab der ersten Buchung, mindestens 6', () => {
    const a = periodsSince('2026-06-15', '2026-11-26')
    expect(a.unit).toBe('monat')
    expect(a.periods.map((p) => p.key)).toEqual(['2026-06', '2026-07', '2026-08', '2026-09', '2026-10', '2026-11'])
    expect(a.periods[0].year).toBe('2026')
    const b = periodsSince('2026-10-02', '2026-11-26')
    expect(b.periods).toHaveLength(6)
    expect(b.periods[0].key).toBe('2026-06')
    const c = periodsSince('2025-12-01', '2026-11-26')
    expect(c.unit).toBe('monat')
    expect(c.periods).toHaveLength(12)
    expect(c.periods[1]).toMatchObject({ key: '2026-01', year: '2026' })
  })

  it('über 1 Jahr: Quartale', () => {
    const a = periodsSince('2025-11-17', '2026-11-26')
    expect(a.unit).toBe('quartal')
    expect(a.periods.map((p) => p.label)).toEqual(['Q4', 'Q1', 'Q2', 'Q3', 'Q4'])
    expect(a.keyOf('2026-05-10')).toBe('2026-Q2')
  })

  it('über 3 Jahre: Halbjahre, über 6 Jahre: Jahre', () => {
    const a = periodsSince('2022-03-01', '2026-11-26')
    expect(a.unit).toBe('halbjahr')
    expect(a.periods[0]).toMatchObject({ key: '2022-H1', label: 'H1', year: '2022' })
    expect(a.periods.at(-1)!.key).toBe('2026-H2')
    expect(a.periods).toHaveLength(10)
    const b = periodsSince('2015-07-01', '2026-11-26')
    expect(b.unit).toBe('jahr')
    expect(b.periods).toHaveLength(12)
    expect(b.keyOf('2019-02-02')).toBe('2019')
  })
})
