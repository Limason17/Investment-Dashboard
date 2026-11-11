import { useSyncExternalStore } from 'react'
import { closeUpdates } from './closes'
import { cloudBatch, cloudLoad, type Op as CloudOp } from './cloud'
import { CLOUD, QUOTES_URL } from './config'
import type { DB, LiveResult } from './types'

/**
 * Datenzugriff. Lokal: data/*.json über den Vite-Server (/api/…). Online (CLOUD): Firestore des
 * angemeldeten Kontos und Kurse über den Kurs-Dienst (QUOTES_URL).
 */
export type Op = CloudOp

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
    if (CLOUD) {
      const db = { ...EMPTY, ...(await cloudLoad()) }
      set({ db, error: null })
      // Neues Konto: Cash erst zählen, wenn der Saldo eingetragen ist (Eintrag → Ein-/Auszahlung → Cash-Stand korrigieren).
      if (!db.meta.settings) await mutate([{ op: 'set', coll: 'meta', id: 'settings', data: { cash: 0, cashExcluded: true, withholding: 0.15, caps: [] } }])
      return
    }
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
    if (CLOUD && !state.db) return false
    const url = apiUrl('live', CLOUD ? { ...tickerParams(), ...(force ? { force: '1' } : {}) } : force ? { force: '1' } : {})
    if (!url) return false
    const r = await fetch(url, { cache: 'no-store' })
    if (r.ok) set({ live: await r.json() })
    if (r.ok && CLOUD) void persistCloses()
    return r.ok
  } catch {
    /* ohne Live-Kurse gelten die gespeicherten Schlusskurse */
    return false
  }
}

/** Adresse einer Kurs-Abfrage (live, chart); null, wenn online kein Kurs-Dienst eingerichtet ist. */
export function apiUrl(path: 'live' | 'chart', params: Record<string, string>) {
  const q = new URLSearchParams(params).toString()
  if (!CLOUD) return `/api/${path}${q ? '?' + q : ''}`
  return QUOTES_URL ? `${QUOTES_URL}/${path}${q ? '?' + q : ''}` : null
}
function tickerParams() {
  const db = state.db
  if (!db) return { held: '', watch: '' }
  return { held: Object.values(db.positions).filter((p) => p.shares > 0).map((p) => p.ticker).join(','), watch: Object.keys(db.watchlist).join(',') }
}
/** Online: Schlusskurse und Tageswert nach Börsenschluss ins Konto schreiben (lokal macht das der Server). */
let persisting = false
async function persistCloses() {
  const db = state.db, live = state.live
  if (!db || !live || persisting) return
  const u = closeUpdates(db.positions, db.prices as never, db.snapshots, db.meta.settings, live.quotes)
  if (!u) return
  persisting = true
  try {
    await mutate([
      ...Object.entries(u.prices).map(([id, data]): Op => ({ op: 'set', coll: 'prices', id, data })),
      ...(u.snapshot ? [{ op: 'set', coll: 'snapshots', id: u.snapshot.date, data: u.snapshot } as Op] : []),
    ])
  } catch {
    /* Festhalten ist optional */
  } finally {
    persisting = false
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
  if (CLOUD) {
    if (!state.db) throw new Error('Daten noch nicht geladen')
    const changed = await cloudBatch(state.db, ops)
    set({ db: { ...state.db, ...changed } })
    return state.db!
  }
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

let started = false
/** Einmal starten: lokal sofort, online nach dem Anmelden (Abmelden lädt die Seite neu). */
export async function initStore() {
  if (started) return
  started = true
  await loadDb()
  pollLive()
  // Dateien in data/ wurden von aussen geändert (z. B. Kurs-Routine): neu laden.
  import.meta.hot?.on('depot:changed', () => void loadDb())
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void loadDb()
  })
}
