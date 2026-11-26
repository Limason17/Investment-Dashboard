import { scaleLinear } from 'd3-scale'
import { area as d3area, curveMonotoneX, curveStepAfter, line as d3line } from 'd3-shape'
import { motion, useReducedMotion } from 'motion/react'
import { useCallback, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react'
import { axisFormatter, dfmt, dlong, dshort, hhmm, MONTHS, usd, weekday, curRate, usdRaw, pxRaw, cur, qty } from '@/lib/format'
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
  /** bezahlter Preis liegt ausserhalb der Kursspanne (Tief bis Hoch): Etikett warnt */
  off?: boolean
}

/**
 * Käufe/Verkäufe im Chart: ein Pfeil zeigt mit der Spitze genau auf den Preis (Kauf grün von links, Verkauf rot von
 * rechts), dahinter ein Etikett mit Stück × Preis («1 × 245.91»). Die Marke sitzt immer auf dem Kurs, den der Chart zeigt.
 */
const TAG_H = 13, ARROW_W = 7
/** Text einer Buchung: Stück × Preis (in Anzeigewährung), «!» wenn der Preis ausserhalb der Kursspanne lag */
const tradeText = (m: Marker, k: number) =>
  [m.shares != null ? qty(m.shares) : '', m.price != null && m.price > 0 ? pxRaw(m.price * k) : ''].filter(Boolean).join(' × ') + (m.off ? ' !' : '')

