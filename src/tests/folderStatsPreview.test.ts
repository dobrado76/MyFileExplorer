import { describe, expect, it } from 'vitest'
import {
  addImmediateFile,
  classifyFolderStatsExt,
  clampFolderStatsTreemapMaxLeaves,
  computeClump,
  emptyPreviewMergeState,
  finalizePreviewPayload,
  mergeChildMergeState,
  parseFolderStatsPreviewJson,
  shrinkPreviewPayloadForAds,
  sortLeavesDesc
} from '@shared/folderStatsPreview'
import { insertNestedLeaf, squarify, squarifyNested, type NestedTreemapNode } from '@shared/treemap'
import type { FolderStatCounts, FolderStatsLeaf } from '@shared/folderStats'

describe('classifyFolderStatsExt', () => {
  it('maps common extensions', () => {
    expect(classifyFolderStatsExt('jpg')).toBe('images')
    expect(classifyFolderStatsExt('.PNG')).toBe('images')
    expect(classifyFolderStatsExt('mp4')).toBe('videos')
    expect(classifyFolderStatsExt('docx')).toBe('documents')
    expect(classifyFolderStatsExt('zip')).toBe('archives')
    expect(classifyFolderStatsExt('exe')).toBe('other')
    expect(classifyFolderStatsExt('')).toBe('other')
  })
})

describe('clampFolderStatsTreemapMaxLeaves', () => {
  it('clamps to 100–50000', () => {
    expect(clampFolderStatsTreemapMaxLeaves(50)).toBe(100)
    expect(clampFolderStatsTreemapMaxLeaves(1000)).toBe(1000)
    expect(clampFolderStatsTreemapMaxLeaves(9000)).toBe(9000)
    expect(clampFolderStatsTreemapMaxLeaves(80_000)).toBe(50_000)
    expect(clampFolderStatsTreemapMaxLeaves('nope')).toBe(50_000)
  })
})

describe('clump + leaves', () => {
  it('returns null when every file is listed', () => {
    const leaves: FolderStatsLeaf[] = [
      { relativePath: 'a.bin', name: 'a.bin', size: 10, ext: 'bin' },
      { relativePath: 'b.bin', name: 'b.bin', size: 5, ext: 'bin' }
    ]
    expect(computeClump(leaves, 2, 15)).toBeNull()
  })

  it('clumps the long tail', () => {
    const leaves: FolderStatsLeaf[] = [
      { relativePath: 'big.bin', name: 'big.bin', size: 100, ext: 'bin' }
    ]
    expect(computeClump(leaves, 10, 150)).toEqual({ size: 50, fileCount: 9 })
  })

  it('keeps top N by size across merge', () => {
    const a = emptyPreviewMergeState()
    addImmediateFile(a, { name: 'a.mp4', size: 100, mtimeMs: 1 }, 2)
    addImmediateFile(a, { name: 'b.jpg', size: 50, mtimeMs: 2 }, 2)
    const b = emptyPreviewMergeState()
    addImmediateFile(b, { name: 'c.zip', size: 80, mtimeMs: 3 }, 2)
    mergeChildMergeState(a, 'sub', b, 2)
    const stats: FolderStatCounts = {
      fileCount: 2,
      folderCount: 1,
      fileTotCount: 3,
      folderTotCount: 1,
      totalSize: 230
    }
    const payload = finalizePreviewPayload(a, stats, 2, 1000)
    expect(payload.leaves.map((l) => l.name)).toEqual(['a.mp4', 'c.zip'])
    expect(payload.clump).toEqual({ size: 50, fileCount: 1 })
    expect(payload.categories.videos.count).toBe(1)
    expect(payload.categories.videos.bytes).toBe(100)
    expect(payload.categories.images.count).toBe(1)
    expect(payload.categories.archives.bytes).toBe(80)
    expect(payload.calculatedAtMs).toBe(1000)
  })
})

describe('shrinkPreviewPayloadForAds', () => {
  it('reduces N when JSON would exceed the cap', () => {
    const leaves: FolderStatsLeaf[] = []
    for (let i = 0; i < 40; i++) {
      leaves.push({
        relativePath: `deep\\folder\\file-${i}-${'x'.repeat(80)}.bin`,
        name: `file-${i}.bin`,
        size: 1000 - i,
        ext: 'bin'
      })
    }
    const stats: FolderStatCounts = {
      fileCount: 40,
      folderCount: 0,
      fileTotCount: 40,
      folderTotCount: 0,
      totalSize: leaves.reduce((s, l) => s + l.size, 0)
    }
    const payload = {
      version: 1 as const,
      calculatedAtMs: 1,
      categories: {
        images: { count: 0, bytes: 0 },
        videos: { count: 0, bytes: 0 },
        documents: { count: 0, bytes: 0 },
        archives: { count: 0, bytes: 0 },
        other: { count: 40, bytes: stats.totalSize }
      },
      topExtensions: [{ ext: 'bin', count: 40 }],
      largest: sortLeavesDesc(leaves).slice(0, 5),
      recent: [],
      newestMtimeMs: 0,
      leaves: sortLeavesDesc(leaves),
      clump: null,
      maxLeaves: 40
    }
    const shrunk = shrinkPreviewPayloadForAds(payload, stats, 2500)
    expect(JSON.stringify(shrunk).length).toBeLessThanOrEqual(2500)
    expect(shrunk.maxLeaves).toBeLessThan(40)
    expect(shrunk.clump).not.toBeNull()
    expect((shrunk.clump?.fileCount ?? 0) + shrunk.leaves.length).toBe(40)
  })
})

