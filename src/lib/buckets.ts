import type { BucketId } from './types'

export interface Bucket {
  id: BucketId
  name: string
  short: string
  color: string
  target: number
  /** harte Obergrenze */
  cap?: boolean
  /** «bis zu» */
  max?: boolean
}

/** Feste Reihenfolge: Farbe folgt dem Baustein, nie dem Rang. */
export const BUCKETS: Bucket[] = [
  { id: 'etf', name: 'ETF-Kern', short: 'ETF', color: 'var(--color-etf)', target: 35, cap: true },
  { id: 'aktien', name: 'Einzelaktien', short: 'Aktien', color: 'var(--color-aktien)', target: 42 },
  { id: 'zukunft', name: 'Zukunft', short: 'Zukunft', color: 'var(--color-zukunft)', target: 11, max: true },
  { id: 'metalle', name: 'Metalle & Krypto', short: 'Metalle', color: 'var(--color-metalle)', target: 9 },
  { id: 'cash', name: 'Cash', short: 'Cash', color: 'var(--color-cash)', target: 3 },
]
export const HOLDING_BUCKETS = BUCKETS.filter((b) => b.id !== 'cash')
export const bucketOf = (id: string | undefined) => BUCKETS.find((b) => b.id === id) ?? BUCKETS[1]

const DEFAULT_NAMES = Object.fromEntries(BUCKETS.map((b) => [b.id, { name: b.name, short: b.short }])) as Record<BucketId, { name: string; short: string }>

/**
 * Eigene Namen der Bausteine (Plan → Bearbeiten). Die Liste BUCKETS wird an Ort und Stelle angepasst,
 * damit alle Ansichten den Namen ohne weitere Übergabe zeigen; compute() ruft das bei jeder Änderung auf.
 */
export function applyBucketNames(names?: Partial<Record<BucketId, string>>) {
  for (const b of BUCKETS) {
    const n = names?.[b.id]?.trim()
    b.name = n || DEFAULT_NAMES[b.id].name
    b.short = n ? (n.length <= 12 ? n : n.split(/\s+/)[0].slice(0, 12)) : DEFAULT_NAMES[b.id].short
  }
}
export const defaultBucketName = (id: BucketId) => DEFAULT_NAMES[id].name
