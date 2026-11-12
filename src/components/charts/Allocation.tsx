import clsx from 'clsx'
import { motion } from 'motion/react'
import { useState } from 'react'
import { BUCKETS } from '@/lib/buckets'
import { isCap, targetOf, type Calc } from '@/lib/calc'
import { pctPlain, usd } from '@/lib/format'
import { Empty } from '../ui'

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
        <ul className="grid gap-1">
          {rows.map((r) => (
            <li
              key={r.b.id}
              onPointerEnter={() => setHot(r.b.id)}
              onPointerLeave={() => setHot(null)}
              className={clsx('grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 rounded-xl px-3 py-2.5 transition-colors', hot === r.b.id ? 'bg-white/[0.05]' : 'hover:bg-white/[0.03]')}
            >
              <div className="flex min-w-0 items-center gap-3">
                <span className="h-8 w-1.5 flex-none rounded-full" style={{ background: r.b.color, boxShadow: `0 0 12px -2px ${r.b.color}` }} />
                <div className="min-w-0">
                  <div className="truncate text-[13.5px] font-medium">{r.b.name}</div>
                  <div className="num text-[12px] text-muted">{usd(r.v)} USD</div>
                </div>
              </div>
              <div className="text-right">
                <div className="num text-[16px] font-semibold leading-5 tracking-[-0.01em]">{pctPlain(r.w)}</div>
                <div className="num mt-0.5 flex items-center justify-end gap-1.5 text-[11.5px]">
                  {r.tgt == null ? (
                    <span className="text-faint">kein Ziel</span>
                  ) : (
                    <>
                      <span className="text-muted">{r.cap ? 'max' : 'Ziel'} {pctPlain(r.tgt, 0)}</span>
                      <span
                        className={clsx(
                          'rounded-md px-1.5 py-px font-medium',
                          r.state === 'over' ? 'bg-down/15 text-down' : r.state === 'off' ? 'bg-warn/12 text-warn' : 'bg-up/12 text-up',
                        )}
                      >
                        {r.state === 'over' ? 'über max' : `${r.diff! >= 0 ? '+' : '−'}${Math.abs(r.diff! * 100).toFixed(1)} Pp`}
                      </span>
                    </>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 px-3 text-[11.5px] text-muted">
          {anyTarget ? (
            <>
              <span className="inline-flex items-center gap-1.5"><i className="inline-block h-2.5 w-4 rounded-sm bg-white/30" />innen Ist</span>
              <span className="inline-flex items-center gap-1.5"><i className="inline-block h-1 w-4 rounded-full bg-white/30" />aussen Ziel</span>
              <span className="inline-flex items-center gap-1.5"><i className="inline-block size-2 rounded-full bg-up" />im Rahmen</span>
              <span className="inline-flex items-center gap-1.5"><i className="inline-block size-2 rounded-full bg-warn" />mehr als 5 Pp daneben</span>
            </>
          ) : (
            <span>Noch keine Zielanteile. Unter «Ziele» legst du sie fest.</span>
          )}
        </div>
        {noCash && <p className="mt-2 px-3 text-[12px] leading-[1.5] text-muted">Anteile an den Wertpapieren, ohne Cash. Mit erfasstem Cash-Stand rechnet die Ansicht mit dem Gesamtwert.</p>}
      </div>
    </div>
    </div>
  )
}
