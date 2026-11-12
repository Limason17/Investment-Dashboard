import clsx from 'clsx'
import { motion } from 'motion/react'
import { useState } from 'react'
import { BUCKETS } from '@/lib/buckets'
import { isCap, targetOf, type Calc } from '@/lib/calc'
import { pctPlain, usd } from '@/lib/format'
import { Empty } from '../ui'
import { Meter } from './Small'

/**
 * Allokation als Ring mit Liste.
 * Innen der Ring der Ist-Anteile, aussen ein feiner Ring der Ziele; daneben je Baustein Ist, Ziel und
 * Abweichung. Ein Zeiger auf Ring oder Liste hebt den Baustein hervor.
 */
const R = 78 // Radius Ist-Ring
const W = 22 // Breite Ist-Ring
const RT = 98 // Radius Zielring
const GAP = 0.012 // Lücke zwischen Segmenten (Anteil am Kreis)

/** Kreisbogen von a0 bis a1 (0–1, im Uhrzeigersinn ab 12 Uhr) */
function arc(r: number, a0: number, a1: number) {
  const p = (a: number) => [Math.sin(a * 2 * Math.PI) * r, -Math.cos(a * 2 * Math.PI) * r]
  const [x0, y0] = p(a0), [x1, y1] = p(a1)
  return `M${x0.toFixed(2)},${y0.toFixed(2)} A${r},${r} 0 ${a1 - a0 > 0.5 ? 1 : 0},1 ${x1.toFixed(2)},${y1.toFixed(2)}`
}

