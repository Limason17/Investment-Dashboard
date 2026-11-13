import { scaleLinear } from 'd3-scale'
import { motion, useReducedMotion } from 'motion/react'
import { useState, type KeyboardEvent } from 'react'
import { axisFormatter, MONTHS, usd } from '@/lib/format'
import type { Dividend } from '@/lib/types'
import { useMeasure } from '@/lib/useMeasure'

export interface DivMonth {
  key: string // JJJJ-MM
  received: number
  expected: number
  items: Dividend[]
}

export const DIV_RECEIVED = 'var(--color-accent)'
export const DIV_EXPECTED = '#5b5fd6'

const topRounded = (x: number, y: number, w: number, h: number, r: number) => {
  if (h <= 0) return ''
  r = Math.min(r, h, w / 2)
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`
}

/** Dividenden je Monat, netto: erhalten unten, erwartet darüber (dunklerer Schritt derselben Farbe). */
export function DividendBars({ months, current, height = 236 }: { months: DivMonth[]; current: string; height?: number }) {
  const [ref, W] = useMeasure<HTMLDivElement>()
  const [hi, setHi] = useState<number | null>(null)
  const reduce = useReducedMotion()
  const L = 38, R = 8, T = 22, B = 28
  const iw = Math.max(10, W - L - R), ih = height - T - B
  const band = iw / months.length
  const bw = Math.min(22, Math.max(6, band - 12))
  const max = Math.max(1, ...months.map((m) => m.received + m.expected))
  const y = scaleLinear().domain([0, max]).range([T + ih, T]).nice(4)
  const ticks = y.ticks(4)
  const fmt = axisFormatter(ticks)
  const peak = months.reduce((best, m, i) => (m.received + m.expected > months[best].received + months[best].expected ? i : best), 0)

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'ArrowLeft') setHi(Math.max(0, (hi ?? months.length) - 1))
    else if (e.key === 'ArrowRight') setHi(Math.min(months.length - 1, (hi ?? -1) + 1))
    else if (e.key === 'Escape') setHi(null)
    else return
    e.preventDefault()
  }
  const label = (k: string) => MONTHS[+k.slice(5) - 1] + (k.slice(5) === '01' ? ' ' + k.slice(2, 4) : '')
  const h = hi != null ? months[hi] : null
  const tipRight = hi != null && hi > months.length / 2

  return (
    <div ref={ref} className="relative select-none rounded-lg outline-offset-4" style={{ height }} tabIndex={0} role="img" aria-label="Dividenden je Monat, netto. Mit den Pfeiltasten Monat für Monat ablesen." onKeyDown={onKey} onBlur={() => setHi(null)}>
      {W > 0 && (
        <svg width={W} height={height} className="block overflow-visible" onPointerLeave={() => setHi(null)}>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={L} x2={L + iw} y1={y(t)} y2={y(t)} stroke={t === 0 ? '#343a47' : 'var(--color-grid)'} strokeWidth="1" shapeRendering="crispEdges" />
              <text x={L - 10} y={y(t) + 3.5} textAnchor="end" className="num fill-muted text-[11px]">{fmt(t)}</text>
            </g>
          ))}
          {months.map((m, i) => {
            const cx = L + (i + 0.5) * band
            const yr = y(m.received), ye = y(m.received + m.expected)
            const gap = m.received > 0 && m.expected > 0 ? 2 : 0
            const total = m.received + m.expected
            return (
              <g key={m.key}>
                {hi === i && <rect x={L + i * band + 2} y={T - 8} width={band - 4} height={ih + 8} rx="6" fill="rgb(255 255 255 / 0.04)" />}
                <motion.g initial={reduce ? false : { scaleY: 0 }} animate={{ scaleY: 1 }} transition={{ duration: 0.6, delay: 0.03 * i, ease: [0.22, 1, 0.36, 1] }} style={{ originY: 1 }}>
                  {m.received > 0 && <path d={topRounded(cx - bw / 2, yr, bw, y(0) - yr, m.expected > 0 ? 0 : 4)} fill={DIV_RECEIVED} />}
                  {m.expected > 0 && <path d={topRounded(cx - bw / 2, ye, bw, yr - ye - gap, 4)} fill={DIV_EXPECTED} />}
                </motion.g>
                {total > 0 && (i === peak || m.key === current) && (
                  <text x={cx} y={ye - 7} textAnchor="middle" className="num fill-ink-2 text-[11px]">{usd(total)}</text>
                )}
                <text x={cx} y={height - 8} textAnchor="middle" className={`text-[11px] ${m.key === current ? 'fill-ink font-medium' : 'fill-muted'}`}>{label(m.key)}</text>
                <rect x={L + i * band} y={T - 8} width={band} height={ih + 8 + B} fill="transparent" onPointerEnter={() => setHi(i)} onPointerMove={() => setHi(i)} />
              </g>
            )
          })}
        </svg>
      )}
      {h && hi != null && (
        <div className="tip" style={tipRight ? { right: W - (L + hi * band) + 6, top: T - 6 } : { left: L + (hi + 1) * band + 6, top: T - 6 }}>
          <div className="text-[11.5px] text-muted">{MONTHS[+h.key.slice(5) - 1]} {h.key.slice(0, 4)}</div>
          <div className="tip-row"><span><i className="swatch mr-[7px]" style={{ background: DIV_RECEIVED }} />erhalten</span><b>{usd(h.received)}</b></div>
          <div className="tip-row"><span><i className="swatch mr-[7px]" style={{ background: DIV_EXPECTED }} />erwartet</span><b>{usd(h.expected)}</b></div>
          {h.items.length > 0 && <div className="hairline my-2" />}
          {h.items.map((d) => (
            <div className="tip-row" key={d.ticker + d.payDate} style={{ marginTop: 3 }}>
              <span className="tk !text-[11.5px] !text-ink-2">{d.ticker}{d.estimate && <span className="ml-1.5 font-sans text-[10.5px] font-normal text-muted">geschätzt</span>}</span>
              <span className="num">{d.estimate ? '≈ ' : ''}{usd(d.net)}</span>
            </div>
          ))}
          {!h.items.length && <div className="mt-1.5 text-faint">keine Zahlung</div>}
        </div>
      )}
    </div>
  )
}
