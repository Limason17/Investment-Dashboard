import { Plus } from 'lucide-react'
import { useMemo, useState } from 'react'
import { LimitRow } from '@/components/blocks'
import { FluidSparkline, LimitTrack, Sparkline } from '@/components/charts/Small'
import { Card, Chip, Delta, Empty, Stat, Ticker } from '@/components/ui'
import { WatchAddSheet } from '@/features/EditSheets'
import { watchRows, type WatchRow } from '@/lib/calc'
import { useChart } from '@/lib/charts'
import { useDepot, useNav } from '@/lib/context'
import { pct, sign, usd } from '@/lib/format'
import { rangeChange, withNow } from '@/lib/history'

const GROUPS: { id: string; title: string; hint: string; test: (r: WatchRow) => boolean }[] = [
  { id: 'unter', title: 'Unter der Grenze', hint: 'Bedingung prüfen, dann entscheiden', test: (r) => r.s.d != null && r.s.d <= 0 },
  { id: 'nahe', title: 'Nahe', hint: 'bis 5 % über der Grenze', test: (r) => r.s.d != null && r.s.d > 0 && r.s.d <= 0.05 },
  { id: 'darueber', title: 'Darüber', hint: 'warten', test: (r) => r.s.d != null && r.s.d > 0.05 },
  { id: 'offen', title: 'Ohne Grenze oder Kurs', hint: '', test: (r) => r.s.d == null },
]

/** Richtung über den ganzen Verlauf: grün, wenn der Kurs gestiegen ist, sonst rot */
const trendOf = (v?: number[]) => sign(v && v.length > 1 && v[0] > 0 ? v[v.length - 1] / v[0] - 1 : null)

