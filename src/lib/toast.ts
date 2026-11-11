/** Kurzmeldungen am unteren Rand; angezeigt von <Toaster /> in components/Sheet.tsx. */
export interface Toast {
  id: number
  text: string
}
let toasts: Toast[] = []
const subs = new Set<() => void>()
let seq = 0
const emit = () => subs.forEach((s) => s())

export function toast(text: string) {
  const id = ++seq
  toasts = [...toasts, { id, text }]
  emit()
  setTimeout(() => {
    toasts = toasts.filter((t) => t.id !== id)
    emit()
  }, 3600)
}
export const subscribeToasts = (l: () => void) => {
  subs.add(l)
  return () => {
    subs.delete(l)
  }
}
export const getToasts = () => toasts
