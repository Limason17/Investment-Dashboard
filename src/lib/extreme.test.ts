import { describe, expect, it } from 'vitest'
import { axisFormatter, cur0, money, pctPlain, px, pxMoney, qty, usd } from './format'

describe('Extremwerte in der Anzeige', () => {
  it('sehr grosse Beträge mit Tausendertrennung, ohne Exponent', () => {
    expect(usd(123_456_789_012.34)).toBe("123'456'789'012.34")
    expect(money(98_765_432.1)).toBe("98'765'432.10 USD")
    expect(cur0(1e15)).toBe("1'000'000'000'000'000")
    expect(usd(1e15)).not.toMatch(/e\+/)
  })

  it('Kurse unter 1 behalten bis zu vier Stellen, Beträge bleiben bei zwei', () => {
    expect(px(0.0042)).toBe('0.0042')
    expect(px(0.0123)).toBe('0.0123')
    expect(px(0.5)).toBe('0.50')
    expect(px(245.91)).toBe('245.91')
    expect(pxMoney(0.0042)).toBe('0.0042 USD')
    expect(px(0)).toBe('0.00')
    // Beträge: Rundungsrest bleibt 0.00 (nie «−0.00»)
    expect(usd(0.004)).toBe('0.00')
    expect(usd(-0.001)).toBe('0.00')
  })

  it('kleine Stückzahlen werden nicht zu 0', () => {
    expect(qty(0.00001)).toBe('0.00001')
    expect(qty(0.000123)).toBe('0.000123')
    expect(qty(0.5079)).toBe('0.5079')
    expect(qty(2_500_000)).toBe("2'500'000")
  })

  it('Prozent bei extremen Werten', () => {
    expect(pctPlain(123.456, 1)).toBe('12345.6 %')
    expect(pctPlain(-0.9999, 1)).toBe('−100.0 %')
  })

  it('Achsen: Millionen/Milliarden kurz, kleine Kurse unterscheidbar', () => {
    const big = axisFormatter([0, 5e6, 1e7, 1.5e7])
    expect(big(1.5e7)).toBe('15M')
    const huge = axisFormatter([0, 2e9, 4e9])
    expect(huge(4e9)).toBe('4B')
    const tiny = axisFormatter([0.0042, 0.0044, 0.0046])
    expect(new Set([0.0042, 0.0044, 0.0046].map(tiny)).size).toBe(3)
    expect(tiny(0.0044)).toBe('0.0044')
    const normal = axisFormatter([200, 250, 300])
    expect(normal(250)).toBe('250')
  })
})
