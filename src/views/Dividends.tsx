import { Check, Pencil, Upload } from 'lucide-react'
import { Fragment, useMemo, useState } from 'react'
import { DIV_EXPECTED, DIV_RECEIVED, DividendBars, type DivMonth } from '@/components/charts/DividendBars'
import { Card, Chip, ConfirmDelete, DemoTag, Empty, Stat, StatGroup, Cur } from '@/components/ui'
import { divAnnual, dividendsList, projectedDividends, wht } from '@/lib/calc'
import { useDepot, useNav } from '@/lib/context'
import { addMonths, dfmt, pctPlain, qty, usd, cur, curRate } from '@/lib/format'
import { movesCash, reverseDividend } from '@/lib/reverse'
import { mutate } from '@/lib/store'
import { toast } from '@/lib/toast'

/** Anzahl Zeilen je Gruppe, bevor «Alle zeigen» nötig ist (wie im Journal). */
const RECENT = 8
type DivRow = ReturnType<typeof dividendsList>[number]

export function Dividends() {
  const { db, c, now } = useDepot()
  const nav = useNav()
  const cashOff = !!db.meta.settings?.cashExcluded
  const del = (id: string) =>
    mutate(reverseDividend(db, id, db.dividends[id]))
      .then(() => toast(db.dividends[id]?.status === 'erhalten' && !cashOff && movesCash(db, db.dividends[id].payDate) ? 'Dividende entfernt. Cash ist zurückgesetzt.' : 'Dividende entfernt.'))
      .catch((e) => toast('Nicht entfernt: ' + e.message))
  const a = useMemo(() => divAnnual(db), [db])
  const all = useMemo(() => dividendsList(db).sort((x, y) => ((y.payDate || y.exDate || '') > (x.payDate || x.exDate || '') ? 1 : -1)), [db])
  const received = all.filter((d) => d.status === 'erhalten')
  // Laufendes Jahr; ohne Zahlung darin das letzte Jahr mit Zahlungen (z. B. nach dem Hochladen älterer Dividenden)
  const paidYears = received.map((d) => (d.payDate || '').slice(0, 4)).filter(Boolean).sort()
  const year = !paidYears.length || paidYears.includes(now.slice(0, 4)) ? now.slice(0, 4) : paidYears[paidYears.length - 1]
  const recYear = received.filter((d) => (d.payDate || '').startsWith(year)).reduce((s, d) => s + (d.net || 0), 0)
  const expected = all.filter((d) => d.status === 'erwartet')
  // Geschätzte Zahlungen der nächsten 6 Monate aus den bisherigen Ausschüttungen (nur Anzeige, nichts gespeichert)
  const projected = useMemo(() => projectedDividends(db, now), [db, now])
  const expSum = [...expected, ...projected].reduce((s, d) => s + (d.net || 0), 0)
  const w = wht(db)

  const months: DivMonth[] = useMemo(() => {
    const first = now.slice(0, 8) + '01'
    const list: DivMonth[] = []
    for (let i = -11; i <= 6; i++) list.push({ key: addMonths(first, i).slice(0, 7), received: 0, expected: 0, items: [] })
    for (const d of [...all, ...projected]) {
      const m = list.find((x) => x.key === (d.payDate || d.exDate || '').slice(0, 7))
      if (!m) continue
      m[d.status === 'erhalten' ? 'received' : 'expected'] += d.net || 0
      m.items.push(d)
    }
    return list
  }, [all, projected, now])
  const hasDemo = all.some((d) => d.demo)
  // Spalten nur zeigen, wenn mindestens eine Zeile dort etwas stehen hat (importierte Buchungen kennen oft nur die Beträge).
  const cols = { ex: all.some((d) => d.exDate), per: all.some((d) => d.perShare != null), shares: all.some((d) => d.shares != null) }

  const [showAll, setShowAll] = useState(false)
  const groups = [
    { key: 'offen', label: 'Anstehend', hint: 'nächste zuerst', items: [...expected].reverse() },
    { key: 'erhalten', label: 'Erhalten', hint: 'neueste zuerst', items: received },
  ].filter((g) => g.items.length).map((g) => ({ ...g, shown: showAll ? g.items : g.items.slice(0, RECENT) }))
  const total = all.length
  const shownCount = groups.reduce((s, g) => s + g.shown.length, 0)
  const isDue = (d: DivRow) => d.status === 'erwartet' && d.payDate <= now
  const actions = (d: DivRow) => (
    <>
      {isDue(d) ? <button type="button" className="btn btn-sm" onClick={() => nav.openEntry('dividende', { fromId: d.id })}><Check /> Bestätigen</button> : <button type="button" className="btn btn-ghost btn-sm" aria-label="Dividende bearbeiten" title="Dividende bearbeiten" onClick={() => nav.openEntry('dividende', { fromId: d.id })}><Pencil /></button>}
      <ConfirmDelete label={d.status === 'erhalten' ? 'Dividende stornieren (Cash wird zurückgesetzt)' : 'Erwartete Dividende löschen'} onConfirm={() => void del(d.id)} />
    </>
  )

  return (
    <div className="grid grid-cols-12 gap-3 sm:gap-4">
      {/* Links (ab 1280px): Kennzahlen und Zahler untereinander; rechts der Monats-Chart. Auf Handy und Tablet steht der Zahler zuletzt. */}
      <div className="contents xl:col-span-4 xl:grid xl:grid-cols-1 xl:content-start xl:gap-2">
        {/* Kennzahlen als Liste wie im Journal: Name links, Zahl rechts, ohne Beschreibung und Währung */}
        <StatGroup className="col-span-12 xl:col-span-1">
          <Stat label="Prognose pro Jahr" value={a.per.length ? usd(a.net) : '–'} />
          <Stat label="Rendite" value={pctPlain(c.valuationComplete && a.per.length && c.sec ? a.gross / c.sec : null, 2)} />
          <Stat label={<>Erhalten {year} {hasDemo && <DemoTag />}</>} value={usd(recYear)} />
          <Stat label="Nächste 6 Monate" value={expected.length || projected.length ? usd(expSum) : '–'} />
          <Stat label="Pro Monat" value={a.per.length ? usd(a.net / 12) : '–'} />
        </StatGroup>
      <Card className="col-span-12 max-xl:order-last xl:col-span-1" title="Dividendenzahler" sub="Rate je Stück" flush>
        {a.per.length === 0 ? (
          <Empty>Für die gehaltenen Titel liegt noch keine Dividendenrate vor. Sie wird aus den Ausschüttungen der letzten 12 Monate berechnet und erscheint kurz nach dem Start.</Empty>
        ) : (
          <div className="@container overflow-x-auto">
            <table className="tbl">
              <thead>
                {/* Schmale Karte (Handy, Seitenspalte): kurze Spaltennamen, damit «Netto pro Jahr» ohne seitliches Scrollen sichtbar bleibt */}
                <tr><th>Titel</th><th className="r"><span className="@max-[440px]:hidden">Rate pro Jahr</span><span className="@min-[440px]:hidden">Rate</span> {cur()}</th><th className="r @max-[340px]:hidden">Rendite</th><th className="r"><span className="@max-[440px]:hidden">Netto pro Jahr</span><span className="@min-[440px]:hidden">Netto</span> {cur()}</th></tr>
              </thead>
              <tbody>
                {a.per.map((r) => (
                  <tr key={r.t} className="row-click" tabIndex={0} onClick={() => nav.openPosition(r.t)} onKeyDown={(e) => e.key === 'Enter' && nav.openPosition(r.t)}>
                    <td><div className="tk">{r.t}</div><div className="text-[12px] leading-4 text-muted">{r.freq}</div></td>
                    <td className="r num">{(r.rate * curRate()).toFixed(4)}</td>
                    <td className="r num text-ink-2 @max-[340px]:hidden">{r.px ? pctPlain(r.rate / r.px, 2) : '–'}</td>
                    <td className="r num font-medium">{usd(r.v * (1 - w))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      </div>

      {/* Rechts (ab 1280px): Monats-Chart und darunter alle Dividenden, damit keine Lücke neben der linken Spalte bleibt */}
      <div className="contents xl:col-span-8 xl:grid xl:grid-cols-1 xl:content-start xl:gap-2">
      <Card className="col-span-12 xl:col-span-1" title="Dividenden nach Monat" sub={`netto, in ${cur()}`}>
        {all.length === 0 ? (
          <Empty title="Noch keine Dividenden erfasst">Erhaltene Beträge trägst du mit «Eintrag» ein, viele auf einmal mit «Hochladen».</Empty>
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

      {/* Zwei Gruppen statt einer Liste mit Status-Spalte: anstehend (nächste zuerst) und erhalten (neueste zuerst).
          Kurz: je Gruppe die ersten RECENT, wie im Journal. «Bestätigen» nur, wenn der Zahltag erreicht ist. */}
      <Card className="col-span-12 xl:col-span-1" title="Alle Dividenden" sub={total > shownCount ? `${shownCount} von ${total}` : `${total} ${total === 1 ? 'Eintrag' : 'Einträge'}`} flush action={<button type="button" className="btn btn-ghost btn-sm" onClick={() => nav.openEntry('import', { kind: 'dividenden' })}><Upload /> Hochladen</button>}>
        {all.length === 0 ? (
          <Empty>Noch keine Einträge.</Empty>
        ) : (
          <>
          {/* Handy: eine Zeile je Zahlung */}
          <div className="px-2 md:hidden">
            {groups.map((g) => (
              <section key={g.key}>
                <div className="label flex items-baseline justify-between px-1 pb-1 pt-4">{g.label} <span className="font-normal normal-case tracking-normal">{g.hint}</span></div>
                <ul className="divide-y divide-white/[0.045]">
                  {g.shown.map((d) => (
                    <li key={d.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 py-3">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                          <span className="tk">{d.ticker}</span>
                          {isDue(d) && <Chip tone="warn">zu bestätigen</Chip>}
                          {d.demo && <DemoTag />}
                        </div>
                        <div className="num mt-1 truncate text-[12px] text-muted">{dfmt(d.payDate)}{d.payDateEstimated ? ' geschätzt' : ''}</div>
                      </div>
                      <div className="text-right">
                        <div className="num text-[14px] font-medium">{usd(d.net)}<Cur /></div>
                        <div className="mt-1 flex items-center justify-end gap-0.5">{actions(d)}</div>
                      </div>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
          <div className="@container hidden overflow-x-auto md:block">
            <table className="tbl">
              <thead>
                <tr><th>Titel</th>{cols.ex && <th className="@max-[960px]:hidden">Ex-Tag</th>}<th>Zahltag</th>{cols.per && <th className="r @max-[800px]:hidden">je Stück</th>}{cols.shares && <th className="r @max-[800px]:hidden">Stück</th>}<th className="r @max-[640px]:hidden">Brutto {cur()}</th><th className="r @max-[760px]:hidden">Steuer {cur()}</th><th className="r">Netto {cur()}</th><th><span className="sr-only">Aktion</span></th></tr>
              </thead>
              <tbody>
                {groups.map((g) => (
                  <Fragment key={g.key}>
                    <tr className="row-group"><td colSpan={9}><span className="inline-flex items-baseline gap-2.5">{g.label}<span className="font-normal text-muted">{g.hint}</span></span></td></tr>
                    {g.shown.map((d) => (
                      <tr key={d.id}>
                        <td><span className="inline-flex items-center gap-2"><span className="tk">{d.ticker}</span>{isDue(d) && <Chip tone="warn">zu bestätigen</Chip>}{d.demo && <DemoTag />}</span></td>
                        {cols.ex && <td className="num text-ink-2 @max-[960px]:hidden">{dfmt(d.exDate)}</td>}
                        <td className="num">{dfmt(d.payDate)}{d.payDateEstimated && <span className="text-muted"> geschätzt</span>}</td>
                        {cols.per && <td className="r num text-ink-2 @max-[800px]:hidden">{d.perShare != null ? Number(d.perShare).toFixed(4) : '–'}</td>}
                        {cols.shares && <td className="r num text-ink-2 @max-[800px]:hidden">{qty(d.shares)}</td>}
                        <td className="r num @max-[640px]:hidden">{usd(d.gross)}</td>
                        <td className="r num text-ink-2 @max-[760px]:hidden">{usd(d.tax)}</td>
                        <td className="r num font-medium">{usd(d.net)}</td>
                        <td className="r"><span className="inline-flex items-center gap-1">{actions(d)}</span></td>
                      </tr>
                    ))}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
          {total > RECENT && groups.some((g) => g.items.length > RECENT) && (
            <div className="px-2 pb-1 pt-2">
              <button type="button" className="btn btn-ghost w-full" onClick={() => setShowAll((v) => !v)}>{showAll ? `Je Gruppe nur ${RECENT} zeigen` : `Alle ${total} Dividenden zeigen`}</button>
            </div>
          )}
          </>
        )}
      </Card>
      </div>

    </div>
  )
}
