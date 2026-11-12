import clsx from 'clsx'
import { CalendarClock, ChartNoAxesColumn, Check, ChevronRight, CircleDot, Eye, Flag, Layers, OctagonAlert, Target, TriangleAlert, type LucideIcon } from 'lucide-react'
import type { Attention, WatchRow } from '@/lib/calc'
import { daysBetween, pct, usd, weekday } from '@/lib/format'
import type { DepotEvent, WithId } from '@/lib/types'
import { LimitTrack } from './charts/Small'
import { Chip, DemoTag } from './ui'

/* ------------------------------------------------------------------ Termin */
const KIND_ICON: Record<NonNullable<DepotEvent['kind']>, LucideIcon> = { zahlen: ChartNoAxesColumn, tranche: Layers, stichtag: Flag, pruefen: Eye, termin: CalendarClock }
const KIND_LABEL: Record<NonNullable<DepotEvent['kind']>, string> = { zahlen: 'Quartalszahlen', tranche: 'Tranche', stichtag: 'Stichtag', pruefen: 'Prüfen', termin: 'Termin' }

const relDay = (date: string, now: string) => {
  const d = daysBetween(now, date)
  if (d === 0) return 'heute'
  if (d === 1) return 'morgen'
  if (d > 1 && d <= 21) return `in ${d} Tagen`
  if (d < 0 && d >= -60) return d === -1 ? 'gestern' : `vor ${-d} Tagen`
  return null
}

export function EventItem({ e, now, onToggle, onEdit, compact }: { e: WithId<DepotEvent>; now: string; onToggle?: (e: WithId<DepotEvent>) => void; onEdit?: (e: WithId<DepotEvent>) => void; compact?: boolean }) {
  const [y, m, d] = e.date.split('-')
  const past = e.date < now
  const Icon = KIND_ICON[e.kind ?? 'termin']
  const rel = relDay(e.date, now)
  return (
    <li className={clsx('grid grid-cols-[50px_minmax(0,1fr)_auto] items-start gap-3 border-b border-white/[0.045] py-3 last:border-b-0', e.done && 'opacity-55')}>
      <div className="text-center leading-tight">
        <div className="num text-[15px] font-semibold tracking-[-0.02em]">{d}.{m}.</div>
        <div className="text-[11px] text-muted">{weekday(e.date)} {y.slice(2)}</div>
      </div>
      <div className="min-w-0">
        <div className="flex items-center gap-1.5 text-[13.5px] font-medium leading-5">
          <Icon className="size-3.5 flex-none text-muted" strokeWidth={2} aria-label={KIND_LABEL[e.kind ?? 'termin']} />
          {onEdit ? (
            <button type="button" title="Termin bearbeiten" onClick={() => onEdit(e)} className={clsx('truncate text-left underline-offset-4 hover:underline', e.done && 'line-through decoration-white/30')}>{e.title}</button>
          ) : (
            <span className={clsx('truncate', e.done && 'line-through decoration-white/30')}>{e.title}</span>
          )}
        </div>
        {e.detail && <div className={clsx('mt-0.5 text-[12.5px] leading-[1.45] text-muted', compact && 'line-clamp-2')}>{e.detail}</div>}
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5 empty:hidden">
          {e.done ? <Chip tone="up">erledigt</Chip> : past ? <Chip tone="warn">offen</Chip> : e.tentative ? <Chip tone="mute">unbestätigt</Chip> : null}
          {rel && !e.done && <span className="text-[11.5px] text-muted">{rel}</span>}
          {e.demo && <DemoTag />}
        </div>
      </div>
      {onToggle && (
        <button
          type="button"
          onClick={() => onToggle(e)}
          aria-label={e.done ? 'Wieder öffnen' : 'Als erledigt markieren'}
          title={e.done ? 'Wieder öffnen' : 'Als erledigt markieren'}
          className={clsx('relative mt-0.5 grid size-6 place-items-center rounded-full border transition-colors before:absolute before:-inset-2.5 before:content-[""]', e.done ? 'border-up/40 bg-up/15 text-up' : 'border-line-2 text-transparent hover:border-white/30 hover:text-muted')}
        >
          <Check className="size-3.5" strokeWidth={2.6} />
        </button>
      )}
    </li>
  )
}

