/** Accumulated edge trims as fractions of width (left/right) or height (top/bottom). */
export type SlideshowAccumulatedCrop = {
  top: number
  right: number
  bottom: number
  left: number
}

export type SlideshowCropEdge = 'top' | 'right' | 'bottom' | 'left'

export const EMPTY_SLIDESHOW_CROP: SlideshowAccumulatedCrop = {
  top: 0,
  right: 0,
  bottom: 0,
  left: 0
}

export function hasSlideshowCrop(acc: SlideshowAccumulatedCrop): boolean {
  return acc.top > 0 || acc.right > 0 || acc.bottom > 0 || acc.left > 0
}

/** Numpad crop step size from modifier keys. */
export function numpadCropStepPct(shiftKey: boolean, ctrlKey: boolean): number {
  if (shiftKey && ctrlKey) return 0.01
  if (ctrlKey) return 0.02
  if (shiftKey) return 0.05
  return 0.1
}

export function applyCropStep(
  acc: SlideshowAccumulatedCrop,
  edge: SlideshowCropEdge,
  stepPct: number
): SlideshowAccumulatedCrop {
  const next = { ...acc, [edge]: acc[edge] + stepPct }
  if (next.top + next.bottom >= 1 || next.left + next.right >= 1) {
    throw new Error('Crop would remove the entire image')
  }
  return next
}

/** Pixel extract rect for Sharp / canvas from accumulated fractions. */
export function cropExtractRect(
  width: number,
  height: number,
  acc: SlideshowAccumulatedCrop
): { left: number; top: number; width: number; height: number } {
  const left = Math.min(width - 1, Math.max(0, Math.round(width * acc.left)))
  const top = Math.min(height - 1, Math.max(0, Math.round(height * acc.top)))
  const right = Math.min(width - left - 1, Math.max(0, Math.round(width * acc.right)))
  const bottom = Math.min(height - top - 1, Math.max(0, Math.round(height * acc.bottom)))
  const w = width - left - right
  const h = height - top - bottom
  if (w < 1 || h < 1) {
    throw new Error('Crop would remove the entire image')
  }
  return { left, top, width: w, height: h }
}
