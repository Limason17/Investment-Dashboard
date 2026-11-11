import { ArrowDown, ArrowUp, Download, Search, Upload } from 'lucide-react'
import { Fragment, useMemo, useState } from 'react'
import { DivergingBars } from '@/components/charts/DivergingBars'
import { FluidSparkline, Meter, Sparkline } from '@/components/charts/Small'
import { Card, Chip, Delta, DemoTag, Empty, Segmented, Ticker } from '@/components/ui'
import { HOLDING_BUCKETS } from '@/lib/buckets'
import { targetOf, type Row } from '@/lib/calc'
import { RANGE_LABEL, RANGE_TEXT, RANGE_TITLE } from '@/lib/charts'
import { useDepot, useNav } from '@/lib/context'
import { exportCsv } from '@/lib/export'
import { pct, pctPlain, qty, sign, sUsd, usd } from '@/lib/format'
import { rangeChange } from '@/lib/history'
import { useMedia, usePortfolio, usePortfolioRanges, useStored } from '@/lib/hooks'
import type { HoldingBucket, RangeId } from '@/lib/types'

type SortKey = 't' | 'trend' | 'chg' | 'shares' | 'val' | 'pl'
const SORTS: { k: SortKey; label: string }[] = [
  { k: 'val', label: 'Wert' },
  { k: 'chg', label: 'Tag' },
  { k: 'trend', label: 'Zeitraum' },
  { k: 'pl', label: 'Gewinn/Verlust' },
  { k: 't', label: 'Name' },
]

