import { curveMonotoneX, line as d3line } from 'd3-shape'
import { useId } from 'react'
import type { Tone } from '@/lib/calc'
import { useMeasure } from '@/lib/useMeasure'

/** Mini-Verlauf: Richtung über den Zeitraum bestimmt die Farbe, Endpunkt markiert. */
export function Sparkline({ values, width = 88, height = 28, tone = 'flat', label, baseline, baselineColor = '#3a4050', split = true, baselineLabel, endLabel }: {
  values: number[]
  width?: number
  height?: number
  tone?: 'up' | 'down' | 'flat'
  label?: string
  /** Ohne Teilung: Vergleichswert (z. B. Kaufgrenze) als feine durchgezogene Linie. Mit Teilung: Startwert. */
  baseline?: number | null
  baselineColor?: string
  /** Startwert als gestrichelte Linie; darüber grün, darunter rot (Standard) */
  split?: boolean
  /** Text direkt an der Vergleichslinie (links) */
  baselineLabel?: string
  /** Text am Endpunkt, z. B. der aktuelle Kurs */
  endLabel?: string
}) {
  const id = useId().replace(/:/g, '')
  if (values.length < 2 || width < 12) return <span className="inline-block text-faint" style={{ width, height, lineHeight: height + 'px' }}>–</span>
  const base = baseline ?? (split ? values.find(Number.isFinite) ?? null : null)
  const all = base != null ? [...values, base] : values
  const lo = Math.min(...all), hi = Math.max(...all)
  const n = values.length
  const x = (i: number) => 1 + (i / (n - 1)) * (width - 6)
  const y = (v: number) => 4 + ((hi - v) / (hi - lo || 1)) * (height - 8)
  const d = d3line<number>().x((_, i) => x(i)).y((v) => y(v)).curve(curveMonotoneX)(values) ?? ''
  const color = tone === 'up' ? 'var(--color-up)' : tone === 'down' ? 'var(--color-down)' : 'var(--color-accent)'
  const UP = 'var(--color-up)', DOWN = 'var(--color-down)'
  // Geteilt: Linie und Fläche über dem Startwert grün, darunter rot
  const cut = split && base != null ? Math.max(0, Math.min(1, y(base) / height)) : null
  const end = cut != null ? (values[n - 1] >= base! ? UP : DOWN) : color
  const floor = cut != null ? y(base!) : height
  return (
    <svg width={width} height={height} role="img" aria-label={label} className="block overflow-visible">
      <defs>
        {cut != null ? (
          <>
            <linearGradient id={id + 'l'} gradientUnits="userSpaceOnUse" x1="0" x2="0" y1="0" y2={height}>
              <stop offset={cut} stopColor={UP} />
              <stop offset={cut} stopColor={DOWN} />
            </linearGradient>
            <linearGradient id={id} gradientUnits="userSpaceOnUse" x1="0" x2="0" y1="0" y2={height}>
              <stop offset="0" stopColor={UP} stopOpacity="0.24" />
              <stop offset={cut} stopColor={UP} stopOpacity="0.03" />
              <stop offset={cut} stopColor={DOWN} stopOpacity="0.03" />
              <stop offset="1" stopColor={DOWN} stopOpacity="0.24" />
            </linearGradient>
          </>
        ) : (
          <linearGradient id={id} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor={color} stopOpacity="0.2" />
            <stop offset="1" stopColor={color} stopOpacity="0" />
          </linearGradient>
        )}
      </defs>
      {!split && baseline != null && <line x1={x(0)} x2={x(n - 1)} y1={y(baseline)} y2={y(baseline)} stroke={baselineColor} strokeWidth="1" />}
      <path d={`${d}L${x(n - 1)},${floor}L${x(0)},${floor}Z`} fill={`url(#${id})`} />
      <path d={d} fill="none" stroke={cut != null ? `url(#${id}l)` : color} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={x(n - 1)} cy={y(values[n - 1])} r="2.5" fill={end} stroke="var(--color-card)" strokeWidth="1.5" />
      {!split && baseline != null && baselineLabel && (
        <text x={x(0)} y={y(baseline) < 14 ? y(baseline) + 12 : y(baseline) - 5} fill={baselineColor} className="num text-[10.5px] font-medium" style={{ paintOrder: 'stroke', stroke: 'var(--color-card)', strokeWidth: 4, strokeLinejoin: 'round' }}>{baselineLabel}</text>
      )}
      {endLabel && (
        <text x={x(n - 1) - 7} y={y(values[n - 1]) < 14 ? y(values[n - 1]) + 15 : y(values[n - 1]) - 7} textAnchor="end" fill="var(--color-ink)" className="num text-[11.5px] font-semibold" style={{ paintOrder: 'stroke', stroke: 'var(--color-card)', strokeWidth: 4, strokeLinejoin: 'round' }}>{endLabel}</text>
      )}
    </svg>
  )
}

