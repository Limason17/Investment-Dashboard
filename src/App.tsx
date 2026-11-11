import clsx from 'clsx'
import { Briefcase, CalendarRange, CircleUser, Coins, LayoutDashboard, NotebookPen, Plus, RefreshCw, Search, Target, type LucideIcon } from 'lucide-react'
import { AnimatePresence, motion, MotionConfig } from 'motion/react'
import { useCallback, useEffect, useId, useMemo, useState } from 'react'
import { Toaster } from '@/components/Sheet'
import { AccountSheet, AuthScreen } from '@/features/Account'
import { CommandPalette } from '@/features/CommandPalette'
import { useAccount } from '@/lib/cloud'
import { CLOUD } from '@/lib/config'
import { PositionSheet, WatchSheet } from '@/features/DetailSheets'
import { EntrySheet } from '@/features/EntrySheet'
import { compute, withLive, type Calc } from '@/lib/calc'
import { refreshCharts } from '@/lib/charts'
import { DepotContext, NavContext, type EntryType, type Nav } from '@/lib/context'
import type { ImportKind } from '@/lib/bulk'
import { exportCsv } from '@/lib/export'
import { daysBetween, dfmt, today, weekday } from '@/lib/format'
import { initStore, loadDb, refreshAll, useStore } from '@/lib/store'
import { toast } from '@/lib/toast'
import type { DB, LiveResult, ViewId } from '@/lib/types'
import { Dividends } from '@/views/Dividends'
import { Journal } from '@/views/Journal'
import { Overview } from '@/views/Overview'
import { Plan } from '@/views/Plan'
import { Positions } from '@/views/Positions'
import { Watchlist } from '@/views/Watchlist'

