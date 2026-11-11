import * as Dialog from '@radix-ui/react-dialog'
import { X } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useSyncExternalStore, type ReactNode } from 'react'
import { getToasts, subscribeToasts } from '@/lib/toast'

/** Blatt für Details und Eingaben: am Rechner von rechts, auf dem Handy von unten über die volle Breite. */
export function Sheet({ open, onClose, title, sub, children, footer }: {
  open: boolean
  onClose: () => void
  title: ReactNode
  sub?: ReactNode
  children: ReactNode
  footer?: ReactNode
}) {
  return (
    <Dialog.Root open={open} onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 animate-[overlay-in_.2s_ease-out] bg-black/55 backdrop-blur-[3px]" />
        <Dialog.Content
          aria-describedby={undefined}
          className="fixed z-50 flex flex-col overflow-hidden border border-line-2 bg-[#0c0e12] shadow-[0_30px_80px_-10px_rgb(0_0_0/0.8),inset_0_1px_0_rgb(255_255_255/0.05)] outline-none max-sm:inset-x-0 max-sm:bottom-0 max-sm:top-[max(14px,env(safe-area-inset-top))] max-sm:animate-[sheet-up_.32s_var(--ease-out-soft)] max-sm:rounded-t-[22px] max-sm:border-b-0 sm:inset-y-2 sm:right-2 sm:w-[min(540px,calc(100vw-16px))] sm:animate-[sheet-in_.3s_var(--ease-out-soft)] sm:rounded-[18px]"
        >
          <div className="mx-auto mt-2 h-1 w-9 flex-none rounded-full bg-white/15 sm:hidden" aria-hidden="true" />
          <header className="flex items-start justify-between gap-4 border-b border-line px-4 pb-3.5 pt-3 sm:px-5 sm:pb-4 sm:pt-5">
            <div className="min-w-0">
              <Dialog.Title className="text-[16px] font-semibold leading-6 tracking-[-0.015em]">{title}</Dialog.Title>
              {sub && <div className="mt-0.5 text-[12.5px] text-muted">{sub}</div>}
            </div>
            <Dialog.Close className="btn btn-ghost btn-icon -mr-1.5 flex-none" aria-label="Schliessen">
              <X />
            </Dialog.Close>
          </header>
          <div className="flex-1 overflow-y-auto overscroll-contain px-4 py-4 sm:px-5 sm:py-5">{children}</div>
          {footer && <footer className="flex flex-wrap items-center justify-end gap-2 border-t border-line bg-white/[0.015] px-4 pb-[max(14px,env(safe-area-inset-bottom))] pt-3.5 sm:px-5 sm:pb-3.5 max-sm:[&>.btn]:flex-1">{footer}</footer>}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

/* ------------------------------------------------------------------ Kurzmeldungen */
export function Toaster() {
  const list = useSyncExternalStore(subscribeToasts, getToasts)
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-[calc(76px+env(safe-area-inset-bottom))] z-[70] flex flex-col items-center gap-2 px-4 lg:bottom-6" role="status" aria-live="polite">
      <AnimatePresence>
        {list.map((t) => (
          <motion.div
            key={t.id}
            initial={{ opacity: 0, y: 12, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 6, scale: 0.98 }}
            transition={{ duration: 0.22 }}
            className="max-w-full rounded-xl border border-line-2 bg-[#1a1d25]/95 px-4 py-2.5 text-center text-[13px] text-ink shadow-[0_16px_40px_-8px_rgb(0_0_0/0.8)] backdrop-blur"
          >
            {t.text}
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  )
}
