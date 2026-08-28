import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type JSX } from 'react'
import {
  insertNestedLeaf,
  squarifyNested,
  type NestedTreemapNode,
  type NestedTreemapRect
} from '@shared/treemap'
import type { FolderStatsLeaf } from '@shared/folderStats'
import { formatBytesBinary } from '@shared/driveSpace'

export type FolderStatsTreemapProps = {
  leaves: FolderStatsLeaf[]
  onLeafClick: (leaf: FolderStatsLeaf) => void
  onLeafDoubleClick: (leaf: FolderStatsLeaf) => void
}

type Hit = { kind: 'leaf'; leaf: FolderStatsLeaf; rect: NestedTreemapRect }

/** Stable WinDirStat-like palette: hash extension → vivid HSL. */
function colorForExtension(ext: string): { r: number; g: number; b: number } {
  const key = (ext || '(none)').toLowerCase()
  let h = 2166136261
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  const hue = h >>> 0
  const H = hue % 360
  const S = 62 + (hue % 20)
  const L = 42 + (hue % 12)
  return hslToRgb(H / 360, S / 100, L / 100)
}

function hslToRgb(h: number, s: number, l: number): { r: number; g: number; b: number } {
  if (s === 0) {
    const v = Math.round(l * 255)
    return { r: v, g: v, b: v }
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s
  const p = 2 * l - q
  const t = (n: number): number => {
    let x = n
    if (x < 0) x += 1
    if (x > 1) x -= 1
    if (x < 1 / 6) return p + (q - p) * 6 * x
    if (x < 1 / 2) return q
    if (x < 2 / 3) return p + (q - p) * (2 / 3 - x) * 6
    return p
  }
  return {
    r: Math.round(t(h + 1 / 3) * 255),
    g: Math.round(t(h) * 255),
    b: Math.round(t(h - 1 / 3) * 255)
  }
}

function splitPath(rel: string): string[] {
  return rel
    .replace(/\//g, '\\')
    .split('\\')
    .map((s) => s.trim())
    .filter(Boolean)
}

/** Soft cushion shading (WinDirStat-style highlight from upper-left). */
function fillCushion(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  rgb: { r: number; g: number; b: number }
): void {
  const { r, g, b } = rgb
  ctx.fillStyle = `rgb(${r},${g},${b})`
  ctx.fillRect(x, y, w, h)

  const cx = x + w * 0.28
  const cy = y + h * 0.22
  const rad = Math.max(w, h) * 0.85
  const grad = ctx.createRadialGradient(cx, cy, 0, x + w * 0.55, y + h * 0.55, rad)
  grad.addColorStop(0, 'rgba(255,255,255,0.42)')
  grad.addColorStop(0.35, `rgba(${r},${g},${b},0.15)`)
  grad.addColorStop(0.75, 'rgba(0,0,0,0.12)')
  grad.addColorStop(1, 'rgba(0,0,0,0.38)')
  ctx.fillStyle = grad
  ctx.fillRect(x, y, w, h)

  if (w > 14 && h > 14) {
    const g2 = ctx.createLinearGradient(x, y, x + w, y + h)
    g2.addColorStop(0, 'rgba(255,255,255,0.18)')
    g2.addColorStop(0.45, 'rgba(255,255,255,0)')
    g2.addColorStop(1, 'rgba(0,0,0,0.22)')
    ctx.fillStyle = g2
    ctx.fillRect(x, y, w, h)
  }
}

function rectContains(outer: NestedTreemapRect, inner: NestedTreemapRect, eps = 0.75): boolean {
  return (
    inner.x >= outer.x - eps &&
    inner.y >= outer.y - eps &&
    inner.x + inner.w <= outer.x + outer.w + eps &&
    inner.y + inner.h <= outer.y + outer.h + eps
  )
}

function sameDirIds(a: NestedTreemapRect[], b: NestedTreemapRect[]): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) if (a[i]!.id !== b[i]!.id) return false
  return true
}

