import { ArrowDown, ArrowUp, Download, Search, Upload, X } from 'lucide-react'
import { Fragment, useMemo, useState } from 'react'
import { FluidSparkline, Meter, Sparkline } from '@/components/charts/Small'
import { Card, Chip, Delta, DemoTag, Empty, Segmented, Ticker } from '@/components/ui'
import { HOLDING_BUCKETS } from '@/lib/buckets'
import { isCap, targetOf, type Row } from '@/lib/calc'
import { RANGE_LABEL, RANGE_TEXT, RANGE_TITLE } from '@/lib/charts'
import { useDepot, useNav } from '@/lib/context'
import { exportCsv } from '@/lib/export'
import { pct, pctPlain, qty, sign, usd } from '@/lib/format'
import { rangeChange } from '@/lib/history'
import { usePortfolio, usePortfolioRanges, useStored } from '@/lib/hooks'
import type { HoldingBucket, RangeId } from '@/lib/types'

type SortKey = 't' | 'px' | 'gl' | 'shares' | 'val'
const SORTS: { k: SortKey; label: string }[] = [
  { k: 'val', label: 'Wert' },
  { k: 'gl', label: 'Gewinn/Verlust' },
  { k: 't', label: 'Name' },
]
/** Gewinn/Verlust je Position im gewählten Zeitraum */
type Move = { abs: number | null; pct: number | null; sinceBuy: boolean }

