import clsx from 'clsx'
import { ArrowDownRight, ArrowUpRight, Minus, Trash2 } from 'lucide-react'
import { motion } from 'motion/react'
import { useId, useState, type ComponentType, type ReactNode } from 'react'
import type { Tone } from '@/lib/calc'
import { pct, sign, sUsd } from '@/lib/format'

/* ------------------------------------------------------------------ Karte */
export function Card({ title, sub, action, children, className, bodyClassName, flush }: {
  title?: ReactNode
  sub?: ReactNode
  action?: ReactNode
  children: ReactNode
  className?: string
  bodyClassName?: string
  /** Inhalt ohne seitlichen Innenabstand (Tabellen) */
  flush?: boolean
}) {
  return (
    <section className={clsx('card flex flex-col', className)}>
      {(title || action) && (
        <header className="card-head">
          <div className="flex min-w-0 flex-wrap items-baseline gap-x-2.5 gap-y-0.5">
            <h2 className="card-title">{title}</h2>
            {sub && <span className="card-sub">{sub}</span>}
          </div>
          {action && <div className="ml-auto flex max-w-full flex-none items-center gap-2 overflow-x-auto [scrollbar-width:none]">{action}</div>}
        </header>
      )}
      <div className={clsx(flush ? 'px-2 pb-2 pt-2' : 'card-body', 'min-w-0 flex-1', bodyClassName)}>{children}</div>
    </section>
  )
}

/* ------------------------------------------------------------------ Status: farbiger Punkt und Wort */
type IconType = ComponentType<{ className?: string; strokeWidth?: number }>
/* ------------------------------------------------------------------ Schalter (statt Checkbox) */
export function Switch({ checked, onChange, label, title, className, ariaLabel }: { checked: boolean; onChange: (v: boolean) => void; label?: ReactNode; title?: string; className?: string; ariaLabel?: string }) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={ariaLabel} title={title} onClick={() => onChange(!checked)} className={clsx('inline-flex flex-none select-none items-center gap-2 rounded-full text-[12.5px] text-ink-2 outline-offset-2', className)}>
      <span className={clsx('relative h-[18px] w-[30px] flex-none rounded-full border transition-colors duration-200', checked ? 'border-transparent bg-accent' : 'border-line-2 bg-white/[0.06]')}>
        <span className={clsx('absolute top-1/2 size-3 -translate-y-1/2 rounded-full shadow-sm transition-[left,background-color] duration-200', checked ? 'left-[14px] bg-white' : 'left-[3px] bg-ink-2')} />
      </span>
      {label}
    </button>
  )
}

export function Chip({ tone = 'mute', children, className, title }: { tone?: Tone | 'down'; icon?: IconType | false; children: ReactNode; className?: string; title?: string }) {
  return (
    <span className={clsx('tag', `tag-${tone}`, className)} title={title}>
      {children}
    </span>
  )
}

/* ------------------------------------------------------------------ Veränderung mit Richtung */
const TONE_TEXT = { up: 'text-up', down: 'text-down', flat: 'text-muted' } as const
export function Delta({ value, kind = 'pct', digits, className, icon = true }: { value: number | null | undefined; kind?: 'pct' | 'usd'; digits?: number; className?: string; icon?: boolean }) {
  const s = sign(value)
  const Icon = s === 'up' ? ArrowUpRight : s === 'down' ? ArrowDownRight : Minus
  return (
    <span className={clsx('num inline-flex items-center gap-0.5 whitespace-nowrap', TONE_TEXT[s], className)}>
      {icon && value != null && <Icon className="size-[1.05em] flex-none" strokeWidth={2.4} />}
      {kind === 'pct' ? pct(value, digits ?? 2) : sUsd(value)}
    </span>
  )
}

/* ------------------------------------------------------------------ Umschalter mit gleitender Marke */
export function Segmented<T extends string>({ value, onChange, options, label, className, fill }: {
  value: T
  onChange: (v: T) => void
  options: { value: T; label: ReactNode; title?: string }[]
  label: string
  className?: string
  /** volle Breite, alle Felder gleich breit (Handy) */
  fill?: boolean
}) {
  const id = useId()
  return (
    <div className={clsx('seg', fill && 'seg-fill', className)} role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" aria-pressed={o.value === value} title={o.title} onClick={() => onChange(o.value)}>
          {o.value === value && <motion.span layoutId={id} className="seg-pill" transition={{ type: 'spring', stiffness: 520, damping: 40 }} />}
          <span className="relative">{o.label}</span>
        </button>
      ))}
    </div>
  )
}

/* ------------------------------------------------------------------ Kennzahl */
export function Stat({ label, value, sub, right, className }: { label: ReactNode; value: ReactNode; sub?: ReactNode; right?: ReactNode; className?: string }) {
  return (
    <div className={clsx('min-w-0 px-5 py-4', className)}>
      <div className="label flex items-center gap-1.5">{label}</div>
      <div className="mt-1.5 flex items-end justify-between gap-3">
        <div className="min-w-0 truncate text-[22px] font-semibold leading-7 tracking-[-0.025em]">{value}</div>
        {right}
      </div>
      {sub && <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12.5px] text-muted">{sub}</div>}
    </div>
  )
}

/* ------------------------------------------------------------------ Titel: Ticker + Name */
export function Ticker({ t, name, className }: { t: string; name?: string; className?: string }) {
  return (
    <div className={clsx('min-w-0', className)}>
      <div className="tk">{t}</div>
      {name && <div className="max-w-[220px] truncate text-[12px] leading-4 text-muted">{name}</div>}
    </div>
  )
}

export function Empty({ title, children }: { title?: string; children?: ReactNode }) {
  return (
    <div className="px-4 py-10 text-center text-[13px] text-muted">
      {title && <div className="mb-1 text-[14px] font-medium text-ink">{title}</div>}
      {children}
    </div>
  )
}

/** Kleine «Testdaten»-Marke für erfundene Werte. */
export function DemoTag({ className }: { className?: string }) {
  return (
    <span className={clsx('inline-flex h-[17px] items-center rounded-[5px] border border-warn/25 bg-warn/10 px-1.5 text-[10px] font-medium uppercase tracking-[0.06em] text-warn', className)}>
      Test
    </span>
  )
}

/* ------------------------------------------------------------------ Löschen mit zweitem Klick */
export function ConfirmDelete({ onConfirm, label }: { onConfirm: () => void; label: string }) {
  const [armed, setArmed] = useState(false)
  return (
    <button
      type="button"
      className={clsx('btn btn-ghost btn-sm', armed && '!text-down')}
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
