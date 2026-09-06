import { useEffect, useRef, useState, type RefObject } from 'react'
import { previewLayoutWide } from '@shared/previewLayout'

/** Observe a preview root and report landscape (width > height). */
export function usePreviewWideLayout(): {
  rootRef: RefObject<HTMLDivElement | null>
  wide: boolean
  width: number
} {
  const rootRef = useRef<HTMLDivElement>(null)
  const [wide, setWide] = useState(false)
  const [width, setWidth] = useState(0)

  useEffect(() => {
    const el = rootRef.current
    if (!el) return
    const apply = (w: number, h: number): void => {
      setWidth(w)
      setWide((prev) => previewLayoutWide(w, h, prev))
    }
    apply(el.clientWidth, el.clientHeight)
    const ro = new ResizeObserver((entries) => {
      const cr = entries[0]?.contentRect
      if (!cr) return
      apply(cr.width, cr.height)
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  return { rootRef, wide, width }
}
