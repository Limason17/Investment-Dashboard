import clsx from 'clsx'
import { MONTHS } from '@/lib/format'

export interface MonthPair {
  key: string // JJJJ-MM
  a: number
  b: number
}

/**
 * Zwei Reihen je Monat nebeneinander auf gemeinsamer Skala. Bewusst schlicht: eine Hilfslinie am Höchstwert,
 * die genauen Beträge stehen im Tooltip und in der Tabelle darunter.
 */
export function MonthBars({ months, labels, colors, format, current, height = 132 }: {
  months: MonthPair[]
  labels: [string, string]
  colors: [string, string]
  format: (v: number) => string
  current: string
  height?: number
}) {
  const max = Math.max(...months.flatMap((m) => [m.a, m.b]), 0)
  const name = (key: string) => MONTHS[Number(key.slice(5, 7)) - 1]
  return (
    <div>
      <div className="relative" style={{ height }} role="img" aria-label={months.map((m) => `${name(m.key)} ${m.key.slice(0, 4)}: ${labels[0]} ${format(m.a)}, ${labels[1]} ${format(m.b)}`).join('; ')}>
        {max > 0 && (
          <div className="pointer-events-none absolute inset-x-0 top-0 border-t border-dashed border-line-2">
            <span className="num absolute right-0 top-1 text-[10.5px] leading-none text-faint">{format(max)}</span>
          </div>
        )}
        <div className="absolute inset-0 flex items-end gap-1 sm:gap-2">
          {months.map((m) => (
            <div key={m.key} className="flex h-full min-w-0 flex-1 items-end justify-center gap-[2px] sm:gap-[3px]" title={`${name(m.key)} ${m.key.slice(0, 4)} · ${labels[0]} ${format(m.a)} · ${labels[1]} ${format(m.b)}`}>
              {[m.a, m.b].map((v, i) => (
                <i key={i} className="block w-full max-w-[13px] rounded-t-[3px] md:max-w-[26px] md:rounded-t-[4px]" style={{ height: max ? `${(v / max) * 100}%` : 0, minHeight: v > 0 ? 2 : 0, background: colors[i] }} />
              ))}
            </div>
          ))}
        </div>
      </div>
      <div className="flex gap-1 border-t border-line pt-1.5 sm:gap-2">
        {months.map((m) => (
          <span key={m.key} className={clsx('min-w-0 flex-1 text-center text-[10.5px] leading-none', m.key === current ? 'font-medium text-ink' : 'text-faint')}>{name(m.key)}</span>
        ))}
      </div>
      <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-[12px] text-muted">
        {labels.map((l, i) => <span key={l} className="inline-flex items-center gap-2"><i className="swatch" style={{ background: colors[i] }} />{l}</span>)}
      </div>
    </div>
  )
}
