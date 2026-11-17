import { Pencil, RefreshCw, ShoppingCart, TrendingDown } from 'lucide-react'
import { useId, useMemo, useState, type FormEvent, type ReactNode } from 'react'
import { LimitTrack } from '@/components/charts/Small'
import { TimeChart, TradeGlyph, type Marker, type RefLine, type VLine } from '@/components/charts/TimeChart'
import { Sheet } from '@/components/Sheet'
import { Chip, ConfirmDelete, Delta, DemoTag, Empty, Segmented, Switch, Cur } from '@/components/ui'
import { bucketOf, catOf, HOLDING_BUCKETS } from '@/lib/buckets'
import { quote, quoteLabel, withIds, wlState, wht } from '@/lib/calc'
import { RANGE_LABEL, RANGE_TEXT, RANGE_TITLE, refreshCharts, useChart } from '@/lib/charts'
import { useDepot, useNav } from '@/lib/context'
import { dfmt, parseNum, pct, pctPlain, qty, usd, cur, money } from '@/lib/format'
import { withNow } from '@/lib/history'
import { useStored } from '@/lib/hooks'
import { TX_LABEL } from '@/lib/labels'
import { mutate } from '@/lib/store'
import { toast } from '@/lib/toast'
import type { RangeId, Tx, WithId } from '@/lib/types'

/** Zeiträume im Kurschart eines Titels: «Max» ab dem ersten Kauf; ohne Kauf (Watchlist) stattdessen 5 Jahre. */
const RANGES_HELD: RangeId[] = ['1T', '1W', '1M', '3M', '1J', 'MAX']
const RANGES_NEW: RangeId[] = ['1T', '1W', '1M', '3M', '1J', '5J']

