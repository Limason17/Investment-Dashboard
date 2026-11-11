import { useCallback, useMemo, useState, useSyncExternalStore } from 'react'
import { RANGE_DAYS, useChart } from './charts'
import { useDepot } from './context'
import { daysBetween } from './format'
import { heldSince, portfolioSeries, timeline, withNow } from './history'
import type { RangeId } from './types'

/** Auswahl, die über das Neuladen hinweg erhalten bleibt (nur auf diesem Gerät). */
export function useStored<T extends string>(key: string, initial: T, allowed?: readonly T[]) {
  const [v, setV] = useState<T>(() => {
    try {
      const s = localStorage.getItem(key) as T | null
      return s != null && (!allowed || allowed.includes(s)) ? s : initial
    } catch {
      return initial
    }
  })
  const set = useCallback(
    (next: T) => {
      setV(next)
      try {
        localStorage.setItem(key, next)
      } catch {
        /* ohne Speicher gilt die Auswahl bis zum Neuladen */
      }
    },
    [key],
  )
  return [v, set] as const
}

/** Trifft eine Media Query zu (z. B. '(min-width: 768px)')? */
export function useMedia(query: string) {
  return useSyncExternalStore(
    (l) => {
      const m = matchMedia(query)
      m.addEventListener('change', l)
      return () => m.removeEventListener('change', l)
    },
    () => matchMedia(query).matches,
  )
}

/** Vergleichsindex der Rendite: der US-Gesamtmarkt. */
export const BENCH = 'VTI'
const shift = (date: string, days: number) => new Date(Date.parse(date + 'T12:00:00Z') + days * 864e5).toISOString().slice(0, 10)

/** Zeiträume, die zum Alter des Depots passen: nichts anbieten, was länger ist als das Depot alt. */
export function usePortfolioRanges(): RangeId[] {
  const { db, now } = useDepot()
  const first = useMemo(() => timeline(db).first, [db.transactions, db.dividends, db.positions]) // eslint-disable-line react-hooks/exhaustive-deps -- nur Buchungen und Bestand zählen
  const age = first ? daysBetween(first, now) : Infinity
  return (['1T', '1W', '1M', '3M', '1J'] as RangeId[]).filter((r) => RANGE_DAYS[r] <= age + 3).concat('MAX')
}

/** Wertverlauf des Depots für einen Zeitraum: Buchungen × Kursverläufe, am Ende der Live-Stand. */
export function usePortfolio(range: RangeId) {
  const { db, now } = useDepot()
  const tl = useMemo(() => timeline(db), [db.transactions, db.dividends, db.positions]) // eslint-disable-line react-hooks/exhaustive-deps -- nur Buchungen und Bestand zählen
  const since = range === '1J' || range === '5J' || range === 'MAX' ? null : shift(now, -(RANGE_DAYS[range] + 6))
  const tickers = useMemo(() => [...new Set([...heldSince(tl, since), BENCH])], [tl, since])
  const { data, pending, error } = useChart(range, tickers, tl.first)
  const chart = useMemo(() => (data ? withNow(db, data) : null), [db, data])
  const series = useMemo(() => (chart ? portfolioSeries(db, tl, chart, BENCH) : null), [db, tl, chart])
  return { tl, chart, series, pending, error }
}
