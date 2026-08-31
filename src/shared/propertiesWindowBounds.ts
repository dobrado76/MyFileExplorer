/** First-open size when `propertiesWindowBounds` is still null. */

export const PROPERTIES_WINDOW_MIN_WIDTH = 420
export const PROPERTIES_WINDOW_MIN_HEIGHT = 360
export const PROPERTIES_WINDOW_DEFAULT_WIDTH = 520
export const PROPERTIES_WINDOW_DEFAULT_HEIGHT = 560
export const PROPERTIES_WINDOW_CASCADE_PX = 28
export const PROPERTIES_WINDOW_MAX_OPEN = 32

export type PropertiesWindowRect = { x: number; y: number; width: number; height: number }

/** Centered default card size on the primary work area. */
export function propertiesWindowDefaultBounds(workArea: PropertiesWindowRect): PropertiesWindowRect {
  const width = Math.min(
    Math.max(PROPERTIES_WINDOW_MIN_WIDTH, PROPERTIES_WINDOW_DEFAULT_WIDTH),
    workArea.width
  )
  const height = Math.min(
    Math.max(PROPERTIES_WINDOW_MIN_HEIGHT, PROPERTIES_WINDOW_DEFAULT_HEIGHT),
    workArea.height
  )
  return {
    x: workArea.x + Math.max(0, Math.floor((workArea.width - width) / 2)),
    y: workArea.y + Math.max(0, Math.floor((workArea.height - height) / 2)),
    width,
    height
  }
}
