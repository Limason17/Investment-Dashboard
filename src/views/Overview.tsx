import clsx from 'clsx'
import { ArrowRight, RefreshCw, Table2 } from 'lucide-react'
import { animate } from 'motion/react'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { AlertItem, EventItem, EventStrip, LimitRow } from '@/components/blocks'
import { FluidSparkline } from '@/components/charts/Small'
import { LineLegend, TimeChart, type RefLine, type TimeSeries, type VLine } from '@/components/charts/TimeChart'
import { Card, Chip, Delta, DemoTag, Empty, Segmented } from '@/components/ui'
import { alerts, capChecks, divAnnual, eventsSorted, fxOf, watchRows, yearStats } from '@/lib/calc'
import { RANGE_LABEL, RANGE_TITLE, refreshCharts } from '@/lib/charts'
import { useDepot, useNav } from '@/lib/context'
import { dfmt, dlong, hhmm, int, pct, pctPlain, sign, sUsd, usd } from '@/lib/format'
import { BENCH, useMedia, usePortfolio, usePortfolioRanges, useStored } from '@/lib/hooks'
import type { RangeId } from '@/lib/types'

const PHRASE: Record<RangeId, string> = { '1T': 'heute', '1W': 'in 1 Woche', '1M': 'in 1 Monat', '3M': 'in 3 Monaten', '1J': 'in 1 Jahr', '5J': 'in 5 Jahren', MAX: 'seit Beginn' }
const pctAxis = (v: number) => (Math.abs(v) < 1e-9 ? '0 %' : (Math.abs(v % 1) > 1e-9 ? v.toFixed(1) : v.toFixed(0)).replace('-', '−') + ' %')

function useCountUp(target: number) {
  const [v, setV] = useState(target)
  const prev = useRef<number | null>(null)
  useEffect(() => {
    const from = prev.current ?? target * 0.985
    prev.current = target
    const ctl = animate(from, target, { duration: 0.9, ease: [0.22, 1, 0.36, 1], onUpdate: setV })
    return () => ctl.stop()
  }, [target])
  return v
}

