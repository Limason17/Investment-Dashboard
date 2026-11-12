import { NotebookPen, Pencil, Trash2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import { MonthBars, type MonthPair } from '@/components/charts/MonthBars'
import { Card, Chip, Delta, DemoTag, Empty, Segmented, Stat } from '@/components/ui'
import { withIds, yearStats } from '@/lib/calc'
import { useDepot, useNav } from '@/lib/context'
import { addMonths, dfmt, int, qty, usd, weekday } from '@/lib/format'
import { TX_LABEL } from '@/lib/labels'
import { reverseTx } from '@/lib/reverse'
import { mutate } from '@/lib/store'
import { toast } from '@/lib/toast'


const RECENT = 12

function DeleteButton({ onConfirm, label = 'Buchung stornieren' }: { onConfirm: () => void; label?: string }) {
  const [armed, setArmed] = useState(false)
  return (
    <button
      type="button"
      className={`btn btn-ghost btn-sm ${armed ? '!text-down' : ''}`}
      aria-label={label}
      title={label}
      onClick={(e) => {
        e.stopPropagation()
        if (armed) return onConfirm()
        setArmed(true)
        setTimeout(() => setArmed(false), 3000)
      }}
    >
      {armed ? 'Sicher?' : <Trash2 />}
    </button>
  )
}

export function Journal() {
  const { db, now } = useDepot()
  const nav = useNav()
  const [filter, setFilter] = useState<'alle' | 'handel' | 'cash'>('alle')
  const tx = useMemo(() => withIds(db.transactions).sort((a, b) => ((b.date || '') > (a.date || '') ? 1 : (b.date || '') < (a.date || '') ? -1 : 0)), [db])
  const matching = tx.filter((x) => filter === 'alle' || (filter === 'handel' ? x.type === 'kauf' || x.type === 'verkauf' : x.type !== 'kauf' && x.type !== 'verkauf'))
  // Zuerst nur die jüngsten Buchungen: Die Liste bleibt kurz, der Rest ist einen Tipp entfernt.
  const [all, setAll] = useState(false)
  const shown = all ? matching : matching.slice(0, RECENT)
  const log = useMemo(() => withIds(db.log).sort((a, b) => ((b.date || '') > (a.date || '') ? 1 : -1)), [db])

  // Storno: Bestand, Einstand, Topf und Cash werden mit zurückgesetzt.
  const del = (id: string) =>
    mutate(reverseTx(db, id, db.transactions[id]))
      .then(() => toast('Buchung storniert. Bestand und Cash sind zurückgesetzt.'))
      .catch((e) => toast('Nicht storniert: ' + e.message))
  const delNote = (id: string) =>
    mutate([{ op: 'delete', coll: 'log', id }])
      .then(() => toast('Notiz gelöscht.'))
      .catch((e) => toast('Nicht gelöscht: ' + e.message))

  // Handel der letzten zwölf Monate; die Kennzahlen zählen alle Buchungen seit der ersten.
  const since = tx.length ? tx[tx.length - 1].date : null
  const stats = useMemo(() => {
    const months: MonthPair[] = Array.from({ length: 12 }, (_, i) => ({ key: addMonths(now.slice(0, 8) + '01', i - 11).slice(0, 7), a: 0, b: 0 }))
    const at = new Map(months.map((m) => [m.key, m]))
    const y = { buys: 0, nBuys: 0, sells: 0, nSells: 0, flow: 0, nFlow: 0 }
    for (const x of tx) {
      const amount = Math.abs(x.cashDelta || 0)
      const m = at.get((x.date || '').slice(0, 7))
      if (m && x.type === 'kauf') m.a += amount
      if (m && x.type === 'verkauf') m.b += amount
      if (x.type === 'kauf') { y.buys += amount; y.nBuys++ }
      else if (x.type === 'verkauf') { y.sells += amount; y.nSells++ }
      else if (x.type === 'einzahlung' || x.type === 'auszahlung') { y.flow += x.cashDelta || 0; y.nFlow++ }
    }
    // Leere Monate vor der ersten Buchung weglassen (mindestens sechs Monate bleiben stehen).
    const firstUsed = months.findIndex((m) => m.a || m.b)
    return { months: months.slice(Math.max(0, Math.min(firstUsed, 6))), y, any: firstUsed >= 0 }
  }, [tx, now])
  const ys = useMemo(() => yearStats(db, ''), [db])
  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

  return (
    <div className="grid grid-cols-12 gap-3 sm:gap-4">
      <section className="card col-span-12 grid grid-cols-2 divide-line lg:grid-cols-4 lg:divide-x [&>*]:border-line max-lg:[&>*:nth-child(n+3)]:border-t max-lg:[&>*:nth-child(even)]:border-l">
        <Stat label="Käufe insgesamt" value={usd(stats.y.buys)} sub={<span>{plural(stats.y.nBuys, 'Kauf', 'Käufe')}{since ? ` seit ${dfmt(since)}` : ''}</span>} />
        <Stat label="Verkäufe insgesamt" value={usd(stats.y.sells)} sub={<span>{plural(stats.y.nSells, 'Verkauf', 'Verkäufe')}</span>} />
        <Stat label="Realisiert insgesamt" value={ys.sales ? <Delta value={ys.realized} kind="usd" icon={false} /> : '–'} sub={<span>{ys.sales ? `aus ${plural(ys.sales, 'Verkauf', 'Verkäufen')}${ys.fifo ? ', FIFO' : ''}` : 'noch kein Verkauf mit Ergebnis'}</span>} />
        {stats.y.nFlow ? (
          <Stat label="Einzahlungen netto" value={<Delta value={stats.y.flow} kind="usd" icon={false} className="!text-ink" />} sub={<span>{plural(stats.y.nFlow, 'Buchung', 'Buchungen')}</span>} />
        ) : (
          <Stat label="Netto investiert" value={usd(stats.y.buys - stats.y.sells)} sub={<span>Käufe abzüglich Verkäufe</span>} />
        )}
      </section>

      {stats.any && (
        <Card className="col-span-12" title="Käufe und Verkäufe" sub={`je Monat, letzte ${stats.months.length} Monate, in USD`}>
          <MonthBars months={stats.months} labels={['Käufe', 'Verkäufe']} colors={['var(--color-accent)', 'var(--color-ref)']} format={int} current={now.slice(0, 7)} />
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
                    <Chip tone={x.type === 'kauf' ? 'info' : 'mute'} icon={false}>{TX_LABEL[x.type] ?? x.type}</Chip>
                    {x.ticker && <button type="button" className="tk" onClick={() => db.positions[x.ticker!] && nav.openPosition(x.ticker!)}>{x.ticker}</button>}
                    {x.demo && <DemoTag />}
                  </div>
                  <div className="num mt-1 truncate text-[12px] text-muted">
                    {dfmt(x.date)}
                    {x.shares != null && x.price != null && <> · {qty(x.shares)} × {usd(x.price)}</>}
                    {x.note && !x.demo && <span className="font-sans"> · {x.note}</span>}
                  </div>
                </div>
                <div className="flex items-start gap-0.5">
                  <div className="pt-0.5 text-right leading-tight">
                    <Delta value={x.cashDelta} kind="usd" icon={false} className="text-[13.5px] font-medium" />
                    {x.type === 'verkauf' && x.realized != null && <div className="whitespace-nowrap text-[11.5px] text-muted">realisiert <Delta value={x.realized} kind="usd" icon={false} /></div>}
                  </div>
                  <span className="flex">{(x.type === 'kauf' || x.type === 'verkauf') && <button type="button" className="btn btn-ghost btn-sm" aria-label="Buchung bearbeiten" title="Buchung bearbeiten" onClick={() => nav.openEntry(x.type as 'kauf' | 'verkauf', { fromId: x.id })}><Pencil /></button>}<DeleteButton onConfirm={() => del(x.id)} /></span>
                </div>
              </li>
            ))}
          </ul>
          <div className="hidden overflow-x-auto md:block">
            <table className="tbl min-w-[720px]">
              <thead>
                <tr><th>Datum</th><th>Art</th><th>Titel</th><th className="r">Stück</th><th className="r">Preis</th><th className="r">Betrag</th><th>Notiz</th><th /></tr>
              </thead>
              <tbody>
                {shown.map((x) => (
                  <tr key={x.id}>
                    <td className="num whitespace-nowrap text-ink-2">{dfmt(x.date)}</td>
                    <td><Chip tone={x.type === 'kauf' ? 'info' : 'mute'} icon={false}>{TX_LABEL[x.type] ?? x.type}</Chip></td>
                    <td>{x.ticker ? <button type="button" className="tk hover:underline" onClick={() => db.positions[x.ticker!] && nav.openPosition(x.ticker!)}>{x.ticker}</button> : null}</td>
                    <td className="r num text-ink-2">{x.shares != null ? qty(x.shares) : ''}</td>
                    <td className="r num text-ink-2">{x.price != null ? usd(x.price) : ''}</td>
                    <td className="r leading-tight">
                      <Delta value={x.cashDelta} kind="usd" icon={false} className="font-medium" />
                      {/* Ein realisiertes Ergebnis gibt es nur bei Verkäufen. */}
                      {x.type === 'verkauf' && x.realized != null && <div className="whitespace-nowrap text-[11.5px] text-muted">{x.costMethod ? 'realisiert (' + x.costMethod + ')' : 'realisiert'} <Delta value={x.realized} kind="usd" icon={false} /></div>}
                    </td>
                    <td>
                      <span className="inline-flex items-center gap-1.5 text-[12px] text-muted">
                        {x.demo ? <DemoTag /> : <span className="line-clamp-2 max-w-[300px] leading-[1.4]" title={x.note}>{x.note}</span>}
                        {x.demo && x.note && x.note !== 'Testbuchung' && <span>{x.note.replace(' (Testbuchung)', '')}</span>}
                      </span>
                    </td>
                    <td className="r whitespace-nowrap">{(x.type === 'kauf' || x.type === 'verkauf') && <button type="button" className="btn btn-ghost btn-sm" aria-label="Buchung bearbeiten" title="Buchung bearbeiten" onClick={() => nav.openEntry(x.type as 'kauf' | 'verkauf', { fromId: x.id })}><Pencil /></button>}<DeleteButton onConfirm={() => del(x.id)} /></td>
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
