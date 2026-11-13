import type { BucketId, Category, Settings } from './types'

export interface Bucket {
  id: BucketId
  name: string
  short: string
  color: string
  /** harte Obergrenze (nur alte Depots ohne eigene Einstellung) */
  cap?: boolean
}

/** Farben der Kategorien in ihrer Reihenfolge */
export const PALETTE = ['var(--color-etf)', 'var(--color-aktien)', 'var(--color-zukunft)', 'var(--color-metalle)', '#a78bfa', '#f472b6', '#2dd4bf', '#fb7185', '#a3e635', '#fbbf24']
export const MAX_CATEGORIES = PALETTE.length

/** Kategorien älterer Depots ohne eigene Liste */
const LEGACY: (Category & { short: string; cap?: boolean })[] = [
  { id: 'etf', name: 'ETF-Kern', short: 'ETF', cap: true },
  { id: 'aktien', name: 'Einzelaktien', short: 'Aktien' },
  { id: 'zukunft', name: 'Zukunft', short: 'Zukunft' },
  { id: 'metalle', name: 'Metalle & Krypto', short: 'Metalle' },
]
/** Vorschlag für neue Konten; jeder passt sie unter Plan → Ziele an. */
export const DEFAULT_CATEGORIES: Category[] = [
  { id: 'etf', name: 'ETFs' },
  { id: 'aktien', name: 'Einzelaktien' },
  { id: 'weitere', name: 'Weitere' },
]

const CASH: Bucket = { id: 'cash', name: 'Cash', short: 'Cash', color: 'var(--color-cash)' }
const shortOf = (name: string) => (name.length <= 12 ? name : name.split(/\s+/)[0].slice(0, 12))
const build = (list: (Category & { short?: string; cap?: boolean })[]): Bucket[] =>
  list.map((c, i) => ({ id: c.id, name: c.name, short: c.short ?? shortOf(c.name), color: PALETTE[i % PALETTE.length], cap: c.cap }))

/**
 * Kategorien des Depots. Die Listen werden an Ort und Stelle angepasst, damit alle Ansichten sie ohne
 * Übergabe zeigen; compute() ruft applyCategories bei jeder Änderung auf.
 */
export const HOLDING_BUCKETS: Bucket[] = build(LEGACY)
export const BUCKETS: Bucket[] = [...HOLDING_BUCKETS, CASH]

/** Eigene Liste aus den Einstellungen; ohne Liste die alten Kategorien mit eigenen Namen. */
export function categoriesOf(s: Settings): Category[] {
  if (s.categories?.length) return s.categories
  return LEGACY.map((l) => ({ id: l.id, name: s.bucketNames?.[l.id]?.trim() || l.name }))
}
export function applyCategories(s: Settings) {
  const list = s.categories?.length ? s.categories : LEGACY.map((l) => ({ ...l, name: s.bucketNames?.[l.id]?.trim() || l.name, short: s.bucketNames?.[l.id]?.trim() ? undefined : l.short }))
  const next = build(list)
  HOLDING_BUCKETS.splice(0, HOLDING_BUCKETS.length, ...next)
  BUCKETS.splice(0, BUCKETS.length, ...next, CASH)
}

/** Gültige Kategorie einer Position: unbekannte (z. B. gelöschte) zählen zur Standard-Kategorie. */
export function catOf(id: string | undefined): BucketId {
  if (id && HOLDING_BUCKETS.some((b) => b.id === id)) return id
  return defaultCat()
}
/** Standard für neue Titel: «Einzelaktien», falls vorhanden, sonst die erste Kategorie. */
export const defaultCat = (): BucketId => (HOLDING_BUCKETS.find((b) => b.id === 'aktien') ?? HOLDING_BUCKETS[0])?.id ?? 'aktien'
export const bucketOf = (id: string | undefined) => BUCKETS.find((b) => b.id === id) ?? HOLDING_BUCKETS.find((b) => b.id === catOf(id)) ?? CASH
/** Neue, eindeutige Kennung */
export const newCategoryId = (taken: string[]) => {
  for (let i = 1; ; i++) if (!taken.includes('k' + i)) return 'k' + i
}