/* ------------------------------------------------------------------ Wert + Verlauf */
function Hero() {
  const { db, c } = useDepot()
  const nav = useNav()
  const ranges = usePortfolioRanges()
  const [stored, setRange] = useStored<RangeId>('depot.range', '1M')
  const range = ranges.includes(stored) ? stored : 'MAX'
  const [mode, setMode] = useStored<'wert' | 'rendite'>('depot.mode', 'wert', ['wert', 'rendite'])
  const [hover, setHover] = useState<number | null>(null)
  const [table, setTable] = useState(false)
  const wide = useMedia('(min-width: 640px)')
  const tall = useMedia('(min-height: 800px)')
  const { series: ps, pending, error } = usePortfolio(range)

  const cashOff = !!c.settings.cashExcluded
  const total = cashOff ? c.sec : c.total
  const shown = useCountUp(total)
  const fx = fxOf(db)
  const n = ps?.t.length ?? 0
  const hi = hover != null && hover < n ? hover : null
  const withInvested = mode === 'wert' && (range === '3M' || range === '1J' || range === 'MAX')
  const valueLabel = cashOff ? 'Wertpapiere' : 'Gesamtwert'
  const investedLabel = ps?.cashTracked ? 'Einzahlungen netto' : 'Netto investiert'

  const series: TimeSeries[] = useMemo(() => {
    if (!ps) return []
    if (mode === 'rendite') {
      const s: TimeSeries[] = [{ key: 'twr', label: 'Depot', values: ps.twr.map((v) => v * 100), color: 'var(--color-accent)', color2: 'var(--color-accent-2)', area: true, glow: true }]
      if (ps.bench) s.push({ key: 'bench', label: BENCH, values: ps.bench.map((v) => v * 100), color: '#7d8494', width: 1.5 })
      return s
    }
    const s: TimeSeries[] = [{ key: 'total', label: valueLabel, values: ps.value, color: 'var(--color-accent)', color2: 'var(--color-accent-2)', area: true, glow: true }]
    if (withInvested) s.push({ key: 'inv', label: investedLabel, values: ps.invested, color: '#6b7385', kind: 'step', width: 1.5 })
    return s
  }, [ps, mode, withInvested, valueLabel, investedLabel])

  const refs: RefLine[] = ps && mode === 'wert' && range === '1T' && ps.base != null ? [{ y: ps.base, label: `Vortag ${usd(ps.base)}`, color: '#8a91a0' }] : []
  const vlines: VLine[] = useMemo(() => {
    if (!ps?.session || range !== '1T') return []
    const out: VLine[] = []
    const open = ps.t.findIndex((x) => x >= ps.session!.open)
    const close = ps.t.findIndex((x) => x >= ps.session!.close)
    if (open > 0) out.push({ i: open, label: 'Eröffnung' })
    if (close > 0 && close < ps.t.length - 1) out.push({ i: close, label: 'Schluss' })
    return out
  }, [ps, range])

  // Kacheln unter dem Chart: Tag, Woche, Monat und das Jahr; ist das Depot jünger, der ganze Zeitraum.
  const periods = useMemo(() => [...(['1T', '1W', '1M'] as RangeId[]).filter((r) => ranges.includes(r)), ranges.includes('1J') ? '1J' : 'MAX'] as RangeId[], [ranges])
  const chf = db.market.latest?.usdchf ?? c.settings.usdchf
  // «Wert» zeigt, was das eingesetzte Geld gemacht hat (passt zum Ertrag in USD), «Rendite» die zeitgewichtete Sicht.
  const ret = ps ? (mode === 'rendite' ? ps.twr : ps.mwr)[hi ?? n - 1] : null
  const chartH = wide ? (tall ? 300 : 232) : 220
  const dayText = c.live ? 'heute' : 'letzter Handelstag'

  return (
    <section className="card col-span-12 overflow-hidden xl:col-span-1">
      {/* Lichtkante oben: die eine Stelle, an der der Akzent leuchten darf */}
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-accent/50 to-transparent" />
      <div className="pointer-events-none absolute -top-24 left-10 h-48 w-[420px] max-w-full rounded-full bg-accent/[0.09] blur-3xl" />

      <div className="relative px-4 pt-4 sm:px-6 sm:pt-5">
        {/* Links Stand und Wert, rechts die Umschalter: So bleibt die Zeile neben der grossen Zahl nicht leer. */}
        <div className="flex items-start justify-between gap-x-6">
         <div className="min-w-0 flex-1">
          <div className="label flex min-h-8 flex-wrap items-center gap-x-2 gap-y-1">
            {hi != null && ps ? (
              <span className="text-ink-2">{ps.kind === 'intraday' ? `${dlong(new Date(ps.t[hi]).toLocaleDateString('en-CA'))} · ${hhmm(ps.t[hi])}` : dlong(ps.d[hi])}</span>
            ) : (
              <>
                {valueLabel}
                {c.priceLabel && (
                  <span className="inline-flex items-center gap-1.5 text-faint">
                    <span className="relative flex size-1.5">
                      {c.live && <span className="absolute inline-flex size-full animate-ping rounded-full bg-up opacity-60 [animation-duration:2.4s]" />}
                      <span className={`relative inline-flex size-1.5 rounded-full ${c.live ? 'bg-up' : 'bg-faint'}`} />
                    </span>
                    {c.priceLabel}
                  </span>
                )}
                {cashOff && <button type="button" onClick={() => nav.openEntry('einzahlung')} title="Cash-Stand eintragen" className="rounded-full focus-visible:outline-2"><Chip tone="mute" icon={false}>ohne Cash · eintragen</Chip></button>}
                {c.settings.demo && <DemoTag />}
              </>
            )}
          </div>
        <div className="mt-1 flex items-baseline gap-2.5">
          <span className={`text-[40px] font-semibold leading-[1.05] tracking-[-0.04em] sm:text-[52px] ${hi != null ? 'tabular-nums' : ''}`}>
            {c.valuationComplete ? usd(hi != null && ps ? ps.value[hi] : shown) : '–'}
          </span>
          <span className="text-[14px] font-medium text-muted sm:text-[15px]">USD</span>
          {fx && c.valuationComplete && <span className="num text-[13px] text-muted sm:text-[14px]" title={`Kurs 1 USD = ${fx.rate.toFixed(4)} ${fx.code}`}>≈ {usd((hi != null && ps ? ps.value[hi] : shown) * fx.rate)} {fx.code}</span>}
        </div>
        <div className="mt-2.5 flex min-h-6 flex-wrap items-center gap-x-3 gap-y-1.5 text-[13px]">
          {!c.valuationComplete ? (
            <Chip tone="warn">Kurse fehlen</Chip>
          ) : (
            <>
              <span className={`chip ${sign(ret) === 'down' ? 'chip-down' : sign(ret) === 'up' ? 'chip-up' : 'chip-mute'} !h-6 !text-[12.5px]`}>
                <Delta value={ret} digits={2} className="!text-inherit" />
              </span>
              {ps && hi == null && (
                <span className="text-muted">
                  <Delta value={ps.gain} kind="usd" icon={false} className="font-medium" /> {range === '1T' ? dayText : PHRASE[range]}
                </span>
              )}
              {ps && hi != null && <span className="text-muted">bis hier, {range === '1T' ? 'seit Vortagesschluss' : PHRASE[range].replace(/^in /, 'über ')}</span>}
              {chf && !fx && hi == null ? (
                <span className="inline-flex items-center gap-1.5 text-muted">
                  <span className="text-faint max-sm:hidden">·</span> ≈ {int(total * chf)} CHF {c.settings.usdchfDemo && !db.market.latest?.usdchf && <DemoTag />}
                </span>
              ) : null}
            </>
          )}
        </div>
         </div>
          <div className="hidden flex-none flex-col items-end gap-2 sm:flex min-[1500px]:flex-row min-[1500px]:items-center">
            <Segmented label="Zeitraum" value={range} onChange={setRange} options={ranges.map((r) => ({ value: r, label: RANGE_LABEL[r], title: RANGE_TITLE[r] }))} />
            <Segmented label="Darstellung" value={mode} onChange={setMode} options={[{ value: 'wert', label: 'Wert', title: 'Wert in USD; der Ertrag bezieht sich auf das eingesetzte Kapital' }, { value: 'rendite', label: 'Rendite', title: 'Zeitgewichtet und im Vergleich zum Markt: Käufe, Verkäufe und Einzahlungen sind herausgerechnet' }]} />
          </div>
        </div>

        {/* Handy: Umschalter in voller Breite unter der Zahl */}
        <div className="mt-4 grid gap-2 sm:hidden">
          <Segmented fill label="Zeitraum" value={range} onChange={setRange} options={ranges.map((r) => ({ value: r, label: RANGE_LABEL[r] }))} />
        </div>
      </div>

      <div className="relative px-1.5 pb-1 pt-3 sm:px-3 sm:pt-4">
        {ps ? (
          <TimeChart
            t={ps.t}
            d={ps.d}
            kind={ps.kind}
            series={series}
            refs={refs}
            vlines={vlines}
            height={chartH}
            baseline={mode === 'rendite' ? 0 : undefined}
            format={mode === 'rendite' ? (v) => pct(v / 100, 2) : usd}
            tickFormat={mode === 'rendite' ? pctAxis : undefined}
            onHover={setHover}
            animateKey={range + mode}
            pending={pending}
            live={c.live}
            ariaLabel={mode === 'rendite' ? 'Zeitgewichtete Rendite des Depots im Vergleich zum US-Gesamtmarkt' : `${valueLabel} im Verlauf`}
            empty={<Empty title="Heute noch kein Handel">Der Tages-Chart beginnt mit dem Pre-Market um 10:00 Uhr.</Empty>}
            tooltipExtra={(i) => (
              <>
                {mode === 'rendite' && <div className="tip-row"><span>{valueLabel}</span><b>{usd(ps.value[i])}</b></div>}
                {mode === 'wert' && <div className="tip-row"><span>Ertrag im Zeitraum</span><b className={ps.pl[i] >= 0 ? '!text-up' : '!text-down'}>{sUsd(ps.pl[i])} · {pct(ps.mwr[i], 2)}</b></div>}
                {mode === 'wert' && !withInvested && range !== '1T' && <div className="tip-row"><span>{investedLabel}</span><b>{usd(ps.invested[i])}</b></div>}
              </>
            )}
          />
        ) : (
          <div style={{ height: chartH }} className="grid place-items-center px-4">
            {error ? (
              <div className="text-center">
                <p className="text-[13px] text-muted">Der Kursverlauf ist gerade nicht erreichbar.</p>
                <button type="button" className="btn btn-sm mt-3" onClick={refreshCharts}><RefreshCw /> Erneut versuchen</button>
              </div>
            ) : pending ? (
              <div className="grid h-full w-full animate-pulse place-items-center rounded-xl bg-white/[0.035] text-[12.5px] text-muted">Kursverlauf lädt …</div>
            ) : (
              <Empty title="Noch kein Verlauf">Der Verlauf entsteht aus den Buchungen. Erfasse den ersten Kauf mit «Eintrag».</Empty>
            )}
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 px-4 pb-4 sm:px-6">
        <LineLegend
          items={
            mode === 'rendite'
              ? [{ label: 'Depot, zeitgewichtet', color: 'var(--color-accent-2)' }, ...(ps?.bench ? [{ label: `${BENCH}, US-Gesamtmarkt`, color: '#7d8494' }] : [])]
              : [{ label: valueLabel, color: 'var(--color-accent-2)' }, ...(withInvested ? [{ label: investedLabel, color: '#6b7385' }] : [])]
          }
        />
        <div className="flex items-center gap-1.5">
          <Segmented className="sm:hidden" label="Darstellung" value={mode} onChange={setMode} options={[{ value: 'wert', label: 'Wert' }, { value: 'rendite', label: 'Rendite' }]} />
          <button type="button" className="btn btn-ghost btn-sm max-sm:hidden" aria-pressed={table} onClick={() => setTable((v) => !v)}>
            <Table2 /> {table ? 'Tabelle ausblenden' : 'Als Tabelle'}
          </button>
        </div>
      </div>
      {ps && ps.approx.length > 0 && <p className="px-4 pb-3 text-[12px] text-muted sm:px-6">Ohne Kursverlauf, zum letzten Kurs bewertet: {ps.approx.join(', ')}.</p>}

      {table && ps && (
        <div className="max-h-[280px] overflow-auto border-t border-line px-2">
          <table className="tbl">
            <caption className="sr-only">Verlauf aus den Buchungen und den Kursen von Yahoo Finance berechnet</caption>
            <thead>
              <tr><th className="bg-card">{ps.kind === 'intraday' ? 'Zeitpunkt' : 'Datum'}</th><th className="r bg-card">{valueLabel}</th><th className="r bg-card">{investedLabel}</th><th className="r bg-card">Ertrag</th><th className="r bg-card">Rendite, zeitgewichtet</th></tr>
            </thead>
            <tbody>
              {ps.t.map((_, k) => {
                const i = n - 1 - k
                return (
                  <tr key={ps.t[i]}>
                    <td className="num">{ps.kind === 'intraday' ? `${dfmt(new Date(ps.t[i]).toLocaleDateString('en-CA'))} ${hhmm(ps.t[i])}` : dfmt(ps.d[i])}</td>
                    <td className="r num">{usd(ps.value[i])}</td>
                    <td className="r num text-ink-2">{usd(ps.invested[i])}</td>
                    <td className="r"><Delta value={ps.pl[i]} kind="usd" icon={false} /></td>
                    <td className="r"><Delta value={ps.twr[i]} icon={false} /></td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Tag, Woche, Monat, Jahr auf einen Blick; ein Tipp wählt den Zeitraum des Charts */}
      <div className={clsx('grid grid-cols-2 border-t border-line [&>*]:border-line max-lg:[&>*:nth-child(even)]:border-l max-lg:[&>*:nth-child(n+3)]:border-t lg:[&>*+*]:border-l', periods.length === 4 ? 'lg:grid-cols-4' : periods.length === 3 ? 'lg:grid-cols-3' : 'lg:grid-cols-2')}>
        {periods.map((p) => <PeriodTile key={p} range={p} active={p === range} onSelect={() => setRange(p)} />)}
      </div>
    </section>
  )
}

const PERIOD_LABEL: Partial<Record<RangeId, string>> = { '1W': 'Woche', '1M': 'Monat', '3M': '3 Monate', '1J': 'Jahr', MAX: 'Seit Beginn' }
/** Höchstens so viele Punkte, dass der Mini-Verlauf ruhig bleibt. */
const thin = (v: number[], max = 48) => (v.length <= max ? v : Array.from({ length: max }, (_, i) => v[Math.round((i / (max - 1)) * (v.length - 1))]))

function PeriodTile({ range, active, onSelect }: { range: RangeId; active: boolean; onSelect: () => void }) {
  const { c } = useDepot()
  const { series: ps, pending } = usePortfolio(range)
  const n = ps?.t.length ?? 0
  const day = range === '1T'
  // Vor Handelsbeginn gibt es noch keinen Tagesverlauf: Dann zählt der Stand gegenüber dem Vortag.
  const ret = n ? ps!.mwr[n - 1] : day ? c.dayPct : null
  const gain = n ? ps!.gain : day && c.dailyComplete ? c.day : null
  const spark = useMemo(() => (ps ? thin(ps.pl) : []), [ps])
  const label = day ? (c.live ? 'Heute' : 'Letzter Tag') : PERIOD_LABEL[range]
  return (
    <button type="button" onClick={onSelect} aria-pressed={active} title={`${label}: im Chart zeigen. Ertrag in USD und im Verhältnis zum eingesetzten Kapital.`} className={clsx('group @container relative min-w-0 px-4 py-3.5 text-left transition-colors hover:bg-white/[0.03] sm:px-5', active && 'bg-white/[0.03]')}>
      {active && <span className="pointer-events-none absolute inset-x-4 top-[-1px] h-px bg-gradient-to-r from-transparent via-accent to-transparent sm:inset-x-5" />}
      <span className="flex items-center justify-between gap-3">
        <span className="min-w-0">
          <span className={clsx('label block truncate transition-colors', active && '!text-ink-2')}>{label}</span>
          <span className={clsx('num mt-1 block text-[17px] font-semibold leading-6 tracking-[-0.02em] sm:text-[19px]', !ps && pending && 'animate-pulse')}>
            <Delta value={c.valuationComplete ? ret : null} digits={2} icon={false} />
          </span>
          <span className="mt-0.5 block truncate text-[12px] text-muted"><Delta value={c.valuationComplete ? gain : null} kind="usd" icon={false} className="!text-muted" /> USD</span>
        </span>
        {/* Mini-Verlauf nur, wenn die Kachel breit genug ist: lieber keiner als ein gequetschter */}
        {spark.length > 1 && <FluidSparkline className="hidden w-12 flex-none @[138px]:block @[190px]:w-20" height={34} values={spark} tone={sign(ret)} baseline={0} label={`Ertrag im Verlauf, ${label}`} />}
      </span>
    </button>
  )
}

/* ------------------------------------------------------------------ Kennzahlen: eine ruhige Zeile */
function KeyFigures() {
  const { db, c, now } = useDepot()
  const nav = useNav()
  const year = now.slice(0, 4)
  const ys = useMemo(() => yearStats(db, year), [db, year])
  const div = useMemo(() => divAnnual(db), [db])
  const cashOff = !!c.settings.cashExcluded
  return (
    <section className={clsx('card grid grid-cols-2 overflow-hidden [&>*]:border-line max-lg:[&>*:nth-child(even)]:border-l max-lg:[&>*:nth-child(n+3)]:border-t lg:[&>*+*]:border-l', cashOff ? 'lg:grid-cols-3' : 'lg:grid-cols-4')}>
      <Figure
        label="Seit Kauf"
        onClick={() => nav.goto('positionen')}
        value={c.pl != null ? <Delta value={c.pl} kind="usd" icon={false} /> : <span className="text-muted">offen</span>}
        sub={c.pl != null ? <><Delta value={c.plPct} digits={1} /> <span className="max-sm:hidden">auf {usd(c.costKnown)}</span></> : <span>Einstand fehlt</span>}
      />
      {!cashOff && <Figure label="Cash" onClick={() => nav.goto('plan')} value={usd(c.cash)} sub={<span>{c.total ? pctPlain(c.cash / c.total) : '–'} vom Depot</span>} />}
      <Figure
        label={`Realisiert ${year}`}
        onClick={() => nav.goto('journal')}
        value={ys.sales ? <Delta value={ys.realized} kind="usd" icon={false} /> : <span className="text-muted">–</span>}
        sub={<span>{ys.sales} {ys.sales === 1 ? 'Verkauf' : 'Verkäufe'}{ys.fifo ? ', FIFO' : ''}</span>}
      />
      <Figure
        label={`Dividenden ${year}`}
        onClick={() => nav.goto('dividenden')}
        value={ys.divCount ? usd(ys.divNet) : <span className="text-muted">–</span>}
        sub={<span>netto{div.per.length ? ` · ${usd(div.net)} p. a. erwartet` : `, ${ys.divCount} ${ys.divCount === 1 ? 'Zahlung' : 'Zahlungen'}`}</span>}
      />
    </section>
  )
}

function Figure({ label, value, sub, onClick }: { label: string; value: ReactNode; sub: ReactNode; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="flex min-w-0 flex-col items-stretch justify-start px-4 py-3.5 text-left transition-colors hover:bg-white/[0.03] sm:px-6">
      <span className="label block truncate">{label}</span>
      <span className="num mt-1 block truncate text-[17px] font-semibold leading-6 tracking-[-0.02em] sm:text-[19px]">{value}</span>
      <span className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-[12px] text-muted">{sub}</span>
    </button>
  )
}

/* ------------------------------------------------------------------ Limits: nur erreicht oder sehr nah */
const NEAR = 0.05

function Limits() {
  const { db, c } = useDepot()
  const nav = useNav()
  const rows = useMemo(() => watchRows(db), [db])
  const hot = rows.filter((r) => r.s.d != null && r.s.d <= NEAR)
  const next = rows.find((r) => r.s.d != null && r.s.d > NEAR)
  const etf = capChecks(c)[0]
  const priced = rows.some((r) => r.s.d != null)
  const under = hot.filter((r) => r.s.d! <= 0).length
  return (
    <Card
      title="Limits"
      sub={hot.length ? `${under} erreicht · ${hot.length - under} nah` : 'erreicht oder bis 5 % darüber'}
      action={<button type="button" className="btn btn-ghost btn-sm" onClick={() => nav.goto('limits')}>Alle {rows.length} <ArrowRight /></button>}
      bodyClassName="!px-2.5 !pt-1.5 !pb-2.5"
    >
      {etf && etf.state !== 'ok' && (
        <button type="button" onClick={() => nav.goto('plan')} className="mb-1 flex w-full items-center justify-between gap-3 rounded-xl px-2.5 py-2.5 text-left transition-colors hover:bg-white/[0.035]">
          <span className="min-w-0">
            <span className="flex items-center gap-2"><span className="text-[13px] font-medium">{etf.name}: Obergrenze</span><Chip tone={etf.state === 'ueber' ? 'down' : 'warn'}>{etf.state === 'ueber' ? 'überschritten' : 'nahe'}</Chip></span>
            <span className="mt-0.5 block text-[12px] text-muted">Keine weiteren Käufe über {pctPlain(etf.cap, 0)}</span>
          </span>
          <span className="num text-[15px] font-semibold">{pctPlain(etf.w)}</span>
        </button>
      )}
      {hot.map((r) => <LimitRow key={r.w.ticker} r={r} onClick={() => nav.openWatch(r.w.ticker)} />)}
      {!hot.length && (
        <div className="px-2.5 py-6 text-center">
          <div className="text-[13.5px] font-medium">{priced ? 'Kein Titel an der Grenze' : rows.length ? 'Kurse fehlen' : 'Keine Watchlist erfasst'}</div>
          {priced && next && (
            <p className="mt-1 text-[12.5px] text-muted">
              Am nächsten: <button type="button" className="tk hover:underline" onClick={() => nav.openWatch(next.w.ticker)}>{next.w.ticker}</button>, {pct(next.s.d, 1)} über {usd(next.w.limit)}
            </p>
          )}
        </div>
      )}
    </Card>
  )
}

/* ------------------------------------------------------------------ Nächste Termine */
function NextEvents() {
  const { db, now } = useDepot()
  const nav = useNav()
  const all = useMemo(() => eventsSorted(db).filter((e) => !e.done), [db])
  const overdue = all.filter((e) => e.date < now)
  const upcoming = all.filter((e) => e.date >= now)
  return (
    <Card
      title="Nächste Termine"
      action={<button type="button" className="btn btn-ghost btn-sm" onClick={() => nav.goto('plan')}>Alle <ArrowRight /></button>}
      bodyClassName="!pt-1 !pb-2"
    >
      {overdue.length > 0 && (
        <button type="button" onClick={() => nav.goto('plan')} className="mt-1.5 flex w-full items-center justify-between gap-3 rounded-xl border border-warn/20 bg-warn/[0.07] px-3 py-2 text-left text-[12.5px] transition-colors hover:bg-warn/[0.11]">
          <span className="min-w-0 truncate"><span className="font-medium text-warn">{overdue.length} {overdue.length === 1 ? 'Termin' : 'Termine'} noch offen</span> <span className="text-muted">· {overdue.slice(-2).map((e) => e.title).join(', ')}</span></span>
          <ArrowRight className="size-3.5 flex-none text-warn" />
        </button>
      )}
      <EventStrip events={upcoming} now={now} className="mb-1 mt-3" />
      {upcoming.length ? <ul>{upcoming.slice(0, 4).map((e) => <EventItem key={e.id} e={e} now={now} compact />)}</ul> : <Empty>{all.length ? 'Kein anstehender Termin.' : 'Keine Termine erfasst.'}</Empty>}
    </Card>
  )
}

/* ------------------------------------------------------------------ Übersicht: nur das Wesentliche */
/** Neues, leeres Depot: die vier Schritte zum ersten Bild. */
function FirstSteps() {
  const nav = useNav()
  const { c } = useDepot()
  const steps: { title: string; text: string; action: string; run: () => void; done?: boolean }[] = [
    { title: 'Positionen hochladen', text: 'Alle bisherigen Käufe auf einmal, mit Vorlage für Excel. Oder einzeln über «Eintrag».', action: 'Hochladen', run: () => nav.openEntry('import', { kind: 'trades' }) },
    { title: 'Cash-Stand eintragen', text: 'Den Saldo laut Broker. Dann zählen Gesamtwert, Anteile und Obergrenzen mit Cash.', action: 'Eintragen', run: () => nav.openEntry('einzahlung'), done: !c.settings.cashExcluded },
    { title: 'Plan festlegen', text: 'Zielanteile je Baustein, Obergrenzen und eigene Regeln.', action: 'Zum Plan', run: () => nav.goto('plan') },
    { title: 'Watchlist anlegen', text: 'Titel mit Kaufgrenze beobachten.', action: 'Zur Watchlist', run: () => nav.goto('limits') },
  ]
  return (
    <Card className="col-span-12" title="Erste Schritte" sub="Dein Depot ist noch leer. So ist es in wenigen Minuten eingerichtet.">
      <ol className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {steps.map((s, i) => (
          <li key={s.title} className="flex flex-col gap-2 rounded-xl border border-line bg-white/[0.02] p-4">
            <div className="flex items-center gap-2.5">
              <span className="num grid size-6 flex-none place-items-center rounded-full border border-line-2 text-[12px] font-semibold">{i + 1}</span>
              <span className="text-[14px] font-medium">{s.title}</span>
              {s.done && <Chip tone="up">erledigt</Chip>}
            </div>
            <p className="flex-1 text-[12.5px] leading-[1.5] text-muted">{s.text}</p>
            <button type="button" data-tour={i === 0 ? 'upload' : undefined} className={i === 0 ? 'btn btn-sm btn-primary w-fit' : 'btn btn-sm w-fit'} onClick={s.run}>{s.action}</button>
          </li>
        ))}
      </ol>
    </Card>
  )
}

export function Overview() {
  const { db, c, now } = useDepot()
  const nav = useNav()
  const list = useMemo(() => alerts(db, c, now), [db, c, now])
  const fresh = !Object.keys(db.positions).length && !Object.keys(db.transactions).length
  return (
    <div className="grid grid-cols-12 gap-3 sm:gap-4">
      {fresh && <FirstSteps />}
      {/* Leeres Depot: nur die ersten Schritte, keine leeren Charts. */}
      {!fresh && (<>
      {list.length > 0 && (
        <div className="col-span-12 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
          {list.map((a) => <AlertItem key={a.title} a={a} onClick={a.goto ? () => nav.goto(a.goto!) : undefined} />)}
        </div>
      )}
      {/* Bis Tablet liegen Wert, Limits und Termine zuerst, die Kennzahlen zuletzt; ab 1280px links unter dem Chart. */}
      <div className="contents xl:col-span-8 xl:grid xl:grid-cols-1 xl:content-start xl:gap-4">
        <Hero />
        <div className="col-span-12 max-xl:order-last xl:col-span-1"><KeyFigures /></div>
      </div>
      <div className="col-span-12 grid content-start items-start gap-3 sm:gap-4 md:grid-cols-2 xl:col-span-4 xl:grid-cols-1">
        <Limits />
        <NextEvents />
      </div>
      </>)}
    </div>
  )
}
