import { scaleLinear } from 'd3-scale'
import { area as d3area, curveMonotoneX, curveStepAfter, line as d3line } from 'd3-shape'
import { motion, useReducedMotion } from 'motion/react'
import { useCallback, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react'
import { axisFormatter, dfmt, dlong, dshort, hhmm, MONTHS, usd, weekday, curRate, usdRaw, cur, qty } from '@/lib/format'
const MINUS_SIGN = '−'
import { useMeasure } from '@/lib/useMeasure'
import { Empty } from '../ui'

export interface TimeSeries {
  key: string
  label: string
  values: number[]
  color: string
  /** zweite Farbe für einen Verlauf entlang der Linie */
  color2?: string
  kind?: 'line' | 'step'
  area?: boolean
  width?: number
  glow?: boolean
  dashed?: boolean
  /** Deckkraft der Linie, z. B. für eine Vergleichslinie im Hintergrund */
  opacity?: number
}
export interface RefLine {
  y: number
  label: string
  color: string
  /** kurzer Name ohne Betrag, z. B. «Ø Einstand» (Tooltip) */
  name?: string
}
/** Kauf (grünes Dreieck nach oben) oder Verkauf (rotes Dreieck nach unten) an einem Punkt */
export interface Marker {
  i: number
  type: 'kauf' | 'verkauf'
  /** Stück und Ø-Preis der Buchungen an diesem Punkt, laufende Nummer (chronologisch) */
  shares?: number
  price?: number
  seq?: number
}

const TRADE_COLOR = { kauf: 'var(--color-up)', verkauf: 'var(--color-down)' } as const
/** Etikett der Buchungen: Höhe und Abstand vom Kurs */
const TAG_H = 11.5, TAG_OFF = 12.5

/** Symbol für Kauf/Verkauf in Legende und Tooltip, gleich wie im Chart */
export function TradeGlyph({ type, size = 10 }: { type: Marker['type']; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 10 10" className="inline-block shrink-0" aria-hidden>
      <circle cx="5" cy="5" r="3.5" fill={TRADE_COLOR[type]} stroke="var(--color-card)" strokeWidth="1.25" />
    </svg>
  )
}
/** senkrechte Marke, z. B. Börseneröffnung */
export interface VLine {
  i: number
  label?: string
}

interface Tick {
  /** Position als (auch gebrochener) Index */
  i: number
  label: string
  strong?: boolean
}

const pad2 = (n: number) => String(n).padStart(2, '0')
const localDate = (ms: number) => {
  const x = new Date(ms)
  return `${x.getFullYear()}-${pad2(x.getMonth() + 1)}-${pad2(x.getDate())}`
}

/** Zeitachse: Stunden am Tag, Tage in der Woche, Monate im Jahr, Jahre darüber. */
function timeTicks(t: number[], d: string[], kind: 'intraday' | 'daily', iw: number): { ticks: Tick[]; seps: number[] } {
  const n = t.length
  const px = (i: number) => (n <= 1 ? iw / 2 : (i / (n - 1)) * iw)
  const out: Tick[] = []
  const seps: number[] = []
  /** Beschriftungen ausdünnen: starke zuerst, dann die übrigen, wo Platz ist. */
  const thin = (list: Tick[], gap: number) => {
    const kept: Tick[] = []
    const fits = (c: Tick) => px(c.i) >= 10 && px(c.i) <= iw - 10 && kept.every((k) => Math.abs(px(k.i) - px(c.i)) >= gap)
    for (const c of list) if (c.strong && fits(c)) kept.push(c)
    for (const c of list) if (!c.strong && fits(c)) kept.push(c)
    return kept.sort((a, b) => a.i - b.i)
  }
  const starts: number[] = [0]
  if (kind === 'intraday') for (let i = 1; i < n; i++) if (d[i] !== d[i - 1]) starts.push(i)
  // Viele Handelstage mit Stundenwerten (3M, 1J): Achse wie bei Tageswerten, nach Monaten beschriftet.
  if (kind === 'intraday' && starts.length <= 25) {
    if (starts.length === 1) {
      for (let i = 1; i < n; i++) {
        const h = new Date(t[i]).getHours()
        if (h !== new Date(t[i - 1]).getHours()) out.push({ i, label: pad2(h) + ':00' })
      }
      return { ticks: thin(out, 54), seps }
    }
    const perDay = iw / starts.length
    starts.forEach((s, k) => {
      const end = (starts[k + 1] ?? n) - 1
      const date = localDate(t[s])
      if (k > 0 && starts.length <= 8) seps.push(s - 0.5)
      if (perDay >= 44) out.push({ i: (s + end) / 2, label: perDay >= 86 ? `${weekday(date)} ${dshort(date)}` : `${weekday(date)} ${Number(date.slice(8))}.` })
      else out.push({ i: s, label: dshort(date), strong: weekday(date) === 'Mo' })
    })
    return { ticks: perDay >= 44 ? out : thin(out, 52), seps }
  }
  if (n <= 34) {
    const step = Math.max(1, Math.ceil(n / Math.max(2, Math.floor(iw / 64))))
    for (let i = n - 1; i >= 0; i -= step) out.unshift({ i, label: dshort(d[i]) })
    return { ticks: out, seps }
  }
  const years = Number(d[n - 1].slice(0, 4)) - Number(d[0].slice(0, 4))
  for (let i = 1; i < n; i++) {
    const m = d[i].slice(5, 7)
    if (m === d[i - 1].slice(5, 7)) continue
    const newYear = d[i].slice(0, 4) !== d[i - 1].slice(0, 4)
    if (newYear) out.push({ i, label: d[i].slice(0, 4), strong: true })
    else if (years < 3) out.push({ i, label: MONTHS[+m - 1] })
  }
  return { ticks: thin(out, 46), seps }
}

/**
 * Zeitreihe als Linie: 2px, Fläche als dünner Schleier, Fadenkreuz rastet auf den Punkt,
 * ein Tooltip für alle Reihen. Pfeiltasten bewegen das Fadenkreuz; auf dem Handy liest der Finger ab.
 */
const NO_REFS: RefLine[] = []

export function TimeChart({ t, d, kind = 'daily', series: seriesIn, height = 260, refs: refsIn = NO_REFS, markers = [], vlines = [], baseline: baselineIn, split: splitIn, signs, format: formatIn = usd, tickFormat, onHover, tooltipExtra, ariaLabel, animateKey, pending, live, empty }: {
  /** Zeitpunkt je Punkt, Millisekunden */
  t: number[]
  /** Handelstag je Punkt, JJJJ-MM-TT */
  d: string[]
  kind?: 'intraday' | 'daily'
  series: TimeSeries[]
  height?: number
  refs?: RefLine[]
  markers?: Marker[]
  vlines?: VLine[]
  /** Fläche füllt bis zu diesem Wert (z. B. 0 bei Renditen) statt bis zum Boden */
  baseline?: number
  /** Startwert als feine gestrichelte Linie; die Hauptlinie ist darüber grün, darunter rot */
  split?: boolean | number
  /** Vorzeichen je Punkt bestimmt die Farbe der Hauptlinie (z. B. Ertrag im Zeitraum), genau wie die Kennzahl oben */
  signs?: number[]
  format?: (v: number) => string
  tickFormat?: (v: number) => string
  onHover?: (i: number | null) => void
  tooltipExtra?: (i: number) => ReactNode
  ariaLabel: string
  animateKey?: string
  /** neuer Zeitraum lädt: bisherige Linie gedämpft zeigen */
  pending?: boolean
  /** laufende Sitzung: der Endpunkt pulsiert */
  live?: boolean
  empty?: ReactNode
}) {
  // Geldbeträge (Standardformat) in der Anzeigewährung zeichnen; Prozent-Charts bleiben unverändert
  const k = formatIn === usd ? curRate() : 1
  const series = useMemo(() => (k === 1 ? seriesIn : seriesIn.map((s) => ({ ...s, values: s.values.map((v) => v * k) }))), [seriesIn, k])
  const refs = useMemo(() => (k === 1 ? refsIn : refsIn.map((r) => ({ ...r, y: r.y * k }))), [refsIn, k])
  const baseline = baselineIn != null ? baselineIn * k : undefined
  const split = typeof splitIn === 'number' ? splitIn * k : splitIn
  const format = formatIn === usd ? (v: number) => `${usdRaw(v)} ${cur()}` : formatIn
  const [ref, W] = useMeasure<HTMLDivElement>()
  const [hi, setHi] = useState<number | null>(null)
  const tipRef = useRef<HTMLDivElement>(null)
  const [tipW, setTipW] = useState(190)
  const id = useId().replace(/:/g, '')
  const reduce = useReducedMotion()
  const n = t.length
  const narrow = W > 0 && W < 460
  // Ränder der Zeichenfläche: links die Werteachse, unten die Zeitachse
  const L = narrow ? 42 : 48, R = narrow ? 10 : 14, T = 14, B = 28
  const iw = Math.max(10, W - L - R)
  const ih = height - T - B
  const x = useCallback((i: number) => L + (n <= 1 ? iw / 2 : (i / (n - 1)) * iw), [n, iw, L])
  // Bezugswert der gestrichelten Linie: eine Zahl (z. B. Vortagesschluss) oder der Startwert
  const sv = split == null || split === false ? undefined : typeof split === 'number' ? split : (baseline ?? series[0]?.values.find(Number.isFinite))

  const { y, ticks, tickFmt } = useMemo(() => {
    const all = series.flatMap((s) => s.values).concat(refs.map((r) => r.y), baseline != null ? [baseline] : [], sv != null ? [sv] : []).filter(Number.isFinite)
    let lo = Math.min(...all), hi2 = Math.max(...all)
    if (!Number.isFinite(lo)) { lo = 0; hi2 = 1 }
    const pad = (hi2 - lo) * 0.1 || Math.abs(hi2) * 0.02 || 1
    // Der Rand oben/unten überschreitet die Null nicht: Ohne negative Werte endet die Achse bei 0 (kein leeres «−5K»).
    const sc = scaleLinear().domain([lo >= 0 ? Math.max(0, lo - pad) : lo - pad, hi2 <= 0 ? Math.min(0, hi2 + pad) : hi2 + pad]).range([T + ih, T]).nice(5)
    const tk = sc.ticks(5)
    return { y: sc, ticks: tk, tickFmt: tickFormat ?? axisFormatter(tk) }
  }, [series, refs, baseline, sv, ih, tickFormat])

  const axis = useMemo(() => timeTicks(t, d, kind, iw), [t, d, kind, iw])

  const paths = useMemo(
    () =>
      series.map((s) => {
        const curve = s.kind === 'step' ? curveStepAfter : curveMonotoneX
        const ln = d3line<number>().x((_, i) => x(i)).y((v) => y(v)).curve(curve)(s.values) ?? ''
        const y0 = sv != null && s === series[0] ? y(sv) : baseline != null ? y(baseline) : T + ih
        const ar = s.area ? (d3area<number>().x((_, i) => x(i)).y0(y0).y1((v) => y(v)).curve(curve)(s.values) ?? '') : ''
        return { ln, ar }
      }),
    [series, x, y, ih, baseline, sv],
  )

  useLayoutEffect(() => {
    if (hi != null && tipRef.current) setTipW(tipRef.current.offsetWidth)
  }, [hi])

  if (n < 2) return <div style={{ minHeight: height }} className="grid place-items-center">{empty ?? <Empty title="Noch kein Verlauf">Sobald zwei Punkte vorliegen, erscheint hier die Linie.</Empty>}</div>

  const hover = (i: number | null) => {
    setHi(i)
    onHover?.(i)
  }
  const at = (e: PointerEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    const px = e.clientX - r.left
    let i = Math.max(0, Math.min(n - 1, Math.round(((px - L) / iw) * (n - 1))))
    // In der Nähe eines Kaufs/Verkaufs rastet das Fadenkreuz darauf ein, damit der Tooltip die Buchung zeigt.
    const reach = e.pointerType === 'touch' ? 16 : 9
    let best = reach
    for (const m of markers) {
      const dx = Math.abs(x(m.i) - px)
      if (dx <= best) { best = dx; i = m.i }
    }
    hover(i)
  }
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.shiftKey ? Math.max(5, Math.round(n / 20)) : 1
    if (e.key === 'ArrowLeft') hover(Math.max(0, (hi ?? n - 1) - step))
    else if (e.key === 'ArrowRight') hover(Math.min(n - 1, (hi ?? n - 1) + step))
    else if (e.key === 'Home') hover(0)
    else if (e.key === 'End') hover(n - 1)
    else if (e.key === 'Escape') hover(null)
    else return
    e.preventDefault()
  }
  const main = series[0]
  const lastI = n - 1
  const UP = 'var(--color-up)', DOWN = 'var(--color-down)'
  const useSigns = !!signs && signs.length === n
  const colorAt = (s: TimeSeries, i: number) =>
    s === main && useSigns ? (signs![i] >= 0 ? UP : DOWN) : s === main && sv != null ? (s.values[i] >= sv ? UP : DOWN) : (s.color2 ?? s.color)
  // Farbwechsel entlang der Zeitachse, wo das Vorzeichen wechselt (harte Kante in der Mitte zwischen zwei Punkten)
  const xStops: { o: number; c: string }[] = []
  if (useSigns) {
    let up = signs![0] >= 0
    xStops.push({ o: 0, c: up ? UP : DOWN })
    for (let i = 1; i < n; i++) {
      const now = signs![i] >= 0
      if (now === up) continue
      const o = Math.max(0, Math.min(1, ((x(i - 1) + x(i)) / 2 - L) / iw))
      xStops.push({ o, c: up ? UP : DOWN }, { o, c: now ? UP : DOWN })
      up = now
    }
    xStops.push({ o: 1, c: up ? UP : DOWN })
  }
  const so = sv != null ? Math.max(0, Math.min(1, (y(sv) - T) / ih)) : 0
  const hx = hi != null ? x(hi) : 0
  let tipLeft = hx + 14
  if (tipLeft + tipW > W - 2) tipLeft = hx - 14 - tipW
  if (tipLeft < 2) tipLeft = Math.max(2, Math.min(W - tipW - 2, hx - tipW / 2))
  const sortedRefs = [...refs].sort((a, b) => b.y - a.y)
  // Schwellen beschriften wir nicht im Chart, sondern mit einer kleinen Marke auf der Werteachse.
  const refTags: { r: RefLine; ty: number; text: string; w: number }[] = []
  for (const r of sortedRefs) {
    const text = r.y >= 1000 ? usdRaw(r.y).replace(/\.\d+$/, '') : usdRaw(r.y)
    let ty = y(r.y)
    const prev = refTags[refTags.length - 1]
    if (prev && ty - prev.ty < 16) ty = prev.ty + 16
    refTags.push({ r, ty, text, w: text.length * 5.9 + 9 })
  }
  const tickHidden = (v: number) => refTags.some((g) => Math.abs(g.ty - y(v)) < 11)
  // Etiketten für Käufe/Verkäufe; überlappende rücken weiter vom Kurs weg.
  const tradeTags: { m: Marker; c: string; cx: number; cy: number; px: number; by: number; w: number; below: boolean; sign: string; rest: string }[] = []
  for (const m of [...markers].sort((a, b) => a.i - b.i)) {
    const cx = x(m.i), cy = y(main.values[m.i])
    const buy = m.type === 'kauf'
    const sign = (buy ? '+' : MINUS_SIGN) + (m.shares != null ? qty(m.shares) : '')
    const rest = m.price != null ? ` × ${usdRaw(m.price * k)}` : ''
    const w = (sign.length + rest.length) * 4.0 + 7
    let below = buy
    if (below && cy + TAG_OFF + TAG_H > T + ih + 4) below = false
    else if (!below && cy - TAG_OFF - TAG_H < T - 2) below = true
    const px = Math.max(L + w / 2 - 4, Math.min(L + iw - w / 2 + 4, cx))
    let off = TAG_OFF
    for (let tries = 0; tries < 4; tries++) {
      const by = below ? cy + off : cy - off
      const hit = tradeTags.some((o) => Math.abs(o.px - px) < (o.w + w) / 2 + 3 && Math.abs(o.by - by) < TAG_H + 2)
      if (!hit) break
      off += TAG_H + 3
    }
    tradeTags.push({ m, c: TRADE_COLOR[m.type], cx, cy, px, by: below ? cy + off : cy - off, w, below, sign, rest })
  }
  const title = (i: number) => (kind === 'intraday' ? `${weekday(localDate(t[i]))}, ${dfmt(localDate(t[i]))} · ${hhmm(t[i])}` : dlong(d[i]))

  return (
    <div
      ref={ref}
      className="relative select-none rounded-lg outline-offset-4"
      style={{ height }}
      tabIndex={0}
      role="img"
      aria-label={ariaLabel + '. Mit den Pfeiltasten Punkt für Punkt ablesen.'}
      onKeyDown={onKey}
      onBlur={() => hover(null)}
    >
      {W > 0 && (
        <svg
          width={W}
          height={height}
          className={`block touch-pan-y overflow-visible transition-opacity duration-300 ${pending ? 'opacity-40' : ''}`}
          onPointerDown={at}
          onPointerMove={at}
          onPointerLeave={() => hover(null)}
          onPointerUp={(e) => e.pointerType !== 'mouse' && hover(null)}
          onPointerCancel={() => hover(null)}
        >
          <defs>
            {series.map((s, k) => k === 0 && useSigns ? (
              <g key={s.key}>
                <linearGradient id={`${id}-s${k}`} gradientUnits="userSpaceOnUse" x1={L} x2={L + iw} y1="0" y2="0">
                  {xStops.map((st, j) => <stop key={j} offset={st.o} stopColor={st.c} />)}
                </linearGradient>
                <linearGradient id={`${id}-a${k}`} gradientUnits="userSpaceOnUse" x1={L} x2={L + iw} y1="0" y2="0">
                  {xStops.map((st, j) => <stop key={j} offset={st.o} stopColor={st.c} stopOpacity="0.13" />)}
                </linearGradient>
              </g>
            ) : k === 0 && sv != null ? (
              <g key={s.key}>
                <linearGradient id={`${id}-s${k}`} gradientUnits="userSpaceOnUse" x1="0" x2="0" y1={T} y2={T + ih}>
                  <stop offset={so} stopColor={UP} />
                  <stop offset={so} stopColor={DOWN} />
                </linearGradient>
                <linearGradient id={`${id}-a${k}`} gradientUnits="userSpaceOnUse" x1="0" x2="0" y1={T} y2={T + ih}>
                  <stop offset="0" stopColor={UP} stopOpacity="0.2" />
                  <stop offset={so} stopColor={UP} stopOpacity="0.02" />
                  <stop offset={so} stopColor={DOWN} stopOpacity="0.02" />
                  <stop offset="1" stopColor={DOWN} stopOpacity="0.2" />
                </linearGradient>
              </g>
            ) : (
              <g key={s.key}>
                <linearGradient id={`${id}-s${k}`} gradientUnits="userSpaceOnUse" x1={L} x2={L + iw} y1="0" y2="0">
                  <stop offset="0" stopColor={s.color} />
                  <stop offset="1" stopColor={s.color2 ?? s.color} />
                </linearGradient>
                <linearGradient id={`${id}-a${k}`} gradientUnits="userSpaceOnUse" x1="0" x2="0" y1={T} y2={T + ih}>
                  <stop offset="0" stopColor={s.color} stopOpacity={baseline != null ? 0.1 : 0.16} />
                  <stop offset="1" stopColor={s.color} stopOpacity={baseline != null ? 0.12 : 0} />
                </linearGradient>
              </g>
            ))}
          </defs>

          {/* Raster: Haarlinien, zurückhaltend */}
          {ticks.map((v) => (
            <g key={v}>
              <line x1={L} x2={L + iw} y1={y(v)} y2={y(v)} stroke="var(--color-grid)" strokeWidth="1" shapeRendering="crispEdges" />
              {!tickHidden(v) && <text x={L - 9} y={y(v) + 3.5} textAnchor="end" className={`num fill-muted ${narrow ? 'text-[10.5px]' : 'text-[11px]'}`}>{tickFmt(v)}</text>}
            </g>
          ))}
          {sv != null ? (
            <line x1={L} x2={L + iw} y1={y(sv)} y2={y(sv)} stroke="#4f5668" strokeWidth="1" strokeDasharray="3 4" />
          ) : baseline != null && <line x1={L} x2={L + iw} y1={y(baseline)} y2={y(baseline)} stroke="#343a47" strokeWidth="1" shapeRendering="crispEdges" />}
          {axis.seps.map((s) => (
            <line key={s} x1={x(s)} x2={x(s)} y1={T} y2={T + ih} stroke="var(--color-grid)" strokeWidth="1" shapeRendering="crispEdges" />
          ))}
          {axis.ticks.map((k) => (
            <text key={k.i} x={x(k.i)} y={height - 8} textAnchor="middle" className={`text-[11px] ${k.strong ? 'fill-ink-2 font-medium' : 'fill-muted'}`}>{k.label}</text>
          ))}

          {/* Senkrechte Marken (Eröffnung, Schluss) */}
          {vlines.map((v) => (
            <g key={v.i + (v.label ?? '')}>
              <line x1={x(v.i)} x2={x(v.i)} y1={T} y2={T + ih} stroke="#3a4050" strokeWidth="1" strokeDasharray="2 4" />
              {v.label && (
                <text x={x(v.i) + 5} y={T + 9} className="fill-faint text-[10.5px]" style={{ paintOrder: 'stroke', stroke: 'var(--color-card)', strokeWidth: 4 }}>{v.label}</text>
              )}
            </g>
          ))}

          {/* Schwellen (Grenze, Einstand, Vortag): gestrichelt, weil es Schwellen sind */}
          {sortedRefs.map((r) => (
            <g key={r.label}>
              <line x1={L} x2={L + iw} y1={y(r.y)} y2={y(r.y)} stroke={r.color} strokeWidth="1" strokeDasharray="4 4" />
            </g>
          ))}

          <g key={animateKey}>
            {series.map((s, k) =>
              s.area ? (
                <motion.path key={s.key + 'a'} d={paths[k].ar} fill={`url(#${id}-a${k})`} initial={reduce ? false : { opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.6, delay: 0.2 }} />
              ) : null,
            )}
            {[...series].reverse().map((s) => {
              const k = series.indexOf(s)
              return (
                <motion.path
                  key={s.key}
                  d={paths[k].ln}
                  fill="none"
                  stroke={`url(#${id}-s${k})`}
                  strokeWidth={s.width ?? 2}
                  strokeOpacity={s.opacity}
                  strokeLinejoin="round"
                  strokeLinecap="round"
                  strokeDasharray={s.dashed ? '1 5' : undefined}
                  style={s.glow ? { filter: `drop-shadow(0 6px 10px color-mix(in srgb, ${colorAt(s, lastI)} 32%, transparent))` } : undefined}
                  initial={reduce || s.dashed ? false : { pathLength: 0, opacity: 0.4 }}
                  animate={s.dashed ? undefined : { pathLength: 1, opacity: 1 }}
                  transition={{ duration: 0.75, ease: [0.22, 1, 0.36, 1] }}
                />
              )
            })}
          </g>

          {/* Schwellen: kleine Marke auf der Werteachse statt Text im Chart */}
          {refTags.map((g) => (
            <g key={g.r.label} pointerEvents="none">
              <rect x={L - 5 - g.w} y={g.ty - 8} width={g.w} height={16} rx={4} fill={`color-mix(in srgb, ${g.r.color} 16%, var(--color-card))`} stroke={`color-mix(in srgb, ${g.r.color} 55%, transparent)`} strokeWidth="1" />
              <text x={L - 5 - g.w / 2} y={g.ty + 3.5} textAnchor="middle" className="num text-[10px] font-medium" fill={g.r.color}>{g.text}</text>
            </g>
          ))}

          {/* Kauf / Verkauf: Punkt auf dem Kurs, feiner Stiel, kleines Etikett «+2 × 322.56» (Kauf darunter, Verkauf darüber) */}
          {tradeTags.map((g) => (
            <g key={g.m.i + g.m.type} pointerEvents="none">
              <line x1={g.cx} x2={g.cx} y1={g.cy} y2={g.by + (g.below ? -TAG_H / 2 : TAG_H / 2)} stroke={g.c} strokeOpacity={0.5} strokeWidth="1" />
              <circle cx={g.cx} cy={g.cy} r={hi === g.m.i ? 2.75 : 2} fill={g.c} stroke="var(--color-card)" strokeWidth="1.5" />
              <rect x={g.px - g.w / 2} y={g.by - TAG_H / 2} width={g.w} height={TAG_H} rx={3} fill="rgb(14 16 20 / 0.92)" stroke={g.c} strokeOpacity={hi === g.m.i ? 1 : 0.6} strokeWidth="1" />
              <text x={g.px} y={g.by + 2.7} textAnchor="middle" className="num text-[8px]">
                <tspan fill={g.c} fontWeight={650}>{g.sign}</tspan>
                <tspan fill="var(--color-ink-2)">{g.rest}</tspan>
              </text>
            </g>
          ))}

          {/* Endpunkt */}
          {hi == null && (
            <g>
              {live && <circle cx={x(lastI)} cy={y(main.values[lastI])} r="5" fill={colorAt(main, lastI)} opacity="0.5" className="pulse-ring" />}
              <circle cx={x(lastI)} cy={y(main.values[lastI])} r="4.5" fill={colorAt(main, lastI)} stroke="var(--color-card)" strokeWidth="2" />
            </g>
          )}

          {/* Fadenkreuz */}
          {hi != null && (
            <g pointerEvents="none">
              <line x1={hx} x2={hx} y1={T} y2={T + ih} stroke="#4a5162" strokeWidth="1" shapeRendering="crispEdges" />
              {series.map((s) => (
                <circle key={s.key} cx={hx} cy={y(s.values[hi])} r={s === main ? 4.5 : 3.5} fill={colorAt(s, hi)} stroke="var(--color-card)" strokeWidth="2" />
              ))}
            </g>
          )}
          <rect x={L} y={T} width={iw} height={ih} fill="transparent" />
        </svg>
      )}

      {hi != null && (
        <div ref={tipRef} className="tip" style={{ left: tipLeft, top: T }}>
          <div className="whitespace-nowrap text-[11.5px] text-muted">{title(hi)}</div>
          {series.map((s) => (
            <div className="tip-row" key={s.key}>
              <span className="whitespace-nowrap"><i className="linekey" style={{ background: s.color2 ?? s.color }} />{s.label}</span>
              <b>{format(s.values[hi])}</b>
            </div>
          ))}
          {refs.map((r) => (
            <div className="tip-row" key={r.label}>
              <span className="whitespace-nowrap"><i className="linekey" style={{ background: `repeating-linear-gradient(90deg, ${r.color} 0 2px, transparent 2px 5px)` }} />{r.name ?? r.label.replace(/ [\d’'.,]+( [A-Z]{3})?$/, '')}</span>
              <b>{format(r.y)}</b>
            </div>
          ))}
          {tooltipExtra?.(hi)}
        </div>
      )}
    </div>
  )
}

/** Legende: Linienschlüssel statt Kästchen. */
export function LineLegend({ items }: { items: { label: string; color: string; dashed?: boolean }[] }) {
  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-[12px] text-ink-2">
      {items.map((i) => (
        <span key={i.label} className="inline-flex items-center">
          <i className="linekey" style={i.dashed ? { background: `repeating-linear-gradient(90deg, ${i.color} 0 2px, transparent 2px 5px)` } : { background: i.color }} />
          {i.label}
        </span>
      ))}
    </div>
  )
}
