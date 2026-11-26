import { Pencil, Plus } from 'lucide-react'
import { useMemo, useState } from 'react'
import { EventItem, EventStrip } from '@/components/blocks'
import { Allocation } from '@/components/charts/Allocation'
import { Card, Empty } from '@/components/ui'
import { EventSheet, PlanSheet, PotSheet } from '@/features/EditSheets'
import { eventsSorted } from '@/lib/calc'
import { useDepot } from '@/lib/context'
import { usd } from '@/lib/format'
import { mutate } from '@/lib/store'
import { toast } from '@/lib/toast'
import type { DepotEvent, WithId } from '@/lib/types'

/** So viele «Vergangen und noch offen» stehen zuerst da. */
const FEW = 3

export function Plan() {
  const { db, c, now } = useDepot()
  const pots = Object.entries(db.pots).map(([id, p]) => ({ id, ...p })).sort((a, b) => (a.order ?? 99) - (b.order ?? 99))
  const budget = pots.reduce((s, p) => s + (p.budget || 0), 0)
  const used = pots.reduce((s, p) => s + (p.used || 0), 0)
  const events = useMemo(() => eventsSorted(db), [db])
  const upcoming = events.filter((e) => !e.done && e.date >= now)
  const overdue = events.filter((e) => !e.done && e.date < now)
  const done = events.filter((e) => e.done).reverse()
  const rules = c.settings.rules ?? []

  const [planOpen, setPlanOpen] = useState(false)
  const [allOverdue, setAllOverdue] = useState(false)
  const [pot, setPot] = useState<{ id: string | null; n: number } | null>(null)
  const [ev, setEv] = useState<{ id: string | null; n: number } | null>(null)
  const editEvent = (e: WithId<DepotEvent>) => setEv({ id: e.id, n: Date.now() })

  const toggle = (e: WithId<DepotEvent>) =>
    mutate([{ op: 'merge', coll: 'events', id: e.id, data: { done: !e.done } }])
      .then(() => toast(e.done ? 'Termin wieder offen.' : 'Termin erledigt.'))
      .catch((err) => toast('Nicht gespeichert: ' + err.message))

  return (
    <div className="grid grid-cols-12 gap-3 sm:gap-4">
      <div className="col-span-12 grid content-start gap-3 sm:gap-4 xl:col-span-7">
      <Card title="Allokation" action={<button type="button" className="btn btn-ghost btn-sm" onClick={() => setPlanOpen(true)}><Pencil /> Ziele</button>} sub={c.settings.cashExcluded ? 'in % der Wertpapiere' : c.settings.cashPartial ? 'Cash nur teilweise erfasst' : undefined}>
        <Allocation c={c} />
      </Card>
      <Card title="Cash-Töpfe" flush action={<button type="button" className="btn btn-sm" onClick={() => setPot({ id: null, n: Date.now() })}><Plus /> Topf</button>}>
        {pots.length === 0 ? (
          <Empty>Ein Topf ist ein Budget für geplante Käufe. Käufe daraus zählen automatisch.</Empty>
        ) : (
          // Tabelle wie bei den Positionen: je Topf Budget, eingesetzt, frei; unten die Summe in gleicher Schriftgrösse wie die Namen
          <div className="overflow-x-auto">
            <table className="tbl text-[13.5px]">
              <thead>
                <tr><th>Topf</th><th className="r">Budget</th><th className="r">Eingesetzt</th><th className="r">Frei</th></tr>
              </thead>
              <tbody>
                {pots.map((p) => {
                  const rest = (p.budget || 0) - (p.used || 0)
                  return (
                    <tr key={p.id} className="row-click" tabIndex={0} onClick={() => setPot({ id: p.id, n: Date.now() })} onKeyDown={(e) => e.key === 'Enter' && setPot({ id: p.id, n: Date.now() })}>
                      <td>
                        <div className="font-medium">{p.label}</div>
                        {p.note && <div className="max-w-[340px] truncate text-[12px] text-muted" title={p.note}>{p.note}</div>}
                      </td>
                      <td className="r num text-ink-2">{usd(p.budget || 0)}</td>
                      <td className="r num text-ink-2">{p.used ? usd(p.used) : '–'}</td>
                      <td className={`r num font-medium ${rest < -0.005 ? 'text-down' : ''}`}>{usd(Math.abs(rest))}</td>
                    </tr>
                  )
                })}
                {/* Summe: feine Linie darüber, gleich gross wie die Topfnamen */}
                <tr className="[&>td]:border-t [&>td]:border-t-line [&>td]:font-[550]">
                  <td>Summe</td>
                  <td className="r num">{usd(budget)}</td>
                  <td className="r num">{usd(used)}</td>
                  <td className="r num">{usd(budget - used)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </Card>
      </div>

      <Card className="col-span-12 self-start xl:col-span-5" title="Termine" bodyClassName="!pt-1" action={<button type="button" className="btn btn-sm" onClick={() => setEv({ id: null, n: Date.now() })}><Plus /> Termin</button>}>
        {events.length === 0 && <Empty>Keine Termine. Mit «Termin» erfasst du z. B. Quartalszahlen oder geplante Käufe.</Empty>}
        <EventStrip events={upcoming} now={now} className="mt-4" />
        {upcoming.length > 0 && (
          <>
            <div className="label mt-3">Anstehend</div>
            <ul>{upcoming.map((e) => <EventItem key={e.id} e={e} now={now} onToggle={toggle} onEdit={editEvent} />)}</ul>
          </>
        )}
        {overdue.length > 0 && (
          <>
            <div className="label mt-5">Vergangen und noch offen</div>
            {/* Zuerst nur die jüngsten 3; ältere offene Termine auf Wunsch */}
            <ul>{(allOverdue ? overdue : overdue.slice(-FEW)).map((e) => <EventItem key={e.id} e={e} now={now} onToggle={toggle} onEdit={editEvent} />)}</ul>
            {overdue.length > FEW && <button type="button" className="btn btn-ghost mt-1 w-full" onClick={() => setAllOverdue((v) => !v)}>{allOverdue ? `Nur die letzten ${FEW} zeigen` : `Alle ${overdue.length} offenen zeigen`}</button>}
          </>
        )}
        {done.length > 0 && (
          <>
            <div className="label mt-5">Erledigt</div>
            <ul>{done.map((e) => <EventItem key={e.id} e={e} now={now} onToggle={toggle} onEdit={editEvent} />)}</ul>
          </>
        )}
      </Card>

      <Card className="col-span-12" title="Regeln des Plans" action={<button type="button" className="btn btn-ghost btn-sm" onClick={() => setPlanOpen(true)}><Pencil /> Bearbeiten</button>}>
        {/* Die Zielanteile je Kategorie stehen schon in der Allokation oben; hier nur die eigenen Regeln. */}
        {rules.length === 0 ? (
          <Empty>Keine Regeln. Unter «Bearbeiten» legst du Zielanteile, Obergrenzen und eigene Regeln fest.</Empty>
        ) : (
          <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {rules.map((r) => (
              <li key={r.title} className="rounded-xl border border-line bg-white/[0.02] p-4">
                <div className="text-[11px] font-medium uppercase tracking-[0.07em] text-accent-2">{r.tag || 'Regel'}</div>
                <div className="mt-1.5 text-[14px] font-medium leading-5">{r.title}</div>
                {r.detail && <p className="mt-1.5 text-[12.5px] leading-[1.5] text-muted">{r.detail}</p>}
              </li>
            ))}
          </ul>
        )}
      </Card>
      <PlanSheet key={'plan' + String(planOpen)} open={planOpen} onClose={() => setPlanOpen(false)} />
      <PotSheet key={'pot' + (pot?.n ?? 0)} id={pot?.id ?? null} open={!!pot} onClose={() => setPot(null)} />
      <EventSheet key={'ev' + (ev?.n ?? 0)} id={ev?.id ?? null} open={!!ev} onClose={() => setEv(null)} />
    </div>
  )
}