export function Watchlist() {
  const [add, setAdd] = useState(false)
  const { db } = useDepot()
  const nav = useNav()
  const rows = useMemo(() => watchRows(db), [db])
  const tickers = useMemo(() => rows.map((r) => r.w.ticker), [rows])
  const { data } = useChart('3M', tickers)
  const chart = useMemo(() => (data ? withNow(db, data) : null), [db, data])
  const under = rows.filter((r) => r.s.d != null && r.s.d <= 0)
  const near = rows.filter((r) => r.s.d != null && r.s.d > 0 && r.s.d <= 0.05)
  const ready = under.filter((r) => r.w.conditionMet !== false)
  const next = rows.find((r) => r.s.d != null && r.s.d > 0.05)
  const priced = rows.some((r) => r.px != null)
  // Im Fokus: alles unter oder nahe der Grenze; ist nichts so weit, die drei nächsten.
  const hot = [...under, ...near]
  const focus = (hot.length ? hot : rows.filter((r) => r.s.d != null).slice(0, 3)).slice(0, 6)
  const none = <span>Kurse fehlen</span>

  return (
    <div className="grid gap-3 sm:gap-4">
      {rows.length > 0 && <section className="card grid grid-cols-2 divide-line lg:grid-cols-4 lg:divide-x [&>*]:border-line max-lg:[&>*:nth-child(n+3)]:border-t max-lg:[&>*:nth-child(even)]:border-l">
        <Stat label="Unter der Grenze" value={priced ? under.length : '–'} sub={priced ? <span>{under.length ? under.map((r) => r.w.ticker).join(', ') : 'kein Titel'}</span> : none} />
        <Stat label="Davon kaufbereit" value={priced ? ready.length : '–'} sub={priced ? <span>{!under.length ? 'kein Titel unter der Grenze' : ready.length ? 'Bedingung erfüllt oder keine' : 'Bedingung überall noch offen'}</span> : none} />
        <Stat label="Nahe (bis 5 %)" value={priced ? near.length : '–'} sub={priced ? <span>{near.length ? near.map((r) => r.w.ticker).join(', ') : 'kein Titel'}</span> : none} />
        <Stat label="Nächster darüber" value={next ? <span className="tk !text-[20px]">{next.w.ticker}</span> : '–'} sub={next ? <span>{pct(next.s.d, 1)} über {usd(next.w.limit)}</span> : priced ? undefined : none} />
      </section>}

      {focus.length > 0 && (
        <Card title="Im Fokus" sub={hot.length ? 'unter oder nahe der Grenze · Kurs der letzten 3 Monate' : 'am nächsten an der Grenze · Kurs der letzten 3 Monate'} bodyClassName="!px-2.5 !pb-2.5 !pt-1.5">
          <div className="grid gap-1 md:grid-cols-2 xl:grid-cols-3">
            {focus.map((r) => {
              const below = r.s.d! <= 0
              return (
                <button key={r.w.ticker} type="button" onClick={() => nav.openWatch(r.w.ticker)} className="min-w-0 rounded-xl px-2.5 py-2.5 text-left transition-colors hover:bg-white/[0.035]">
                  <span className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-4">
                    <span className="min-w-0">
                      <span className="flex flex-wrap items-center gap-x-2 gap-y-1"><span className="tk">{r.w.ticker}</span><Chip tone={r.s.tone}>{r.s.label}</Chip></span>
                      <span className="mt-0.5 block truncate text-[12px] leading-4 text-muted">{r.w.name}</span>
                    </span>
                    <span className="text-right leading-tight">
                      <span className={`num block text-[15px] font-semibold tracking-[-0.01em] ${below ? 'text-up' : ''}`}>{pct(r.s.d, 1)}</span>
                      <span className="num mt-0.5 block text-[11.5px] text-muted">{usd(r.px)} <span className="text-faint">/</span> {usd(r.w.limit)}</span>
                    </span>
                  </span>
                  <FluidSparkline className="mt-3" height={56} values={chart?.series[r.w.ticker] ?? []} baseline={r.w.limit} split={false} tone={trendOf(chart?.series[r.w.ticker])} label={`${r.w.ticker}: Kurs der letzten 3 Monate gegen die Kaufgrenze ${usd(r.w.limit)}`} />
                </button>
              )
            })}
          </div>
          <div className="flex items-center gap-2 px-2.5 pt-2 text-[12px] text-muted"><i className="inline-block w-5 border-t border-dashed border-[#5a6172]" />Kaufgrenze</div>
        </Card>
      )}

      <Card title="Kaufgrenzen nach Planregel" sub={<span className="max-md:hidden">Grenze erreicht heisst noch nicht kaufen: Die Bedingung muss erfüllt sein.</span>} flush action={<button type="button" className="btn btn-sm" onClick={() => setAdd(true)}><Plus /> Titel</button>}>
        {rows.length === 0 ? (
          <Empty title="Keine Watchlist">Mit «Titel» oben rechts beobachtest du Kandidaten mit Kaufgrenze.</Empty>
        ) : (
          <>
            {/* Ab Tablet: Tabelle */}
            <div className="hidden overflow-x-auto md:block">
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Titel</th>
                    <th title="Kursverlauf der letzten 3 Monate">3 Monate</th>
                    <th className="r">Kurs · Tag</th>
                    <th className="r">Grenze</th>
                    <th>Kurs zur Grenze</th>
                    <th className="r">Abstand</th>
                    <th>Status</th>
                    <th className="max-xl:hidden">Bedingung</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const chg = rangeChange(chart, r.w.ticker)
                    return (
                      <tr key={r.w.ticker} className="row-click" tabIndex={0} onClick={() => nav.openWatch(r.w.ticker)} onKeyDown={(e) => e.key === 'Enter' && nav.openWatch(r.w.ticker)}>
                        <td><Ticker t={r.w.ticker} name={r.w.name} /></td>
                        <td>
                          <span className="flex items-center gap-2.5">
                            <Sparkline width={72} values={chart?.series[r.w.ticker] ?? []} tone={sign(chg)} label={`${r.w.ticker}: ${pct(chg, 1)} in 3 Monaten`} />
                            <Delta value={chg} digits={0} icon={false} className="text-[12px]" />
                          </span>
                        </td>
                        <td className="r leading-tight">
                          <div className="num font-medium">{usd(r.px)}</div>
                          <Delta value={r.chg} digits={2} icon={false} className="text-[11.5px]" />
                        </td>
                        <td className="r leading-tight">
                          <div className="num">{r.w.limit ? usd(r.w.limit) : '–'}</div>
                          {r.w.limitCautious != null && <div className="num text-[11.5px] text-muted">vorsichtig {usd(r.w.limitCautious)}</div>}
                          {r.w.limitNote && <div className="max-w-[150px] text-[11.5px] text-muted">{r.w.limitNote}</div>}
                        </td>
                        <td><LimitTrack d={r.s.d} tone={r.s.tone} width={120} /></td>
                        <td className={`r num font-medium ${r.s.d != null && r.s.d <= 0 ? 'text-up' : ''}`}>{pct(r.s.d, 1)}</td>
                        <td><Chip tone={r.s.tone}>{r.s.label}</Chip></td>
                        <td className="max-xl:hidden"><div className="line-clamp-2 max-w-[300px] text-[12px] leading-[1.4] text-ink-2">{r.w.condition}</div>{r.w.pot && <div className="mt-0.5 text-[11.5px] text-muted">Topf: {r.w.pot}</div>}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            {/* Handy: nach Nähe zur Grenze gruppiert */}
            <div className="md:hidden">
              {GROUPS.map((g) => {
                const rs = rows.filter(g.test)
                if (!rs.length) return null
                return (
                  <section key={g.id}>
                    <div className="flex items-baseline justify-between gap-3 border-b border-line px-3 pb-2 pt-4 text-[12px]">
                      <span className="font-medium text-ink-2">{g.title} <span className="font-normal text-faint">{rs.length}</span></span>
                      <span className="text-muted">{g.hint}</span>
                    </div>
                    <div className="px-0.5 py-1">{rs.map((r) => <LimitRow key={r.w.ticker} r={r} onClick={() => nav.openWatch(r.w.ticker)} />)}</div>
                  </section>
                )
              })}
            </div>
          </>
        )}
        <div className="flex flex-wrap items-center gap-x-5 gap-y-1 px-3 pb-2 pt-3 text-[12px] text-muted">
          <span className="inline-flex items-center gap-2"><i className="inline-block h-3 w-[2px] rounded-full bg-ink-2" />Kaufgrenze</span>
          <span className="inline-flex items-center gap-2"><i className="inline-block h-1 w-5 rounded-full bg-up/30" />Kaufzone darunter</span>
          <span className="inline-flex items-center gap-2"><i className="inline-block size-2 rounded-full bg-[#8a91a0]" />Kurs, Skala −15 % bis +35 %</span>
        </div>
      </Card>
      <WatchAddSheet key={String(add)} open={add} onClose={() => setAdd(false)} />
    </div>
  )
}
