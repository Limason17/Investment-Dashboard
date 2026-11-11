import { useSyncExternalStore } from 'react'
import type { DB, LiveResult } from './types'

export type Op = { op: 'set' | 'merge' | 'delete'; coll: keyof DB; id: string; data?: object }

interface State {
  db: DB | null
  error: string | null
  live: LiveResult | null
}

let state: State = { db: null, error: null, live: null }
const listeners = new Set<() => void>()
const set = (p: Partial<State>) => {
  state = { ...state, ...p }
  listeners.forEach((l) => l())
}

const EMPTY: DB = { positions: {}, prices: {}, watchlist: {}, pots: {}, events: {}, log: {}, transactions: {}, dividends: {}, snapshots: {}, meta: {}, market: {} }

export async function loadDb() {
  try {
    const r = await fetch('/api/db', { cache: 'no-store' })
    if (!r.ok) throw new Error('Daten nicht erreichbar (' + r.status + ')')
    set({ db: { ...EMPTY, ...(await r.json()) }, error: null })
  } catch (e) {
    set({ error: e instanceof Error ? e.message : String(e) })
  }
}

/** Live-Kurse vom lokalen Server (der fragt Yahoo und, falls eingerichtet, Alpaca). */
export async function loadLive(force = false) {
  try {
    const r = await fetch('/api/live' + (force ? '?force=1' : ''), { cache: 'no-store' })
    if (r.ok) set({ live: await r.json() })
    return r.ok
  } catch {
    /* ohne Live-Kurse gelten die gespeicherten Schlusskurse */
    return false
  }
}

/** Aktualisieren-Knopf: Kurse sofort neu bei den Quellen holen und alle Dateien aus data/ neu lesen. */
export async function refreshAll() {
  const [ok] = await Promise.all([loadLive(true), loadDb()])
  return { ok, live: state.live, error: state.error }
}

/** Während einer Sitzung alle 20 Sekunden, sonst alle 5 Minuten; nur bei sichtbarer Seite. */
function pollLive() {
  let timer: ReturnType<typeof setTimeout> | undefined
  let busy = false
  const tick = async () => {
    if (busy) return
    busy = true
    clearTimeout(timer)
    if (document.visibilityState === 'visible') await loadLive()
    busy = false
    const s = state.live?.session
    timer = setTimeout(tick, s && s !== 'closed' ? 20_000 : 300_000)
  }
  void tick()
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void tick()
  })
}

/** Schreibt mehrere Änderungen in einem Zug in data/*.json. */
export async function mutate(ops: Op[]) {
  const r = await fetch('/api/batch', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ops }) })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(j.error || 'Speichern fehlgeschlagen')
  if (state.db) set({ db: { ...state.db, ...j.changed } })
  return state.db!
}

export function useStore() {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => state,
  )
}

export function initStore() {
  void loadDb()
  pollLive()
  // Dateien in data/ wurden von aussen geändert (z. B. Kurs-Routine): neu laden.
  import.meta.hot?.on('depot:changed', () => void loadDb())
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void loadDb()
  })
}
