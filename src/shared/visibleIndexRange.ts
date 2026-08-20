/** Visible virtual-list row span for Details meta (ADS, size, …). */

export function visibleIndexRange(opts: {
  rangeStart?: number | null
  rangeEnd?: number | null
  rowCount: number
  scrollTop?: number
  clientHeight?: number
  rowHeight: number
  overscan?: number
}): { start: number; end: number } | null {
  const n = opts.rowCount
  if (n <= 0) return null
  const last = n - 1
  const h = opts.rowHeight > 0 ? opts.rowHeight : 24
  const overscan = opts.overscan ?? 2

  let virt: { start: number; end: number } | null = null
  const rs = opts.rangeStart
  const re = opts.rangeEnd
  if (rs != null && re != null && re >= rs && rs >= 0) {
    virt = { start: rs, end: Math.min(re, last) }
  }

  // Geometry from the real scroll box. TanStack often reports a valid but
  // stale/short range (0..0, or last frame) until another wheel tick.
  let geom: { start: number; end: number } | null = null
  const viewH = opts.clientHeight ?? 0
  if (viewH > 0 || !virt) {
    const fallbackH = viewH > 0 ? viewH : h * 24
    const top = Math.max(0, opts.scrollTop ?? 0)
    const start = Math.max(0, Math.floor(top / h) - overscan)
    const end = Math.min(last, Math.ceil((top + fallbackH) / h) + overscan)
    if (end >= start) geom = { start, end }
  }

  if (virt && geom) {
    return { start: Math.min(virt.start, geom.start), end: Math.max(virt.end, geom.end) }
  }
  return virt ?? geom
}
