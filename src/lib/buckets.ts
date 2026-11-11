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