/* ------------------------------------------------------------------ Termine als Zeitstrahl */
/** Die nächsten Wochen auf einer Linie: ein Punkt je Termin, Striche im Wochenabstand. Gefüllt = bestätigt, Ring = unbestätigt. */
export function EventStrip({ events, now, days = 56, className }: { events: WithId<DepotEvent>[]; now: string; days?: number; className?: string }) {
  const list = events.filter((e) => !e.done && e.date >= now && daysBetween(now, e.date) <= days)
  if (!list.length) return null
  const lanes: number[] = []
  const dots = list.map((e) => {
    const x = daysBetween(now, e.date) / days
    let lane = lanes.findIndex((last) => x - last >= 0.035)
    if (lane < 0) lane = Math.min(lanes.length, 2)
    lanes[lane] = x
    return { e, x, lane }
  })
  const weeks = Array.from({ length: Math.floor(days / 7) + 1 }, (_, i) => i * 7)
  return (
    <div className={clsx('px-2', className)} role="img" aria-label={`${list.length} ${list.length === 1 ? 'Termin' : 'Termine'} in den nächsten ${Math.round(days / 7)} Wochen`}>
      <div className="relative" style={{ height: 10 + lanes.length * 11 }}>
        <div className="absolute inset-x-0 bottom-0 h-px bg-line-2" />
        {weeks.map((w) => <i key={w} className="absolute bottom-0 h-[5px] w-px bg-line-2" style={{ left: `${(w / days) * 100}%` }} />)}
        {dots.map(({ e, x, lane }) => (
          <span
            key={e.id}
            title={`${e.date.slice(8)}.${e.date.slice(5, 7)}. ${e.title}`}
            className={clsx('absolute size-[7px] -translate-x-1/2 rounded-full', e.tentative ? 'border border-accent-2/80 bg-card' : 'bg-accent shadow-[0_0_8px_rgb(143_125_255/0.55)]')}
            style={{ left: `${x * 100}%`, bottom: 5 + lane * 11 }}
          />
        ))}
      </div>
      <div className="mt-1.5 flex justify-between text-[10.5px] leading-none text-faint">
        <span>heute</span>
        <span>in {Math.round(days / 14)} Wochen</span>
        <span>in {Math.round(days / 7)} Wochen</span>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ Hinweis, der eine Handlung braucht */
const ATT_ICON: Record<Attention['kind'], LucideIcon> = { Achtung: OctagonAlert, Prüfen: TriangleAlert, Grenze: Target, Offen: CircleDot, Bald: CalendarClock }
const ATT_TILE: Record<Attention['tone'], string> = {
  down: 'bg-down/12 text-down border-down/20',
  warn: 'bg-warn/12 text-warn border-warn/20',
  up: 'bg-up/12 text-up border-up/20',
  info: 'bg-accent/12 text-accent-2 border-accent/20',
  mute: 'bg-white/[0.05] text-ink-2 border-line',
}
export function AlertItem({ a, onClick }: { a: Attention; onClick?: () => void }) {
  const Icon = ATT_ICON[a.kind]
  const Tag = onClick ? 'button' : 'div'
  return (
    <Tag type={onClick ? 'button' : undefined} onClick={onClick} className={clsx('card group grid min-h-[56px] w-full grid-cols-[32px_minmax(0,1fr)_auto] items-center gap-3 !rounded-[14px] px-3 py-2.5 text-left transition-colors', onClick && 'hover:border-line-2')}>
      <span className={clsx('grid size-8 place-items-center rounded-[10px] border', ATT_TILE[a.tone])}>
        <Icon className="size-4" strokeWidth={2} />
      </span>
      <span className="min-w-0">
        <span className="block truncate text-[13.5px] font-medium leading-5">{a.title}</span>
        <span className="block truncate text-[12.5px] leading-[1.45] text-muted">{a.detail}</span>
      </span>
      {onClick && <ChevronRight className="size-4 text-faint transition-transform group-hover:translate-x-0.5 group-hover:text-muted" />}
    </Tag>
  )
}

/* ------------------------------------------------------------------ Titel an seiner Kaufgrenze */
export function LimitRow({ r, onClick }: { r: WatchRow; onClick: () => void }) {
  const under = r.s.d != null && r.s.d <= 0
  return (
    <button type="button" onClick={onClick} className="group block w-full rounded-xl px-2.5 py-2.5 text-left transition-colors hover:bg-white/[0.035]">
      <span className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-4">
        <span className="min-w-0">
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="tk">{r.w.ticker}</span>
            <Chip tone={r.s.tone}>{r.s.label}</Chip>
          </span>
          <span className="mt-0.5 block truncate text-[12px] leading-4 text-muted">{r.w.name}</span>
        </span>
        <span className="text-right leading-tight">
          <span className={clsx('num block text-[15px] font-semibold tracking-[-0.01em]', under ? 'text-up' : 'text-ink')}>{pct(r.s.d, 1)}</span>
          <span className="num mt-0.5 block text-[11.5px] text-muted">{usd(r.px)} <span className="text-faint">/</span> {usd(r.w.limit)}</span>
        </span>
      </span>
      <span className="mt-2 block"><LimitTrack d={r.s.d} tone={r.s.tone} width="100%" /></span>
    </button>
  )
}
