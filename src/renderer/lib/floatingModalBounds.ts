import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'

export type FloatingBounds = { x: number; y: number; width: number; height: number }

type ResizeEdge = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw'

export const FLOATING_RESIZE_EDGES: ResizeEdge[] = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw']

export function clampFloatingBounds(
  b: FloatingBounds,
  minW: number,
  minH: number
): FloatingBounds {
  const vw = window.innerWidth
  const vh = window.innerHeight
  const maxW = Math.max(minW, Math.floor(vw * 0.96))
  const maxH = Math.max(minH, Math.floor(vh * 0.92))
  const width = Math.min(Math.max(Math.round(b.width), minW), maxW)
  const height = Math.min(Math.max(Math.round(b.height), minH), maxH)
  const x = Math.min(Math.max(Math.round(b.x), 0), Math.max(0, vw - width))
  const y = Math.min(Math.max(Math.round(b.y), 0), Math.max(0, vh - height))
  return { x, y, width, height }
}

export function defaultFloatingBounds(
  defaultW: number,
  defaultH: number,
  minW: number,
  minH: number
): FloatingBounds {
  const vw = window.innerWidth
  const vh = window.innerHeight
  const width = Math.min(defaultW, Math.floor(vw * 0.96))
  const height = Math.min(defaultH, Math.floor(vh * 0.92))
  return clampFloatingBounds(
    { x: (vw - width) / 2, y: (vh - height) / 2, width, height },
    minW,
    minH
  )
}

export function maximizedFloatingBounds(minW: number, minH: number): FloatingBounds {
  const pad = 6
  const vw = window.innerWidth
  const vh = window.innerHeight
  return {
    x: pad,
    y: pad,
    width: Math.max(minW, vw - pad * 2),
    height: Math.max(minH, vh - pad * 2)
  }
}

export function useFloatingModalBounds(opts: {
  saved: (FloatingBounds & { maximized?: boolean }) | null | undefined
  persist: (next: FloatingBounds, maximized: boolean) => void
  minW: number
  minH: number
  defaultW: number
  defaultH: number
  allowMaximize?: boolean
}): {
  bounds: FloatingBounds
  maximized: boolean
  beginDrag: (kind: 'move' | ResizeEdge, e: ReactPointerEvent) => void
  toggleMaximize: () => void
} {
  const { saved, persist, minW, minH, defaultW, defaultH, allowMaximize = false } = opts
  const [maximized, setMaximized] = useState(() => allowMaximize && !!saved?.maximized)
  const restoreRef = useRef<FloatingBounds>(
    saved
      ? clampFloatingBounds(saved, minW, minH)
      : defaultFloatingBounds(defaultW, defaultH, minW, minH)
  )
  const [bounds, setBounds] = useState<FloatingBounds>(() =>
    allowMaximize && saved?.maximized
      ? maximizedFloatingBounds(minW, minH)
      : restoreRef.current
  )
  const boundsRef = useRef(bounds)
  useEffect(() => {
    boundsRef.current = bounds
  }, [bounds])
  const maximizedRef = useRef(maximized)
  useEffect(() => {
    maximizedRef.current = maximized
  }, [maximized])

  const dragRef = useRef<{
    kind: 'move' | ResizeEdge
    startX: number
    startY: number
    orig: FloatingBounds
  } | null>(null)
  const endDragRef = useRef<() => void>(() => {})

  const persistNow = useCallback(
    (normal: FloatingBounds, isMax: boolean) => {
      persist(clampFloatingBounds(normal, minW, minH), isMax)
    },
    [minH, minW, persist]
  )

  const onPointerMove = useCallback(
    (e: PointerEvent): void => {
      const drag = dragRef.current
      if (!drag || maximizedRef.current) return
      const dx = e.clientX - drag.startX
      const dy = e.clientY - drag.startY
      const o = drag.orig
      let next = { ...o }
      if (drag.kind === 'move') {
        next = { ...o, x: o.x + dx, y: o.y + dy }
      } else {
        const edge = drag.kind
        if (edge.includes('e')) next.width = o.width + dx
        if (edge.includes('s')) next.height = o.height + dy
        if (edge.includes('w')) {
          next.width = o.width - dx
          next.x = o.x + dx
        }
        if (edge.includes('n')) {
          next.height = o.height - dy
          next.y = o.y + dy
        }
        if (edge.includes('w') && next.width < minW) {
          next.x = o.x + o.width - minW
          next.width = minW
        }
        if (edge.includes('n') && next.height < minH) {
          next.y = o.y + o.height - minH
          next.height = minH
        }
      }
      setBounds(clampFloatingBounds(next, minW, minH))
    },
    [minH, minW]
  )

  const onPointerUp = useCallback((): void => {
    endDragRef.current()
  }, [])

  useEffect(() => {
    endDragRef.current = (): void => {
      if (!dragRef.current) return
      dragRef.current = null
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', onPointerUp)
      window.removeEventListener('pointercancel', onPointerUp)
      if (maximizedRef.current) return
      restoreRef.current = boundsRef.current
      persistNow(boundsRef.current, false)
    }
  }, [onPointerMove, onPointerUp, persistNow])

  useEffect(() => {
    const onResize = (): void => {
      if (maximizedRef.current) {
        setBounds(maximizedFloatingBounds(minW, minH))
      } else {
        setBounds((b) => clampFloatingBounds(b, minW, minH))
      }
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [minH, minW])

  const beginDrag = (kind: 'move' | ResizeEdge, e: ReactPointerEvent): void => {
    if (maximizedRef.current) return
    e.preventDefault()
    e.stopPropagation()
    dragRef.current = {
      kind,
      startX: e.clientX,
      startY: e.clientY,
      orig: boundsRef.current
    }
    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', onPointerUp)
    window.addEventListener('pointercancel', onPointerUp)
  }

  const toggleMaximize = useCallback((): void => {
    if (!allowMaximize) return
    if (maximizedRef.current) {
      const restored = clampFloatingBounds(restoreRef.current, minW, minH)
      setBounds(restored)
      setMaximized(false)
      persistNow(restored, false)
      return
    }
    restoreRef.current = clampFloatingBounds(boundsRef.current, minW, minH)
    const next = maximizedFloatingBounds(minW, minH)
    setBounds(next)
    setMaximized(true)
    persistNow(restoreRef.current, true)
  }, [allowMaximize, minH, minW, persistNow])

  return { bounds, maximized, beginDrag, toggleMaximize }
}
