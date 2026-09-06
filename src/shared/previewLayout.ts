/**
 * Landscape preview: visualization on the left, metadata / details on the right.
 * Small hysteresis avoids flicker when the pane is nearly square.
 */
export function previewLayoutWide(width: number, height: number, prev = false): boolean {
  if (!(width > 0) || !(height > 0)) return prev
  if (width > height + 8) return true
  if (width + 8 < height) return false
  return prev
}
