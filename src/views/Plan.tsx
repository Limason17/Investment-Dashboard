import { Pencil, Plus } from 'lucide-react'
import { useMemo, useState } from 'react'
import { EventItem, EventStrip } from '@/components/blocks'
import { Allocation } from '@/components/charts/Allocation'
import { Meter } from '@/components/charts/Small'
import { Card, Empty } from '@/components/ui'
import { EventSheet, PlanSheet, PotSheet } from '@/features/EditSheets'
import { BUCKETS } from '@/lib/buckets'
import { eventsSorted, isCap, targetOf } from '@/lib/calc'
import { useDepot } from '@/lib/context'
import { pctPlain, usd } from '@/lib/format'
import { mutate } from '@/lib/store'
import { toast } from '@/lib/toast'
import type { DepotEvent, WithId } from '@/lib/types'

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
      <Card title="Allokation" action={<button type="button" className="btn btn-ghost btn-sm" onClick={() => setPlanOpen(true)}><Pencil /> Ziele</button>} sub={c.settings.cashExcluded ? 'Ist gegen Plan, in % der Wertpapiere' : 'Ist gegen Plan, in % vom Gesamtwert'}>
        <Allocation c={c} />
      </Card>
      <Card title="Cash-Töpfe" sub={pots.length ? `${usd(budget - used)} von ${usd(budget)} USD frei` : undefined} action={<button type="button" className="btn btn-sm" onClick={() => setPot({ id: null, n: Date.now() })}><Plus /> Topf</button>}>
        {pots.length === 0 ? (
          <Empty>Keine Töpfe. Ein Topf ist ein Budget für geplante Käufe; Käufe daraus zählen automatisch.</Empty>
        ) : (
          <>
            <div className="rounded-xl border border-line bg-white/[0.02] p-4">
              <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                  <div className="label">Frei in Töpfen</div>
                  <div className="mt-1 text-[26px] font-semibold leading-8 tracking-[-0.03em]">{usd(budget - used)} <span className="text-[13px] font-medium text-muted">USD</span></div>
                </div>
                <div className="text-right text-[12.5px] text-muted">
                  <div><span className="num text-ink-2">{usd(used)}</span> eingesetzt von <span className="num text-ink-2">{usd(budget)}</span></div>
                  <div hidden={c.settings.cashExcluded}>Cash laut Konto <span className="num text-ink-2">{usd(c.cash)}</span>, davon <span className="num text-ink-2">{usd(c.cash - (budget - used))}</span> ohne Topf</div>
                </div>
              </div>
              {/* Ein Abschnitt je Topf, Breite = Budget, gefüllt = eingesetzt */}
              <div className="mt-3.5 flex h-2 gap-[3px]" role="img" aria-label={`Töpfe nach Budget, gefüllt ist der eingesetzte Teil: ${pctPlain(budget ? used / budget : 0, 0)} eingesetzt`}>
                {pots.filter((p) => p.budget > 0).map((p) => (
                  <div key={p.id} title={`${p.label}: ${usd(p.used || 0)} von ${usd(p.budget)} eingesetzt`} className="relative min-w-[3px] basis-0 overflow-hidden rounded-full bg-white/[0.08]" style={{ flexGrow: p.budget }}>
                    <div className="absolute inset-y-0 left-0 rounded-full bg-accent" style={{ width: `${Math.min((p.used || 0) / p.budget, 1) * 100}%` }} />
                  </div>
                ))}
              </div>
            </div>
            <ul className="mt-2 divide-y divide-white/[0.045]">
              {pots.map((p) => {
                const rest = (p.budget || 0) - (p.used || 0)
                const u = p.budget ? (p.used || 0) / p.budget : 0
                return (
                  <li key={p.id} className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-2 py-3.5">
                    <div className="min-w-0">
                      <button type="button" title="Topf bearbeiten" className="text-left text-[13.5px] font-medium underline-offset-4 hover:underline" onClick={() => setPot({ id: p.id, n: Date.now() })}>{p.label}</button>
                      {p.note && <div className="mt-0.5 text-[12.5px] text-muted">{p.note}</div>}
                    </div>
                    <div className="text-right leading-tight">
                      <div className="num text-[13.5px] font-medium">{usd(rest)} <span className="font-normal text-muted">frei</span></div>
                      <div className="num mt-0.5 text-[12px] text-muted">von {usd(p.budget)}{u > 0 && ` · ${pctPlain(u, 0)} eingesetzt`}</div>
                    </div>
                    <Meter className="col-span-2" value={u} height={5} />
                  </li>
                )
              })}
            </ul>
          </>
        )}
      </Card>
      </div>

      <Card className="col-span-12 xl:col-span-5" title="Termine" sub="Quartalszahlen, geplante Käufe, Stichtage" bodyClassName="!pt-1" action={<button type="button" className="btn btn-sm" onClick={() => setEv({ id: null, n: Date.now() })}><Plus /> Termin</button>}>
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
            <ul>{overdue.map((e) => <EventItem key={e.id} e={e} now={now} onToggle={toggle} onEdit={editEvent} />)}</ul>
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
        <div className="mb-4 flex flex-wrap gap-2">
          {BUCKETS.map((b) => (
            <span key={b.id} className="inline-flex items-center gap-2 rounded-full border border-line bg-white/[0.025] py-1 pl-2.5 pr-3 text-[12.5px]">
              <i className="swatch" style={{ background: b.color }} />
              <span className="text-ink-2">{b.name}</span>
              <span className="num font-medium">{targetOf(c.settings, b.id) == null ? 'kein Ziel' : (isCap(c.settings, b.id) ? 'max ' : '') + pctPlain(targetOf(c.settings, b.id), 0)}</span>
            </span>
          ))}
        </div>
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
