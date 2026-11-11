import { useEffect, useState, useSyncExternalStore } from 'react'
import type { ChartData, RangeId } from './types'
import { apiUrl } from './store'

/** Beschriftung der Zeiträume: kurz für den Umschalter, ausgeschrieben für Sätze. */
export const RANGE_LABEL: Record<RangeId, string> = { '1T': '1T', '1W': '1W', '1M': '1M', '3M': '3M', '1J': '1J', '5J': '5J', MAX: 'Max' }
export const RANGE_TEXT: Record<RangeId, string> = { '1T': 'heute', '1W': '1 Woche', '1M': '1 Monat', '3M': '3 Monate', '1J': '1 Jahr', '5J': '5 Jahre', MAX: 'seit Beginn' }
export const RANGE_TITLE: Record<RangeId, string> = { '1T': 'Tag', '1W': 'Woche', '1M': 'Monat', '3M': '3 Monate', '1J': 'Jahr', '5J': '5 Jahre', MAX: 'seit Beginn' }
/** Ungefähre Länge in Tagen, um Zeiträume auszublenden, die länger sind als das Depot alt ist. */
export const RANGE_DAYS: Record<RangeId, number> = { '1T': 1, '1W': 7, '1M': 31, '3M': 92, '1J': 366, '5J': 1827, MAX: Infinity }

const MIN = 60_000
/** So lange gilt ein geladener Verlauf als frisch; danach wird im Hintergrund neu geholt. */
const MAX_AGE: Record<RangeId, number> = { '1T': MIN, '1W': 5 * MIN, '1M': 15 * MIN, '3M': 30 * MIN, '1J': 30 * MIN, '5J': 120 * MIN, MAX: 30 * MIN }

const cache = new Map<string, { at: number; data: ChartData }>()
const inflight = new Map<string, Promise<ChartData>>()
let version = 0
const subs = new Set<() => void>()
const subscribe = (l: () => void) => {
  subs.add(l)
  return () => {
    subs.delete(l)
  }
}

/** Aktualisieren-Knopf: alle sichtbaren Verläufe neu holen (die bisherigen bleiben stehen, bis die neuen da sind). */
export function refreshCharts() {
  version++
  for (const e of cache.values()) e.at = 0
  subs.forEach((l) => l())
}

function load(key: string, url: string | null) {
  if (!url) return Promise.reject(new Error('Kurs-Dienst nicht eingerichtet'))
  let p = inflight.get(key)
  if (!p) {
    p = fetch(url, { cache: 'no-store' })
      .then(async (r) => {
        const j = await r.json().catch(() => null)
        if (!r.ok || !j || !Array.isArray(j.t)) throw new Error(j?.error || 'Kursverlauf nicht erreichbar (' + r.status + ')')
        cache.set(key, { at: Date.now(), data: j as ChartData })
        return j as ChartData
      })
      .finally(() => inflight.delete(key))
    inflight.set(key, p)
  }
  return p
}

/**
 * Kursverlauf mehrerer Titel für einen Zeitraum. Beim Wechsel des Zeitraums bleibt der bisherige
 * Verlauf sichtbar («pending»), bis der neue geladen ist.
 */
export function useChart(range: RangeId, tickers: string[], from?: string | null) {
  const list = [...new Set(tickers)].sort().join(',')
  const key = list ? `${range}|${range === 'MAX' ? (from ?? '') : ''}|${list}` : ''
  const v = useSyncExternalStore(subscribe, () => version)
  const [res, setRes] = useState<{ key: string; data: ChartData } | null>(null)
  const [err, setErr] = useState<{ key: string; msg: string } | null>(null)

  useEffect(() => {
    if (!key) return
    let alive = true
    const url = apiUrl('chart', { range, tickers: list, ...(range === 'MAX' && from ? { from } : {}) })
    const run = () =>
      load(key, url)
        .then((data) => {
          if (!alive) return
          setRes({ key, data })
          setErr(null)
        })
        .catch((e) => alive && setErr({ key, msg: e instanceof Error ? e.message : String(e) }))
    const hit = cache.get(key)
    if (!hit || Date.now() - hit.at > MAX_AGE[range]) void run()
    const id = setInterval(() => {
      if (document.visibilityState === 'visible') void run()
    }, MAX_AGE[range])
    return () => {
      alive = false
      clearInterval(id)
    }
  }, [key, v, range, list, from])

  const fresh = key ? (res?.key === key ? res.data : (cache.get(key)?.data ?? null)) : null
  return {
    /** passender Verlauf oder, solange der neue lädt, der zuletzt gezeigte */
    data: fresh ?? (key ? (res?.data ?? null) : null),
    pending: !!key && !fresh,
    error: err && err.key === key && !fresh ? err.msg : null,
  }
}
