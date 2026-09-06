/** Right-column width in the detached landscape preview (details / stats). */
export const PREVIEW_WINDOW_SPLIT_RIGHT_MIN = 240
export const PREVIEW_WINDOW_SPLIT_RIGHT_MAX = 4000
export const PREVIEW_WINDOW_SPLIT_LEFT_MIN = 160
export const PREVIEW_WINDOW_SPLIT_GUTTER = 5
/** First-open / unset: same 42% as the previous fixed grid. */
export const PREVIEW_WINDOW_SPLIT_DEFAULT_RATIO = 0.42

export function previewWindowSplitRightMax(containerWidth: number): number {
  return Math.max(
    PREVIEW_WINDOW_SPLIT_RIGHT_MIN,
    containerWidth - PREVIEW_WINDOW_SPLIT_LEFT_MIN - PREVIEW_WINDOW_SPLIT_GUTTER
  )
}

/** Clamp a saved or live right-column width to the current window. */
export function previewWindowSplitRightPx(
  containerWidth: number,
  savedPx: number | null | undefined
): number {
  if (!(containerWidth > 0)) {
    return savedPx != null && savedPx > 0
      ? Math.min(
          PREVIEW_WINDOW_SPLIT_RIGHT_MAX,
          Math.max(PREVIEW_WINDOW_SPLIT_RIGHT_MIN, Math.round(savedPx))
        )
      : PREVIEW_WINDOW_SPLIT_RIGHT_MIN
  }
  const max = Math.min(PREVIEW_WINDOW_SPLIT_RIGHT_MAX, previewWindowSplitRightMax(containerWidth))
  const fallback = Math.round(containerWidth * PREVIEW_WINDOW_SPLIT_DEFAULT_RATIO)
  const raw = savedPx != null && savedPx > 0 ? savedPx : fallback
  return Math.min(max, Math.max(PREVIEW_WINDOW_SPLIT_RIGHT_MIN, Math.round(raw)))
}

export function applyPreviewWindowSplitDelta(
  currentRightPx: number,
  deltaPx: number,
  containerWidth: number
): number {
  return previewWindowSplitRightPx(containerWidth, currentRightPx - deltaPx)
}