export function Positions() {
  const { c } = useDepot()
  const nav = useNav()
  const ranges = usePortfolioRanges()
  const [stored, setRange] = useStored<RangeId>('depot.range.pos', '1M')
  const range = ranges.includes(stored) ? stored : 'MAX'
  const { chart, series: ps, pending } = usePortfolio(range)
  const [sort, setSort] = useState<{ k: SortKey; d: 1 | -1 }>({ k: 'val', d: -1 })
  const [bucket, setBucket] = useState<string>('alle')
  const [q, setQ] = useState('')
  const [allBars, setAllBars] = useState(false)
  const desktop = useMedia('(min-width: 768px)')
  const cashOff = !!c.settings.cashExcluded

  const trend = useMemo(() => {
    const out: Record<string, { values: number[]; chg: number | null; base: number | null }> = {}
    for (const r of c.rows) out[r.t] = { values: chart?.series[r.t] ?? [], chg: rangeChange(chart, r.t), base: chart?.prev[r.t] ?? null }
    return out
  }, [c.rows, chart])

  const value = (r: Row, k: SortKey): number | string | null =>
    k === 't' ? r.t : k === 'shares' ? r.p.shares : k === 'trend' ? (trend[r.t]?.chg ?? null) : (r[k] as number | null)
  const needle = q.trim().toLowerCase()
  const rows = c.rows
    .filter((r) => (bucket === 'alle' || r.p.bucket === bucket) && (!needle || r.t.toLowerCase().includes(needle) || r.p.name.toLowerCase().includes(needle)))
    .sort((a, b) => {
      const va = value(a, sort.k), vb = value(b, sort.k)
      if (va == null) return 1
      if (vb == null) return -1
      return (va > vb ? 1 : va < vb ? -1 : 0) * sort.d
    })
  const costDemo = c.rows.some((r) => r.p.costDemo)
  const onSort = (k: SortKey) => setSort((s) => (s.k === k ? { k, d: s.d === 1 ? -1 : 1 } : { k, d: k === 't' ? 1 : -1 }))
  const rangeSwitch = <Segmented label="Zeitraum" value={range} onChange={setRange} options={ranges.map((r) => ({ value: r, label: RANGE_LABEL[r], title: RANGE_TITLE[r] }))} />
  const edges = desktop || allBars ? undefined : 4
  const more = !desktop && c.rows.length > 9 && (
    <button type="button" className="btn btn-ghost btn-sm" onClick={() => setAllBars((v) => !v)}>{allBars ? 'Weniger' : `Alle ${c.rows.length}`}</button>
  )

  const th = (k: SortKey, label: string, right?: boolean, hint?: string, className?: string) => (
    <th className={`${right ? 'r' : ''} ${className ?? ''}`} aria-sort={sort.k === k ? (sort.d === 1 ? 'ascending' : 'descending') : undefined} title={hint}>
      <button type="button" onClick={() => onSort(k)}>
        {label}
        {sort.k === k && (sort.d === 1 ? <ArrowUp className="size-3" /> : <ArrowDown className="size-3" />)}
      </button>
    </th>
  )

  return (
    <div className="grid grid-cols-12 gap-3 sm:gap-4">
      {/* Bausteine: Gewicht gegen Plan und Rendite im Zeitraum */}
      <Card
        className="col-span-12"
        title="Bausteine"
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
            const over = b.cap && !cashOff && w > tgt
            return (
              <button key={b.id} type="button" onClick={() => setBucket(bucket === b.id ? 'alle' : b.id)} aria-pressed={bucket === b.id} className="group min-w-0 rounded-xl text-left outline-offset-4">
                <div className="flex items-center gap-2 text-[12.5px] text-ink-2">
                  <i className="swatch" style={{ background: b.color }} />
                  <span className="truncate">{b.name}</span>
                  <span className="text-faint">{n}</span>
                </div>
                <div className="num mt-1 text-[19px] font-semibold leading-6 tracking-[-0.02em]">{usd(c.valuationComplete ? v : null)}</div>
                <div className="num mt-0.5 flex flex-wrap items-center gap-x-1.5 text-[12px] text-muted">
                  <span className="text-ink-2">{pctPlain(c.valuationComplete ? w : null)}</span>
                  <span>/ {b.cap ? 'max ' : b.max ? 'bis ' : ''}{pctPlain(tgt, 0)}</span>
                  {over && <Chip tone="down">über Deckel</Chip>}
                </div>
                <Meter className="mt-2" value={w / 0.6} mark={tgt / 0.6} color={b.color} height={4} />
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

      <Card className="col-span-12 xl:col-span-6" title="Kursentwicklung je Titel" sub={range === '1T' ? (c.live ? 'heute' : 'letzter Handelstag') : RANGE_TEXT[range]} action={more} bodyClassName="!px-3.5">
        <div className={`transition-opacity ${pending ? 'opacity-40' : ''}`}>
          <DivergingBars
            ariaLabel={`Kursentwicklung je Position, ${RANGE_TEXT[range]}`}
            edges={edges}
            rows={c.rows.filter((r) => trend[r.t]?.chg != null).map((r) => ({ key: r.t, label: r.t, title: `${r.t} · ${r.p.name}`, value: trend[r.t].chg!, right: range === '1T' ? sUsd(r.dayAbs) : undefined }))}
            format={(v) => pct(v, 1)}
            onSelect={nav.openPosition}
            empty={pending ? 'Kurse werden geladen …' : 'Noch keine Kursverläufe.'}
          />
        </div>
      </Card>

      <Card className="col-span-12 xl:col-span-6" title="Gewinn/Verlust seit Kauf" sub="offene Positionen, in USD" action={more} bodyClassName="!px-3.5">
        <DivergingBars
          ariaLabel="Gewinn oder Verlust je Position seit Kauf"
          edges={edges}
          rows={c.rows.filter((r) => r.pl != null).map((r) => ({ key: r.t, label: r.t, title: `${r.t} · ${r.p.name}`, value: r.pl!, right: pct(r.plPct, 1) }))}
          format={sUsd}
          onSelect={nav.openPosition}
          empty="Einstand oder Kurse fehlen."
        />
      </Card>

      <Card
        className="col-span-12"
        title="Alle Positionen"
        sub={`${c.rows.length} Titel · ${c.valuationComplete ? usd(c.sec) + ' USD' : 'Marktwert offen'}`}
        flush
        action={<div className="flex gap-1"><button type="button" className="btn btn-ghost btn-sm" onClick={() => nav.openEntry('import', { kind: 'trades' })}><Upload /> Import</button><button type="button" className="btn btn-ghost btn-sm" onClick={() => exportCsv(c)}><Download /> CSV</button></div>}
      >
        <div className="flex flex-wrap items-center gap-2 px-2 pb-2 sm:px-3">
          <label className="relative min-w-[150px] flex-1 sm:max-w-[240px]">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted" />
            <input className="input input-sm !pl-8" placeholder="Titel suchen" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Titel suchen" />
          </label>
          <div className="scroll-x max-w-full">
            <Segmented label="Baustein" value={bucket} onChange={setBucket} options={[{ value: 'alle', label: 'Alle' }, ...HOLDING_BUCKETS.map((b) => ({ value: b.id as string, label: b.short }))]} />
          </div>
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
                {th('trend', RANGE_TITLE[range], false, `Kursverlauf und Veränderung, ${RANGE_TEXT[range]}`)}
                {th('chg', 'Kurs · Tag', true)}
                {th('shares', 'Stück · Ø Einstand', true, costDemo ? 'Einstand: Testwerte' : undefined, 'max-lg:hidden')}
                {th('val', 'Wert · Anteil', true, cashOff ? 'Anteil an den Wertpapieren' : 'Anteil am Gesamtwert')}
                {th('pl', 'Gewinn/Verlust', true)}
              </tr>
            </thead>
            <tbody>
              {HOLDING_BUCKETS.map((b) => {
                const rs = rows.filter((r) => r.p.bucket === b.id)
                if (!rs.length) return null
                const sum = rs.reduce((s, r) => s + (r.val ?? 0), 0)
                const pl = rs.every((r) => r.pl != null) ? rs.reduce((s, r) => s + r.pl!, 0) : null
                return (
                  <Fragment key={b.id}>
                    <tr className="row-group">
                      <td colSpan={3}>
                        <span className="inline-flex items-center gap-2.5"><i className="swatch" style={{ background: b.color }} />{b.name}<span className="font-normal text-muted">{rs.length} Titel</span></span>
                      </td>
                      <td className="max-lg:hidden" />
                      <td className="r num">{usd(rs.every((r) => r.val != null) ? sum : null)} <span className="font-normal text-muted">· {pctPlain(c.valuationComplete && c.total ? sum / c.total : null)}</span></td>
                      <td className="r"><Delta value={pl} kind="usd" icon={false} className="font-medium" /></td>
                    </tr>
                    {rs.map((r) => (
                      <tr key={r.t} className="row-click" tabIndex={0} onClick={() => nav.openPosition(r.t)} onKeyDown={(e) => e.key === 'Enter' && nav.openPosition(r.t)}>
                        <td><Ticker t={r.t} name={r.p.name} /></td>
                        <td>
                          <span className={`flex items-center gap-3 transition-opacity ${pending ? 'opacity-40' : ''}`}>
                            <Sparkline values={trend[r.t]?.values ?? []} baseline={range === '1T' ? trend[r.t]?.base : undefined} tone={sign(trend[r.t]?.chg)} label={`${r.t}: ${pct(trend[r.t]?.chg, 1)} ${RANGE_TEXT[range]}`} />
                            <Delta value={trend[r.t]?.chg} digits={1} icon={false} className="text-[12.5px]" />
                          </span>
                        </td>
                        <td className="r leading-tight">
                          <div className="num">{usd(r.px)}</div>
                          <Delta value={r.chg} digits={2} icon={false} className="text-[11.5px]" />
                        </td>
                        <td className="r leading-tight max-lg:hidden">
                          <div className="num text-ink-2">{qty(r.p.shares)}</div>
                          <div className="num text-[11.5px] text-muted">{usd(r.avg)}{r.p.costDemo && <DemoTag className="ml-1.5" />}</div>
                        </td>
                        <td className="r leading-tight">
                          <div className="num font-medium">{usd(r.val)}</div>
                          <div className="num mt-0.5 inline-flex items-center gap-2 text-[11.5px] text-muted">
                            {pctPlain(c.valuationComplete ? r.w : null)}
                            <span className="relative inline-block h-1 w-9 overflow-hidden rounded-full" style={{ background: `color-mix(in srgb, ${b.color} 16%, transparent)` }}>
                              <i className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${Math.min(r.w / 0.2, 1) * 100}%`, background: b.color }} />
                            </span>
                          </div>
                        </td>
                        <td className="r leading-tight">
                          {r.pl != null ? (
                            <>
                              <Delta value={r.pl} kind="usd" icon={false} className="font-medium" />
                              <div><Delta value={r.plPct} digits={1} icon={false} className="text-[11.5px] opacity-80" /></div>
                            </>
                          ) : (
                            <span className="text-faint">–</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </Fragment>
                )
              })}
              {bucket === 'alle' && !needle && !cashOff && (
                <tr className="row-group">
                  <td colSpan={3}>
                    <span className="inline-flex items-center gap-2.5"><i className="swatch" style={{ background: 'var(--color-cash)' }} />Cash {c.settings.cashEstimate && <Chip tone="warn" title={c.settings.cashNote}>Schätzung</Chip>}</span>
                  </td>
                  <td className="max-lg:hidden" />
                  <td className="r num">{usd(c.cash)} <span className="font-normal text-muted">· {pctPlain(c.total ? c.cash / c.total : 0)}</span></td>
                  <td />
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Handy: Liste zum Antippen */}
        <div className="md:hidden">
          {HOLDING_BUCKETS.map((b) => {
            const rs = rows.filter((r) => r.p.bucket === b.id)
            if (!rs.length) return null
            const sum = rs.reduce((s, r) => s + (r.val ?? 0), 0)
            return (
              <Fragment key={b.id}>
                <div className="flex items-center justify-between gap-3 border-b border-line px-3 pb-2 pt-4 text-[12px] font-medium text-ink-2">
                  <span className="inline-flex items-center gap-2"><i className="swatch" style={{ background: b.color }} />{b.name}</span>
                  <span className="num">{usd(rs.every((r) => r.val != null) ? sum : null)} <span className="font-normal text-muted">· {pctPlain(c.valuationComplete && c.total ? sum / c.total : null)}</span></span>
                </div>
                <ul>
                  {rs.map((r) => (
                    <li key={r.t} className="border-b border-white/[0.04] last:border-b-0">
                      <button type="button" onClick={() => nav.openPosition(r.t)} className="grid min-h-[58px] w-full grid-cols-[minmax(0,1fr)_60px_auto] items-center gap-3 px-3 py-2 text-left active:bg-white/[0.04]">
                        <Ticker t={r.t} name={r.p.name} />
                        <span className={pending ? 'opacity-40' : ''}><Sparkline width={60} height={26} values={trend[r.t]?.values ?? []} baseline={range === '1T' ? trend[r.t]?.base : undefined} tone={sign(trend[r.t]?.chg)} /></span>
                        <span className="min-w-[84px] text-right leading-tight">
                          <span className="num block text-[13.5px] font-medium">{usd(r.val)}</span>
                          <span className="mt-0.5 block text-[12px]">
                            {sort.k === 'pl' ? <Delta value={r.pl} kind="usd" icon={false} /> : sort.k === 'trend' ? <Delta value={trend[r.t]?.chg} digits={1} icon={false} /> : <Delta value={r.chg} digits={2} icon={false} />}
                          </span>
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </Fragment>
            )
          })}
          {bucket === 'alle' && !needle && !cashOff && (
            <div className="flex items-center justify-between gap-3 px-3 pb-2 pt-4 text-[12px] font-medium text-ink-2">
              <span className="inline-flex items-center gap-2"><i className="swatch" style={{ background: 'var(--color-cash)' }} />Cash</span>
              <span className="num">{usd(c.cash)} <span className="font-normal text-muted">· {pctPlain(c.total ? c.cash / c.total : 0)}</span></span>
            </div>
          )}
          <p className="px-3 pb-1 pt-3 text-[11.5px] text-faint">Zweite Zeile: {sort.k === 'pl' ? 'Gewinn/Verlust seit Kauf' : sort.k === 'trend' ? `Veränderung ${RANGE_TEXT[range]}` : 'Veränderung am Tag'}</p>
        </div>

        {rows.length === 0 && <Empty title="Kein Treffer">Kein Titel passt zur Suche.</Empty>}
      </Card>
    </div>
  )
}
