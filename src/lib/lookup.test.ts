import { afterEach, describe, expect, it, vi } from 'vitest'
import { lookupTicker } from './store'

const reply = (body: unknown, ok = true) => vi.fn(async () => ({ ok, json: async () => body }))
afterEach(() => vi.unstubAllGlobals())

describe('Ticker beim Kauf prüfen', () => {
  it('gefunden: Name und Kurs', async () => {
    vi.stubGlobal('fetch', reply({ quotes: { AAPL: { name: 'Apple Inc.', price: 353.61 } }, failures: [] }))
    expect(await lookupTicker('AAPL')).toEqual({ found: true, name: 'Apple Inc.', price: 353.61 })
  })
  it('unbekannter Ticker: nicht gefunden', async () => {
    vi.stubGlobal('fetch', reply({ quotes: {}, failures: ['ZZZQX (Not Found)'] }))
    expect(await lookupTicker('ZZZQX')).toEqual({ found: false })
  })
  it('Netzfehler oder Dienst nicht erreichbar: keine Aussage', async () => {
    vi.stubGlobal('fetch', reply({}, false))
    expect(await lookupTicker('AAPL')).toBeNull()
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline') }))
    expect(await lookupTicker('AAPL')).toBeNull()
  })
})
