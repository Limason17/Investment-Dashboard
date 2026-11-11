import { Check, Pencil, Upload } from 'lucide-react'
import { useMemo } from 'react'
import { DIV_EXPECTED, DIV_RECEIVED, DividendBars, type DivMonth } from '@/components/charts/DividendBars'
import { Card, Chip, ConfirmDelete, DemoTag, Empty, Stat } from '@/components/ui'
import { divAnnual, dividendsList, wht } from '@/lib/calc'
import { useDepot, useNav } from '@/lib/context'
import { addMonths, dfmt, pctPlain, qty, usd } from '@/lib/format'
import { reverseDividend } from '@/lib/reverse'
import { mutate } from '@/lib/store'
import { toast } from '@/lib/toast'

export function Dividends() {
  const { db, c, now } = useDepot()
  const nav = useNav()
  const del = (id: string) =>
    mutate(reverseDividend(db, id, db.dividends[id]))
      .then(() => toast('Dividende entfernt. Cash ist zurückgesetzt.'))
      .catch((e) => toast('Nicht entfernt: ' + e.message))
  const a = useMemo(() => divAnnual(db), [db])
  const all = useMemo(() => dividendsList(db).sort((x, y) => ((y.payDate || y.exDate || '') > (x.payDate || x.exDate || '') ? 1 : -1)), [db])
  const year = now.slice(0, 4)
  const received = all.filter((d) => d.status === 'erhalten')
  const recYear = received.filter((d) => (d.payDate || '').startsWith(year)).reduce((s, d) => s + (d.net || 0), 0)
  const recYearCount = received.filter((d) => (d.payDate || '').startsWith(year)).length
  const expected = all.filter((d) => d.status === 'erwartet')
  const expSum = expected.reduce((s, d) => s + (d.net || 0), 0)
  const w = wht(db)

  const months: DivMonth[] = useMemo(() => {
    const first = now.slice(0, 8) + '01'
    const list: DivMonth[] = []
    for (let i = -5; i <= 6; i++) list.push({ key: addMonths(first, i).slice(0, 7), received: 0, expected: 0, items: [] })
    for (const d of all) {
      const m = list.find((x) => x.key === (d.payDate || d.exDate || '').slice(0, 7))
      if (!m) continue
      m[d.status === 'erhalten' ? 'received' : 'expected'] += d.net || 0
      m.items.push(d)
    }
    return list
  }, [all, now])
  const hasDemo = all.some((d) => d.demo)
  // Spalten nur zeigen, wenn mindestens eine Zeile dort etwas stehen hat (importierte Buchungen kennen oft nur die Beträge).
  const cols = { ex: all.some((d) => d.exDate), per: all.some((d) => d.perShare != null), shares: all.some((d) => d.shares != null) }

  return (
    <div className="grid grid-cols-12 gap-3 sm:gap-4">
      <section className="card col-span-12 grid grid-cols-2 divide-line lg:grid-cols-5 lg:divide-x [&>*]:border-line max-lg:[&>*:nth-child(n+3)]:border-t max-lg:[&>*:nth-child(even)]:border-l">
        <Stat label="Jahresprognose netto" value={<>{usd(a.per.length ? a.net : null)} <span className="text-[13px] font-medium text-muted">USD</span></>} sub={<span>{usd(a.per.length ? a.gross : null)} brutto, {pctPlain(w, 0)} Steuer</span>} />
        <Stat label="Rendite auf Wertpapiere" value={pctPlain(c.valuationComplete && a.per.length && c.sec ? a.gross / c.sec : null, 2)} sub={<span>brutto, laufende Raten</span>} />
        <Stat label={<>Erhalten {year} {hasDemo && <DemoTag />}</>} value={usd(recYear)} sub={<span>{recYearCount} {recYearCount === 1 ? 'Zahlung' : 'Zahlungen'}, netto</span>} />
        <Stat label="Erwartet" value={expected.length ? usd(expSum) : '–'} sub={<span>{expected.length ? `${expected.length} offene ${expected.length === 1 ? 'Zahlung' : 'Zahlungen'}` : 'keine offene Zahlung erfasst'}</span>} />
        <Stat className="max-lg:col-span-2" label="Pro Monat im Schnitt" value={usd(a.per.length ? a.net / 12 : null)} sub={<span>netto, Prognose</span>} />
      </section>

      <div className="col-span-12 grid content-start gap-3 sm:gap-4 xl:col-span-7">
      <Card title="Dividenden nach Monat" sub="netto nach Quellensteuer, in USD">
        {all.length === 0 ? (
          <Empty title="Noch keine Dividenden erfasst">Erhaltene Beträge trägst du mit «Eintrag» ein.</Empty>
        ) : (
          <>
            <DividendBars months={months} current={now.slice(0, 7)} />
            <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-[12px] text-ink-2">
              <span className="inline-flex items-center gap-2"><i className="swatch" style={{ background: DIV_RECEIVED }} />erhalten</span>
              <span className="inline-flex items-center gap-2"><i className="swatch" style={{ background: DIV_EXPECTED }} />erwartet</span>
            </div>
          </>
        )}
      </Card>

      <Card title="Alle Dividenden" sub="Erwartete Beträge bestätigst du, sobald der Broker sie bucht" flush action={<button type="button" className="btn btn-ghost btn-sm" onClick={() => nav.openEntry('import', { kind: 'dividenden' })}><Upload /> Hochladen</button>}>
        {all.length === 0 ? (
          <Empty>Noch keine Einträge.</Empty>
        ) : (
          <>
          {/* Handy: eine Zeile je Zahlung */}
          <ul className="divide-y divide-white/[0.045] px-2 md:hidden">
            {all.map((d) => {
              const due = d.status === 'erwartet' && d.payDate <= now
              return (
                <li key={d.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 py-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="tk">{d.ticker}</span>
                      {d.status === 'erhalten' ? <Chip tone="up">erhalten</Chip> : due ? <Chip tone="warn">zu bestätigen</Chip> : <Chip tone="info">erwartet</Chip>}
                      {d.demo && <DemoTag />}
                    </div>
                    <div className="num mt-1 truncate text-[12px] text-muted">{dfmt(d.payDate)}{d.payDateEstimated ? ' (geschätzt)' : ''} · brutto {usd(d.gross)} · Steuer {usd(d.tax)}</div>
                  </div>
                  <div className="text-right">
                    <div className="num text-[14px] font-medium">{usd(d.net)}</div>
                    {d.status === 'erwartet' && <button type="button" className="btn btn-sm mt-1.5" onClick={() => nav.openEntry('dividende', { fromId: d.id })}><Check /> Bestätigen</button>}
                  </div>
                </li>
              )
            })}
          </ul>
          <div className="hidden overflow-x-auto md:block">
            <table className="tbl">
              <thead>
                <tr><th>Titel</th>{cols.ex && <th>Ex-Tag</th>}<th>Zahltag</th>{cols.per && <th className="r">je Stück</th>}{cols.shares && <th className="r">Stück</th>}<th className="r">Brutto</th><th className="r">Steuer</th><th className="r">Netto</th><th>Status</th><th /></tr>
              </thead>
              <tbody>
                {all.map((d) => {
                  const due = d.status === 'erwartet' && d.payDate <= now
                  return (
                    <tr key={d.id}>
                      <td><span className="tk">{d.ticker}</span></td>
                      {cols.ex && <td className="num text-ink-2">{dfmt(d.exDate)}</td>}
                      <td className="num">{dfmt(d.payDate)}{d.payDateEstimated && <span className="text-muted"> (geschätzt)</span>}</td>
                      {cols.per && <td className="r num text-ink-2">{d.perShare != null ? Number(d.perShare).toFixed(4) : '–'}</td>}
                      {cols.shares && <td className="r num text-ink-2">{qty(d.shares)}</td>}
                      <td className="r num">{usd(d.gross)}</td>
                      <td className="r num text-ink-2">{usd(d.tax)}</td>
                      <td className="r num font-medium">{usd(d.net)}</td>
                      <td>
                        <span className="inline-flex items-center gap-1.5">
                          {d.status === 'erhalten' ? <Chip tone="up">erhalten</Chip> : due ? <Chip tone="warn">zu bestätigen</Chip> : <Chip tone="info">erwartet</Chip>}
                          {d.demo && <DemoTag />}
                        </span>
                      </td>
                      <td className="r">
                        <span className="inline-flex items-center gap-1">
                          {d.status === 'erwartet' ? <button type="button" className="btn btn-sm" onClick={() => nav.openEntry('dividende', { fromId: d.id })}><Check /> Bestätigen</button> : <button type="button" className="btn btn-ghost btn-sm" aria-label="Dividende bearbeiten" title="Dividende bearbeiten" onClick={() => nav.openEntry('dividende', { fromId: d.id })}><Pencil /></button>}
                          <ConfirmDelete label={d.status === 'erhalten' ? 'Dividende stornieren (Cash wird zurückgesetzt)' : 'Erwartete Dividende löschen'} onConfirm={() => void del(d.id)} />
                        </span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          </>
        )}
      </Card>
      </div>

      <Card className="col-span-12 self-start xl:col-span-5" title="Dividendenzahler im Depot" sub={c.settings.demo ? 'Jahresrate je Stück' : 'Jahresrate je Stück, letzte 12 Monate'} flush>
        {a.per.length === 0 ? (
          <Empty>Für die gehaltenen Titel liegt noch keine Dividendenrate vor. Sie wird aus den Ausschüttungen der letzten 12 Monate berechnet und erscheint kurz nach dem Start.</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="tbl">
              <thead>
                <tr><th>Titel</th><th className="r">Rate pro Jahr</th><th className="r">Rendite</th><th className="r">Netto pro Jahr</th></tr>
              </thead>
              <tbody>
                {a.per.map((r) => (
                  <tr key={r.t} className="row-click" tabIndex={0} onClick={() => nav.openPosition(r.t)} onKeyDown={(e) => e.key === 'Enter' && nav.openPosition(r.t)}>
                    <td><div className="tk">{r.t}</div><div className="text-[12px] leading-4 text-muted">{r.freq}</div></td>
                    <td className="r num">{r.rate.toFixed(4)}</td>
                    <td className="r num text-ink-2">{r.px ? pctPlain(r.rate / r.px, 2) : '–'}</td>
                    <td className="r num font-medium">{usd(r.v * (1 - w))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

    </div>
  )
}