describe('parseFolderStatsPreviewJson', () => {
  it('rejects invalid or old payloads', () => {
    expect(parseFolderStatsPreviewJson('')).toBeNull()
    expect(parseFolderStatsPreviewJson('{"version":2}')).toBeNull()
    expect(parseFolderStatsPreviewJson('not json')).toBeNull()
  })

  it('round-trips a minimal valid payload', () => {
    const raw = JSON.stringify({
      version: 1,
      calculatedAtMs: 42,
      categories: {
        images: { count: 1, bytes: 10 },
        videos: { count: 0, bytes: 0 },
        documents: { count: 0, bytes: 0 },
        archives: { count: 0, bytes: 0 },
        other: { count: 0, bytes: 0 }
      },
      topExtensions: [{ ext: 'jpg', count: 1 }],
      largest: [{ relativePath: 'a.jpg', name: 'a.jpg', size: 10, ext: 'jpg' }],
      recent: [{ name: 'a.jpg', relativePath: 'a.jpg', mtimeMs: 1, isDir: false }],
      newestMtimeMs: 1,
      leaves: [{ relativePath: 'a.jpg', name: 'a.jpg', size: 10, ext: 'jpg' }],
      clump: null,
      maxLeaves: 100
    })
    const parsed = parseFolderStatsPreviewJson(raw)
    expect(parsed?.version).toBe(1)
    expect(parsed?.categories.images.bytes).toBe(10)
    expect(parsed?.leaves).toHaveLength(1)
  })
})

describe('squarify', () => {
  it('returns empty for empty input', () => {
    expect(squarify([], 0, 0, 100, 100)).toEqual([])
  })

  it('fills the container with proportional areas', () => {
    const rects = squarify(
      [
        { id: 'a', size: 60 },
        { id: 'b', size: 40 }
      ],
      0,
      0,
      100,
      50
    )
    expect(rects.length).toBe(2)
    const area = rects.reduce((s, r) => s + r.w * r.h, 0)
    expect(area).toBeCloseTo(5000, 0)
  })

  it('does not collapse equal large byte sizes into full-width strips', () => {
    const items = Array.from({ length: 16 }, (_, i) => ({
      id: `f${i}`,
      size: 40_000_000_000
    }))
    const rects = squarify(items, 0, 0, 320, 240)
    expect(rects).toHaveLength(16)
    const strips = rects.filter((r) => r.w > 300 && r.h < 20)
    expect(strips.length).toBe(0)
    for (const r of rects) {
      expect(r.w).toBeGreaterThan(8)
      expect(r.h).toBeGreaterThan(8)
    }
  })
})

describe('squarifyNested', () => {
  it('nests files under folder nodes', () => {
    const root: NestedTreemapNode = { id: 'root', name: '', size: 0, children: [] }
    insertNestedLeaf(root, ['Media', 'a.mp4'], 'leaf:0', 80)
    insertNestedLeaf(root, ['Media', 'b.jpg'], 'leaf:1', 20)
    insertNestedLeaf(root, ['readme.txt'], 'leaf:2', 10)
    const layout = squarifyNested(root, 0, 0, 200, 100)
    const files = layout.filter((r) => !r.isDir)
    expect(files.map((f) => f.id).sort()).toEqual(['leaf:0', 'leaf:1', 'leaf:2'])
    expect(layout.some((r) => r.isDir && r.depth > 0)).toBe(true)
  })

  it('covers the full area on a tiny canvas (no blank holes)', () => {
    const root: NestedTreemapNode = { id: 'root', name: '', size: 0, children: [] }
    for (let i = 0; i < 200; i++) {
      insertNestedLeaf(root, ['A', 'B', `f${i}.bin`], `leaf:${i}`, 1000 + (i % 7))
    }
    const W = 80
    const H = 48
    const layout = squarifyNested(root, 0, 0, W, H, { inset: 0 })
    const leaves = layout.filter((r) => !r.isDir)
    expect(leaves.length).toBeGreaterThan(0)
    // Every leaf pixel should be covered by at least one leaf rect (sample grid).
    const covered = Array.from({ length: H }, () => Array.from({ length: W }, () => false))
    for (const r of leaves) {
      const x0 = Math.max(0, Math.floor(r.x))
      const y0 = Math.max(0, Math.floor(r.y))
      const x1 = Math.min(W, Math.ceil(r.x + r.w))
      const y1 = Math.min(H, Math.ceil(r.y + r.h))
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) covered[y]![x] = true
      }
    }
    let holes = 0
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) if (!covered[y]![x]) holes++
    }
    expect(holes).toBe(0)
  })
})

describe('squarify holes', () => {
  it('fills the container even when many items share a tiny area', () => {
    const items = Array.from({ length: 80 }, (_, i) => ({ id: `f${i}`, size: 10 + (i % 5) }))
    const W = 40
    const H = 24
    const rects = squarify(items, 0, 0, W, H)
    expect(rects.length).toBeGreaterThan(0)
    const covered = Array.from({ length: H }, () => Array.from({ length: W }, () => false))
    for (const r of rects) {
      const x0 = Math.max(0, Math.floor(r.x))
      const y0 = Math.max(0, Math.floor(r.y))
      const x1 = Math.min(W, Math.ceil(r.x + r.w))
      const y1 = Math.min(H, Math.ceil(r.y + r.h))
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) covered[y]![x] = true
      }
    }
    let holes = 0
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) if (!covered[y]![x]) holes++
    }
    expect(holes).toBe(0)
  })
})
