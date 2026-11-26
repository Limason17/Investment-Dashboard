import { MONTHS } from './format'

export type PeriodUnit = 'monat' | 'quartal' | 'halbjahr' | 'jahr'

export interface Period {
  key: string
  label: string
  year?: string
  title: string
}

/** Mehrzahl für die Unterzeile, z. B. «8 Quartale» */
export const UNIT_PLURAL: Record<PeriodUnit, [string, string]> = {
  monat: ['Monat', 'Monate'],
  quartal: ['Quartal', 'Quartale'],
  halbjahr: ['Halbjahr', 'Halbjahre'],
  jahr: ['Jahr', 'Jahre'],
}

/**
 * Zeitachse für Käufe und Verkäufe ab der ersten Buchung bis heute, höchstens etwa 12 Balken:
 * bis 1 Jahr Monate (mindestens 6), bis 3 Jahre Quartale, bis 6 Jahre Halbjahre, darüber Jahre.
 */
export function periodsSince(first: string, now: string): { unit: PeriodUnit; periods: Period[]; keyOf: (date: string) => string } {
  const fy = Number(first.slice(0, 4)), fm = Number(first.slice(5, 7))
  const ny = Number(now.slice(0, 4)), nm = Number(now.slice(5, 7))
  const span = ny * 12 + nm - (fy * 12 + fm) + 1
  const unit: PeriodUnit = span <= 12 ? 'monat' : span <= 36 ? 'quartal' : span <= 72 ? 'halbjahr' : 'jahr'
  // Abschnitt eines Monats (1–12): Index innerhalb des Jahres
  const per = unit === 'monat' ? 12 : unit === 'quartal' ? 4 : unit === 'halbjahr' ? 2 : 1
  const part = (m: number) => Math.floor((m - 1) / (12 / per))
  const keyOfYM = (y: number, m: number) =>
    unit === 'monat' ? `${y}-${String(m).padStart(2, '0')}` : unit === 'quartal' ? `${y}-Q${part(m) + 1}` : unit === 'halbjahr' ? `${y}-H${part(m) + 1}` : String(y)
  const keyOf = (date: string) => keyOfYM(Number(date.slice(0, 4)), Number(date.slice(5, 7)))

  // Startabschnitt: Monat der ersten Buchung, bei Monaten mindestens 6 Monate zurück
  let y = fy, p = part(fm)
  if (unit === 'monat' && span < 6) {
    const start = ny * 12 + (nm - 1) - 5
    y = Math.floor(start / 12)
    p = start % 12
  }
  const periods: Period[] = []
  const endY = ny, endP = part(nm)
  for (let guard = 0; guard < 200 && (y < endY || (y === endY && p <= endP)); guard++) {
    const first = periods.length === 0
    if (unit === 'monat') periods.push({ key: `${y}-${String(p + 1).padStart(2, '0')}`, label: MONTHS[p], year: first || p === 0 ? String(y) : undefined, title: `${MONTHS[p]} ${y}` })
    else if (unit === 'quartal') periods.push({ key: `${y}-Q${p + 1}`, label: `Q${p + 1}`, year: first || p === 0 ? String(y) : undefined, title: `Q${p + 1} ${y}` })
    else if (unit === 'halbjahr') periods.push({ key: `${y}-H${p + 1}`, label: `H${p + 1}`, year: first || p === 0 ? String(y) : undefined, title: `${p + 1}. Halbjahr ${y}` })
    else periods.push({ key: String(y), label: String(y), title: String(y) })
    p++
    if (p >= per) { p = 0; y++ }
  }
  return { unit, periods, keyOf }
}
