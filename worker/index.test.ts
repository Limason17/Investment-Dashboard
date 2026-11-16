/**
 * Kurs-Dienst: Herkunft, Methoden, Ticker-Prüfung und Anfragebremse. Yahoo wird nachgebaut, es geht nichts ins Netz.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import worker from './index.ts'

const SITE = 'https://limason17.github.io'
const call = (path: string, init: { origin?: string; method?: string; ip?: string } = {}) =>
  worker.fetch(
    new Request('https://depot-kurse.example.dev' + path, {
      method: init.method ?? 'GET',
      headers: { ...(init.origin ? { Origin: init.origin } : {}), 'CF-Connecting-IP': init.ip ?? '10.0.0.' + Math.floor(Math.random() * 250) },
    }),
    {},
  )

let urls: string[] = []
beforeEach(() => {
  urls = []
  vi.stubGlobal('fetch', vi.fn(async (u: string | URL | Request) => {
    urls.push(String(u))
    return new Response('{}', { status: 503 })
  }))
})
afterEach(() => vi.unstubAllGlobals())

describe('Kurs-Dienst', () => {
  it('erlaubt die eigene Seite und setzt CORS', async () => {
    const r = await call('/live?held=VTI', { origin: SITE })
    expect(r.status).toBe(200)
    expect(r.headers.get('Access-Control-Allow-Origin')).toBe(SITE)
    expect(r.headers.get('Cache-Control')).toBe('no-store')
  })
  it('weist fremde Seiten ab', async () => {
    const r = await call('/live?held=VTI', { origin: 'https://evil.example' })
    expect(r.status).toBe(403)
    expect(r.headers.get('Access-Control-Allow-Origin')).toBeNull()
    expect(urls).toEqual([])
  })
  it('weist Aufrufe ohne Herkunft ab (Skripte, fremde Server)', async () => {
    const r = await call('/live?held=VTI')
    expect(r.status).toBe(403)
    expect(await r.json()).toEqual({ error: 'Herkunft fehlt' })
    expect(urls).toEqual([])
  })
  it('beantwortet die CORS-Vorabfrage und nur GET', async () => {
    const o = await call('/live', { origin: SITE, method: 'OPTIONS' })
    expect(o.status).toBe(204)
    expect(o.headers.get('Access-Control-Allow-Methods')).toBe('GET')
    expect((await call('/live', { origin: SITE, method: 'POST' })).status).toBe(405)
  })
  it('unbekannte Pfade ergeben 404', async () => {
    expect((await call('/admin', { origin: SITE })).status).toBe(404)
  })
  it('fragt nur gültige Ticker ab', async () => {
    await call('/live?held=VTI,%3Cscript%3E,brk-b,../x,' + 'A'.repeat(20) + '&watch=CHF%3DX', { origin: SITE })
    const asked = urls.join(' ')
    expect(asked).toMatch(/VTI/)
    expect(asked).toMatch(/BRK-B/)
    expect(asked).toMatch(/CHF%3DX|CHF=X/)
    expect(asked).not.toMatch(/script|\.\.\/x|AAAAAAAAAAAAAAAAAAAA/)
  })
  it('bremst mehr als 90 Anfragen pro Minute und IP', async () => {
    let last = 0
    for (let i = 0; i < 92; i++) last = (await call('/nichts', { origin: SITE, ip: '192.0.2.1' })).status
    expect(last).toBe(429)
    expect((await call('/nichts', { origin: SITE, ip: '192.0.2.2' })).status).toBe(404)
  })
})
