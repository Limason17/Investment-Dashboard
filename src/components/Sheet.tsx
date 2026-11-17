import * as Dialog from '@radix-ui/react-dialog'
import { X } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useCallback, useEffect, useRef, useSyncExternalStore, type ReactNode, type RefObject } from 'react'
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
  const overlay = useRef<HTMLDivElement>(null)
  const swipe = useSwipeDown(onClose, overlay)
  return (
    <Dialog.Root open={open} onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay ref={overlay} className="fixed inset-0 z-40 animate-[overlay-in_.2s_ease-out] bg-black/55 backdrop-blur-[3px]" />
        <Dialog.Content
          ref={swipe}
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
          <div data-sheet-body className="flex-1 overflow-y-auto overscroll-contain px-4 py-4 sm:px-5 sm:py-5">{children}</div>
          {footer && <footer className="flex flex-wrap items-center justify-end gap-2 border-t border-line bg-white/[0.015] px-4 pb-[max(14px,env(safe-area-inset-bottom))] pt-3.5 sm:px-5 sm:pb-3.5 max-sm:[&>.btn]:flex-1">{footer}</footer>}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

/**
 * Handy: Blatt mit dem Finger nach unten wischen schliesst es (wie bei iOS/Android).
 * Gilt am Griff und Kopf immer, im Inhalt nur, wenn er ganz oben steht und die Bewegung klar nach unten geht.
 * Nicht auf Charts, Eingabefeldern und Reglern, damit dort Ablesen und Tippen ungestört bleiben.
 */
function useSwipeDown(onClose: () => void, overlay: RefObject<HTMLDivElement | null>) {
  const close = useRef(onClose)
  useEffect(() => {
    close.current = onClose
  }, [onClose])
  const cleanup = useRef<(() => void) | null>(null)
  return useCallback((el: HTMLDivElement | null) => {
    cleanup.current?.()
    cleanup.current = null
    if (!el) return
    let y0 = 0, x0 = 0, t0 = 0, dy = 0, state: 'idle' | 'maybe' | 'drag' | 'no' = 'idle'
    const phone = () => matchMedia('(max-width: 639px)').matches
    const set = (v: number, anim: boolean) => {
      el.style.transition = anim ? 'transform .22s cubic-bezier(.22,1,.36,1)' : 'none'
      el.style.transform = v ? `translateY(${v}px)` : ''
      if (overlay.current) {
        overlay.current.style.transition = anim ? 'opacity .22s' : 'none'
        overlay.current.style.opacity = String(Math.max(0, 1 - v / (el.offsetHeight || 1)))
      }
    }
    const onStart = (e: TouchEvent) => {
      if (!phone() || e.touches.length !== 1) return void (state = 'no')
      const target = e.target as HTMLElement
      if (target.closest('input, textarea, select, svg, [role="slider"], [data-noswipe]')) return void (state = 'no')
      const body = el.querySelector<HTMLElement>('[data-sheet-body]')
      const inBody = !!body && body.contains(target)
      // Im Inhalt nur von ganz oben; sonst scrollt der Finger wie gewohnt
      if (inBody && body!.scrollTop > 0) return void (state = 'no')
      y0 = e.touches[0].clientY
      x0 = e.touches[0].clientX
      t0 = Date.now()
      dy = 0
      state = 'maybe'
    }
    const onMove = (e: TouchEvent) => {
      if (state === 'no' || state === 'idle') return
      const ddy = e.touches[0].clientY - y0, ddx = e.touches[0].clientX - x0
      if (state === 'maybe') {
        if (Math.abs(ddy) < 8 && Math.abs(ddx) < 8) return
        // Nur eine klar senkrechte Bewegung nach unten zieht das Blatt
        if (ddy <= 0 || Math.abs(ddx) > Math.abs(ddy)) return void (state = 'no')
        state = 'drag'
      }
      e.preventDefault()
      dy = Math.max(0, ddy)
      set(dy, false)
    }
    const onEnd = () => {
      if (state === 'drag') {
        const fast = dy / Math.max(1, Date.now() - t0) > 0.6
        if (dy > Math.min(140, el.offsetHeight * 0.25) || (fast && dy > 40)) {
          set(el.offsetHeight, true)
          setTimeout(() => close.current(), 200)
        } else set(0, true)
      }
      state = 'idle'
    }
    el.addEventListener('touchstart', onStart, { passive: true })
    el.addEventListener('touchmove', onMove, { passive: false })
    el.addEventListener('touchend', onEnd)
    el.addEventListener('touchcancel', onEnd)
    cleanup.current = () => {
      el.removeEventListener('touchstart', onStart)
      el.removeEventListener('touchmove', onMove)
      el.removeEventListener('touchend', onEnd)
      el.removeEventListener('touchcancel', onEnd)
    }
  }, [overlay])
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
