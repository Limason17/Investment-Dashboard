import { RefreshCw } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

const TRIGGER = 70 // Weg in px, ab dem Loslassen aktualisiert
const MAX = 110

/**
 * Ganz oben auf der Seite nach unten ziehen und loslassen: aktualisiert Kurse und Daten.
 * Nur bei Touch; gesperrt, solange ein Blatt oder Dialog offen ist.
 */
export function PullToRefresh({ onRefresh, disabled }: { onRefresh: () => Promise<void> | void; disabled?: boolean }) {
  const [pull, setPull] = useState(0)
  const [busy, setBusy] = useState(false)
  const [dragging, setDragging] = useState(false)
  const start = useRef<number | null>(null)
  const pullRef = useRef(0)
  const cb = useRef(onRefresh)
  useEffect(() => {
    cb.current = onRefresh
  }, [onRefresh])

  useEffect(() => {
    if (disabled) return
    const onStart = (e: TouchEvent) => {
      start.current = window.scrollY <= 0 && e.touches.length === 1 ? e.touches[0].clientY : null
      setDragging(start.current != null)
    }
    const onMove = (e: TouchEvent) => {
      if (start.current == null) return
      const dy = e.touches[0].clientY - start.current
      if (dy <= 0 || window.scrollY > 0) {
        pullRef.current = 0
        setPull(0)
        return
      }
      // gedämpft, damit es sich wie ein Gummiband anfühlt
      const p = Math.min(MAX, dy * 0.5)
      pullRef.current = p
      setPull(p)
    }
    const onEnd = async () => {
      const p = pullRef.current
      start.current = null
      setDragging(false)
      pullRef.current = 0
      if (p >= TRIGGER) {
        setBusy(true)
        setPull(TRIGGER)
        try {
          await cb.current()
        } finally {
          setBusy(false)
          setPull(0)
        }
      } else setPull(0)
    }
    window.addEventListener('touchstart', onStart, { passive: true })
    window.addEventListener('touchmove', onMove, { passive: true })
    window.addEventListener('touchend', onEnd)
    window.addEventListener('touchcancel', onEnd)
    return () => {
      window.removeEventListener('touchstart', onStart)
      window.removeEventListener('touchmove', onMove)
      window.removeEventListener('touchend', onEnd)
      window.removeEventListener('touchcancel', onEnd)
    }
  }, [disabled])

  if (!pull && !busy) return null
  const ready = pull >= TRIGGER
  return (
    <div className="pointer-events-none fixed inset-x-0 top-0 z-40 flex justify-center" style={{ transform: `translateY(${Math.max(8, pull - 28)}px)`, transition: dragging ? undefined : 'transform 0.2s ease' }} aria-live="polite">
      <div className="flex items-center gap-2 rounded-full border border-line-2 bg-[#12141a]/95 px-3.5 py-2 text-[12.5px] text-ink-2 shadow-[0_10px_30px_-8px_rgb(0_0_0/0.8)] backdrop-blur">
        <RefreshCw className={busy ? 'size-4 animate-spin text-accent-2' : 'size-4 text-accent-2'} style={busy ? undefined : { transform: `rotate(${pull * 3}deg)` }} />
        {busy ? 'Aktualisiere …' : ready ? 'Loslassen zum Aktualisieren' : 'Zum Aktualisieren ziehen'}
      </div>
    </div>
  )
}