/* ------------------------------------------------------------------ Kursverlauf eines Titels */
function PriceChart({ t, refs = NO_REFS, txs = NO_TXS }: { t: string; refs?: RefLine[]; txs?: WithId<Tx>[] }) {
  const { db, c } = useDepot()
  // Erster Kauf dieses Titels (auch ein später ganz verkaufter zählt): Beginn der Ansicht «Max»
  const firstBuy = useMemo(() => {
    let m: string | null = null
    for (const x of Object.values(db.transactions)) if (x.type === 'kauf' && x.ticker === t && (!m || x.date < m)) m = x.date
    return m
  }, [db.transactions, t])
  const RANGES = firstBuy ? RANGES_HELD : RANGES_NEW
  const [stored, setRange] = useStored<RangeId>('depot.range.titel', '3M', [...RANGES_NEW, 'MAX'])
  // Früher gewähltes «5J» wird bei gekauften Titeln zu «Max» und umgekehrt
  const range: RangeId = stored === '5J' && firstBuy ? 'MAX' : stored === 'MAX' && !firstBuy ? '5J' : stored
  // Käufe und Verkäufe im Chart ein- oder ausblenden (gilt für alle Titel, bleibt gespeichert)
  const [tradesPref, setTradesPref] = useStored<'an' | 'aus'>('depot.trades.titel', 'an', ['an', 'aus'])
  const showTrades = tradesPref === 'an'
  const tickers = useMemo(() => [t], [t])
  const { data, pending, error } = useChart(range, tickers, range === 'MAX' ? firstBuy : null)
  const chart = useMemo(() => {
    if (!data) return null
    const full = withNow(db, data)
    // «Max»: genau ab dem Tag des ersten Kaufs; der Kurs davor wird zur Vergleichsbasis.
    if (full.range !== 'MAX' || !firstBuy) return full
    const cut = full.d.findIndex((d) => d >= firstBuy)
    const values = full.series[t]
    if (cut <= 0 || !values || full.d.length - cut < 2) return full
    return { ...full, t: full.t.slice(cut), d: full.d.slice(cut), series: { ...full.series, [t]: values.slice(cut) }, prev: { ...full.prev, [t]: values[cut - 1] ?? full.prev[t] } }
  }, [db, data, firstBuy, t])
  const view = useMemo(() => {
    const values = chart?.series[t]
    if (!chart || !values || values.length < 2) return null
    const markers: Marker[] = []
    const byIndex = new Map<number, WithId<Tx>[]>()
    for (const x of txs) {
      // Bei «Max» zählt auch ein Kauf an einem Tag ohne Handel (er erscheint am nächsten Handelstag)
      if ((x.type !== 'kauf' && x.type !== 'verkauf') || x.date < (chart.range === 'MAX' && firstBuy ? firstBuy : chart.d[0])) continue
      const i = chart.d.findIndex((d) => d >= x.date)
      if (i < 0) continue
      const mk = markers.find((m) => m.i === i && m.type === x.type)
      if (mk) {
        mk.price = (mk.price! * mk.shares! + (x.price ?? 0) * (x.shares ?? 0)) / (mk.shares! + (x.shares ?? 0) || 1)
        mk.shares! += x.shares ?? 0
      } else markers.push({ i, type: x.type, shares: x.shares, price: x.price })
      byIndex.set(i, [...(byIndex.get(i) ?? []), x])
    }
    markers.sort((a, b) => a.i - b.i).forEach((m, k) => (m.seq = k + 1))
    const base = chart.prev[t] ?? values[0]
    // Schwellen nur zeigen, wenn sie den Kursverlauf nicht zur flachen Linie drücken.
    const lo = Math.min(...values), hi = Math.max(...values)
    const span = Math.max(hi - lo, hi * 0.02)
    const near = refs.filter((r) => r.y >= lo - span * 1.5 && r.y <= hi + span * 1.5)
    const vlines: VLine[] = []
    if (chart.range === '1T' && chart.session) {
      const open = chart.t.findIndex((x) => x >= chart.session!.open)
      const close = chart.t.findIndex((x) => x >= chart.session!.close)
      if (open > 0) vlines.push({ i: open, label: 'Eröffnung' })
      if (close > 0 && close < chart.t.length - 1) vlines.push({ i: close, label: 'Schluss' })
    }
    const shown: RefLine[] = near
    return { values, markers, byIndex, base, chg: base > 0 ? values[values.length - 1] / base - 1 : null, refs: shown, away: refs.filter((r) => !near.includes(r)), vlines }
  }, [chart, t, txs, refs, firstBuy])

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-[12.5px] text-muted">
          {view && chart ? <><Delta value={view.chg} digits={1} className="font-medium" /> {chart.range === '1T' && !c.live ? 'letzter Handelstag' : chart.range === 'MAX' && firstBuy ? `seit erstem Kauf (${dfmt(firstBuy)})` : RANGE_TEXT[chart.range]}</> : <span>Kursverlauf</span>}
        </div>
        <Segmented className="max-sm:flex max-sm:w-full [&>button]:max-sm:flex-1" label="Zeitraum" value={range} onChange={setRange} options={RANGES.map((r) => ({ value: r, label: RANGE_LABEL[r], title: r === 'MAX' && firstBuy ? `seit dem ersten Kauf am ${dfmt(firstBuy)}` : RANGE_TITLE[r] }))} />
      </div>
      {view && chart ? (
        <div className="-mx-2">
          <TimeChart
            t={chart.t}
            d={chart.d}
            kind={chart.kind}
            series={[{ key: 'px', label: chart.kind === 'intraday' ? 'Kurs' : 'Schlusskurs', values: view.values, color: 'var(--color-accent)', color2: 'var(--color-accent-2)', area: true }]}
            split={view.base}
            refs={view.refs}
            markers={showTrades ? view.markers : NO_MARKERS}
            vlines={view.vlines}
            height={220}
            animateKey={t + chart.range}
            pending={pending}
            live={c.live}
            ariaLabel={`Kursverlauf ${t}`}
            tooltipExtra={(i) => (
              <>
                {view.base > 0 && <div className="tip-row"><span>im Zeitraum</span><b className={view.values[i] >= view.base ? '!text-up' : '!text-down'}>{pct(view.values[i] / view.base - 1, 1)}</b></div>}
                {showTrades && view.byIndex.get(i)?.map((x) => (
                  <div key={x.id} className="mt-2 border-t border-line pt-2 text-[11.5px]">
                    <div className="flex items-center justify-between gap-3">
                      <span className="inline-flex items-center gap-1.5 font-medium text-ink"><TradeGlyph type={x.type as Marker['type']} />{TX_LABEL[x.type]}</span>
                      <span className="num text-muted">{dfmt(x.date)}</span>
                    </div>
                    <div className="num mt-0.5 text-ink-2">{qty(x.shares)} Stk. × {money(x.price)}</div>
                  </div>
                ))}
              </>
            )}
          />
        </div>
      ) : (
        <div className="grid h-[220px] place-items-center rounded-xl border border-line">
          {error ? (
            <div className="text-center">
              <p className="text-[13px] text-muted">Der Kursverlauf ist gerade nicht erreichbar.</p>
              <button type="button" className="btn btn-sm mt-3" onClick={refreshCharts}><RefreshCw /> Erneut versuchen</button>
            </div>
          ) : pending ? (
            <div className="grid h-full w-full animate-pulse place-items-center rounded-xl bg-white/[0.035] text-[12.5px] text-muted">Kursverlauf lädt …</div>
          ) : (
            <Empty title="Kein Kursverlauf">{range === '1T' ? 'Heute wurde noch nicht gehandelt.' : 'Für diesen Titel liegen keine Kurse vor.'}</Empty>
          )}
        </div>
      )}
      {view && (view.markers.length > 0 || view.refs.length > 0 || view.away.length > 0) && (
        <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11.5px] text-muted">
          {showTrades && view.markers.some((m) => m.type === 'kauf') && <span className="inline-flex items-center gap-1.5"><TradeGlyph type="kauf" />Kauf</span>}
          {showTrades && view.markers.some((m) => m.type === 'verkauf') && <span className="inline-flex items-center gap-1.5"><TradeGlyph type="verkauf" />Verkauf</span>}
          {view.refs.map((r) => <span key={r.label} className="num inline-flex items-center gap-1.5"><i className="inline-block w-4 border-t border-dashed" style={{ borderColor: r.color }} />{r.name === 'Ø Einstand' ? r.label.replace('Ø Einstand ', 'Ø ') : r.label}</span>)}
          {view.away.length > 0 && <span>{view.away.map((r) => r.label).join(' · ')}: ausserhalb des Ausschnitts</span>}
          {view.markers.length > 0 && <Switch className="ml-auto !text-[11.5px] !text-muted" checked={showTrades} onChange={(v) => setTradesPref(v ? 'an' : 'aus')} label="Käufe/Verkäufe" title="Käufe und Verkäufe im Chart zeigen" />}
        </div>
      )}
    </div>
  )
}
const NO_REFS: RefLine[] = []
const NO_TXS: WithId<Tx>[] = []
const NO_MARKERS: Marker[] = []