export function FolderStatsTreemap({
  leaves,
  onLeafClick,
  onLeafDoubleClick
}: FolderStatsTreemapProps): JSX.Element | null {
  const wrapRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const baseCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const [size, setSize] = useState({ w: 0, h: 0 })
  const [tip, setTip] = useState<{ x: number; y: number; text: string } | null>(null)
  const tipRef = useRef<HTMLDivElement>(null)
  const hitsRef = useRef<Hit[]>([])
  const dirRectsRef = useRef<NestedTreemapRect[]>([])
  const hoverDirsRef = useRef<NestedTreemapRect[]>([])
  const lastClickRef = useRef<{ id: string; t: number } | null>(null)

  const leafById = useMemo(() => {
    const m = new Map<string, FolderStatsLeaf>()
    for (let i = 0; i < leaves.length; i++) m.set(`leaf:${i}`, leaves[i]!)
    return m
  }, [leaves])

  const tree = useMemo((): NestedTreemapNode | null => {
    const root: NestedTreemapNode = { id: 'root', name: '', size: 0, children: [] }
    for (let i = 0; i < leaves.length; i++) {
      const leaf = leaves[i]!
      if (leaf.size <= 0) continue
      insertNestedLeaf(root, splitPath(leaf.relativePath), `leaf:${i}`, leaf.size)
    }
    return root.size > 0 ? root : null
  }, [leaves])

  const composeFrame = useCallback(() => {
    const canvas = canvasRef.current
    const base = baseCanvasRef.current
    if (!canvas || !base || size.w < 2 || size.h < 2) return
    const dpr = window.devicePixelRatio || 1
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    ctx.drawImage(base, 0, 0)

    const dirs = hoverDirsRef.current
    if (dirs.length === 0) return
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    for (let i = 0; i < dirs.length; i++) {
      const d = dirs[i]!
      const isInner = i === dirs.length - 1
      // Dark amber — readable over vivid tiles without bleaching the edge.
      ctx.strokeStyle = isInner ? 'rgba(160, 100, 20, 0.85)' : 'rgba(120, 75, 16, 0.55)'
      ctx.lineWidth = isInner ? 1.5 : 1
      ctx.strokeRect(d.x + 0.5, d.y + 0.5, Math.max(0, d.w - 1), Math.max(0, d.h - 1))
    }
  }, [size.w, size.h])

  const setHoverDirs = useCallback(
    (dirs: NestedTreemapRect[]) => {
      if (sameDirIds(hoverDirsRef.current, dirs)) return
      hoverDirsRef.current = dirs
      composeFrame()
    },
    [composeFrame]
  )

  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const measure = (): void => {
      const w = Math.max(0, Math.floor(el.clientWidth))
      const h = Math.max(0, Math.floor(el.clientHeight))
      setSize((prev) => (prev.w === w && prev.h === h ? prev : { w, h }))
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !tree || size.w < 2 || size.h < 2) {
      hitsRef.current = []
      dirRectsRef.current = []
      hoverDirsRef.current = []
      return
    }
    const dpr = window.devicePixelRatio || 1
    const bw = Math.floor(size.w * dpr)
    const bh = Math.floor(size.h * dpr)
    canvas.width = bw
    canvas.height = bh
    canvas.style.width = '100%'
    canvas.style.height = '100%'

    // Fresh offscreen buffer each paint (avoids mutating a ref-held canvas).
    const base = document.createElement('canvas')
    base.width = bw
    base.height = bh
    baseCanvasRef.current = base
    const ctx = base.getContext('2d')
    if (!ctx) return
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, size.w, size.h)
    ctx.fillStyle = '#0c0e12'
    ctx.fillRect(0, 0, size.w, size.h)

    // inset 0 + shared right/bottom edges → uniform 1px seams (no folder+file double stroke).
    const layout = squarifyNested(tree, 0, 0, size.w, size.h, { inset: 0 })
    const hits: Hit[] = []
    const dirs: NestedTreemapRect[] = []

    // Shared right/bottom hairlines (abutting tiles share one line).
    const strokeSharedEdges = (x: number, y: number, w: number, h: number) => {
      ctx.strokeStyle = 'rgba(0,0,0,0.4)'
      ctx.lineWidth = 1
      ctx.beginPath()
      const right = x + w - 0.5
      const bottom = y + h - 0.5
      if (right < size.w - 0.5) {
        ctx.moveTo(right, y)
        ctx.lineTo(right, y + h)
      }
      if (bottom < size.h - 0.5) {
        ctx.moveTo(x, bottom)
        ctx.lineTo(x + w, bottom)
      }
      ctx.stroke()
    }

    // Pass 1: solid overpaint seals float seams so the dark clear never peeks through
    // as black patches between tiny tiles. Pass 2: cushion + borders (unchanged look).
    type LeafDraw = {
      leaf: FolderStatsLeaf
      x: number
      y: number
      w: number
      h: number
      rgb: { r: number; g: number; b: number }
      rect: NestedTreemapRect
    }
    const draws: LeafDraw[] = []

    for (const rect of layout) {
      if (rect.isDir) {
        if (rect.id !== 'root' && rect.depth > 0) dirs.push(rect)
        continue
      }
      const x = rect.x
      const y = rect.y
      const w = rect.w
      const h = rect.h
      if (w <= 0 || h <= 0) continue
      const leaf = leafById.get(rect.id)
      if (!leaf) continue
      draws.push({
        leaf,
        x,
        y,
        w,
        h,
        rgb: colorForExtension(leaf.ext),
        rect: { ...rect, x, y, w, h }
      })
    }

    for (const d of draws) {
      const { r, g, b } = d.rgb
      ctx.fillStyle = `rgb(${r},${g},${b})`
      ctx.fillRect(d.x, d.y, d.w + 1, d.h + 1)
    }
    for (const d of draws) {
      fillCushion(ctx, d.x, d.y, d.w, d.h, d.rgb)
      strokeSharedEdges(d.x, d.y, d.w, d.h)
      hits.push({ kind: 'leaf', leaf: d.leaf, rect: d.rect })
    }

    hitsRef.current = hits
    dirRectsRef.current = dirs
    hoverDirsRef.current = []
    composeFrame()
  }, [tree, size, leafById, composeFrame])

  const hitTest = useCallback((clientX: number, clientY: number): Hit | null => {
    const canvas = canvasRef.current
    if (!canvas) return null
    const r = canvas.getBoundingClientRect()
    const x = ((clientX - r.left) / r.width) * size.w
    const y = ((clientY - r.top) / r.height) * size.h
    for (let i = hitsRef.current.length - 1; i >= 0; i--) {
      const hit = hitsRef.current[i]!
      const { x: hx, y: hy, w, h } = hit.rect
      if (x >= hx && x < hx + w && y >= hy && y < hy + h) return hit
    }
    return null
  }, [size.w, size.h])

  const foldersForHit = useCallback((hit: Hit): NestedTreemapRect[] => {
    return dirRectsRef.current
      .filter((d) => rectContains(d, hit.rect))
      .sort((a, b) => a.depth - b.depth)
  }, [])

  // Flip / clamp so the tip never gets crushed against the viewport edge.
  useLayoutEffect(() => {
    const el = tipRef.current
    if (!tip || !el) return
    const pad = 8
    const gap = 12
    const tw = el.offsetWidth
    const th = el.offsetHeight
    let left = tip.x + gap
    let top = tip.y + gap
    if (left + tw > window.innerWidth - pad) left = tip.x - gap - tw
    if (top + th > window.innerHeight - pad) top = tip.y - gap - th
    left = Math.max(pad, Math.min(left, window.innerWidth - tw - pad))
    top = Math.max(pad, Math.min(top, window.innerHeight - th - pad))
    el.style.left = `${left}px`
    el.style.top = `${top}px`
  }, [tip])

  if (!tree) return null

  return (
    <div className="folder-stats-treemap" ref={wrapRef}>
      <canvas
        ref={canvasRef}
        className="folder-stats-treemap-canvas"
        role="img"
        aria-label={`Space map of ${leaves.length.toLocaleString()} largest files`}
        onMouseMove={(e) => {
          const hit = hitTest(e.clientX, e.clientY)
          if (!hit) {
            setHoverDirs([])
            setTip(null)
            return
          }
          const folders = foldersForHit(hit)
          setHoverDirs(folders)
          setTip({
            x: e.clientX,
            y: e.clientY,
            text: `${hit.leaf.relativePath} · ${formatBytesBinary(hit.leaf.size)}${
              hit.leaf.ext ? ` · .${hit.leaf.ext}` : ''
            }`
          })
        }}
        onMouseLeave={() => {
          setHoverDirs([])
          setTip(null)
        }}
        onClick={(e) => {
          const hit = hitTest(e.clientX, e.clientY)
          if (!hit) return
          const now = Date.now()
          const prev = lastClickRef.current
          if (prev && prev.id === hit.leaf.relativePath && now - prev.t < 400) {
            lastClickRef.current = null
            onLeafDoubleClick(hit.leaf)
            return
          }
          lastClickRef.current = { id: hit.leaf.relativePath, t: now }
          onLeafClick(hit.leaf)
        }}
      />
      {tip ? (
        <div ref={tipRef} className="folder-stats-treemap-tip" role="tooltip">
          {tip.text}
        </div>
      ) : null}
    </div>
  )
}
