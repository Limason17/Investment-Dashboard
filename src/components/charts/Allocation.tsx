import { motion } from 'motion/react'
import { BUCKETS } from '@/lib/buckets'
import { targetOf, type Calc } from '@/lib/calc'
import { pctPlain, usd } from '@/lib/format'
import { Chip, Empty } from '../ui'

/**
 * Ist-Anteile gegen den Plan. Oben das Ganze als dünner geteilter Balken, darunter je Baustein
 * ein Balken auf gemeinsamer Skala; der Strich markiert das Ziel (rot = harter ETF-Deckel).
 */
export function Allocation({ c }: { c: Calc }) {
  // Ohne erfassten Cash: Anteile an den Wertpapieren. Der Plan zählt Cash mit, der Vergleich ist dann eine Näherung.
  const noCash = !!c.settings.cashExcluded
  const total = noCash ? c.sec : c.total
  if (!c.valuationComplete) return <Empty>Aktuelle Kurse fehlen. Die Allokation bleibt offen.</Empty>
  if (!total) return <Empty>Die Allokation erscheint mit den Positionen.</Empty>
  const rows = BUCKETS.filter((b) => !noCash || b.id !== 'cash').map((b) => {
    const v = c.b[b.id] || 0
    return { b, v, w: v / total, tgt: targetOf(c.settings, b.id) }
  })
  const scaleMax = Math.max(0.5, Math.ceil(Math.max(...rows.map((r) => Math.max(r.w, r.tgt))) * 10) / 10)
  const axis = Array.from({ length: Math.round(scaleMax * 10) + 1 }, (_, i) => i / 10)

  return (
    <div>
      <div className="flex h-2 gap-[2px] overflow-hidden rounded-full" role="img" aria-label={'Aufteilung: ' + rows.map((r) => `${r.b.name} ${pctPlain(r.w)}`).join(', ')}>
        {rows.filter((r) => r.w > 0).map((r) => (
          <motion.div key={r.b.id} title={`${r.b.name}: ${pctPlain(r.w)}`} style={{ background: r.b.color }} initial={{ flexGrow: 0 }} animate={{ flexGrow: r.w }} transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }} className="basis-0" />
        ))}
      </div>

      <div className="mt-5 grid gap-y-1">
        {rows.map((r, i) => {
          const over = !noCash && r.b.cap && r.w > r.tgt
          const diff = (r.w - r.tgt) * 100
          return (
            <div key={r.b.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1.5 rounded-lg py-2 sm:grid-cols-[148px_minmax(0,1fr)_176px]">
              <div className="flex items-center gap-2.5 text-[13px] font-medium">
                <i className="swatch" style={{ background: r.b.color }} />
                {r.b.name}
              </div>
              <div className="relative order-3 col-span-2 h-[10px] sm:order-none sm:col-span-1" title={`${r.b.name}: ${pctPlain(r.w)} Ist, ${pctPlain(r.tgt, 0)} ${r.b.cap ? 'Deckel' : 'Ziel'}`}>
                <div className="absolute inset-0 rounded-full" style={{ background: `color-mix(in srgb, ${r.b.color} 15%, transparent)` }} />
                <motion.div
                  className="absolute inset-y-0 left-0 rounded-r-full"
                  style={{ background: r.b.color }}
                  initial={{ width: 0 }}
                  animate={{ width: `${Math.min(r.w / scaleMax, 1) * 100}%` }}
                  transition={{ duration: 0.8, delay: 0.05 * i, ease: [0.22, 1, 0.36, 1] }}
                />
                <div
                  className={`absolute -bottom-[5px] -top-[5px] w-[2px] -translate-x-1/2 rounded-full ${r.b.cap ? 'bg-down' : 'bg-ink'}`}
                  style={{ left: `${(r.tgt / scaleMax) * 100}%`, boxShadow: '0 0 0 2px var(--color-card)' }}
                />
              </div>
              <div className="text-right leading-tight">
                <div className="num text-[13px]">
                  <span className="font-semibold">{pctPlain(r.w)}</span>
                  <span className="text-muted"> / {r.b.cap ? 'max ' : r.b.max ? 'bis ' : ''}{pctPlain(r.tgt, 0)}</span>
                </div>
                <div className="num mt-0.5 text-[12px] text-muted">
                  {usd(r.v)}
                  <span className="text-faint"> · </span>
                  {over ? <Chip tone="down" className="ml-0.5 align-middle">über Deckel</Chip> : `${Math.abs(diff).toFixed(1)} Pp ${diff >= 0 ? 'darüber' : 'darunter'}`}
                </div>
              </div>
            </div>
          )
        })}
        <div className="hidden grid-cols-[148px_minmax(0,1fr)_176px] gap-x-4 sm:grid" aria-hidden="true">
          <div />
          <div className="relative mt-1 h-4 border-t border-line">
            {axis.map((a) => (
              <span key={a} className="num absolute top-1 -translate-x-1/2 text-[10.5px] text-faint" style={{ left: `${(a / scaleMax) * 100}%` }}>
                {Math.round(a * 100)}
              </span>
            ))}
          </div>
          <div className="mt-1.5 text-right text-[10.5px] text-faint">{noCash ? '% der Wertpapiere' : '% vom Gesamtwert'}</div>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-x-5 gap-y-1 text-[12px] text-muted">
        <span className="inline-flex items-center gap-2"><i className="inline-block h-3 w-[2px] rounded-full bg-ink" />Ziel laut Plan</span>
        <span className="inline-flex items-center gap-2"><i className="inline-block h-3 w-[2px] rounded-full bg-down" />ETF-Deckel {pctPlain(targetOf(c.settings, 'etf'), 0)} (hart)</span>
      </div>
      {noCash && <p className="mt-2 text-[12px] leading-[1.5] text-muted">Anteile an den Wertpapieren. Der Plan zählt Cash mit, das hier nicht erfasst ist: Die Anteile fallen darum etwas höher aus als im Gesamtdepot.</p>}
    </div>
  )
}