export function Positions() {
  const { db, c } = useDepot()
  const nav = useNav()
  const ranges = usePortfolioRanges()
  const [stored, setRange] = useStored<RangeId>('depot.range.pos', '1M')
  const range = ranges.includes(stored) ? stored : 'MAX'
  const { chart, series: ps, pending } = usePortfolio(range)
  const [sort, setSort] = useState<{ k: SortKey; d: 1 | -1 }>({ k: 'val', d: -1 })
  const [bucket, setBucket] = useState<string>('alle')
  const [grouped, setGrouped] = useStored<'an' | 'aus'>('depot.pos.group', 'aus', ['an', 'aus'])
  const [q, setQ] = useState('')
  const cashOff = !!c.settings.cashExcluded

  // Erster Kauf je Titel: Wer erst im Zeitraum gekauft hat, sieht den Gewinn/Verlust seit Kauf.
  const firstBuy = useMemo(() => {
    const m: Record<string, string> = {}
    for (const x of Object.values(db.transactions)) if (x.type === 'kauf' && x.ticker && (!m[x.ticker] || x.date < m[x.ticker])) m[x.ticker] = x.date
    return m
  }, [db.transactions])

  const data = useMemo(() => {
    const start = chart?.d[0] ?? null
    const out: Record<string, { values: number[]; base: number | null; move: Move }> = {}
    for (const r of c.rows) {
      const values = chart?.series[r.t] ?? []
      const base = chart?.prev[r.t] ?? null
      let move: Move
      if (range === 'MAX' || (start && firstBuy[r.t] && firstBuy[r.t] > start)) move = { abs: r.pl, pct: r.plPct, sinceBuy: true }
      else if (range === '1T') move = { abs: r.dayAbs, pct: r.chg, sinceBuy: false }
      else {
        const chg = rangeChange(chart, r.t)
        move = { abs: r.val != null && chg != null ? (r.val * chg) / (1 + chg) : null, pct: chg, sinceBuy: false }
      }
      out[r.t] = { values, base, move }
    }
    return out
  }, [c.rows, chart, range, firstBuy])

  const value = (r: Row, k: SortKey): number | string | null =>
    k === 't' ? r.t : k === 'shares' ? r.p.shares : k === 'px' ? r.px : k === 'gl' ? (data[r.t]?.move.abs ?? null) : r.val
  const needle = q.trim().toLowerCase()
  const rows = c.rows
    .filter((r) => (bucket === 'alle' || r.p.bucket === bucket) && (!needle || r.t.toLowerCase().includes(needle) || r.p.name.toLowerCase().includes(needle)))
    .sort((a, b) => {
      const va = value(a, sort.k), vb = value(b, sort.k)
      if (va == null) return 1
      if (vb == null) return -1
      return (va > vb ? 1 : va < vb ? -1 : 0) * sort.d
    })
  const groups = grouped === 'an'
    ? HOLDING_BUCKETS.map((b) => ({ b, rs: rows.filter((r) => r.p.bucket === b.id) })).filter((g) => g.rs.length)
    : [{ b: null, rs: rows }]
  const share = (v: number | null) => pctPlain(c.valuationComplete && v != null && (cashOff ? c.sec : c.total) ? v / (cashOff ? c.sec : c.total) : null)
  const costDemo = c.rows.some((r) => r.p.costDemo)
  const showCash = bucket === 'alle' && !needle && !cashOff
  const glTitle = range === 'MAX' ? 'seit Kauf' : RANGE_TEXT[range]
  const onSort = (k: SortKey) => setSort((s) => (s.k === k ? { k, d: s.d === 1 ? -1 : 1 } : { k, d: k === 't' ? 1 : -1 }))
  const rangeSwitch = <Segmented label="Zeitraum" value={range} onChange={setRange} options={ranges.map((r) => ({ value: r, label: RANGE_LABEL[r], title: RANGE_TITLE[r] }))} />
  const bucketName = HOLDING_BUCKETS.find((b) => b.id === bucket)?.name

  const th = (k: SortKey | null, label: string, right?: boolean, hint?: string, className?: string) => (
    <th className={`${right ? 'r' : ''} ${className ?? ''}`} aria-sort={k && sort.k === k ? (sort.d === 1 ? 'ascending' : 'descending') : undefined} title={hint}>
      {k ? (
        <button type="button" onClick={() => onSort(k)}>
          {label}
          {sort.k === k && (sort.d === 1 ? <ArrowUp className="size-3" /> : <ArrowDown className="size-3" />)}
        </button>
      ) : label}
    </th>
  )
  const gl = (m: Move | undefined, small?: boolean) =>
    m?.abs != null ? (
      <span className={`leading-tight ${pending && !m.sinceBuy ? 'opacity-40' : ''}`} title={m.sinceBuy ? 'Gewinn/Verlust seit Kauf' : undefined}>
        <Delta value={m.abs} kind="usd" icon={false} className={small ? 'text-[12px]' : 'font-medium'} />
        {small ? <span className="text-[12px]"> · <Delta value={m.pct} digits={1} icon={false} /></span> : <span className="block"><Delta value={m.pct} digits={2} icon={false} className="text-[11.5px]" /></span>}
      </span>
    ) : <span className="text-faint">–</span>

  return (
    <div className="grid grid-cols-12 gap-3 sm:gap-4">
      {/* Kategorien: Gewicht gegen Plan und Rendite im Zeitraum. Ein Tipp filtert die Liste. */}
      <Card
        className="col-span-12"
        title="Kategorien"
        sub={<span className="max-sm:hidden">Gewicht gegen Plan · Rendite {RANGE_TEXT[range]}, Käufe und Verkäufe herausgerechnet</span>}
        action={rangeSwitch}
      >
        {c.sec > 0 && (
          <div className="mb-4 flex h-2 gap-[2px] overflow-hidden rounded-full" role="img" aria-label={'Aufteilung: ' + HOLDING_BUCKETS.map((b) => `${b.name} ${pctPlain((c.b[b.id] || 0) / c.sec)}`).join(', ')}>
            {HOLDING_BUCKETS.filter((b) => c.b[b.id] > 0).map((b) => <div key={b.id} className="basis-0" style={{ background: b.color, flexGrow: c.b[b.id] }} title={`${b.name}: ${usd(c.b[b.id])}`} />)}
          </div>
        )}
        <div className="grid grid-cols-2 gap-x-5 gap-y-5 lg:grid-cols-4 lg:gap-x-7">
          {HOLDING_BUCKETS.map((b) => {
            const v = c.b[b.id] || 0
            const w = c.total ? v / c.total : 0
            const tgt = targetOf(c.settings, b.id)
            const s = ps?.buckets[b.id as HoldingBucket]
            const ret = s && s.twr.length ? s.twr[s.twr.length - 1] : null
            const n = c.rows.filter((r) => r.p.bucket === b.id).length
            const over = isCap(c.settings, b.id) && !cashOff && tgt != null && w > tgt
            return (
              <button key={b.id} type="button" onClick={() => setBucket(bucket === b.id ? 'alle' : b.id)} aria-pressed={bucket === b.id} title={bucket === b.id ? 'Filter aufheben' : `Nur ${b.name} zeigen`} className={`group min-w-0 rounded-xl text-left outline-offset-4 transition-opacity ${bucket !== 'alle' && bucket !== b.id ? 'opacity-45' : ''}`}>
                <div className="flex items-center gap-2 text-[12.5px] text-ink-2">
                  <i className="swatch" style={{ background: b.color }} />
                  <span className="truncate">{b.name}</span>
                  <span className="text-faint">{n}</span>
                </div>
                <div className="num mt-1 text-[19px] font-semibold leading-6 tracking-[-0.02em]">{usd(c.valuationComplete ? v : null)}</div>
                <div className="num mt-0.5 flex flex-wrap items-center gap-x-1.5 text-[12px] text-muted">
                  <span className="text-ink-2">{pctPlain(c.valuationComplete ? w : null)}</span>
                  {tgt != null && <span>/ {isCap(c.settings, b.id) ? 'max ' : ''}{pctPlain(tgt, 0)}</span>}
                  {over && <Chip tone="down">über Obergrenze</Chip>}
                </div>
                <Meter className="mt-2" value={w / 0.6} mark={tgt != null ? tgt / 0.6 : undefined} color={b.color} height={4} />
                <div className={`mt-3 flex items-center gap-3 transition-opacity ${pending ? 'opacity-40' : ''}`}>
                  <Delta value={ret} digits={1} className="flex-none text-[12.5px] font-medium" />
                  <FluidSparkline className="min-w-0 flex-1" values={s?.twr ?? []} tone={sign(ret)} baseline={0} height={30} label={`${b.name}: ${pct(ret, 1)} ${RANGE_TEXT[range]}`} />
                </div>
              </button>
            )
          })}
        </div>
        {cashOff && <p className="mt-4 text-[12px] text-muted">Anteile an den Wertpapieren. Der Plan zählt Cash mit, das hier nicht erfasst ist.</p>}
      </Card>

      <Card
        className="col-span-12"
        title="Alle Positionen"
        sub={`${c.rows.length} Titel · ${c.valuationComplete ? usd(c.sec) + ' USD' : 'Marktwert offen'}`}
        flush
        action={<div className="flex gap-1"><button type="button" className="btn btn-ghost btn-sm" onClick={() => nav.openEntry('import', { kind: 'trades' })}><Upload /> Hochladen</button><button type="button" className="btn btn-ghost btn-sm" onClick={() => exportCsv(c)}><Download /> CSV</button></div>}
      >
        <div className="flex flex-wrap items-center gap-2 px-2 pb-2 sm:px-3">
          <label className="relative min-w-[150px] flex-1 sm:max-w-[240px]">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted" />
            <input className="input input-sm !pl-8" placeholder="Titel suchen" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Titel suchen" />
          </label>
          {bucketName && (
            <button type="button" className="chip chip-mute !h-7 gap-1.5" onClick={() => setBucket('alle')} title="Filter aufheben">
              {bucketName} <X className="size-3" />
            </button>
          )}
          <label className="flex cursor-pointer select-none items-center gap-2 text-[12.5px] text-ink-2">
            <input type="checkbox" className="size-4 accent-[var(--color-accent)]" checked={grouped === 'an'} onChange={(e) => setGrouped(e.target.checked ? 'an' : 'aus')} />
            Nach Kategorie
          </label>
          <label className="ml-auto flex items-center gap-2 text-[12px] text-muted md:hidden">
            Sortiert nach
            <select className="input input-sm !w-auto" value={sort.k} onChange={(e) => setSort({ k: e.target.value as SortKey, d: e.target.value === 't' ? 1 : -1 })}>
              {SORTS.map((s) => <option key={s.k} value={s.k}>{s.label}</option>)}
            </select>
          </label>
        </div>

        {/* Ab Tablet: Tabelle */}
        <div className="hidden overflow-x-auto md:block">
          <table className="tbl">
            <thead>
              <tr>
                {th('t', 'Titel')}
                {th(null, `Verlauf ${RANGE_LABEL[range]}`, false, `Kursverlauf, ${RANGE_TEXT[range]}`)}
                {th('px', 'Kurs', true)}
                {th('gl', `Gewinn/Verlust ${RANGE_LABEL[range]}`, true, `In USD und Prozent, ${glTitle}. Erst im Zeitraum gekaufte Titel: seit Kauf.`)}
                {th('shares', 'Stück · Ø Einstand', true, costDemo ? 'Einstand: Testwerte' : undefined, 'max-lg:hidden')}
                {th('val', 'Wert', true)}
                {th(null, 'Anteil', true, cashOff ? 'Anteil an den Wertpapieren' : 'Anteil am Gesamtwert')}
              </tr>
            </thead>
            <tbody>
              {groups.map(({ b, rs }) => {
                const sum = rs.every((r) => r.val != null) ? rs.reduce((s, r) => s + r.val!, 0) : null
                return (
                  <Fragment key={b?.id ?? 'alle'}>
                    {b && (
                      <tr className="row-group">
                        <td colSpan={3}>{b.name} <span className="font-normal text-muted">{rs.length} Titel</span></td>
                        <td />
                        <td className="max-lg:hidden" />
                        <td className="r num">{usd(sum)}</td>
                        <td className="r num">{share(sum)}</td>
                      </tr>
                    )}
                    {rs.map((r) => {
                      const d = data[r.t]
                      return (
                        <tr key={r.t} className="row-click" tabIndex={0} onClick={() => nav.openPosition(r.t)} onKeyDown={(e) => e.key === 'Enter' && nav.openPosition(r.t)}>
                          <td><Ticker t={r.t} name={r.p.name} /></td>
                          <td className={`transition-opacity ${pending ? 'opacity-40' : ''}`}>
                            <Sparkline values={d?.values ?? []} baseline={range === '1T' ? (d?.base ?? undefined) : undefined} tone={sign(d?.move.pct)} label={`${r.t}: ${pct(d?.move.pct, 1)} ${glTitle}`} />
                          </td>
                          <td className="r num">{usd(r.px)}</td>
                          <td className="r">{gl(d?.move)}</td>
                          <td className="r leading-tight max-lg:hidden">
                            <div className="num text-ink-2">{qty(r.p.shares)}</div>
                            <div className="num text-[11.5px] text-muted">{usd(r.avg)}{r.p.costDemo && <DemoTag className="ml-1.5" />}</div>
                          </td>
                          <td className="r num font-medium">{usd(r.val)}</td>
                          <td className="r num text-ink-2">{share(r.val)}</td>
                        </tr>
                      )
                    })}
                  </Fragment>
                )
              })}
              {showCash && (
                <tr className="row-group">
                  <td colSpan={3}>Cash {c.settings.cashEstimate && <Chip tone="warn" title={c.settings.cashNote}>Schätzung</Chip>}</td>
                  <td />
                  <td className="max-lg:hidden" />
                  <td className="r num">{usd(c.cash)}</td>
                  <td className="r num">{share(c.cash)}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Handy: Liste zum Antippen */}
        <div className="md:hidden">
          <div className="flex justify-between border-b border-line px-3 pb-2 text-[11.5px] text-faint">
            <span>Titel · Verlauf {RANGE_LABEL[range]}</span>
            <span>Wert · Gewinn/Verlust</span>
          </div>
          {groups.map(({ b, rs }) => {
            const sum = rs.every((r) => r.val != null) ? rs.reduce((s, r) => s + r.val!, 0) : null
            return (
              <Fragment key={b?.id ?? 'alle'}>
                {b && (
                  <div className="flex items-center justify-between gap-3 border-b border-line px-3 pb-2 pt-4 text-[12px] font-medium text-ink-2">
                    <span>{b.name}</span>
                    <span className="num">{usd(sum)} <span className="font-normal text-muted">· {share(sum)}</span></span>
                  </div>
                )}
                <ul>
                  {rs.map((r) => {
                    const d = data[r.t]
                    return (
                      <li key={r.t} className="border-b border-white/[0.04] last:border-b-0">
                        <button type="button" onClick={() => nav.openPosition(r.t)} className="grid min-h-[58px] w-full grid-cols-[minmax(0,1fr)_56px_auto] items-center gap-3 px-3 py-2 text-left active:bg-white/[0.04]">
                          <Ticker t={r.t} name={r.p.name} />
                          <span className={pending ? 'opacity-40' : ''}><Sparkline width={56} height={26} values={d?.values ?? []} baseline={range === '1T' ? (d?.base ?? undefined) : undefined} tone={sign(d?.move.pct)} /></span>
                          <span className="min-w-[96px] text-right leading-tight">
                            <span className="num block text-[13.5px] font-medium">{usd(r.val)}</span>
                            <span className="mt-0.5 block whitespace-nowrap">{gl(d?.move, true)}</span>
                          </span>
                        </button>
                      </li>
                    )
                  })}
                </ul>
              </Fragment>
            )
          })}
          {showCash && (
            <div className="flex items-center justify-between gap-3 border-t border-line px-3 pb-2 pt-3 text-[12.5px] font-medium text-ink-2">
              <span>Cash</span>
              <span className="num">{usd(c.cash)} <span className="font-normal text-muted">· {share(c.cash)}</span></span>
            </div>
          )}
        </div>

        {rows.length === 0 && <Empty title="Kein Treffer">Kein Titel passt zur Suche.</Empty>}
      </Card>
    </div>
  )
}