const VIEWS: { id: ViewId; label: string; short: string; icon: LucideIcon; sub: string }[] = [
  { id: 'uebersicht', label: 'Übersicht', short: 'Übersicht', icon: LayoutDashboard, sub: 'Wert, Limits und die nächsten Termine' },
  { id: 'positionen', label: 'Positionen', short: 'Positionen', icon: Briefcase, sub: 'Bausteine, Kursentwicklung und Bestand' },
  { id: 'limits', label: 'Limits & Watchlist', short: 'Limits', icon: Target, sub: 'Kandidaten mit Kaufgrenze und Bedingung' },
  { id: 'dividenden', label: 'Dividenden', short: 'Dividenden', icon: Coins, sub: 'Erhalten, erwartet und Prognose' },
  { id: 'plan', label: 'Plan & Termine', short: 'Plan', icon: CalendarRange, sub: 'Allokation, Cash-Töpfe, Termine und Regeln' },
  { id: 'journal', label: 'Journal', short: 'Journal', icon: NotebookPen, sub: 'Buchungen, Entscheide und Notizen' },
]
const isView = (v: string): v is ViewId => VIEWS.some((x) => x.id === v)
const viewFromHash = (): ViewId => {
  const h = location.hash.replace(/^#\/?/, '')
  return isView(h) ? h : 'uebersicht'
}
const LONG_MONTHS = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember']
const WEEKDAY_LONG: Record<string, string> = { Mo: 'Montag', Di: 'Dienstag', Mi: 'Mittwoch', Do: 'Donnerstag', Fr: 'Freitag', Sa: 'Samstag', So: 'Sonntag' }

/* ------------------------------------------------------------------ Marke und Datenstand */
/** Konto (online) oder Backup (lokal) in der Seitenleiste. */
function AccountButton({ onClick }: { onClick: () => void }) {
  const { user } = useAccount()
  const label = CLOUD ? user?.name || user?.email || 'Konto' : 'Daten hochladen und sichern'
  return (
    <button type="button" onClick={onClick} className="flex h-9 w-full items-center gap-2.5 rounded-[10px] px-2.5 text-[13px] text-ink-2 transition-colors hover:bg-white/[0.04] hover:text-ink">
      <CircleUser className="size-4 flex-none text-muted" />
      <span className="truncate">{label}</span>
    </button>
  )
}

function Brand({ compact }: { compact?: boolean }) {
  // Eigene Id je Logo: Die Seitenleiste ist auf dem Handy ausgeblendet, ein geteilter Verlauf würde dort fehlen.
  const grad = useId()
  return (
    <div className="flex items-center gap-3">
      <div className={clsx('relative grid place-items-center rounded-[11px] border border-white/10 bg-gradient-to-b from-[#1b1e28] to-[#0c0d11] shadow-[inset_0_1px_0_rgb(255_255_255/0.08),0_6px_16px_-6px_rgb(143_155_255/0.45)]', compact ? 'size-8' : 'size-9')}>
        <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
          <defs><linearGradient id={grad} x1="0" y1="1" x2="1" y2="0"><stop offset="0" stopColor="#8f9bff" /><stop offset="1" stopColor="#e3e6ff" /></linearGradient></defs>
          <path d="M2.5 13 6.6 8.2l3 2.3L15 4.5" fill="none" stroke={`url(#${grad})`} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          <circle cx="15" cy="4.5" r="1.7" fill="#eef0ff" />
        </svg>
      </div>
      <div className="leading-tight">
        <div className="text-[14.5px] font-semibold tracking-[-0.015em]">{CLOUD ? 'Depot' : 'Depot Liam'}</div>
        <div className="text-[11.5px] text-muted">{CLOUD ? 'Portfolio · USD' : 'Schwab · USD'}</div>
      </div>
    </div>
  )
}

const isStale = (c: Calc, now: string) => (c.lastDate ? daysBetween(c.lastDate, now) > 4 : true)
const statusText = (c: Calc, now: string, live: LiveResult | null) =>
  live && !isStale(c, now) ? c.priceLabel : c.lastDate ? (isStale(c, now) ? 'Kurse vom ' : 'Schlusskurse ') + dfmt(c.lastDate) : 'Noch keine Kurse'

function StatusDot({ stale, live }: { stale: boolean; live: boolean }) {
  return (
    <span className="relative flex size-2 flex-none">
      {live && !stale && <span className="absolute inline-flex size-full animate-ping rounded-full bg-up opacity-50 [animation-duration:2.4s]" />}
      <span className={clsx('relative inline-flex size-2 rounded-full', stale ? 'bg-warn' : 'bg-up')} />
    </span>
  )
}

function DataStatus({ db, c, now, live }: { db: DB; c: Calc; now: string; live: LiveResult | null }) {
  const s = c.settings
  const m = db.market.latest
  const stale = isStale(c, now)
  const refreshed = m?.refreshedAt?.slice(0, 10) ?? s.refresh?.at
  const by = m?.by ?? s.refresh?.by
  return (
    <div className="rounded-xl border border-line bg-white/[0.025] p-3.5">
      <div className="flex items-center gap-2 text-[12.5px] font-medium">
        <StatusDot stale={stale} live={c.live} />
        {statusText(c, now, live)}
      </div>
      {live ? (
        <div className="mt-1 pl-4 text-[11.5px] text-muted">
          Yahoo Finance{live.overnight === 'aktiv' ? ' und Alpaca' : ''} · {c.live ? 'alle 20 s' : 'alle 5 min'}
          {live.overnight === 'kein Schlüssel' && <div className="text-faint" title="Kurse der Overnight-Sitzung brauchen einen Alpaca-Schlüssel, siehe README">Overnight-Kurse nicht eingerichtet</div>}
          {live.overnight === 'fehler' && <div className="text-warn">Overnight-Abfrage fehlgeschlagen</div>}
        </div>
      ) : refreshed && <div className="mt-1 pl-4 text-[11.5px] text-muted">Abgleich {dfmt(refreshed)}{by ? ' · ' + by : ''}</div>}
      {m?.status && m.status !== 'ok' && <div className="mt-1 pl-4 text-[11.5px] text-warn">{m.status === 'fehler' ? 'Abgleich fehlgeschlagen' : 'Abgleich unvollständig'}</div>}
      {s.demo && (
        <div className="mt-3 border-t border-line pt-3">
          <div className="inline-flex h-[19px] items-center rounded-md border border-warn/25 bg-warn/10 px-1.5 text-[10.5px] font-medium uppercase tracking-[0.07em] text-warn">Testdaten aktiv</div>
          <p className="mt-1.5 text-[11.5px] leading-[1.45] text-muted">Einstände, ältere Buchungen und Dividenden sind erfunden; Bestand, Limits und Töpfe: Stand 22.10.2026. Kurse und Verläufe sind echt.</p>
        </div>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ Navigation */
function SideNav({ view, goto, counts }: { view: ViewId; goto: (v: ViewId) => void; counts: Partial<Record<ViewId, number>> }) {
  return (
    <>
      {VIEWS.map((v, i) => {
        const active = v.id === view
        return (
          <button
            key={v.id}
            type="button"
            onClick={() => goto(v.id)}
            aria-current={active ? 'page' : undefined}
            className={clsx('group relative flex h-[38px] w-full items-center gap-2.5 whitespace-nowrap rounded-[10px] px-3 text-[13.5px] font-medium transition-colors', active ? 'text-ink' : 'text-muted hover:text-ink')}
          >
            {active && (
              <motion.span layoutId="nav-v" className="absolute inset-0 rounded-[10px] border border-white/[0.07] bg-white/[0.06] shadow-[inset_0_1px_0_rgb(255_255_255/0.06)]" transition={{ type: 'spring', stiffness: 480, damping: 40 }}>
                <span className="absolute -left-[13px] top-1/2 h-4 w-[3px] -translate-y-1/2 rounded-full bg-accent shadow-[0_0_12px_rgb(143_155_255/0.9)]" />
              </motion.span>
            )}
            <v.icon className={clsx('relative size-4 flex-none transition-colors', active ? 'text-accent-2' : 'text-faint group-hover:text-muted')} strokeWidth={2} />
            <span className="relative">{v.label}</span>
            <span className="relative ml-auto flex items-center gap-2">
              {counts[v.id] != null && <span className="num text-[11.5px] font-normal text-faint">{counts[v.id]}</span>}
              <span className="kbd opacity-0 transition-opacity group-hover:opacity-100">{i + 1}</span>
            </span>
          </button>
        )
      })}
    </>
  )
}

/** Handy und Tablet: Leiste am unteren Rand, mit dem Daumen erreichbar. */
function TabBar({ view, goto }: { view: ViewId; goto: (v: ViewId) => void }) {
  return (
    <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-[#08090c]/88 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl lg:hidden" aria-label="Ansichten">
      <div className="mx-auto grid max-w-2xl grid-cols-6">
        {VIEWS.map((v) => {
          const active = v.id === view
          return (
            <button key={v.id} type="button" onClick={() => goto(v.id)} aria-current={active ? 'page' : undefined} className={clsx('relative flex h-[58px] min-w-0 flex-col items-center justify-center gap-[5px] transition-colors', active ? 'text-ink' : 'text-muted')}>
              {active && <motion.span layoutId="nav-b" className="absolute top-0 h-[2px] w-9 rounded-full bg-accent shadow-[0_0_12px_rgb(143_155_255/0.9)]" transition={{ type: 'spring', stiffness: 480, damping: 40 }} />}
              <v.icon className={clsx('size-[20px]', active ? 'text-accent-2' : 'text-muted')} strokeWidth={active ? 2.1 : 1.9} />
              <span className="max-w-full truncate px-0.5 text-[10px] font-medium leading-none tracking-[-0.01em]">{v.short}</span>
            </button>
          )
        })}
      </div>
    </nav>
  )
}

/* ------------------------------------------------------------------ App */
/** Online: erst anmelden, dann das Dashboard. Lokal: direkt das Dashboard. */
export default function App() {
  const acc = useAccount()
  useEffect(() => {
    if (CLOUD && acc.status === 'in') void initStore()
  }, [acc.status])
  if (!CLOUD) return <Dashboard />
  if (acc.status === 'loading') return <div className="grid min-h-dvh place-items-center"><Brand /></div>
  if (acc.status === 'out') return <AuthScreen brand={<Brand />} />
  return <Dashboard />
}

function Dashboard() {
  const { db: stored, error, live } = useStore()
  const db = useMemo(() => (stored ? withLive(stored, live) : null), [stored, live])
  const [view, setView] = useState<ViewId>(viewFromHash)
  const [palette, setPalette] = useState(false)
  const [entry, setEntry] = useState<{ open: boolean; n: number; type: EntryType; fromId?: string; ticker?: string; kind?: ImportKind; text?: string }>({ open: false, n: 0, type: 'kauf' })
  const [posT, setPosT] = useState<string | null>(null)
  const [watchT, setWatchT] = useState<string | null>(null)
  const [accountOpen, setAccountOpen] = useState(false)
  const now = today()
  const [refreshing, setRefreshing] = useState(false)
  const refresh = useCallback(async () => {
    if (refreshing) return
    setRefreshing(true)
    const r = await refreshAll()
    refreshCharts()
    setRefreshing(false)
    const n = r.live ? Object.keys(r.live.quotes).length : 0
    if (!r.ok || r.error) toast('Aktualisieren fehlgeschlagen' + (r.error ? ': ' + r.error : '. Es gelten die gespeicherten Kurse.'))
    else if (r.live?.failures.length) toast(`${n} Kurse aktualisiert, ${r.live.failures.length} ohne Kurs: ${r.live.failures.map((f) => f.split(' ')[0]).join(', ')}`)
    else toast(`Alle ${n} Kurse und Daten aktualisiert.`)
  }, [refreshing])

  const goto = useCallback((v: ViewId) => {
    if (location.hash.replace(/^#\/?/, '') !== v) location.hash = v
    setView(v)
    window.scrollTo({ top: 0 })
  }, [])
  useEffect(() => {
    const onHash = () => {
      setView(viewFromHash())
      window.scrollTo({ top: 0 })
    }
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  const nav: Nav = useMemo(
    () => ({
      view,
      goto,
      openPosition: (t) => { setWatchT(null); setPosT(t) },
      openWatch: (t) => { setPosT(null); setWatchT(t) },
      openEntry: (type = 'kauf', opt) => setEntry((e) => ({ open: true, n: e.n + 1, type, fromId: opt?.fromId, ticker: opt?.ticker, kind: opt?.kind, text: opt?.text })),
    }),
    [view, goto],
  )

  const c = useMemo(() => (db ? compute(db) : null), [db])
  const anyDialog = palette || entry.open || !!posT || !!watchT

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setPalette((p) => !p)
        return
      }
      const el = e.target as HTMLElement | null
      if (anyDialog || e.ctrlKey || e.metaKey || e.altKey || (el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))) return
      const n = Number(e.key)
      if (n >= 1 && n <= VIEWS.length) goto(VIEWS[n - 1].id)
      else if (e.key === '+' || e.key.toLowerCase() === 'n') nav.openEntry('kauf')
      else if (e.key.toLowerCase() === 'r') void refresh()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [anyDialog, goto, nav, refresh])

  if (!db || !c) {
    return (
      <div className="grid min-h-dvh place-items-center px-6">
        <div className="text-center">
          <div className="mx-auto mb-5 w-fit"><Brand /></div>
          {error ? (
            <>
              <p className="max-w-sm text-[13.5px] text-ink-2">Die Daten sind nicht erreichbar: {error}</p>
              <button type="button" className="btn mt-4" onClick={() => void loadDb()}><RefreshCw /> Erneut versuchen</button>
            </>
          ) : (
            <p className="animate-pulse text-[13px] text-muted">Daten werden geladen …</p>
          )}
        </div>
      </div>
    )
  }

  const meta = VIEWS.find((v) => v.id === view)!
  const counts: Partial<Record<ViewId, number>> = { positionen: c.rows.length, limits: Object.keys(db.watchlist).length }
  const dateLine = `${WEEKDAY_LONG[weekday(now)]}, ${Number(now.slice(8))}. ${LONG_MONTHS[Number(now.slice(5, 7)) - 1]} ${now.slice(0, 4)}`
  const stale = isStale(c, now)

  return (
    <MotionConfig reducedMotion="user">
      <DepotContext.Provider value={{ db, c, now }}>
        <NavContext.Provider value={nav}>
          {/* Seitenleiste (ab 1024px) */}
          <aside className="fixed inset-y-0 left-0 z-30 hidden w-[252px] flex-col border-r border-line bg-[#08090c]/70 px-4 pb-4 pt-5 backdrop-blur-xl lg:flex">
            <div className="px-1.5"><Brand /></div>
            <button type="button" onClick={() => setPalette(true)} className="mt-5 flex h-9 w-full items-center gap-2.5 rounded-[10px] border border-line bg-white/[0.03] px-3 text-[13px] text-muted transition-colors hover:border-line-2 hover:text-ink-2">
              <Search className="size-3.5" /> Suchen
              <span className="ml-auto flex gap-1"><span className="kbd">Ctrl</span><span className="kbd">K</span></span>
            </button>
            <nav className="mt-5 grid gap-0.5" aria-label="Ansichten">
              <SideNav view={view} goto={goto} counts={counts} />
            </nav>
            <div className="mt-auto grid gap-2">
              <AccountButton onClick={() => setAccountOpen(true)} />
              <DataStatus db={db} c={c} now={now} live={live} />
            </div>
          </aside>

          <div className="lg:pl-[252px]">
            {/* Kopf für Handy und Tablet: Marke, Datenstand, Suche, Aktualisieren */}
            <div className="flex items-center justify-between gap-3 px-4 pt-[max(12px,env(safe-area-inset-top))] sm:px-6 lg:hidden">
              <Brand compact />
              <div className="flex min-w-0 items-center gap-1.5">
                <span className="mr-1 inline-flex min-w-0 items-center gap-1.5 text-[11.5px] text-muted" title={c.settings.demo ? 'Testdaten aktiv' : undefined}>
                  <StatusDot stale={stale} live={c.live} />
                  <span className="truncate">{statusText(c, now, live)}</span>
                </span>
                <button type="button" className="btn btn-ghost btn-icon" onClick={() => setPalette(true)} aria-label="Suchen"><Search /></button>
                <button type="button" className="btn btn-ghost btn-icon" onClick={() => setAccountOpen(true)} aria-label={CLOUD ? 'Konto und Daten' : 'Daten'}><CircleUser /></button>
                <button type="button" className="btn btn-ghost btn-icon" onClick={() => void refresh()} disabled={refreshing} aria-label="Kurse und Daten aktualisieren"><RefreshCw className={clsx(refreshing && 'animate-spin')} /></button>
              </div>
            </div>

            <main className="mx-auto max-w-[1440px] px-3 pb-[calc(104px+env(safe-area-inset-bottom))] sm:px-6 lg:px-9 lg:pb-14">
              <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3 px-1 pb-4 pt-5 sm:px-0 sm:pb-6 lg:pt-8 [@media(max-height:800px)]:lg:pb-4 [@media(max-height:800px)]:lg:pt-5">
                <div className="min-w-0">
                  <div className="text-[12.5px] text-muted">{dateLine}{c.settings.demo && <span className="ml-2 inline-flex h-[17px] items-center rounded-[5px] border border-warn/25 bg-warn/10 px-1.5 align-middle text-[10px] font-medium uppercase tracking-[0.06em] text-warn lg:hidden">Testdaten</span>}</div>
                  <h1 className="mt-1 text-[24px] font-semibold leading-8 tracking-[-0.03em] sm:text-[26px]">{meta.label}</h1>
                  <p className="mt-1 text-[13.5px] text-muted max-sm:hidden [@media(max-height:800px)]:hidden">{meta.sub}</p>
                </div>
                <div className="hidden items-center gap-2 lg:flex">
                  <button type="button" className="btn" onClick={() => void refresh()} disabled={refreshing} title="Kurse und Daten jetzt neu holen (R)"><RefreshCw className={clsx(refreshing && 'animate-spin')} /> {refreshing ? 'Aktualisiere …' : 'Aktualisieren'}</button>
                  <button type="button" className="btn btn-primary" onClick={() => nav.openEntry('kauf')} title="Kauf, Verkauf, Dividende, Cash oder Notiz erfassen (N)"><Plus /> Eintrag</button>
                </div>
              </header>

              <AnimatePresence mode="wait" initial={false}>
                <motion.div key={view} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}>
                  {view === 'uebersicht' && <Overview />}
                  {view === 'positionen' && <Positions />}
                  {view === 'limits' && <Watchlist />}
                  {view === 'dividenden' && <Dividends />}
                  {view === 'plan' && <Plan />}
                  {view === 'journal' && <Journal />}
                </motion.div>
              </AnimatePresence>

              <footer className="mx-auto mt-10 max-w-3xl px-2 text-center text-[12px] leading-[1.6] text-faint sm:mt-12">
                Analyse-Werkzeug, keine Anlageberatung und keine Orderausführung. Massgebend sind die Kontoauszüge deines Brokers.
                <br />Kurse und Verläufe: Yahoo Finance (inoffiziell), splitbereinigt, ohne Dividenden. Der Wertverlauf ist aus den Buchungen nachgerechnet.
              </footer>
            </main>
          </div>

          {/* Handy: neuer Eintrag mit dem Daumen */}
          <button type="button" onClick={() => nav.openEntry('kauf')} aria-label="Neuer Eintrag" className="fixed bottom-[calc(72px+env(safe-area-inset-bottom))] right-4 z-30 grid size-[52px] place-items-center rounded-full bg-gradient-to-b from-white to-[#dfe2ee] text-[#0b0c10] shadow-[inset_0_1px_0_#fff,0_2px_4px_rgb(0_0_0/0.5),0_14px_30px_-8px_rgb(143_155_255/0.6)] transition-transform active:scale-95 lg:hidden">
            <Plus className="size-6" strokeWidth={2.2} />
          </button>
          <TabBar view={view} goto={goto} />

          <EntrySheet key={entry.n} open={entry.open} type={entry.type} fromId={entry.fromId} ticker={entry.ticker} kind={entry.kind} text={entry.text} onClose={() => setEntry((e) => ({ ...e, open: false }))} />
          <PositionSheet key={'p' + (posT ?? '')} ticker={posT} onClose={() => setPosT(null)} />
          <WatchSheet key={'w' + (watchT ?? '')} ticker={watchT} onClose={() => setWatchT(null)} />
          <CommandPalette open={palette} onOpenChange={setPalette} views={VIEWS} onExport={() => exportCsv(c)} onRefresh={() => void refresh()} onAccount={() => setAccountOpen(true)} />
          <AccountSheet open={accountOpen} onClose={() => setAccountOpen(false)} />
          <Toaster />
        </NavContext.Provider>
      </DepotContext.Provider>
    </MotionConfig>
  )
}
