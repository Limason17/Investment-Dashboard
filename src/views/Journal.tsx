import { NotebookPen, Pencil } from 'lucide-react'
import clsx from 'clsx'
import { useMemo, useState } from 'react'
import { MonthBars, type PeriodPair } from '@/components/charts/MonthBars'
import { Card, ConfirmDelete, Delta, DemoTag, Empty, Segmented, Stat, StatGroup } from '@/components/ui'
import { withIds, yearStats } from '@/lib/calc'
import { useDepot, useNav, type EntryType } from '@/lib/context'
import { dfmt, qty, usd, weekday, cur, cur0, money } from '@/lib/format'
import { periodsSince, UNIT_PLURAL } from '@/lib/periods'
import { txLabel } from '@/lib/labels'
import { mutate } from '@/lib/store'
import { toast } from '@/lib/toast'
import type { Tx } from '@/lib/types'


const RECENT = 12

const DeleteButton = ({ onConfirm, label = 'Buchung stornieren' }: { onConfirm: () => void; label?: string }) => <ConfirmDelete onConfirm={onConfirm} label={label} />

/** Welches Formular eine Buchung bearbeitet; Gebühren und Bestandskorrekturen lassen sich nur ansehen und löschen. */
const editType = (x: Tx): EntryType => (x.type === 'kauf' || x.type === 'verkauf' ? x.type : (x.type === 'einzahlung' || x.type === 'auszahlung' || x.type === 'korrektur') && !x.ticker ? 'einzahlung' : 'buchung')

/** Betrag ohne Vorzeichen: Rot heisst Geld geht weg, Grün heisst Geld kommt herein */
const signTone = (v: number | null | undefined) => (v == null || v === 0 ? 'text-ink' : v < 0 ? 'text-down' : 'text-up')