export function Allocation({ c }: { c: Calc }) {
  const [hot, setHot] = useState<string | null>(null)
  // Ohne erfassten Cash: Anteile an den Wertpapieren. Der Plan zählt Cash mit, der Vergleich ist dann eine Näherung.
  const noCash = !!c.settings.cashExcluded
  const total = noCash ? c.sec : c.total
  if (!c.valuationComplete) return <Empty>Aktuelle Kurse fehlen. Die Allokation bleibt offen.</Empty>
  if (!total) return <Empty>Die Allokation erscheint mit den Positionen.</Empty>

  const rows = BUCKETS.filter((b) => !noCash || b.id !== 'cash').map((b) => {
    const v = c.b[b.id] || 0
    const w = v / total
    const tgt = targetOf(c.settings, b.id)
    const cap = isCap(c.settings, b.id)
    const diff = tgt != null ? w - tgt : null
    // Zustand: über einer harten Obergrenze, deutlich daneben (> 5 Pp), nah am Ziel
    // Bei einer Obergrenze ist «darunter» in Ordnung.
    const state: 'over' | 'off' | 'ok' | 'none' = tgt == null ? 'none' : cap ? (w > tgt ? 'over' : 'ok') : Math.abs(diff!) > 0.05 ? 'off' : 'ok'
    return { b, v, w, tgt, cap, diff, state }
  })
  const anyTarget = rows.some((r) => r.tgt != null)
  const tgtSum = rows.reduce((s, r) => s + (r.tgt ?? 0), 0)

  // Segmente der beiden Ringe: kumulierte Anteile
  const cumulate = <T,>(list: T[], share: (x: T) => number) =>
    list.reduce<{ x: T; a0: number; a1: number }[]>((acc, x) => {
      const a0 = acc.length ? acc[acc.length - 1].a1 : 0
      return [...acc, { x, a0, a1: a0 + share(x) }]
    }, [])
  const segs = cumulate(rows.filter((r) => r.w > 0.0005), (r) => r.w).map(({ x, a0, a1 }) => ({ r: x, a0, a1 }))
  const tsegs = anyTarget ? cumulate(rows.filter((r) => (r.tgt ?? 0) > 0), (r) => r.tgt! / (tgtSum || 1)).map(({ x, a0, a1 }) => ({ r: x, a0, a1 })) : []
  const focus = rows.find((r) => r.b.id === hot)
  // Gemeinsame Skala der Balken, damit sie untereinander vergleichbar sind
  const scale = Math.max(...rows.map((r) => Math.max(r.w, r.tgt ?? 0)), 0.01) * 1.08

  return (
    // Nebeneinander erst, wenn die Karte breit genug ist (Container-Abfrage), sonst untereinander.
    <div className="@container">
    <div className="grid items-center gap-6 @[620px]:grid-cols-[220px_minmax(0,1fr)] @[620px]:gap-8">
      {/* Ring */}
      <div className="relative mx-auto aspect-square w-full max-w-[240px]" onPointerLeave={() => setHot(null)}>
        <svg viewBox="-120 -120 240 240" className="size-full overflow-visible" role="img" aria-label={'Aufteilung: ' + rows.map((r) => `${r.b.name} ${pctPlain(r.w)}`).join(', ')}>
          <defs>
            {rows.map((r) => (
              <linearGradient key={r.b.id} id={'al-' + r.b.id} x1="0" y1="0" x2="1" y2="1">
                <stop offset="0" stopColor={r.b.color} stopOpacity="1" />
                <stop offset="1" stopColor={r.b.color} stopOpacity="0.72" />
              </linearGradient>
            ))}
          </defs>
          {/* Grund */}
          <circle r={R} fill="none" stroke="rgb(255 255 255 / 0.05)" strokeWidth={W} />
          {anyTarget && <circle r={RT} fill="none" stroke="rgb(255 255 255 / 0.05)" strokeWidth={5} />}
          {/* Zielring aussen */}
          {tsegs.map(({ r, a0, a1 }) => (
            <path key={'t' + r.b.id} d={arc(RT, a0 + GAP / 2, Math.max(a0 + GAP / 2 + 0.001, a1 - GAP / 2))} fill="none" stroke={r.b.color} strokeWidth={5} strokeLinecap="round" opacity={hot && hot !== r.b.id ? 0.18 : 0.55} />
          ))}
          {/* Ist-Ring */}
          {segs.map(({ r, a0, a1 }, i) => (
            <motion.path
              key={r.b.id}
              d={arc(R, a0 + GAP / 2, Math.max(a0 + GAP / 2 + 0.001, a1 - GAP / 2))}
              fill="none"
              stroke={`url(#al-${r.b.id})`}
              strokeWidth={hot === r.b.id ? W + 6 : W}
              strokeLinecap="butt"
              initial={{ pathLength: 0, opacity: 0 }}
              animate={{ pathLength: 1, opacity: hot && hot !== r.b.id ? 0.35 : 1 }}
              transition={{ pathLength: { duration: 0.7, delay: 0.06 * i, ease: [0.22, 1, 0.36, 1] }, opacity: { duration: 0.15 } }}
              onPointerEnter={() => setHot(r.b.id)}
              style={{ cursor: 'default', filter: hot === r.b.id ? `drop-shadow(0 0 10px ${r.b.color})` : undefined }}
            />
          ))}
        </svg>
        {/* Mitte */}
        <div className="pointer-events-none absolute inset-0 grid place-items-center text-center">
          <div>
            <div className="text-[11.5px] text-muted">{focus ? focus.b.name : noCash ? 'Wertpapiere' : 'Gesamtwert'}</div>
            <div className="num mt-0.5 text-[22px] font-semibold leading-7 tracking-[-0.02em]">{focus ? pctPlain(focus.w) : usd(total)}</div>
            <div className="num text-[11.5px] text-muted">{focus ? `${usd(focus.v)} USD` : 'USD'}</div>
          </div>
        </div>
      </div>

      {/* Liste */}
      <div className="min-w-0">
        {/* Je Kategorie: Name und Betrag, rechts Ist-Anteil; darunter Balken mit Zielstrich und die Abweichung in Worten */}
        <ul className="grid gap-0.5">
          {rows.map((r) => {
            const pp = r.diff != null ? Math.abs(r.diff * 100).toFixed(1).replace('.0', '') : null
            const note = r.tgt == null ? 'kein Ziel'
              : r.state === 'over' ? `${pp} Pp über der Obergrenze`
              : r.cap ? `${pp} Pp Spielraum bis max ${pctPlain(r.tgt, 0)}`
              : Math.abs(r.diff!) < 0.0005 ? `genau im Ziel ${pctPlain(r.tgt, 0)}`
              : `${pp} Pp ${r.diff! > 0 ? 'über' : 'unter'} Ziel ${pctPlain(r.tgt, 0)}`
            return (
              <li
                key={r.b.id}
                onPointerEnter={() => setHot(r.b.id)}
                onPointerLeave={() => setHot(null)}
                className={clsx('rounded-xl px-3 py-2.5 transition-colors', hot === r.b.id ? 'bg-white/[0.05]' : 'hover:bg-white/[0.03]')}
              >
                <div className="flex items-baseline justify-between gap-3">
                  <span className="flex min-w-0 items-center gap-2">
                    <i className="swatch" style={{ background: r.b.color }} />
                    <span className="truncate text-[13.5px] font-medium">{r.b.name}</span>
                    <span className="num truncate text-[12px] text-muted max-[380px]:hidden">{usd(r.v)} USD</span>
                  </span>
                  <span className="num text-[15px] font-semibold tracking-[-0.01em]">{pctPlain(r.w)}</span>
                </div>
                <Meter className="mt-2" value={r.w / scale} mark={r.tgt != null ? r.tgt / scale : undefined} color={r.b.color} height={5} />
                <div className={clsx('mt-1.5 text-[11.5px]', r.state === 'over' ? 'text-down' : r.state === 'off' ? 'text-warn' : 'text-muted')}>{note}</div>
              </li>
            )
          })}
        </ul>
        <p className="mt-2 px-3 text-[11.5px] leading-[1.5] text-muted">
          {anyTarget ? 'Innerer Ring: aktuelle Anteile. Äusserer Ring und weisser Strich im Balken: Ziele. Gelb: mehr als 5 Pp vom Ziel entfernt.' : 'Noch keine Zielanteile. Unter «Ziele» legst du sie fest.'}
        </p>
        {noCash && <p className="mt-2 px-3 text-[12px] leading-[1.5] text-muted">Anteile an den Wertpapieren, ohne Cash. Mit erfasstem Cash-Stand rechnet die Ansicht mit dem Gesamtwert.</p>}
      </div>
    </div>
    </div>
  )
}
