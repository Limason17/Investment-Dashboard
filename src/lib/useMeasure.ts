import { useLayoutEffect, useRef, useState } from 'react'

/** Breite eines Elements messen und bei Grössenänderung nachführen (für SVG-Charts). */
export function useMeasure<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  const [width, setWidth] = useState(0)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setWidth(Math.round(e.contentRect.width)))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return [ref, width] as const
}