/** Symbol für Kauf (grüner Pfeil nach rechts) und Verkauf (roter Pfeil nach links) in Legende und Tooltip */
export function TradeGlyph({ type, size = 10 }: { type: Marker['type']; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 10 10" className="inline-block shrink-0" aria-hidden>
      <path d={type === 'kauf' ? 'M9,5L2,1L2,9Z' : 'M1,5L8,1L8,9Z'} fill={type === 'kauf' ? 'var(--color-up)' : 'var(--color-down)'} />
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
const NO_MARKERS: Marker[] = []

/** Kerzen für die erste Reihe: Eröffnung, Hoch, Tief je Punkt; der Schluss ist der Wert der Reihe. */
export interface CandleData {
  o: number[]
  h: number[]
  l: number[]
}

export function TimeChart({ t, d, kind = 'daily', series: seriesIn, candles: candlesIn, titleOf, height = 260, refs: refsIn = NO_REFS, markers = NO_MARKERS, vlines = [], baseline: baselineIn, split: splitIn, signs, format: formatIn = usd, tickFormat, onHover, tooltipExtra, ariaLabel, animateKey, pending, live, empty }: {
  /** Zeitpunkt je Punkt, Millisekunden */
  t: number[]
  /** Handelstag je Punkt, JJJJ-MM-TT */
  d: string[]
  kind?: 'intraday' | 'daily'
  series: TimeSeries[]
  /** erste Reihe als Kerzen statt als Linie zeichnen */
  candles?: CandleData
  /** Überschrift im Tooltip je Punkt (z. B. «Woche bis …» bei Wochenkerzen) */
  titleOf?: (i: number) => string
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
  const candles = useMemo(() => (!candlesIn || k === 1 ? candlesIn : { o: candlesIn.o.map((v) => v * k), h: candlesIn.h.map((v) => v * k), l: candlesIn.l.map((v) => v * k) }), [candlesIn, k])
  const baseline = baselineIn != null ? baselineIn * k : undefined
  const split = typeof splitIn === 'number' ? splitIn * k : splitIn
  const format = formatIn === usd ? (v: number) => `${pxRaw(v)} ${cur()}` : formatIn
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
  // Kerzen stehen in der Mitte ihres Feldes, damit die erste und die letzte nicht am Rand abgeschnitten werden.
  const cdl = !!candles && candles.o.length === n
  const x = useCallback((i: number) => (cdl ? L + ((i + 0.5) / n) * iw : L + (n <= 1 ? iw / 2 : (i / (n - 1)) * iw)), [n, iw, L, cdl])
  // Bezugswert der gestrichelten Linie: eine Zahl (z. B. Vortagesschluss) oder der Startwert
  const sv = split == null || split === false ? undefined : typeof split === 'number' ? split : (baseline ?? series[0]?.values.find(Number.isFinite))

  const { y, ticks, tickFmt } = useMemo(() => {
    const all = series.flatMap((s) => s.values).concat(cdl ? [...candles!.h, ...candles!.l] : [], refs.map((r) => r.y),baseline != null ? [baseline] : [], sv != null ? [sv] : []).filter(Number.isFinite)
    let lo = Math.min(...all), hi2 = Math.max(...all)
    if (!Number.isFinite(lo)) { lo = 0; hi2 = 1 }
    const pad = (hi2 - lo) * 0.1 || Math.abs(hi2) * 0.02 || 1
    // Der Rand oben/unten überschreitet die Null nicht: Ohne negative Werte endet die Achse bei 0 (kein leeres «−5K»).
    const sc = scaleLinear().domain([lo >= 0 ? Math.max(0, lo - pad) : lo - pad, hi2 <= 0 ? Math.min(0, hi2 + pad) : hi2 + pad]).range([T + ih, T]).nice(5)
    const tk = sc.ticks(5)
    return { y: sc, ticks: tk, tickFmt: tickFormat ?? axisFormatter(tk) }
  }, [series, refs, baseline, sv, ih, tickFormat, cdl, candles])

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
    let i = Math.max(0, Math.min(n - 1, cdl ? Math.floor(((px - L) / iw) * n) : Math.round(((px - L) / iw) * (n - 1))))
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
    // Kurz genug für die Achse: ab 100'000 in K bzw. M, ab 1000 ohne Rappen, darunter genau (auch 0.0042)
    const text = r.y >= 1e6 ? (r.y / 1e6).toFixed(2) + 'M' : r.y >= 1e5 ? Math.round(r.y / 1000) + 'K' : r.y >= 1000 ? usdRaw(r.y).replace(/\.\d+$/, '') : pxRaw(r.y)
    let ty = y(r.y)
    const prev = refTags[refTags.length - 1]
    if (prev && ty - prev.ty < 16) ty = prev.ty + 16
    refTags.push({ r, ty, text, w: text.length * 5.9 + 9 })
  }
  const tickHidden = (v: number) => refTags.some((g) => Math.abs(g.ty - y(v)) < 11)
  // Kerzen: Feldbreite je Punkt, Körper gut zwei Drittel davon (mind. 1 px), Docht 1 px
  const slot = iw / Math.max(1, n)
  const bw = Math.max(1, Math.min(14, slot >= 4 ? slot * 0.68 : slot - 1))
  // Buchungen: immer auf dem Kurs, den der Chart zeigt. Linie: auf der Linie. Kerzen: der bezahlte Preis, begrenzt auf
  // Tief bis Hoch dieser Kerze (liegt er ausserhalb, z. B. wegen Split-Bereinigung, sitzt die Marke am nächsten Rand).
  const trades = [...markers].sort((a, b) => a.i - b.i).map((m) => {
    const paid = m.price != null && m.price > 0 ? m.price * k : null
    const v = cdl ? Math.max(candles!.l[m.i], Math.min(candles!.h[m.i], paid ?? main.values[m.i])) : main.values[m.i]
    const buy = m.type === 'kauf'
    const text = tradeText(m, k)
    return { m, buy, cx: x(m.i), cy: y(v), text, w: text.length * 5.5 + 8 }
  })
  type Placed = { x: number; y: number; w: number }
  const free = (list: Placed[], p: Placed) => !list.some((o) => Math.abs(o.x - p.x) < (o.w + p.w) / 2 + 2 && Math.abs(o.y - p.y) < TAG_H + 2)
  // Seitenpfeil: Kauf kommt von links, Verkauf von rechts; die Spitze zeigt genau auf den Preis, das Etikett sitzt dahinter.
  // Fehlt der Platz am Rand oder überlappt ein Etikett, kommt es auf die andere Seite; sonst rückt es eine Zeile weiter und
  // ein feiner Strich verbindet es mit dem Preis.
  const sides: Placed[] = []
  const sideOf = trades.map((g) => {
    const gap = Math.max(bw, 3) / 2 + 2
    const place = (left: boolean, dy: number): Placed & { left: boolean; tip: number; base: number } => {
      const tip = left ? g.cx - gap : g.cx + gap
      const base = left ? tip - ARROW_W : tip + ARROW_W
      return { left, tip, base, x: left ? base - g.w / 2 : base + g.w / 2, y: g.cy + dy, w: g.w }
    }
    const fits = (p: Placed) => p.x - p.w / 2 >= L - 2 && p.x + p.w / 2 <= L + iw + 2
    const order = [g.buy, !g.buy]
    let best: ReturnType<typeof place> | null = null
    for (const dy of [0, -(TAG_H + 3), TAG_H + 3, -2 * (TAG_H + 3), 2 * (TAG_H + 3)]) {
      for (const left of order) {
        const p = place(left, dy)
        if (fits(p) && free(sides, p)) { best = p; break }
      }
      if (best) break
    }
    best ??= place(fits(place(g.buy, 0)) ? g.buy : !g.buy, 0)
    sides.push(best)
    return best
  })
  const title = (i: number) => titleOf ? titleOf(i) : (kind === 'intraday' ?`${weekday(localDate(t[i]))}, ${dfmt(localDate(t[i]))} · ${hhmm(t[i])}` : dlong(d[i]))

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
          {/* Liegt der Bezugswert auf einer Schwelle (z. B. Ø Einstand), zeigt nur die Schwelle die Linie */}
          {sv != null ? (
            !refs.some((r) => Math.abs(r.y - sv) < 1e-6) && <line x1={L} x2={L + iw} y1={y(sv)} y2={y(sv)} stroke="#4f5668" strokeWidth="1" strokeDasharray="3 4" />
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

          {/* Kerzen: grün, wenn der Schluss über der Eröffnung liegt, sonst rot; eckig wie die Felder */}
          {cdl && (
            <motion.g key={'c' + animateKey} initial={reduce ? false : { opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.35 }} shapeRendering="crispEdges">
              {main.values.map((c, i) => {
                const o = candles!.o[i], up = c >= o
                const col = up ? UP : DOWN
                const cx = Math.round(x(i)) + (Math.round(bw) % 2 ? 0.5 : 0)
                const top = y(Math.max(o, c)), bot = y(Math.min(o, c))
                const dim = hi != null && hi !== i
                return (
                  <g key={i} opacity={dim ? 0.55 : 1}>
                    <line x1={cx} x2={cx} y1={y(candles!.h[i])} y2={y(candles!.l[i])} stroke={col} strokeWidth="1" />
                    <rect x={cx - bw / 2} y={top} width={bw} height={Math.max(1, bot - top)} fill={col} />
                  </g>
                )
              })}
            </motion.g>
          )}

          <g key={animateKey}>
            {series.map((s, k) =>
              s.area && !(cdl && s === main) ? (
                <motion.path key={s.key + 'a'} d={paths[k].ar} fill={`url(#${id}-a${k})`} initial={reduce ? false : { opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.6, delay: 0.2 }} />
              ) : null,
            )}
            {[...series].reverse().map((s) => {
              const k = series.indexOf(s)
              if (cdl && s === main) return null
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

          {/* Käufe / Verkäufe: Pfeil mit der Spitze genau am Preis, Etikett «1 × 245.91»; Kauf grün, Verkauf rot */}
          {trades.map((g, j) => {
            const s = sideOf[j]
            const col = g.buy ? 'var(--color-up)' : 'var(--color-down)'
            const moved = s.y !== g.cy
            return (
              <g key={g.m.i + g.m.type} pointerEvents="none" opacity={hi != null && hi !== g.m.i ? 0.55 : 1}>
                {moved && <line x1={s.tip} x2={g.cx} y1={s.y} y2={g.cy} stroke={col} strokeWidth="1" />}
                {moved && <circle cx={g.cx} cy={g.cy} r={2} fill={col} />}
                <path d={`M${s.tip},${s.y}L${s.base},${s.y - TAG_H / 2}L${s.base},${s.y + TAG_H / 2}Z`} fill={col} />
                <rect x={s.x - s.w / 2} y={s.y - TAG_H / 2} width={s.w} height={TAG_H} fill={g.m.off ? '#000' : col} stroke={g.m.off ? col : 'none'} strokeDasharray={g.m.off ? '3 2' : undefined} shapeRendering="crispEdges" />
                <text x={s.x} y={s.y + 3.4} textAnchor="middle" className="num" fontSize={9.5} fontWeight={650} fill={g.m.off ? col : '#000'}>{g.text}</text>
              </g>
            )
          })}

          {/* Endpunkt */}
          {hi == null && !cdl && (
            <g>
              {live && <circle cx={x(lastI)} cy={y(main.values[lastI])} r="5" fill={colorAt(main, lastI)} opacity="0.5" className="pulse-ring" />}
              <circle cx={x(lastI)} cy={y(main.values[lastI])} r="4.5" fill={colorAt(main, lastI)} stroke="var(--color-card)" strokeWidth="2" />
            </g>
          )}

          {/* Fadenkreuz */}
          {hi != null && (
            <g pointerEvents="none">
              <line x1={hx} x2={hx} y1={T} y2={T + ih} stroke="#4a5162" strokeWidth="1" shapeRendering="crispEdges" />
              {series.map((s) => (cdl && s === main ? null : (
                <circle key={s.key} cx={hx} cy={y(s.values[hi])} r={s === main ? 4.5 : 3.5} fill={colorAt(s, hi)} stroke="var(--color-card)" strokeWidth="2" />
              )))}
            </g>
          )}
          <rect x={L} y={T} width={iw} height={ih} fill="transparent" />
        </svg>
      )}

      {hi != null && (
        <div ref={tipRef} className="tip" style={{ left: tipLeft, top: T }}>
          <div className="whitespace-nowrap text-[11.5px] text-muted">{title(hi)}</div>
          {series.map((s) => cdl && s === main ? (
            <div key={s.key}>
              {([['Eröffnung', candles!.o[hi]], ['Hoch', candles!.h[hi]], ['Tief', candles!.l[hi]], ['Schluss', s.values[hi]]] as const).map(([name, v]) => (
                <div className="tip-row" key={name}>
                  <span className="whitespace-nowrap">{name}</span>
                  <b className={name === 'Schluss' ? (s.values[hi] >= candles!.o[hi] ? '!text-up' : '!text-down') : undefined}>{format(v)}</b>
                </div>
              ))}
            </div>
          ) : (
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
