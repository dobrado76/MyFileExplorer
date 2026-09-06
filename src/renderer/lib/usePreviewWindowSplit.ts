import { useCallback, useEffect, useRef, useState } from 'react'
import {
  PREVIEW_WINDOW_SPLIT_GUTTER,
  applyPreviewWindowSplitDelta,
  previewWindowSplitRightPx
} from '@shared/previewWindowSplit'
import { api } from './ipc'
import { useAppStore } from '../store/appStore'

/** Live right-column width + persist the last drag position (`previewWindowSplitPx`). */
export function usePreviewWindowSplit(
  containerWidth: number,
  enabled: boolean
): {
  rightPx: number
  gutterPx: number
  onDrag: (deltaPx: number) => void
  onDragEnd: () => void
} {
  const savedPx = useAppStore((s) => s.settings.previewWindowSplitPx ?? null)
  const [livePx, setLivePx] = useState<number | null>(null)
  const liveRef = useRef<number | null>(null)
  const dirtyRef = useRef(false)

  useEffect(() => {
    if (dirtyRef.current) return
    liveRef.current = savedPx
    setLivePx(savedPx)
  }, [savedPx])

  const rightPx = previewWindowSplitRightPx(containerWidth, livePx ?? savedPx)

  const persist = useCallback((px: number): void => {
    dirtyRef.current = false
    liveRef.current = px
    useAppStore.setState((s) => ({
      settings: { ...s.settings, previewWindowSplitPx: px }
    }))
    void api.settings.set({ previewWindowSplitPx: px })
  }, [])

  useEffect(() => {
    return () => {
      if (dirtyRef.current && liveRef.current != null) {
        void api.settings.set({ previewWindowSplitPx: liveRef.current })
      }
    }
  }, [])

  const onDrag = useCallback(
    (deltaPx: number): void => {
      if (!enabled) return
      const cur = liveRef.current ?? previewWindowSplitRightPx(containerWidth, savedPx)
      const next = applyPreviewWindowSplitDelta(cur, deltaPx, containerWidth)
      dirtyRef.current = true
      liveRef.current = next
      setLivePx(next)
    },
    [containerWidth, enabled, savedPx]
  )

  const onDragEnd = useCallback((): void => {
    if (!enabled) return
    const next = liveRef.current ?? previewWindowSplitRightPx(containerWidth, savedPx)
    persist(next)
  }, [containerWidth, enabled, persist, savedPx])

  return { rightPx, gutterPx: PREVIEW_WINDOW_SPLIT_GUTTER, onDrag, onDragEnd }
}
