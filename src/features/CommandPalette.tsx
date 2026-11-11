import * as Dialog from '@radix-ui/react-dialog'
import { Command } from 'cmdk'
import { Download, Plus, RefreshCw, Search, type LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { useDepot, useNav, type EntryType } from '@/lib/context'
import type { ViewId } from '@/lib/types'

const ENTRIES: { type: EntryType; label: string }[] = [
  { type: 'kauf', label: 'Kauf erfassen' },
  { type: 'verkauf', label: 'Verkauf erfassen' },
  { type: 'dividende', label: 'Dividende erfassen' },
  { type: 'einzahlung', label: 'Ein- oder Auszahlung erfassen' },
  { type: 'notiz', label: 'Notiz schreiben' },
  { type: 'import', label: 'Massen-Import: Bestand, Käufe, Dividenden, Schwab-CSV' },
]

const Item = ({ value, onSelect, children }: { value: string; onSelect: () => void; children: ReactNode }) => (
  <Command.Item value={value} onSelect={onSelect}>{children}</Command.Item>
)

/** Schnellsuche: Ansichten, Titel und Aktionen über die Tastatur (Ctrl K). */
export function CommandPalette({ open, onOpenChange, views, onExport, onRefresh }: {
  open: boolean
  onOpenChange: (o: boolean) => void
  views: { id: ViewId; label: string; icon: LucideIcon }[]
  onExport: () => void
  onRefresh: () => void
}) {
  const { db } = useDepot()
  const nav = useNav()
  // Erst schliessen, dann ausführen.
  const run = (fn: () => void) => () => {
    onOpenChange(false)
    fn()
  }
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[60] animate-[overlay-in_.15s_ease-out] bg-black/55 backdrop-blur-[3px]" />
        <Dialog.Content aria-describedby={undefined} className="fixed inset-x-0 top-[16vh] z-[61] mx-auto w-[min(620px,calc(100vw-24px))] animate-[pop-in_.18s_var(--ease-out-soft)] overflow-hidden rounded-2xl border border-line-2 bg-[#101216] shadow-[0_30px_80px_-10px_rgb(0_0_0/0.85),inset_0_1px_0_rgb(255_255_255/0.05)] outline-none">
          <Dialog.Title className="sr-only">Suchen und springen</Dialog.Title>
          <Command loop>
            <div className="relative">
              <Search className="pointer-events-none absolute left-[18px] top-1/2 size-4 -translate-y-1/2 text-muted" />
              <Command.Input placeholder="Titel, Ansicht oder Aktion suchen" />
            </div>
            <Command.List>
              <Command.Empty>Nichts gefunden.</Command.Empty>
              <Command.Group heading="Ansichten">
                {views.map((v) => (
                  <Item key={v.id} value={'ansicht ' + v.label} onSelect={run(() => nav.goto(v.id))}><v.icon />{v.label}</Item>
                ))}
              </Command.Group>
              <Command.Group heading="Aktionen">
                {ENTRIES.map((e) => (
                  <Item key={e.type} value={'aktion ' + e.label} onSelect={run(() => nav.openEntry(e.type))}><Plus />{e.label}</Item>
                ))}
                <Item value="aktion aktualisieren kurse neu laden refresh" onSelect={run(onRefresh)}><RefreshCw />Kurse und Daten aktualisieren</Item>
                <Item value="aktion export csv positionen" onSelect={run(onExport)}><Download />Positionen als CSV exportieren</Item>
              </Command.Group>
              <Command.Group heading="Positionen">
                {Object.values(db.positions).filter((p) => p.shares > 0).map((p) => (
                  <Item key={p.ticker} value={'position ' + p.ticker + ' ' + p.name} onSelect={run(() => nav.openPosition(p.ticker))}>
                    <span className="tk w-12">{p.ticker}</span><span className="truncate">{p.name}</span>
                  </Item>
                ))}
              </Command.Group>
              <Command.Group heading="Watchlist">
                {Object.values(db.watchlist).map((w) => (
                  <Item key={w.ticker} value={'watchlist ' + w.ticker + ' ' + w.name} onSelect={run(() => nav.openWatch(w.ticker))}>
                    <span className="tk w-12">{w.ticker}</span><span className="truncate">{w.name}</span>
                  </Item>
                ))}
              </Command.Group>
            </Command.List>
          </Command>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
