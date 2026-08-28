/** Treemap layout for folder space maps (WinDirStat-style rectangles). */

export type TreemapInput = {
  id: string
  size: number
}

export type TreemapRect = {
  id: string
  size: number
  x: number
  y: number
  w: number
  h: number
}

/** Nested node for hierarchical maps. */
export type NestedTreemapNode = {
  id: string
  name: string
  size: number
  /** Present on file leaves. */
  leafId?: string
  children?: NestedTreemapNode[]
}

export type NestedTreemapRect = TreemapRect & {
  /** True for directory frames (borders / nesting only). */
  isDir?: boolean
  depth: number
}

/**
 * Size-balanced binary partition along the longer axis.
 *
 * Classic Bruls squarify fed with raw byte sizes (or with a flat leftover
 * band) collapses into full-width horizontal strips. BSP always fills the
 * rectangle with proper tiles — the WinDirStat look users expect.
 */
export function squarify(
  items: readonly TreemapInput[],
  x: number,
  y: number,
  w: number,
  h: number
): TreemapRect[] {
  const positive = items.filter((i) => i.size > 0 && Number.isFinite(i.size))
  if (positive.length === 0 || w <= 0 || h <= 0) return []

  const sorted = [...positive].sort((a, b) => b.size - a.size)
  const out: TreemapRect[] = []

  function layout(list: TreemapInput[], rx: number, ry: number, rw: number, rh: number): void {
    if (list.length === 0 || rw < 0.5 || rh < 0.5) return
    if (list.length === 1) {
      out.push({
        id: list[0]!.id,
        size: list[0]!.size,
        x: rx,
        y: ry,
        w: rw,
        h: rh
      })
      return
    }

    const total = list.reduce((s, i) => s + i.size, 0)
    let acc = 0
    let bestI = 0
    let bestDiff = Infinity
    for (let i = 0; i < list.length - 1; i++) {
      acc += list[i]!.size
      const diff = Math.abs(0.5 - acc / total)
      if (diff < bestDiff) {
        bestDiff = diff
        bestI = i
      }
    }

    const left = list.slice(0, bestI + 1)
    const right = list.slice(bestI + 1)
    const leftSum = left.reduce((s, i) => s + i.size, 0)
    const frac = leftSum / total

    if (rw >= rh) {
      const lw = rw * frac
      layout(left, rx, ry, lw, rh)
      layout(right, rx + lw, ry, rw - lw, rh)
    } else {
      const lh = rh * frac
      layout(left, rx, ry, rw, lh)
      layout(right, rx, ry + lh, rw, rh - lh)
    }
  }

  layout(sorted, x, y, w, h)
  return out
}

/**
 * Recursively layout a folder tree (WinDirStat-style nesting).
 * Directory nodes get a 1px inset so children sit inside parent frames.
 */
export function squarifyNested(
  root: NestedTreemapNode,
  x: number,
  y: number,
  w: number,
  h: number,
  opts?: { inset?: number; maxDepth?: number }
): NestedTreemapRect[] {
  const inset = opts?.inset ?? 1
  const maxDepth = opts?.maxDepth ?? 24
  const out: NestedTreemapRect[] = []

  function walk(
    node: NestedTreemapNode,
    rx: number,
    ry: number,
    rw: number,
    rh: number,
    depth: number
  ): void {
    if (rw < 1 || rh < 1 || node.size <= 0) return
    const kids = node.children?.filter((c) => c.size > 0) ?? []
    if (kids.length === 0 || !node.children || depth >= maxDepth) {
      out.push({ id: node.id, size: node.size, x: rx, y: ry, w: rw, h: rh, depth, isDir: false })
      return
    }

    out.push({ id: node.id, size: node.size, x: rx, y: ry, w: rw, h: rh, depth, isDir: true })

    const pad = depth === 0 ? 0 : inset
    const ix = rx + pad
    const iy = ry + pad
    const iw = rw - pad * 2
    const ih = rh - pad * 2
    if (iw < 1 || ih < 1) return

    const layout = squarify(
      kids.map((c) => ({ id: c.id, size: c.size })),
      ix,
      iy,
      iw,
      ih
    )
    const byId = new Map(kids.map((c) => [c.id, c]))
    for (const rect of layout) {
      const child = byId.get(rect.id)
      if (!child) continue
      walk(child, rect.x, rect.y, rect.w, rect.h, depth + 1)
    }
  }

  walk(root, x, y, w, h, 0)
  return out
}

/** Insert a file leaf into a mutable tree by path segments. File nodes use `leafId` as `id`. */
export function insertNestedLeaf(
  root: NestedTreemapNode,
  segments: string[],
  leafId: string,
  size: number
): void {
  if (segments.length === 0) return
  let node = root
  for (let i = 0; i < segments.length; i++) {
    const name = segments[i]!
    const isFile = i === segments.length - 1
    if (!node.children) node.children = []
    let child = node.children.find((c) =>
      isFile ? c.leafId === leafId : c.name === name && !c.leafId
    )
    if (!child) {
      child = isFile
        ? { id: leafId, name, size: 0, leafId }
        : { id: `${node.id}/${name}`, name, size: 0, children: [] }
      node.children.push(child)
    }
    child.size += size
    node = child
  }
  root.size += size
}