/** Mini-Verlauf, der die Breite seines Platzes füllt. */
export function FluidSparkline(props: Omit<Parameters<typeof Sparkline>[0], 'width'> & { className?: string }) {
  const [ref, w] = useMeasure<HTMLDivElement>()
  const { className, ...rest } = props
  return (
    <div ref={ref} className={className} style={{ height: props.height ?? 28 }}>
      {w > 0 && <Sparkline {...rest} width={w} />}
    </div>
  )
}

const TONE_COLOR: Record<Tone, string> = { up: 'var(--color-up)', down: 'var(--color-down)', warn: 'var(--color-warn)', info: 'var(--color-accent)', mute: '#9aa2b4' }

/**
 * Kurs relativ zur Kaufgrenze. Strich = Grenze, links davon die Kaufzone, Punkt = aktueller Kurs.
 * Skala von −15 % bis +35 % um die Grenze, ausserhalb wird am Rand gehalten.
 */
export function LimitTrack({ d, tone, width = 132 }: { d: number | null; tone: Tone; width?: number | string }) {
  if (d == null) return <span className="text-faint">–</span>
  const LO = -0.15, SPAN = 0.5
  const tick = (0 - LO) / SPAN
  const pos = Math.max(0.02, Math.min(0.98, (d - LO) / SPAN))
  return (
    <span className="relative block h-4" style={{ width }} aria-hidden="true">
      <span className="absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 rounded-full bg-white/[0.07]" />
      <span className="absolute left-0 top-1/2 h-1 -translate-y-1/2 rounded-l-full bg-up/25" style={{ width: `${tick * 100}%` }} />
      <span className="absolute top-1/2 h-3.5 w-0.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-ink-2" style={{ left: `${tick * 100}%` }} />
      <span
        className="absolute top-1/2 size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full transition-[left] duration-500"
        style={{ left: `${pos * 100}%`, background: TONE_COLOR[tone], boxShadow: `0 0 0 2px var(--color-card), 0 0 10px color-mix(in srgb, ${TONE_COLOR[tone]} 55%, transparent)` }}
      />
    </span>
  )
}

/** Füllstand: die Spur ist ein heller Schritt derselben Farbe. */
export function Meter({ value, color = 'var(--color-accent)', height = 6, className, mark }: { value: number; color?: string; height?: number; className?: string; /** Zielmarke, 0–1 */ mark?: number }) {
  const v = Math.max(0, Math.min(1, value))
  return (
    <div className={`relative w-full ${className ?? ''}`} style={{ height }}>
      <div className="absolute inset-0 overflow-hidden rounded-full" style={{ background: `color-mix(in srgb, ${color} 16%, transparent)` }}>
        <div className="absolute inset-y-0 left-0 rounded-full transition-[width] duration-700 ease-out" style={{ width: `${v * 100}%`, background: color, minWidth: v > 0 ? height : 0 }} />
      </div>
      {mark != null && <div className="absolute -bottom-[3px] -top-[3px] w-[2px] -translate-x-1/2 rounded-full bg-ink" style={{ left: `${Math.max(0, Math.min(1, mark)) * 100}%`, boxShadow: '0 0 0 2px var(--color-card)' }} />}
    </div>
  )
}
