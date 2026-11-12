/**
 * Einführung für neue Benutzer: wenige kurze Schritte, jeder hebt eine Stelle der Oberfläche hervor.
 * Ziele tragen data-tour="…"; gezeigt wird das erste sichtbare Element (Seitenleiste am Computer,
 * untere Leiste und Kopf auf dem Handy). Schritte ohne sichtbares Ziel fallen weg.
 */
import { AnimatePresence, motion } from 'motion/react'
import { X } from 'lucide-react'
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

interface Step {
  target?: string
  title: string
  text: string
}

const isTouch = () => typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches
const isStandalone = () => typeof matchMedia !== 'undefined' && (matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true)
const isIOS = () => /iPhone|iPad|iPod/.test(navigator.userAgent)

function steps(): Step[] {
  const touch = isTouch()
  const install = isStandalone()
    ? ''
    : isIOS()
      ? ' Tipp: In Safari über «Teilen» → «Zum Home-Bildschirm» installierst du Depot als App.'
      : ' Tipp: Über das Browser-Menü → «App installieren» öffnest du Depot wie eine App.'
  return [
    { title: 'Willkommen bei Depot', text: 'Dein Portfolio an einem Ort: Wert, Positionen, Dividenden, Kaufgrenzen und Plan. Die Einführung dauert eine Minute.' },
    { target: 'nav', title: 'Sechs Ansichten', text: touch ? 'Übersicht, Positionen, Limits, Dividenden, Plan und Journal. Tippe unten, um zu wechseln.' : 'Übersicht, Positionen, Limits, Dividenden, Plan und Journal. Mit den Tasten 1 bis 6 wechselst du schneller.' },
    { target: 'upload', title: 'Alles auf einmal hochladen', text: 'Lade deine bisherigen Käufe mit einer Excel-Vorlage hoch. Mit dem Kaufdatum entstehen Wertverlauf und Charts.' },
    { target: 'entry', title: 'Einträge erfassen', text: 'Kauf, Verkauf, Dividende, Cash oder Notiz. Bestand, Einstand und Cash rechnet Depot selbst nach.' },
    { target: 'refresh', title: 'Live-Kurse', text: `Kurse kommen von selbst, während der Börse alle 20 Sekunden. ${touch ? 'Ein Tipp' : 'Ein Klick'} hier holt sie sofort.` },
    { target: 'portfolio', title: 'Mehrere Portfolios', text: 'Getrennte Depots, z. B. je Broker. «Alle Portfolios» zählt sie zusammen.' },
    { target: 'account', title: 'Konto und Daten', text: 'Hier verwaltest du Portfolios, lädst Vorlagen herunter, sicherst deine Daten und startest diese Einführung neu.' },
    { title: 'Bereit', text: 'Starte mit deinen Positionen.' + install },
  ]
}

