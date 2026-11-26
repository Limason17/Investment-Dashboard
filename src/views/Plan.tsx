import { Pencil, Plus } from 'lucide-react'
import { useMemo, useState } from 'react'
import { EventItem, EventStrip } from '@/components/blocks'
import { Allocation } from '@/components/charts/Allocation'
import { Meter } from '@/components/charts/Small'
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
      <Card title="Cash-Töpfe" action={<button type="button" className="btn btn-sm" onClick={() => setPot({ id: null, n: Date.now() })}><Plus /> Topf</button>} bodyClassName="!pt-1">
        {pots.length === 0 ? (
          <Empty>Ein Topf ist ein Budget für geplante Käufe. Käufe daraus zählen automatisch.</Empty>
        ) : (
          <>
            {/* Übersicht als Liste wie im Journal: Name links, Zahl rechts; darunter ein Balken für alle Töpfe zusammen */}
            <div className="grid">
              {([
                ['Frei', budget - used, true],
                ['Eingesetzt', used, false],
                ['Budget', budget, false],
                ...(c.settings.cashExcluded ? [] : [['Cash ohne Topf', c.cash - (budget - used), false] as const]),
              ] as const).map(([label, v, strong]) => (
                <div key={label} className="flex items-baseline justify-between gap-4 border-b border-line py-[8px]">
                  <span className="text-[13px] text-ink-2">{label}</span>
                  <span className={`num text-right ${strong ? 'text-[16px] font-semibold' : 'text-[14px] font-medium'} ${v < -0.005 ? 'text-down' : ''}`}>{usd(Math.abs(v))}</span>
                </div>
              ))}
            </div>
            <Meter className="mt-3" value={budget ? used / budget : 0} height={4} />

            {/* Je Topf eine Zeile: Name und Notiz links, frei rechts; ist etwas eingesetzt, darunter Balken und «eingesetzt / Budget» */}
            <div className="mt-5 flex justify-between border-b border-line pb-1.5 text-[11.5px] text-faint">
              <span>Topf</span>
              <span>frei</span>
            </div>
            <ul>
              {pots.map((p) => {
                const rest = (p.budget || 0) - (p.used || 0)
                const u = p.budget ? (p.used || 0) / p.budget : 0
                return (
                  <li key={p.id} className="border-b border-white/[0.045] last:border-b-0">
                    <button type="button" title="Topf bearbeiten" onClick={() => setPot({ id: p.id, n: Date.now() })} className="grid w-full grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-4 gap-y-1.5 py-3 text-left transition-colors hover:bg-white/[0.03]">
                      <span className="min-w-0">
                        <span className="block break-words text-[13.5px] font-medium">{p.label}</span>
                        {p.note && <span className="mt-0.5 block text-[12px] text-muted">{p.note}</span>}
                      </span>
                      <span className={`num text-[14px] font-semibold ${rest < -0.005 ? 'text-down' : ''}`}>{usd(Math.abs(rest))}</span>
                      {u > 0 && (
                        <span className="col-span-2 flex items-center gap-3">
                          <Meter className="flex-1" value={u} height={3} />
                          <span className="num whitespace-nowrap text-[11.5px] text-muted">{usd(p.used || 0)} / {usd(p.budget)}</span>
                        </span>
                      )}
                    </button>
                  </li>
                )
              })}
            </ul>
          </>
        )}
      </Card>
      </div>

      <Card className="col-span-12 xl:col-span-5" title="Termine" bodyClassName="!pt-1" action={<button type="button" className="btn btn-sm" onClick={() => setEv({ id: null, n: Date.now() })}><Plus /> Termin</button>}>
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