const Fact = ({ label, children }: { label: ReactNode; children: ReactNode }) => (
  <div className="min-w-0 rounded-xl border border-line bg-white/[0.02] px-3 py-2 sm:px-3.5 sm:py-3">
    <div className="label flex items-center gap-1.5 max-sm:text-[11.5px]">{label}</div>
    <div className="num mt-0.5 truncate text-[14px] font-medium tracking-[-0.01em] sm:mt-1 sm:text-[15px]">{children}</div>
  </div>
)
const Block = ({ title, children }: { title: string; children: ReactNode }) => (
  <div>
    <div className="label mb-1.5">{title}</div>
    <div className="text-[13px] leading-[1.55] text-ink-2">{children}</div>
  </div>
)
function useSave(run: () => Promise<string>, done: () => void) {
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const onSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setErr('')
    setBusy(true)
    try {
      toast(await run())
      done()
    } catch (x) {
      setErr(x instanceof Error ? x.message : String(x))
    } finally {
      setBusy(false)
    }
  }
  const clearErr = () => setErr((e) => (e ? '' : e))
  return { err, busy, onSubmit, clearErr }
}

/* ------------------------------------------------------------------ Position */
export function PositionSheet({ ticker, onClose }: { ticker: string | null; onClose: () => void }) {
  const { db, c } = useDepot()
  const nav = useNav()
  const [edit, setEdit] = useState(false)
  const formId = useId()
  const p = ticker ? db.positions[ticker] : undefined
  const r = c.rows.find((x) => x.t === ticker)
  const q = ticker ? quote(db, ticker) : undefined
  const txs = useMemo(() => withIds(db.transactions).filter((x) => x.ticker === ticker).sort((a, b) => (a.date < b.date ? 1 : -1)), [db, ticker])
  const b = bucketOf(p?.bucket)

  // Das Blatt wird je Titel neu aufgebaut (key in App), darum genügt der Startwert.
  const [sh, setSh] = useState(p ? String(p.shares) : '')
  const [cost, setCost] = useState(p?.cost != null ? String(p.cost) : '')
  const [bucket, setBucket] = useState<string>(catOf(p?.bucket))
  const [status, setStatus] = useState(p?.status ?? '')
  const [note, setNote] = useState(p?.note ?? '')

  const { err, busy, onSubmit, clearErr } = useSave(async () => {
    const n = parseNum(sh)
    if (n == null || n < 0) throw new Error('Stückzahl prüfen.')
    const c = parseNum(cost)
    if (cost.trim() && (c == null || c < 0)) throw new Error('Einstand prüfen: Betrag gesamt in USD, leer = unbekannt.')
    await mutate([{ op: 'merge', coll: 'positions', id: ticker!, data: { shares: n, cost: c, bucket, status: status.trim(), note: note.trim(), costDemo: false } }])
    return `${ticker} gespeichert.`
  }, () => setEdit(false))

  const refs: RefLine[] = r?.avg != null ? [{ y: r.avg, name: 'Ø Einstand', label: `Ø Einstand ${money(r.avg)}`, color: 'var(--color-ref)' }] : []
  const yearly = p && q?.divAnnual ? p.shares * q.divAnnual * (1 - wht(db)) : null

  return (
    <Sheet
      open={!!p}
      onClose={onClose}
      title={<span className="flex items-center gap-2.5"><span className="tk !text-[17px]">{ticker}</span><span className="truncate font-medium text-ink-2">{p?.name}</span></span>}
      sub={<span className="inline-flex items-center gap-2"><i className="swatch" style={{ background: b.color }} />{b.name}</span>}
      footer={
        edit ? (
          <>
            <button type="button" className="btn btn-ghost" onClick={() => setEdit(false)}>Abbrechen</button>
            <button type="submit" form={formId} className="btn btn-primary" disabled={busy}>Speichern</button>
          </>
        ) : (
          <>
            <button type="button" className="btn btn-ghost mr-auto" onClick={() => setEdit(true)}><Pencil /> Bearbeiten</button>
            <button type="button" className="btn" onClick={() => { onClose(); nav.openEntry('verkauf', { ticker: ticker! }) }}><TrendingDown /> Verkauf</button>
            <button type="button" className="btn btn-primary" onClick={() => { onClose(); nav.openEntry('kauf', { ticker: ticker! }) }}><ShoppingCart /> Kauf</button>
          </>
        )
      }
    >
      {p && !edit && (
        <div className="grid gap-5">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <div className="label">{quoteLabel(q)}</div>
              <div className="mt-0.5 flex items-baseline gap-2.5">
                <span className="text-[30px] font-semibold leading-9 tracking-[-0.03em]">{usd(q?.close)}<Cur /></span>
                <Delta value={r?.chg} digits={2} className="text-[13.5px] font-medium" />
              </div>
            </div>
            <div className="text-right">
              <div className="label">Wert</div>
              <div className="num mt-0.5 text-[20px] font-semibold leading-9 tracking-[-0.02em]">{usd(r?.val)} <span className="text-[12px] font-medium text-muted">{cur()}</span></div>
            </div>
          </div>

          <PriceChart t={ticker!} refs={refs} txs={txs} />

          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 sm:gap-2.5">
            <Fact label="Stück">{qty(p.shares)}</Fact>
            <Fact label="Anteil am Depot">{pctPlain(r?.w)}</Fact>
            <Fact label={<>Ø Einstand {p.costDemo && <DemoTag />}</>}>{money(r?.avg)}</Fact>
            <Fact label="Gewinn/Verlust">{r?.pl != null ? <><Delta value={r.pl} kind="usd" icon={false} /><Cur /></> : <span className="text-muted">offen</span>}</Fact>
            <Fact label="in Prozent">{r?.plPct != null ? <Delta value={r.plPct} digits={1} icon={false} /> : <span className="text-muted">–</span>}</Fact>
            <Fact label="Dividende netto pro Jahr">{yearly != null ? money(yearly) : <span className="text-muted">keine</span>}</Fact>
          </div>

          {p.status && <Block title="Regel">{p.status}</Block>}
          {p.note && <Block title="These & Notizen"><span className="whitespace-pre-wrap">{p.note}</span></Block>}

          <div>
            <div className="label mb-1.5">Buchungen</div>
            {txs.length === 0 ? (
              <div className="text-[12.5px] text-muted">Keine Buchungen erfasst.</div>
            ) : (
              <ul className="divide-y divide-white/[0.045] rounded-xl border border-line">
                {txs.map((x) => (
                  <li key={x.id} className="grid grid-cols-[74px_70px_minmax(0,1fr)_auto] items-center gap-2 px-3.5 py-2.5 text-[12.5px]">
                    <span className="num text-muted">{dfmt(x.date)}</span>
                    <span className="font-medium">{TX_LABEL[x.type]}</span>
                    <span className="num text-ink-2">{qty(x.shares)} × {money(x.price)} {x.demo && <DemoTag className="ml-1" />}</span>
                    <span><Delta value={x.cashDelta} kind="usd" icon={false} /><Cur /></span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}

      {p && edit && (
        <form id={formId} onSubmit={onSubmit} onChange={clearErr} className="grid gap-3.5">
          <div className="grid grid-cols-2 gap-3">
            <div className="field"><label htmlFor={formId + 's'}>Stück</label><input id={formId + 's'} className="input num" inputMode="decimal" value={sh} onChange={(e) => setSh(e.target.value)} /></div>
            <div className="field"><label htmlFor={formId + 'c'}>Einstand gesamt (USD)</label><input id={formId + 'c'} className="input num" inputMode="decimal" placeholder="laut Broker" value={cost} onChange={(e) => setCost(e.target.value)} /></div>
          </div>
          <div className="field">
            <label htmlFor={formId + 'b'}>Kategorie</label>
            <select id={formId + 'b'} className="input" value={bucket} onChange={(e) => setBucket(e.target.value)}>
              {HOLDING_BUCKETS.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
            </select>
          </div>
          <div className="field"><label htmlFor={formId + 'r'}>Regel / Status</label><input id={formId + 'r'} className="input" value={status} onChange={(e) => setStatus(e.target.value)} /></div>
          <div className="field"><label htmlFor={formId + 'n'}>These & Notizen</label><textarea id={formId + 'n'} className="input" value={note} onChange={(e) => setNote(e.target.value)} /></div>
          {err && <div role="alert" className="text-[12.5px] text-down">{err}</div>}
        </form>
      )}
    </Sheet>
  )
}

/* ------------------------------------------------------------------ Watchlist-Titel */
export function WatchSheet({ ticker, onClose }: { ticker: string | null; onClose: () => void }) {
  const { db } = useDepot()
  const nav = useNav()
  const [edit, setEdit] = useState(false)
  const formId = useId()
  const w = ticker ? db.watchlist[ticker] : undefined
  const q = ticker ? quote(db, ticker) : undefined
  const px = q?.close ?? w?.price ?? null
  const s = w ? wlState(w, px) : null

  const [limit, setLimit] = useState(w?.limit != null ? String(w.limit) : '')
  const [cautious, setCautious] = useState(w?.limitCautious != null ? String(w.limitCautious) : '')
  const [cond, setCond] = useState(w?.condition ?? '')
  const [met, setMet] = useState(w?.conditionMet === false ? 'offen' : w?.conditionMet === true ? 'ja' : 'keine')
  const [pot, setPot] = useState(w?.pot ?? '')

  const { err, busy, onSubmit, clearErr } = useSave(async () => {
    for (const [v, name] of [[limit, 'Grenze'], [cautious, 'Vorsichtige Grenze']] as const) {
      const n = parseNum(v)
      if (v.trim() && (n == null || n <= 0)) throw new Error(`${name} muss eine positive Zahl sein.`)
    }
    const l = parseNum(limit), lc = parseNum(cautious)
    if (l != null && lc != null && lc > l) throw new Error('Die vorsichtige Grenze liegt unter der Grenze oder ist gleich hoch.')
    await mutate([{ op: 'merge', coll: 'watchlist', id: ticker!, data: { limit: parseNum(limit), limitCautious: parseNum(cautious), condition: cond.trim(), conditionMet: met === 'offen' ? false : met === 'ja' ? true : null, pot: pot.trim() } }])
    return `${ticker} gespeichert.`
  }, () => setEdit(false))

  const refs: RefLine[] = []
  if (w?.limit) refs.push({ y: w.limit, name: 'Grenze', label: `Grenze ${money(w.limit)}`, color: 'var(--color-warn)' })
  if (w?.limitCautious) refs.push({ y: w.limitCautious, name: 'vorsichtig', label: `vorsichtig ${money(w.limitCautious)}`, color: 'var(--color-bench)' })

  return (
    <Sheet
      open={!!w}
      onClose={onClose}
      title={<span className="flex items-center gap-2.5"><span className="tk !text-[17px]">{ticker}</span><span className="truncate font-medium text-ink-2">{w?.name}</span></span>}
      sub="Watchlist"
      footer={
        edit ? (
          <>
            <span className="mr-auto"><ConfirmDelete label="Von der Watchlist entfernen" onConfirm={() => void mutate([{ op: 'delete', coll: 'watchlist', id: ticker! }]).then(() => { toast(`${ticker} von der Watchlist entfernt.`); onClose() }).catch((e) => toast('Nicht entfernt: ' + e.message))} /></span>
            <button type="button" className="btn btn-ghost" onClick={() => setEdit(false)}>Abbrechen</button>
            <button type="submit" form={formId} className="btn btn-primary" disabled={busy}>Speichern</button>
          </>
        ) : (
          <>
            <button type="button" className="btn btn-ghost mr-auto" onClick={() => setEdit(true)}><Pencil /> Bearbeiten</button>
            <button type="button" className="btn btn-primary" onClick={() => { onClose(); nav.openEntry('kauf', { ticker: ticker! }) }}><ShoppingCart /> Kauf erfassen</button>
          </>
        )
      }
    >
      {w && s && !edit && (
        <div className="grid gap-5">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <div className="label">{quoteLabel(q, w.priceDate)}</div>
              <div className="mt-0.5 flex items-baseline gap-2.5">
                <span className="text-[30px] font-semibold leading-9 tracking-[-0.03em]">{usd(px)}<Cur /></span>
                {q?.prev ? <Delta value={q.close / q.prev - 1} digits={2} className="text-[13.5px] font-medium" /> : null}
              </div>
            </div>
            <div className="text-right">
              <Chip tone={s.tone}>{s.label}</Chip>
              <div className="mt-2 flex items-center justify-end gap-3">
                <LimitTrack d={s.d} tone={s.tone} width={120} />
                <span className={`num text-[15px] font-semibold ${s.d != null && s.d <= 0 ? 'text-up' : ''}`}>{pct(s.d, 1)}</span>
              </div>
            </div>
          </div>

          <PriceChart t={ticker!} refs={refs} />

          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 sm:gap-2.5">
            <Fact label="Grenze">{w.limit ? money(w.limit) : '–'}</Fact>
            <Fact label="Vorsichtige Grenze">{w.limitCautious != null ? money(w.limitCautious) : <span className="text-muted">–</span>}</Fact>
            <Fact label="Bis zur Grenze">{px != null && w.limit ? (px <= w.limit ? <span className="text-up">erreicht</span> : money(px - w.limit)) : '–'}</Fact>
          </div>

          {w.condition && (
            <Block title="Bedingung">
              {w.condition}
              <div className="mt-2">{w.conditionMet === false ? <Chip tone="warn">noch offen</Chip> : w.conditionMet === true ? <Chip tone="up">erfüllt</Chip> : <Chip tone="mute" icon={false}>ohne Vorbedingung</Chip>}</div>
            </Block>
          )}
          {w.limitNote && <Block title="Hinweis zur Grenze">{w.limitNote}</Block>}
          {w.pot && <Block title="Topf">{w.pot}</Block>}
          {db.positions[ticker!] && <Block title="Im Depot">{qty(db.positions[ticker!].shares)} Stück bereits im Bestand.</Block>}
        </div>
      )}

      {w && edit && (
        <form id={formId} onSubmit={onSubmit} onChange={clearErr} className="grid gap-3.5">
          <div className="grid grid-cols-2 gap-3">
            <div className="field"><label htmlFor={formId + 'l'}>Grenze (USD)</label><input id={formId + 'l'} className="input num" inputMode="decimal" value={limit} onChange={(e) => setLimit(e.target.value)} /></div>
            <div className="field"><label htmlFor={formId + 'c'}>Vorsichtige Grenze</label><input id={formId + 'c'} className="input num" inputMode="decimal" value={cautious} onChange={(e) => setCautious(e.target.value)} /></div>
          </div>
          <div className="field"><label htmlFor={formId + 'b'}>Bedingung</label><textarea id={formId + 'b'} className="input" value={cond} onChange={(e) => setCond(e.target.value)} /></div>
          <div className="field">
            <label htmlFor={formId + 'm'}>Bedingung erfüllt?</label>
            <select id={formId + 'm'} className="input" value={met} onChange={(e) => setMet(e.target.value)}>
              <option value="offen">offen</option>
              <option value="ja">ja</option>
              <option value="keine">keine Bedingung</option>
            </select>
          </div>
          <div className="field"><label htmlFor={formId + 'p'}>Topf</label><input id={formId + 'p'} className="input" value={pot} onChange={(e) => setPot(e.target.value)} /></div>
          {err && <div role="alert" className="text-[12.5px] text-down">{err}</div>}
        </form>
      )}
    </Sheet>
  )
}
