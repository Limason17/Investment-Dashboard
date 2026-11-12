/**
 * Kurs-Dienst für die Online-Version (Cloudflare Worker, Gratis-Tarif).
 * Yahoo Finance erlaubt keine Abfragen direkt aus dem Browser; dieser Worker fragt stellvertretend an.
 * Er speichert nichts und kennt keine Konten: Er bekommt nur Ticker und gibt Kurse zurück.
 *
 *   GET /live?held=VTI,UBER&watch=MSFT[&force=1]   wie /api/live im lokalen Server
 *   GET /chart?range=1M&tickers=VTI,UBER[&from=…]   wie /api/chart
 *
 * Optional: ALPACA_KEY_ID und ALPACA_SECRET_KEY als Secret (Overnight-Kurse), ALLOWED_ORIGINS als Variable.
 */
import { marketCharts } from '../server/market-charts.ts'
import { liveQuotes } from '../server/live-quotes.ts'

interface Env {
  ALPACA_KEY_ID?: string
  ALPACA_SECRET_KEY?: string
  ALLOWED_ORIGINS?: string
}

const TICKER = /^[A-Z0-9][A-Z0-9.\-^=]{0,11}$/
const MAX_TICKERS = 80
const list = (v: string | null) => [...new Set((v ?? '').split(',').map((t) => t.trim().toUpperCase()).filter((t) => TICKER.test(t)))].slice(0, MAX_TICKERS)

// Ein Kurs-Cache je Ticker-Liste, solange die Worker-Instanz lebt (spart Abfragen bei mehreren offenen Fenstern).
type Live = ReturnType<typeof liveQuotes>
const pools = new Map<string, { live: Live; charts: ReturnType<typeof marketCharts> }>()
function pool(held: string[], watch: string[], env: Env) {
  const key = held.join(',') + '|' + watch.join(',')
  let p = pools.get(key)
  if (!p) {
    if (pools.size > 200) pools.clear()
    const live = liveQuotes({ tickers: () => ({ held, watch }) }, env as Record<string, string | undefined>)
    p = { live, charts: marketCharts(live) }
    pools.set(key, p)
  }
  return p
}

// Anfragebremse je IP und Worker-Instanz: höchstens 90 Anfragen pro Minute (die App braucht wenige pro Minute).
const LIMIT = 90
const hits = new Map<string, { n: number; t: number }>()
function tooMany(ip: string) {
  const now = Date.now()
  const h = hits.get(ip)
  if (!h || now - h.t > 60_000) {
    if (hits.size > 5000) hits.clear()
    hits.set(ip, { n: 1, t: now })
    return false
  }
  return ++h.n > LIMIT
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const origin = req.headers.get('Origin') ?? ''
    const allowed = (env.ALLOWED_ORIGINS ?? 'https://limason17.github.io,http://localhost:5173,http://localhost:5175,http://localhost:5177,http://localhost:4173').split(',').map((s) => s.trim())
    const cors: Record<string, string> = allowed.includes(origin) ? { 'Access-Control-Allow-Origin': origin, Vary: 'Origin' } : {}
    const json = (status: number, body: unknown) =>
      new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...cors } })
    if (tooMany(req.headers.get('CF-Connecting-IP') ?? 'unbekannt')) return json(429, { error: 'zu viele Anfragen' })

    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: { ...cors, 'Access-Control-Allow-Methods': 'GET', 'Access-Control-Max-Age': '86400' } })
    if (req.method !== 'GET') return json(405, { error: 'nur GET' })
    if (origin && !cors['Access-Control-Allow-Origin']) return json(403, { error: 'fremde Herkunft' })

    const url = new URL(req.url)
    try {
      if (url.pathname === '/live') {
        const held = list(url.searchParams.get('held')), watch = list(url.searchParams.get('watch'))
        return json(200, await pool(held, watch, env).live(url.searchParams.get('force') === '1'))
      }
      if (url.pathname === '/chart') {
        const tickers = list(url.searchParams.get('tickers'))
        const { charts } = pool(tickers, [], env)
        return json(200, await charts(url.searchParams.get('range') ?? '', tickers, url.searchParams.get('from') ?? undefined))
      }
      return json(404, { error: 'unbekannt' })
    } catch (e) {
      return json(500, { error: e instanceof Error ? e.message : String(e) })
    }
  },
}
