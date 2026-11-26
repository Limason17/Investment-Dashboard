import { Pencil, RefreshCw } from 'lucide-react'
import { useId, useMemo, useState, type FormEvent, type ReactNode } from 'react'
import { ChartStyleToggle, LimitTrack } from '@/components/charts/Small'
import { TimeChart, TradeGlyph, type Marker, type RefLine, type VLine } from '@/components/charts/TimeChart'
import { Sheet } from '@/components/Sheet'
import { Chip, ConfirmDelete, Delta, DemoTag, Empty, Segmented, Switch, Cur } from '@/components/ui'
import { bucketOf, catOf, HOLDING_BUCKETS } from '@/lib/buckets'
import { quote, quoteLabel, withIds, wlState, wht } from '@/lib/calc'
import { sliceChart, toCandles, UNIT_TEXT, weekOf } from '@/lib/candles'
import { RANGE_LABEL, RANGE_TEXT, RANGE_TITLE, refreshCharts, useChart, useChartStyle } from '@/lib/charts'
import { useDepot, useNav } from '@/lib/context'
import { dfmt, dlong, hhmm, MONTHS, parseNum, pct, pctPlain, qty, usd, cur, money } from '@/lib/format'
import { withNow } from '@/lib/history'
import { useStored } from '@/lib/hooks'
import { useMeasure } from '@/lib/useMeasure'
import { txLabel } from '@/lib/labels'
import { mutate } from '@/lib/store'
import { toast } from '@/lib/toast'
import type { RangeId, Tx, WithId } from '@/lib/types'

/** Zeiträume im Kurschart eines Titels: «Max» ab dem ersten Kauf; ohne Kauf (Watchlist) stattdessen 5 Jahre. */
const RANGES_HELD: RangeId[] = ['1T', '1W', '1M', '3M', '1J', 'MAX']
const RANGES_NEW: RangeId[] = ['1T', '1W', '1M', '3M', '1J', '5J']

