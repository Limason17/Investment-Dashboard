import { useSyncExternalStore } from 'react'
import { closeUpdates } from './closes'
import { cloudBatch, cloudDeletePortfolio, cloudLoad, cloudPortfolios, cloudSavePortfolios, type Op as CloudOp } from './cloud'
import { CLOUD, QUOTES_URL } from './config'
import { aggregate, ALL, MAIN, MAX_PORTFOLIOS, newPortfolioId, portfolioList, toMap, type PortfolioInfo } from './portfolios'
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
  /** Portfolios des Kontos und das gewählte («all» = Gesamtansicht) */
  portfolios: PortfolioInfo[]
  portfolio: string
}

const PICK_KEY = 'depot:portfolio'
const remembered = () => {
  try {
    return localStorage.getItem(PICK_KEY) || MAIN
  } catch {
    return MAIN
  }
}
let state: State = { db: null, error: null, live: null, portfolios: portfolioList(null), portfolio: remembered() }
const listeners = new Set<() => void>()
const set = (p: Partial<State>) => {
  state = { ...state, ...p }
  listeners.forEach((l) => l())
}

const EMPTY: DB = { positions: {}, prices: {}, watchlist: {}, pots: {}, events: {}, log: {}, transactions: {}, dividends: {}, snapshots: {}, meta: {}, market: {} }

/** Ein Portfolio lesen: online aus Firestore, lokal aus data/ bzw. data/p/{id}/. */
async function fetchOne(pid: string): Promise<DB> {
  if (CLOUD) return { ...EMPTY, ...(await cloudLoad(pid)) }
  const r = await fetch('/api/db?p=' + encodeURIComponent(pid), { cache: 'no-store' })
  if (!r.ok) throw new Error('Daten nicht erreichbar (' + r.status + ')')
  return { ...EMPTY, ...(await r.json()) }
}

/** Portfolio-Liste lesen; ein gewähltes, das es nicht mehr gibt, fällt auf das Hauptportfolio zurück. */
export async function loadPortfolios() {
  try {
    const list = CLOUD ? await cloudPortfolios() : portfolioList((await (await fetch('/api/portfolios', { cache: 'no-store' })).json()).portfolios)
    const pick = state.portfolio === ALL ? (list.length > 1 ? ALL : MAIN) : list.some((p) => p.id === state.portfolio) ? state.portfolio : MAIN
    set({ portfolios: list, portfolio: pick })
  } catch {
    /* ohne Liste gilt das Hauptportfolio */
  }
}

let loadSeq = 0
export async function loadDb() {
  const seq = ++loadSeq
  const pid = state.portfolio
  try {
    if (pid === ALL) {
      const parts = await Promise.all(state.portfolios.map(async (info) => ({ info, db: await fetchOne(info.id) })))
      if (seq === loadSeq) set({ db: aggregate(parts), error: null })
      return
    }
    const db = await fetchOne(pid)
    if (seq !== loadSeq) return
    set({ db, error: null })
    // Neues Portfolio: Cash erst zählen, wenn der Saldo eingetragen ist (Eintrag → Ein-/Auszahlung → Cash-Stand).
    if (!db.meta.settings) await mutate([{ op: 'set', coll: 'meta', id: 'settings', data: { cash: 0, cashExcluded: true, withholding: 0.15, caps: [] } }])
  } catch (e) {
    if (seq === loadSeq) set({ error: e instanceof Error ? e.message : String(e) })
  }
}

/* ------------------------------------------------------------------ Portfolios verwalten */

export const getPortfolio = () => state.portfolio

/** Anderes Portfolio zeigen (oder «all» für die Gesamtansicht). */
export async function setPortfolio(pid: string) {
  if (pid === state.portfolio) return
  try {
    localStorage.setItem(PICK_KEY, pid)
  } catch {
    /* nur Komfort */
  }
  set({ portfolio: pid, db: null, error: null })
  await loadDb()
  void loadLive()
}

async function savePortfolios(list: PortfolioInfo[]) {
  if (CLOUD) await cloudSavePortfolios(list)
  else {
    const r = await fetch('/api/portfolios', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ portfolios: toMap(list) }) })
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'Speichern fehlgeschlagen')
  }
  set({ portfolios: list })
}

export async function createPortfolio(name: string) {
  const n = name.trim().slice(0, 40)
  if (!n) throw new Error('Namen eingeben.')
  if (state.portfolios.length >= MAX_PORTFOLIOS) throw new Error(`Höchstens ${MAX_PORTFOLIOS} Portfolios.`)
  const id = newPortfolioId(n, state.portfolios)
  await savePortfolios([...state.portfolios, { id, name: n, order: state.portfolios.length }])
  await setPortfolio(id)
  return id
}

export async function renamePortfolio(id: string, name: string) {
  const n = name.trim().slice(0, 40)
  if (!n) throw new Error('Namen eingeben.')
  await savePortfolios(state.portfolios.map((p) => (p.id === id ? { ...p, name: n } : p)))
}

export async function movePortfolio(id: string, dir: -1 | 1) {
  const list = [...state.portfolios]
  const i = list.findIndex((p) => p.id === id), j = i + dir
  if (i < 0 || j < 0 || j >= list.length) return
  ;[list[i], list[j]] = [list[j], list[i]]
  await savePortfolios(list.map((p, k) => ({ ...p, order: k })))
}

/** Löscht ein Portfolio mit allen Daten. Das Hauptportfolio bleibt immer. */
export async function deletePortfolio(id: string) {
  if (id === MAIN) throw new Error('Das Hauptportfolio lässt sich nicht löschen. Du kannst es umbenennen oder leeren.')
  if (CLOUD) await cloudDeletePortfolio(id)
  else {
    const r = await fetch('/api/portfolio-delete?p=' + encodeURIComponent(id), { method: 'POST' })
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'Löschen fehlgeschlagen')
  }
  await savePortfolios(state.portfolios.filter((p) => p.id !== id))
  if (state.portfolio === id || (state.portfolio === ALL && state.portfolios.length < 2)) await setPortfolio(MAIN)
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
  const fx = db.meta.settings?.fx ? [db.meta.settings.fx + '=X'] : []
  return { held: Object.values(db.positions).filter((p) => p.shares > 0).map((p) => p.ticker).join(','), watch: [...Object.keys(db.watchlist), ...fx].join(',') }
}
/** Online: Schlusskurse und Tageswert nach Börsenschluss ins Konto schreiben (lokal macht das der Server). */
let persisting = false
async function persistCloses() {
  const db = state.db, live = state.live
  if (!db || !live || persisting || state.portfolio === ALL) return
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
  const pid = state.portfolio
  if (pid === ALL) throw new Error('In der Gesamtansicht lässt sich nichts ändern. Wähle oben ein Portfolio.')
  if (CLOUD) {
    if (!state.db) throw new Error('Daten noch nicht geladen')
    const changed = await cloudBatch(state.db, ops, pid)
    if (ops.some((o) => o.coll === 'positions' || o.coll === 'watchlist')) setTimeout(() => void loadLive(), 0)
    set({ db: { ...state.db, ...changed } })
    return state.db!
  }
  const r = await fetch('/api/batch?p=' + encodeURIComponent(pid), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ops }) })
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
  await loadPortfolios()
  await loadDb()
  pollLive()
  // Dateien in data/ wurden von aussen geändert (z. B. Kurs-Routine): neu laden.
  import.meta.hot?.on('depot:changed', () => void loadPortfolios().then(loadDb))
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void loadDb()
  })
}