export function Journal() {
  const { db, c, now } = useDepot()
  const nav = useNav()
  const [filter, setFilter] = useState<'alle' | 'handel' | 'cash'>('alle')
  const tx = useMemo(() => withIds(db.transactions).sort((a, b) => ((b.date || '') > (a.date || '') ? 1 : (b.date || '') < (a.date || '') ? -1 : 0)), [db])
  const matching = tx.filter((x) => filter === 'alle' || (filter === 'handel' ? x.type === 'kauf' || x.type === 'verkauf' : x.type !== 'kauf' && x.type !== 'verkauf'))
  // Zuerst nur die jüngsten Buchungen: Die Liste bleibt kurz, der Rest ist einen Tipp entfernt.
  const [all, setAll] = useState(false)
  const shown = all ? matching : matching.slice(0, RECENT)
  const log = useMemo(() => withIds(db.log).sort((a, b) => ((b.date || '') > (a.date || '') ? 1 : -1)), [db])

  // Storno: Bestand, Einstand, Topf und Cash werden mit zurückgesetzt (Cash nur nach dem letzten Cash-Stand).
  const delNote = (id: string) =>
    mutate([{ op: 'delete', coll: 'log', id }])
      .then(() => toast('Notiz gelöscht.'))
      .catch((e) => toast('Nicht gelöscht: ' + e.message))

  // Käufe und Verkäufe seit der ersten Buchung: bis 1 Jahr je Monat, länger je Quartal, Halbjahr oder Jahr.
  // Die Kennzahlen zählen alle Buchungen seit der ersten.
  const stats = useMemo(() => {
    const trades = tx.filter((x) => (x.type === 'kauf' || x.type === 'verkauf') && x.date)
    const first = trades.reduce<string | null>((a, x) => (!a || x.date! < a ? x.date! : a), null)
    const axis = first ? periodsSince(first, now) : null
    const periods: PeriodPair[] = axis ? axis.periods.map((p) => ({ ...p, a: 0, b: 0 })) : []
    const at = new Map(periods.map((m) => [m.key, m]))
    const y = { buys: 0, nBuys: 0, sells: 0, nSells: 0, flow: 0, nFlow: 0 }
    for (const x of tx) {
      const amount = Math.abs(x.cashDelta || 0)
      const m = axis && x.date ? at.get(axis.keyOf(x.date)) : undefined
      if (m && x.type === 'kauf') m.a += amount
      if (m && x.type === 'verkauf') m.b += amount
      if (x.type === 'kauf') { y.buys += amount; y.nBuys++ }
      else if (x.type === 'verkauf') { y.sells += amount; y.nSells++ }
      else if (x.type === 'einzahlung' || x.type === 'auszahlung') { y.flow += x.cashDelta || 0; y.nFlow++ }
    }
    const unit = axis?.unit ?? 'monat'
    return { periods, unit, current: axis ? axis.keyOf(now) : '', y, any: periods.some((m) => m.a || m.b) }
  }, [tx, now])
  const ys = useMemo(() => yearStats(db, ''), [db])

  return (
    <div className="grid grid-cols-12 gap-3 sm:gap-4">
      {/* Kennzahlen: eine Zeile je Zahl, Name links, Zahl rechts; ohne Beschreibung, ohne Vorzeichen und Währung (Rot = Minus, Grün = Plus) */}
      <StatGroup className="col-span-12 self-start xl:col-span-4">
        <Stat label="Gesamtwert" value={c.valuationComplete ? usd(c.settings.cashExcluded ? c.sec : c.total) : '–'} />
        <Stat label="Einstand" value={usd(stats.y.buys)} />
        <Stat label="Verkauft" value={usd(stats.y.sells)} />
        <Stat label="Unrealisiert" value={c.pl != null ? <Delta value={c.pl} kind="usd" icon={false} /> : '–'} />
        <Stat label="Realisiert" value={ys.sales ? <Delta value={ys.realized} kind="usd" icon={false} /> : '–'} />
        <Stat label="Dividenden" value={ys.divCount ? usd(ys.divNet) : '–'} />
        {stats.y.nFlow ? (
          <Stat label="Einzahlungen" value={<span className={stats.y.flow < 0 ? 'text-down' : ''}>{usd(Math.abs(stats.y.flow))}</span>} />
        ) : (
          <Stat label="Investiert" value={usd(stats.y.buys - stats.y.sells)} />
        )}
      </StatGroup>

      {stats.any && (
        <Card className={"col-span-12 xl:col-span-8"} title="Käufe und Verkäufe" sub={`${stats.periods.length} ${UNIT_PLURAL[stats.unit][stats.periods.length === 1 ? 0 : 1]}, in ${cur()}`}>
          <MonthBars months={stats.periods} labels={['Käufe', 'Verkäufe']} colors={['var(--color-accent)', 'var(--color-ref)']} format={cur0} current={stats.current} />
        </Card>
      )}

      <Card
        className="col-span-12 xl:col-span-8"
        title="Buchungen"
        sub={matching.length > shown.length ? `die letzten ${shown.length} von ${matching.length}` : `${matching.length} Einträge`}
        flush
        action={<Segmented label="Art der Buchung" value={filter} onChange={setFilter} options={[{ value: 'alle', label: 'Alle' }, { value: 'handel', label: 'Käufe & Verkäufe' }, { value: 'cash', label: 'Ein- & Auszahlungen' }]} />}
      >
        {shown.length === 0 ? (
          <Empty title="Noch keine Buchungen">Mit «Eintrag» erfasst du Käufe, Verkäufe und Einzahlungen.</Empty>
        ) : (
          <>
          {/* Handy: eine Zeile je Buchung statt der breiten Tabelle */}
          <ul className="divide-y divide-white/[0.045] px-2 md:hidden">
            {shown.map((x) => (
              <li key={x.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-3 py-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="text-ink-2">{txLabel(x)}</span>
                    {x.ticker && <button type="button" className="tk" onClick={() => db.positions[x.ticker!] && nav.openPosition(x.ticker!)}>{x.ticker}</button>}
                    {x.demo && <DemoTag />}
                  </div>
                  {/* Datum und Stück × Preis brechen als Ganzes um statt abgeschnitten zu werden; nur die Notiz wird gekürzt */}
                  <div className="num mt-1 text-[12px] text-muted">
                    <span className="whitespace-nowrap">{dfmt(x.date)}</span>
                    {x.shares != null && x.price != null && <> · <span className="whitespace-nowrap">{qty(x.shares)} × {money(x.price)}</span></>}
                  </div>
                  {x.note && !x.demo && <div className="truncate text-[12px] text-muted">{x.note}</div>}
                </div>
                <div className="flex items-start gap-0.5">
                  <div className="pt-0.5 text-right leading-tight">
                    <span className={clsx('num text-[13.5px] font-medium', signTone(x.cashDelta))}>{usd(Math.abs(x.cashDelta ?? 0))}</span>
                  </div>
                  <span className="flex"><button type="button" className="btn btn-ghost btn-sm" aria-label="Buchung bearbeiten" title="Buchung bearbeiten oder löschen" onClick={() => nav.openEntry(editType(x), { fromId: x.id })}><Pencil /></button></span>
                </div>
              </li>
            ))}
          </ul>
          <div className="@container hidden overflow-x-auto md:block">
            <table className="tbl">
              <thead>
                <tr><th>Datum</th><th>Art</th><th>Titel</th><th className="r">Stück</th><th className="r">Preis {cur()}</th><th className="r">Betrag {cur()}</th><th className="@max-[880px]:hidden">Notiz</th><th><span className="sr-only">Aktion</span></th></tr>
              </thead>
              <tbody>
                {shown.map((x) => (
                  <tr key={x.id}>
                    <td className="num whitespace-nowrap text-ink-2">{dfmt(x.date)}</td>
                    <td><span className="text-ink-2">{txLabel(x)}</span></td>
                    <td>{x.ticker ? <button type="button" className="tk hover:underline" onClick={() => db.positions[x.ticker!] && nav.openPosition(x.ticker!)}>{x.ticker}</button> : null}</td>
                    <td className="r num text-ink-2">{x.shares != null ? qty(x.shares) : ''}</td>
                    <td className="r num text-ink-2">{x.price != null ? usd(x.price) : ''}</td>
                    <td className="r leading-tight">
                      <span className={clsx('num font-medium', signTone(x.cashDelta))}>{usd(Math.abs(x.cashDelta ?? 0))}</span>
                    </td>
                    <td className="@max-[880px]:hidden">
                      <span className="inline-flex items-center gap-1.5 text-[12px] text-muted">
                        {x.demo ? <DemoTag /> : <span className="line-clamp-2 max-w-[300px] leading-[1.4]" title={x.note}>{x.note}</span>}
                        {x.demo && x.note && x.note !== 'Testbuchung' && <span>{x.note.replace(' (Testbuchung)', '')}</span>}
                      </span>
                    </td>
                    <td className="r whitespace-nowrap"><button type="button" className="btn btn-ghost btn-sm" aria-label="Buchung bearbeiten" title="Buchung bearbeiten oder löschen" onClick={() => nav.openEntry(editType(x), { fromId: x.id })}><Pencil /></button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {matching.length > RECENT && (
            <div className="px-2 pb-1 pt-2">
              <button type="button" className="btn btn-ghost w-full" onClick={() => setAll((v) => !v)}>{all ? `Nur die letzten ${RECENT} zeigen` : `Alle ${matching.length} Buchungen zeigen`}</button>
            </div>
          )}
          </>
        )}
      </Card>

      <Card
        className="col-span-12 xl:col-span-4"
        title="Entscheide & Notizen"
        action={<button type="button" className="btn btn-sm" onClick={() => nav.openEntry('notiz')}><NotebookPen /> Notiz</button>}
        bodyClassName="!pt-3"
      >
        {log.length === 0 ? (
          <Empty>Noch keine Notizen.</Empty>
        ) : (
          <ol className="relative ml-1.5 border-l border-line">
            {log.map((e) => (
              <li key={e.id} className="relative pb-5 pl-5 last:pb-1">
                <span className="absolute -left-[4.5px] top-1.5 size-2 rounded-full bg-accent shadow-[0_0_0_3px_var(--color-card)]" />
                <div className="flex flex-wrap items-center gap-x-2 text-[11.5px] text-muted">
                  <span className="num">{weekday(e.date)}, {dfmt(e.date)}</span>
                  {e.by && <><span className="text-faint">·</span><span>{e.by}</span></>}
                </div>
                <div className="mt-0.5 flex items-start justify-between gap-2">
                  <span className="text-[13.5px] font-medium leading-5">{e.title}</span>
                  <span className="-mr-2 -mt-1.5 flex-none"><DeleteButton label="Notiz löschen" onConfirm={() => void delNote(e.id)} /></span>
                </div>
                {e.text && <p className="mt-1 text-[12.5px] leading-[1.5] text-muted">{e.text}</p>}
              </li>
            ))}
          </ol>
        )}
      </Card>
    </div>
  )
}

/** Ergebnis eines Verkaufs: Gewinn oder Verlust gegenüber dem Einstand, in USD und Prozent */
