/**
 * Whether a pointer Y inside the Rich player host should cycle pause
 * (Chromium `<video>` click parity). Exclude the OSC bottom bar when it is shown.
 */
export function mpvPointerInVideoToggleZone(
  y: number,
  height: number,
  oscVisible: boolean,
  barPx = 64
): boolean {
  if (height <= 0 || y < 0 || y >= height) return false
  if (!oscVisible) return true
  const bar = Math.max(barPx, height * 0.16)
  return y < height - bar
}

/** Screen-DIP overlay rect (same space as `screen.getCursorScreenPoint()`). */
export type MpvDipRect = { x: number; y: number; width: number; height: number }

/**
 * Click is on the video picture — not chrome above/beside the host, not the OSC bar.
 * `cursor` and `overlay` must be the same coordinate space (DIP).
 */
export function mpvDipClickIsVideoToggle(
  cursor: { x: number; y: number },
  overlay: MpvDipRect,
  oscVisible: boolean,
  barPx = 64
): boolean {
  if (overlay.width <= 0 || overlay.height <= 0) return false
  const x = cursor.x - overlay.x
  if (x < 0 || x >= overlay.width) return false
  return mpvPointerInVideoToggleZone(cursor.y - overlay.y, overlay.height, oscVisible, barPx)
}
