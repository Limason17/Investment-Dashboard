import clsx from 'clsx'
import { cur, curRate } from '@/lib/format'

/** Ein Abschnitt der Zeitachse (Monat, Quartal, Halbjahr oder Jahr) mit zwei Werten */
export interface PeriodPair {
  key: string
  /** Beschriftung unter dem Balken, z. B. «Jun», «Q3», «H1», «2026» */
  label: string
  /** zweite Zeile, z. B. das Jahr beim ersten Abschnitt und bei jedem Jahreswechsel */
  year?: string
  /** ausgeschrieben für Tooltip und Vorleser, z. B. «Juni 2026», «Q3 2026» */
  title: string
  a: number
  b: number
}

/** Kurze Beschriftung über dem Balken: 903, 1.2k, 15k */
const short = (v: number) => (v >= 10000 ? `${Math.round(v / 1000)}k` : v >= 1000 ? `${(v / 1000).toFixed(1)}k` : String(Math.round(v)))

/**
 * Zwei Reihen je Abschnitt nebeneinander auf gemeinsamer Skala: Hilfslinien, Betrag über jedem Balken.
 * Oben die Summe je Reihe untereinander: Name links, Betrag rechts daneben. Abschnitte ohne Buchung bleiben leer.
 */
export function MonthBars({ months, labels, colors, format, current, height = 168 }: {
  months: PeriodPair[]
  labels: [string, string]
  colors: [string, string]
  format: (v: number) => string
  /** Schlüssel des laufenden Abschnitts (hervorgehoben) */
  current: string
  height?: number
}) {
  const max = Math.max(...months.flatMap((m) => [m.a, m.b]), 0)
  const sums = [months.reduce((s, m) => s + m.a, 0), months.reduce((s, m) => s + m.b, 0)]
  const top = 18 // Platz für die Beträge über den Balken
  const grid = max > 0 ? [1, 0.5] : []
  return (
    <div>
      <div className="mb-4 inline-grid grid-cols-[auto_auto] items-baseline gap-x-6 gap-y-1">
        {labels.map((l, i) => (
          <div key={l} className="contents">
            <div className="flex items-center gap-2 text-[12.5px] text-muted"><i className="swatch" style={{ background: colors[i] }} />{l}</div>
            <div className="num text-right text-[15px] font-semibold tracking-[-0.01em]">{format(sums[i])}</div>
          </div>
        ))}
      </div>
      <div className="relative" style={{ height }} role="img" aria-label={months.map((m) => `${m.title}: ${labels[0]} ${format(m.a)}, ${labels[1]} ${format(m.b)}`).join('; ')}>
        {grid.map((g) => (
          <div key={g} className="pointer-events-none absolute inset-x-0 border-t border-line" style={{ top: top + (1 - g) * (height - top) }} />
        ))}
        <div className="absolute inset-x-0 bottom-0 flex items-end gap-1 sm:gap-2" style={{ top }}>
          {months.map((m) => (
            <div key={m.key} className={clsx('flex h-full min-w-0 flex-1 items-end justify-center gap-[2px] rounded-t-md sm:gap-[3px]', m.key === current && 'bg-white/[0.025]')} title={`${m.title} · ${labels[0]} ${format(m.a)} ${cur()} · ${labels[1]} ${format(m.b)} ${cur()}`}>
              {[m.a, m.b].map((v, i) => (
                <span key={i} className="relative flex h-full w-full max-w-[13px] flex-col justify-end md:max-w-[26px]">
                  {v > 0 && <span className="num absolute inset-x-[-8px] text-center text-[10px] leading-none text-ink-2 max-md:hidden" style={{ bottom: `calc(${(v / max) * 100}% + 4px)` }}>{short(v * curRate())}</span>}
                  <i className="block w-full rounded-t-[3px] md:rounded-t-[4px]" style={{ height: max ? `${(v / max) * 100}%` : 0, minHeight: v > 0 ? 2 : 0, background: colors[i] }} />
                </span>
              ))}
            </div>
          ))}
        </div>
      </div>
      <div className="flex gap-1 border-t border-line-2 pt-1.5 sm:gap-2">
        {months.map((m) => (
          <span key={m.key} className={clsx('min-w-0 flex-1 text-center text-[10.5px] leading-none', m.key === current ? 'font-medium text-ink' : 'text-muted')}>
            {m.label}
            {m.year && <span className="mt-1 block text-[9.5px] text-faint">{m.year}</span>}
          </span>
        ))}
      </div>
    </div>
  )
}
