/**
 * Lokale Datenschnittstelle des Dashboards. Die Daten liegen als JSON-Dateien in data/
 * (eine Datei je Sammlung, Aufbau {id: Dokument}), genau wie die Startdaten der früheren Version.
 *
 *   GET  /api/db        alle Sammlungen ausser dem Kursverlauf
 *   GET  /api/history   Kursverlauf je Titel
 *   GET  /api/live      Live-Kurse (siehe live-quotes.ts); ?force=1 fragt sofort neu an
 *   GET  /api/chart     Kursverläufe für die Charts (siehe market-charts.ts); ?range=1T|1W|1M|3M|1J|5J|MAX&tickers=A,B
 *   POST /api/batch    { ops: [{ op: 'set' | 'merge' | 'delete', coll, id, data }] }
 *
 * Ändert jemand eine Datei von aussen (z. B. eine Kurs-Routine), lädt das Dashboard von selbst neu.
 */
import fs from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import path from 'node:path'
import type { Plugin } from 'vite'
import { liveQuotes } from './live-quotes.ts'
import { marketCharts } from './market-charts.ts'

const COLLECTIONS = ['positions', 'prices', 'watchlist', 'pots', 'events', 'log', 'transactions', 'dividends', 'snapshots', 'meta', 'market'] as const
type Coll = (typeof COLLECTIONS)[number]
type Doc = Record<string, unknown>
type Op = { op: 'set' | 'merge' | 'delete'; coll: Coll; id: string; data?: Doc }

const LOCAL_HOST = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/

export function depotApi(dataDir: string, opts: { env?: Record<string, string | undefined>; persistCloses?: boolean } = {}): Plugin {
  const live = liveQuotes(dataDir, opts.env ?? {}, opts.persistCloses ?? true)
  const charts = marketCharts(live)
  const file =(name: string) => path.join(dataDir, name + '.json')
  const read = (name: string): Record<string, Doc> => {
    try {
      return JSON.parse(fs.readFileSync(file(name), 'utf8'))
    } catch {
      return {}
    }
  }
  const write = (name: string, data: unknown) => {
    fs.mkdirSync(dataDir, { recursive: true })
    const tmp = file(name) + '.tmp'
    fs.writeFileSync(tmp, JSON.stringify(data, null, 1) + '\n', 'utf8')
    fs.renameSync(tmp, file(name))
  }
  const json = (res: ServerResponse, status: number, body: unknown) => {
    res.statusCode = status
    res.setHeader('Content-Type', 'application/json; charset=utf-8')
    res.setHeader('Cache-Control', 'no-store')
    res.end(JSON.stringify(body))
  }
  const body = (req: IncomingMessage) =>
    new Promise<string>((resolve, reject) => {
      let s = ''
      req.on('data', (c) => {
        s += c
        if (s.length > 2_000_000) reject(new Error('zu gross'))
      })
      req.on('end', () => resolve(s))
      req.on('error', reject)
    })

  const handle = async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    const url = (req.url ?? '').split('?')[0]
    if (!url.startsWith('/api/')) return next()
    // Nur Anfragen von diesem Rechner und von dieser Seite annehmen.
    if (!LOCAL_HOST.test(req.headers.host ?? '')) return json(res, 403, { error: 'nur lokal' })
    try {
      if (req.method === 'GET' && url === '/api/db') {
        return json(res, 200, Object.fromEntries(COLLECTIONS.map((c) => [c, read(c)])))
      }
      if (req.method === 'GET' && url === '/api/history') {
        const h = read('history') as unknown as { dates?: string[]; series?: Record<string, number[]> }
        return json(res, 200, { dates: h.dates ?? [], series: h.series ?? {} })
      }
      if (req.method === 'GET' && url === '/api/live') {
        return json(res, 200, await live(/[?&]force=1(&|$)/.test(req.url ?? '')))
      }
      if (req.method === 'GET' && url === '/api/chart') {
        const p = new URLSearchParams((req.url ?? '').split('?')[1] ?? '')
        return json(res, 200, await charts(p.get('range') ?? '', (p.get('tickers') ?? '').split(','), p.get('from') ?? undefined))
      }
      if (req.method === 'POST' && url === '/api/batch') {
        if (!(req.headers['content-type'] ?? '').includes('application/json')) return json(res, 415, { error: 'JSON erwartet' })
        const origin = req.headers.origin
        if (origin && !LOCAL_HOST.test(origin.replace(/^https?:\/\//, ''))) return json(res, 403, { error: 'fremde Herkunft' })
        const { ops } = JSON.parse(await body(req)) as { ops: Op[] }
        if (!Array.isArray(ops)) return json(res, 400, { error: 'ops fehlt' })
        const touched = new Map<Coll, Record<string, Doc>>()
        for (const o of ops) {
          if (!COLLECTIONS.includes(o.coll) || typeof o.id !== 'string' || !o.id || o.id === '__proto__') return json(res, 400, { error: 'ungültige Operation' })
          const data = touched.get(o.coll) ?? read(o.coll)
          if (o.op === 'delete') delete data[o.id]
          else if (o.op === 'set') data[o.id] = o.data ?? {}
          else if (o.op === 'merge') data[o.id] = { ...data[o.id], ...o.data }
          else return json(res, 400, { error: 'unbekannte Operation' })
          touched.set(o.coll, data)
        }
        for (const [c, data] of touched) write(c, data)
        return json(res, 200, { ok: true, changed: Object.fromEntries(touched) })
      }
      return json(res, 404, { error: 'unbekannt' })
    } catch (e) {
      return json(res, 500, { error: e instanceof Error ? e.message : String(e) })
    }
  }

  return {
    name: 'depot-api',
    configureServer(server) {
      server.middlewares.use(handle)
      // Dateien in data/ beobachten: Änderungen von aussen sofort im Browser zeigen.
      fs.mkdirSync(dataDir, { recursive: true })
      let timer: ReturnType<typeof setTimeout> | undefined
      const watcher = fs.watch(dataDir, (_event, name) => {
        if (!name || !String(name).endsWith('.json')) return
        clearTimeout(timer)
        timer = setTimeout(() => server.ws.send({ type: 'custom', event: 'depot:changed', data: {} }), 200)
      })
      server.httpServer?.once('close', () => watcher.close())
    },
    configurePreviewServer(server) {
      server.middlewares.use(handle)
    },
  }
}
