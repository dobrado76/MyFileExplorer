/** First-ever pop-out size when `previewWindowBounds` is still null. */
export const PREVIEW_WINDOW_DEFAULT_WORK_AREA_FRACTION = 0.9

export const PREVIEW_WINDOW_MIN_WIDTH = 360
export const PREVIEW_WINDOW_MIN_HEIGHT = 280

export type PreviewWindowRect = { x: number; y: number; width: number; height: number }

/** Centered ~90% of the work area (first open only; later opens use saved bounds). */
export function previewWindowDefaultBounds(workArea: PreviewWindowRect): PreviewWindowRect {
  const width = Math.max(
    PREVIEW_WINDOW_MIN_WIDTH,
    Math.round(workArea.width * PREVIEW_WINDOW_DEFAULT_WORK_AREA_FRACTION)
  )
  const height = Math.max(
    PREVIEW_WINDOW_MIN_HEIGHT,
    Math.round(workArea.height * PREVIEW_WINDOW_DEFAULT_WORK_AREA_FRACTION)
  )
  return {
    x: workArea.x + Math.max(0, Math.floor((workArea.width - width) / 2)),
    y: workArea.y + Math.max(0, Math.floor((workArea.height - height) / 2)),
    width: Math.min(width, workArea.width),
    height: Math.min(height, workArea.height)
  }
}