/** Erstes sichtbares Element mit data-tour=name. */
function findTarget(name?: string): HTMLElement | null {
  if (!name) return null
  for (const el of document.querySelectorAll<HTMLElement>(`[data-tour="${name}"]`)) {
    const r = el.getBoundingClientRect()
    if (r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden') return el
  }
  return null
}

const PAD = 6
const GAP = 12

/** Wird nur gezeigt, solange sie offen ist (App blendet sie ein und aus). */
export function Tour({ onClose, onStart }: { onClose: () => void; onStart: () => void }) {
  const open = true
  // Nur Schritte mit sichtbarem Ziel (oder ohne Ziel), bestimmt beim Öffnen.
  const [list] = useState<Step[]>(() => steps().filter((s) => !s.target || findTarget(s.target)))
  const [i, setI] = useState(0)
  const [rect, setRect] = useState<DOMRect | null>(null)
  const [vw, setVw] = useState(() => (typeof window !== 'undefined' ? window.innerWidth : 1024))
  const [vh, setVh] = useState(() => (typeof window !== 'undefined' ? window.innerHeight : 768))
  const titleId = useId()
  const primary = useRef<HTMLButtonElement>(null)


  const step = list[i]
  const last = i === list.length - 1

  const measure = useCallback(() => {
    setVw(window.innerWidth)
    setVh(window.innerHeight)
    const el = findTarget(step?.target)
    setRect(el ? el.getBoundingClientRect() : null)
  }, [step])

  // Ziel in den sichtbaren Bereich holen, dann messen; bei Scrollen und Grössenwechsel nachführen.
  useLayoutEffect(() => {
    if (!open || !step) return
    const el = findTarget(step.target)
    if (el) {
      const r = el.getBoundingClientRect()
      if (r.top < 70 || r.bottom > window.innerHeight - 90) el.scrollIntoView({ block: 'center', behavior: 'instant' as ScrollBehavior })
    }
    const raf = requestAnimationFrame(measure)
    const t = setTimeout(measure, 120)
    window.addEventListener('resize', measure)
    window.addEventListener('scroll', measure, true)
    return () => {
      cancelAnimationFrame(raf)
      clearTimeout(t)
      window.removeEventListener('resize', measure)
      window.removeEventListener('scroll', measure, true)
    }
  }, [open, step, measure])

  useEffect(() => {
    if (open) primary.current?.focus({ preventScroll: true })
  }, [open, i])

  const next = useCallback(() => (last ? onClose() : setI((x) => Math.min(x + 1, list.length - 1))), [last, list.length, onClose])
  const back = useCallback(() => setI((x) => Math.max(0, x - 1)), [])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      else if (e.key === 'ArrowRight') next()
      else if (e.key === 'ArrowLeft') back()
      else return
      e.preventDefault()
      e.stopPropagation()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [open, next, back, onClose])

  // Karte: auf schmalen Bildschirmen über die ganze Breite, oben oder unten (je nachdem, wo das Ziel liegt);
  // sonst neben dem Ziel, rechts oder darunter, und immer im Bild.
  const card = useMemo(() => {
    const narrow = vw < 640
    const w = Math.min(narrow ? vw - 24 : 360, vw - 24)
    if (!rect) return { style: { left: (vw - w) / 2, top: Math.max(16, vh / 2 - 150), width: w }, center: true }
    if (narrow) {
      const below = rect.top + rect.height / 2 < vh / 2
      return { style: below ? { left: 12, top: Math.min(rect.bottom + GAP + PAD, vh - 260), width: w } : { left: 12, bottom: Math.max(vh - rect.top + GAP + PAD, 16), width: w }, center: false }
    }
    // Ziel links (Seitenleiste): Karte rechts daneben; sonst darunter bzw. darüber.
    if (rect.right + GAP + w < vw && rect.left < vw / 3) return { style: { left: rect.right + GAP + PAD, top: Math.min(Math.max(16, rect.top), vh - 280), width: w }, center: false }
    const left = Math.min(Math.max(12, rect.left + rect.width / 2 - w / 2), vw - w - 12)
    return rect.bottom + 260 < vh
      ? { style: { left, top: rect.bottom + GAP + PAD, width: w }, center: false }
      : { style: { left, bottom: vh - rect.top + GAP + PAD, width: w }, center: false }
  }, [rect, vw, vh])

  if (typeof document === 'undefined') return null
  return createPortal(
    <AnimatePresence>
      {open && step && (
        <div className="fixed inset-0 z-[60]" role="dialog" aria-modal="true" aria-labelledby={titleId}>
          {/* Abdunkeln mit Aussparung um das Ziel; Klicks auf die Seite sind während der Einführung gesperrt. */}
          <div className="fixed inset-0" />
          {rect ? (
            <motion.div
              key="ring"
              className="pointer-events-none fixed rounded-[14px] ring-2 ring-accent/80"
              initial={false}
              animate={{ left: rect.left - PAD, top: rect.top - PAD, width: rect.width + PAD * 2, height: rect.height + PAD * 2 }}
              transition={{ type: 'spring', stiffness: 380, damping: 36 }}
              style={{ boxShadow: '0 0 0 9999px rgb(4 5 8 / 0.8), 0 0 0 6px rgb(143 155 255 / 0.18), 0 0 28px 6px rgb(143 155 255 / 0.35)' }}
            />
          ) : (
            <motion.div key="dim" className="fixed inset-0 bg-[rgb(4_5_8/0.8)] backdrop-blur-[2px]" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} />
          )}
          <motion.div
            key={i}
            className="fixed rounded-[18px] border border-line-2 bg-[#0e1015] p-5 shadow-[0_24px_70px_-12px_rgb(0_0_0/0.85),inset_0_1px_0_rgb(255_255_255/0.06)]"
            style={card.style}
            initial={{ opacity: 0, y: 8, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="num text-[11.5px] font-medium uppercase tracking-[0.08em] text-accent-2">{i === 0 ? 'Einführung' : `Schritt ${i} von ${list.length - 1}`}</div>
              <button type="button" className="btn btn-ghost btn-icon -mr-2 -mt-2" aria-label="Einführung schliessen" onClick={onClose}><X /></button>
            </div>
            <h2 id={titleId} className="mt-1 text-[18px] font-semibold leading-6 tracking-[-0.02em]">{step.title}</h2>
            <p className="mt-2 text-[13.5px] leading-[1.55] text-ink-2">{step.text}</p>

            <div className="mt-4 flex items-center gap-1.5" aria-hidden="true">
              {list.map((_, k) => <span key={k} className={`h-1.5 rounded-full transition-all ${k === i ? 'w-5 bg-accent' : 'w-1.5 bg-white/20'}`} />)}
            </div>

            <div className="mt-4 flex flex-wrap items-center justify-end gap-2">
              {i === 0 ? (
                <button type="button" className="btn btn-ghost mr-auto" onClick={onClose}>Überspringen</button>
              ) : !last ? (
                <button type="button" className="btn btn-ghost mr-auto" onClick={back}>Zurück</button>
              ) : (
                <button type="button" className="btn btn-ghost mr-auto" onClick={onClose}>Später</button>
              )}
              {last ? (
                <button ref={primary} type="button" className="btn btn-primary" onClick={() => { onClose(); onStart() }}>Positionen hochladen</button>
              ) : (
                <button ref={primary} type="button" className="btn btn-primary" onClick={next}>{i === 0 ? 'Los geht’s' : 'Weiter'}</button>
              )}
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  )
}