/* ------------------------------------------------------------------ Kursverlauf eines Titels */
function PriceChart({ t, refs = NO_REFS, txs = NO_TXS, avg, hideChange }: { t: string; refs?: RefLine[]; txs?: WithId<Tx>[]; /** Ø Einstand: Bezugslinie der Ansicht «Max» */ avg?: number | null; /** ohne Zeile «x % im Zeitraum» über dem Chart (Position: steht beim Wert) */ hideChange?: boolean }) {
  const { db, c } = useDepot()
  // Erster Kauf dieses Titels (auch ein später ganz verkaufter zählt): Beginn der Ansicht «Max»
  // Dazu der Preis dieses Kaufs (mehrere Käufe am ersten Tag: gewichtet) und die Zahl der Käufe.
  const { firstBuy, firstPx, buys } = useMemo(() => {
    const list = Object.values(db.transactions).filter((x) => x.type === 'kauf' && x.ticker === t)
    const m = list.reduce<string | null>((a, x) => (!a || x.date < a ? x.date : a), null)
    const day = list.filter((x) => x.date === m && (x.shares ?? 0) > 0 && x.price != null)
    const n = day.reduce((a, x) => a + x.shares!, 0)
    return { firstBuy: m, firstPx: n > 0 ? day.reduce((a, x) => a + x.shares! * x.price!, 0) / n : null, buys: list.length }
  }, [db.transactions, t])
  const RANGES = firstBuy ? RANGES_HELD : RANGES_NEW
  const [storedPref, setStored] = useStored<RangeId>('depot.range.titel', '3M', [...RANGES_NEW, 'MAX'])
  // Gekaufte Titel öffnen immer mit «Max» (ab dem ersten Kauf); Watchlist-Titel mit dem zuletzt gewählten Zeitraum
  const [picked, setPicked] = useState<RangeId | null>(null)
  const stored = picked ?? (firstBuy ? 'MAX' : storedPref)
  const setRange = (r: RangeId) => {
    setPicked(r)
    if (!firstBuy) setStored(r)
  }
  // Früher gewähltes «5J» wird bei gekauften Titeln zu «Max» und umgekehrt
  const range: RangeId = stored === '5J' && firstBuy ? 'MAX' : stored === 'MAX' && !firstBuy ? '5J' : stored
  // Käufe und Verkäufe im Chart ein- oder ausblenden (gilt für alle Titel, bleibt gespeichert)
  const [tradesPref, setTradesPref] = useStored<'an' | 'aus'>('depot.trades.titel', 'an', ['an', 'aus'])
  const showTrades = tradesPref === 'an'
  // Linie oder Kerzen (gilt für alle Kurscharts); Kerzen so viele, wie in die Breite passen (mind. 4 px je Kerze)
  const [style, setStyle] = useChartStyle()
  const candle = style === 'kerzen'
  const [boxRef, boxW] = useMeasure<HTMLDivElement>()
  const maxCandles = Math.max(12, Math.floor((boxW - 62) / 4))
  const tickers = useMemo(() => [t], [t])
  const { data, pending, error } = useChart(range, tickers, range === 'MAX' ? firstBuy : null, candle)
  const raw = useMemo(() => {
    if (!data) return null
    const full = withNow(db, data)
    // «Max»: genau ab dem Tag des ersten Kaufs; der Kurs davor wird zur Vergleichsbasis.
    if (full.range !== 'MAX' || !firstBuy) return full
    const cut = full.d.findIndex((d) => d >= firstBuy)
    const values = full.series[t]
    if (cut <= 0 || !values || full.d.length - cut < 2) return full
    return sliceChart(full, t, cut)
  }, [db, data, firstBuy, t])
  // Kerzen: derselbe Verlauf, zu Kerzen gebündelt (Schluss je Kerze als Reihe, damit Käufe und Schwellen gleich bleiben)
  const cs = useMemo(() => (candle && raw && boxW > 0 ? toCandles(raw, t, maxCandles) : null), [candle, raw, t, maxCandles, boxW])
  const chart = useMemo(() => {
    if (!raw || !cs || cs.candles.length < 2) return raw
    return { ...raw, kind: cs.kind, t: cs.candles.map((k) => k.t), d: cs.candles.map((k) => k.d), series: { ...raw.series, [t]: cs.candles.map((k) => k.c) } }
  }, [raw, cs, t])
  const ohlc = useMemo(() => (cs && chart !== raw ? { o: cs.candles.map((k) => k.o), h: cs.candles.map((k) => k.h), l: cs.candles.map((k) => k.l) } : undefined), [cs, chart, raw])
  const view = useMemo(() => {
    const values = chart?.series[t]
    if (!chart || !values || values.length < 2) return null
    const markers: Marker[] = []
    const byIndex = new Map<number, WithId<Tx>[]>()
    const offTx = new Set<string>()
    for (const x of txs) {
      // Bei «Max» zählt auch ein Kauf an einem Tag ohne Handel (er erscheint am nächsten Handelstag)
      if ((x.type !== 'kauf' && x.type !== 'verkauf') || x.date < (chart.range === 'MAX' && firstBuy ? firstBuy : chart.d[0])) continue
      let i = chart.d.findIndex((d) => d >= x.date)
      if (i < 0) continue
      // Mehrere Punkte am selben Tag (Stunden- oder Minutenkerzen): den Punkt nehmen, an dem der Kurs dem bezahlten Preis
      // am nächsten war (bei Kerzen: dessen Spanne Tief bis Hoch den Preis enthält). So sitzt die Marke dort, wo der Kurs war.
      if (x.price != null && x.price > 0) {
        const dist = (j: number) => (ohlc ? Math.max(0, ohlc.l[j] - x.price!, x.price! - ohlc.h[j]) : Math.abs(values[j] - x.price!))
        let best = i
        for (let j = i + 1; j < chart.d.length && chart.d[j] === chart.d[i]; j++) if (dist(j) < dist(best)) best = j
        i = best
      }
      // Preis ausserhalb von Tief bis Hoch der Kerze (0.5 % Spielraum): so wurde nie gehandelt. Meist ein Tippfehler,
      // ein Split oder erfundene Testdaten. Die Marke bleibt auf dem Kurs, Etikett und Tooltip warnen.
      const off = !!ohlc && x.price != null && x.price > 0 && (x.price < ohlc.l[i] * 0.995 || x.price > ohlc.h[i] * 1.005)
      if (off) offTx.add(x.id)
      const mk = markers.find((m) => m.i === i && m.type === x.type)
      if (mk) {
        mk.price = (mk.price! * mk.shares! + (x.price ?? 0) * (x.shares ?? 0)) / (mk.shares! + (x.shares ?? 0) || 1)
        mk.shares! += x.shares ?? 0
        mk.off = mk.off || off
      } else markers.push({ i, type: x.type, shares: x.shares, price: x.price, off })
      byIndex.set(i, [...(byIndex.get(i) ?? []), x])
    }
    markers.sort((a, b) => a.i - b.i).forEach((m, k) => (m.seq = k + 1))
    // «Max»: Startlinie = Preis des ersten Kaufs. Gab es nur einen Kauf, ist das der Ø Einstand (gleiche Linie).
    // «Max» bei gekauften Titeln: Bezug ist der Ø Einstand (fehlt er, der Preis des ersten Kaufs)
    const buyBase = chart.range === 'MAX' && firstBuy ? (avg != null && avg > 0 ? avg : firstPx) : null
    const base = buyBase ?? chart.prev[t] ?? values[0]
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
    return { values, markers, byIndex, offTx, base, chg: base > 0 ? values[values.length - 1] / base - 1 : null, refs: shown, away: refs.filter((r) => !near.includes(r)), vlines }
  }, [chart, ohlc, t, txs, refs, firstBuy, firstPx, buys, avg])

  return (
    <div>
      <div ref={boxRef} className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-[12.5px] text-muted">
          {hideChange ? null : view && chart ? <><Delta value={view.chg} digits={1} className="font-medium" /> {chart.range === '1T' && !c.live ? 'letzter Handelstag' : chart.range === 'MAX' && firstBuy ? `seit erstem Kauf (${dfmt(firstBuy)})` : RANGE_TEXT[chart.range]}</> : <span>Kursverlauf</span>}
        </div>
        <div className="flex items-center gap-2 max-sm:w-full">
          <ChartStyleToggle value={style} onChange={setStyle} className="flex-none" />
          <Segmented className="max-sm:flex max-sm:min-w-0 max-sm:flex-1 [&>button]:max-sm:flex-1 [&>button]:max-sm:!px-1" label="Zeitraum" value={range} onChange={setRange} options={RANGES.map((r) => ({ value: r, label: RANGE_LABEL[r], title: r === 'MAX' && firstBuy ? `seit dem ersten Kauf am ${dfmt(firstBuy)}` : RANGE_TITLE[r] }))} />
        </div>
      </div>
      {view && chart ? (
        <div className="-mx-2">
          <TimeChart
            t={chart.t}
            d={chart.d}
            kind={chart.kind}
            series={[{ key: 'px', label: chart.kind === 'intraday' ? 'Kurs' : 'Schlusskurs', values: view.values, color: 'var(--color-accent)', color2: 'var(--color-accent-2)', area: true }]}
            candles={ohlc}
            titleOf={ohlc && cs ? (i) => (cs.unit === 'woche' ? `Woche ab ${dfmt(weekOf(chart.d[i]))}` : cs.unit === 'monat' ? `${MONTHS[+chart.d[i].slice(5, 7) - 1]} ${chart.d[i].slice(0, 4)}` : cs.unit === 'tag' ? dlong(chart.d[i]) : `${dfmt(chart.d[i])} · ${hhmm(chart.t[i])}, ${UNIT_TEXT[cs.unit]}`) : undefined}
            split={view.base}
            refs={view.refs}
            markers={showTrades ? view.markers : NO_MARKERS}
            vlines={view.vlines}
            height={220}
            animateKey={t + chart.range + (ohlc ? 'k' : '')}
            pending={pending}
            live={c.live}
            ariaLabel={`Kursverlauf ${t}`}
            tooltipExtra={(i) => (
              <>
                {view.base > 0 && <div className="tip-row"><span>{chart.range === 'MAX' && firstBuy ? (avg != null && avg > 0 ? 'gegen Ø Einstand' : 'seit erstem Kauf') : 'im Zeitraum'}</span><b className={view.values[i] >= view.base ? '!text-up' : '!text-down'}>{pct(view.values[i] / view.base - 1, 1)}</b></div>}
                {showTrades && view.byIndex.get(i)?.map((x) => (
                  <div key={x.id} className="mt-2 border-t border-line pt-2 text-[11.5px]">
                    <div className="flex items-center justify-between gap-3">
                      <span className="inline-flex items-center gap-1.5 font-medium text-ink"><TradeGlyph type={x.type as Marker['type']} />{txLabel(x)}</span>
                      <span className="num text-muted">{dfmt(x.date)}</span>
                    </div>
                    <div className="num mt-0.5 text-ink-2">{qty(x.shares)} Stk. × {money(x.price)}</div>
                    {view.offTx.has(x.id) && <div className="mt-1 max-w-[220px] whitespace-normal text-warn">Preis lag nicht in der Kursspanne (Tief bis Hoch). Buchung prüfen.</div>}
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
  const sales = txs.filter((x) => x.type === 'verkauf' && x.realized != null)
  const realized = sales.length ? sales.reduce((s, x) => s + (x.realized ?? 0), 0) : null

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
            {/* Ein Knopf für beide Richtungen: Kauf oder Verkauf wählt man im Eintrag oben */}
            <button type="button" className="btn btn-primary min-w-[148px]" onClick={() => { onClose(); nav.openEntry('kauf', { ticker: ticker! }) }} title="Kauf oder Verkauf erfassen">Kauf / Verkauf</button>
          </>
        )
      }
    >
      {p && !edit && (
        <div className="grid grid-cols-[minmax(0,1fr)] gap-5">
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
              {/* Unrealisiert gegen den Ø Einstand: Prozent und Betrag, Farbe zeigt die Richtung */}
              {r?.pl != null && r.plPct != null && (
                <div className="num -mt-0.5 text-[12px] leading-4" title="Unrealisiert gegenüber dem Ø Einstand">
                  <Delta value={r.plPct} digits={1} icon={false} /> <span className="text-faint">·</span> <Delta value={r.pl} kind="usd" icon={false} /><Cur />
                </div>
              )}
            </div>
          </div>

          <PriceChart t={ticker!} refs={refs} txs={txs} avg={r?.avg} hideChange />

          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 sm:gap-2.5">
            <Fact label="Stück">{qty(p.shares)}</Fact>
            <Fact label="Depotanteil">{pctPlain(r?.w)}</Fact>
            <Fact label={<>Ø Einstand {p.costDemo && <DemoTag />}</>}>{money(r?.avg)}</Fact>
            <Fact label="Gewinn/Verlust">{r?.pl != null ? <><Delta value={r.pl} kind="usd" icon={false} /><Cur />{r.plPct != null && <> <span className="text-faint">·</span> <Delta value={r.plPct} digits={1} icon={false} /></>}</> : <span className="text-muted">offen</span>}</Fact>
            {/* Bereits realisiert: Gewinn oder Verlust aller Verkäufe dieses Titels */}
            <Fact label="Realisiert">{realized != null ? <><Delta value={realized} kind="usd" icon={false} /><Cur /></> : <span className="text-muted">keine Verkäufe</span>}</Fact>
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
                    <span className="font-medium">{txLabel(x)}</span>
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
            <button type="button" className="btn btn-primary min-w-[148px]" onClick={() => { onClose(); nav.openEntry('kauf', { ticker: ticker! }) }}>Kauf erfassen</button>
          </>
        )
      }
    >
      {w && s && !edit && (
        <div className="grid grid-cols-[minmax(0,1fr)] gap-5">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <div className="label">{quoteLabel(q, w.priceDate)}</div>
              <div className="mt-0.5 flex items-baseline gap-2.5">
                <span className="text-[30px] font-semibold leading-9 tracking-[-0.03em]">{usd(px)}<Cur /></span>
                {q?.prev ? <Delta value={q.close / q.prev - 1} digits={2} className="text-[13.5px] font-medium" /> : null}
              </div>
            </div>
            {/* Bricht der Block auf dem Handy um, bleibt er rechtsbündig (sonst hängt er schief links unter dem Kurs) */}
            <div className="ml-auto text-right">
              <Chip tone={s.tone}>{s.label}</Chip>
              <div className="mt-2 flex items-center justify-end gap-3">
                <LimitTrack d={s.d} tone={s.tone} width={120} />
                <span className={`num text-[15px] font-semibold ${s.d != null && s.d <= 0 ? 'text-up' : ''}`}>{s.d != null ? pctPlain(Math.abs(s.d), 1) : '–'}</span>
              </div>
            </div>
          </div>

          <PriceChart t={ticker!} refs={refs} />

          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 sm:gap-2.5">
            <Fact label="Grenze">{w.limit ? money(w.limit) : '–'}</Fact>
            {/* Ohne vorsichtige Grenze keine leere Kachel mit «–» */}
            {w.limitCautious != null && <Fact label="Vorsichtige Grenze">{money(w.limitCautious)}</Fact>}
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
