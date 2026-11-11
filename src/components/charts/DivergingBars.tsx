import { motion } from 'motion/react'
import type { ReactNode } from 'react'
import { Empty } from '../ui'

export interface BarRow {
  key: string
  label: string
  title?: string
  value: number
  /** Zusatz am rechten Rand, z. B. der Betrag */
  right?: ReactNode
}

/**
 * Rangliste mit Balken ab der Mittellinie: Gewinner nach rechts, Verlierer nach links,
 * der Wert steht an der Balkenspitze. Sortiert vom grössten Plus zum grössten Minus.
 */
export function DivergingBars({ rows, format, onSelect, ariaLabel, edges, empty = 'Noch keine Werte.' }: {
  rows: BarRow[]
  format: (v: number) => string
  onSelect?: (key: string) => void
  ariaLabel: string
  /** nur die n stärksten und n schwächsten zeigen */
  edges?: number
  empty?: string
}) {
  const sorted = [...rows].sort((a, b) => b.value - a.value)
  if (!sorted.length) return <Empty>{empty}</Empty>
  const cut = edges != null && sorted.length > edges * 2 + 1
  const list = cut ? [...sorted.slice(0, edges), null, ...sorted.slice(-edges!)] : sorted
  const max = Math.max(1e-9, ...sorted.map((r) => Math.abs(r.value)))
  const ROOM = 58 // Platz für die Zahl an der Balkenspitze
  return (
    <div role="list" aria-label={ariaLabel}>
      {list.map((r, i) => {
        if (!r) return <div key="gap" role="listitem" className="py-1 pl-[58px] text-[11.5px] text-faint">· · · {sorted.length - edges! * 2} weitere dazwischen</div>
        const up = r.value >= 0
        const ratio = Math.abs(r.value) / max
        const w = `max(2px, calc((50% - ${ROOM}px) * ${ratio.toFixed(4)}))`
        const tip = `calc(50% + (50% - ${ROOM}px) * ${ratio.toFixed(4)} + 7px)`
        return (
          <button
            key={r.key}
            type="button"
            role="listitem"
            onClick={() => onSelect?.(r.key)}
            title={r.title}
            className="group grid h-[28px] w-full grid-cols-[52px_minmax(0,1fr)_auto] items-center rounded-md px-1.5 text-left transition-colors hover:bg-white/[0.035]"
          >
            <span className="tk">{r.label}</span>
            <span className="relative h-full">
              <i className="absolute inset-y-0 left-1/2 w-px bg-line-2" />
              <motion.i
                className={`absolute top-1/2 block h-[10px] -translate-y-1/2 ${up ? 'rounded-r-[4px] bg-up' : 'rounded-l-[4px] bg-down'} opacity-85 transition-opacity group-hover:opacity-100`}
                style={up ? { left: '50%', width: w, transformOrigin: 'left' } : { right: '50%', width: w, transformOrigin: 'right' }}
                initial={{ scaleX: 0 }}
                animate={{ scaleX: 1 }}
                transition={{ duration: 0.6, delay: 0.015 * i, ease: [0.22, 1, 0.36, 1] }}
              />
              <span className="num absolute top-1/2 -translate-y-1/2 text-[11.5px] text-ink-2" style={up ? { left: tip } : { right: tip }}>
                {format(r.value)}
              </span>
            </span>
            {r.right != null && <span className="num min-w-[64px] pl-2 text-right text-[12px] text-muted">{r.right}</span>}
          </button>
        )
      })}
    </div>
  )
}
