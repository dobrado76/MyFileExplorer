/**
 * C#-scale virtual compiled playlist: segments hold unique paths once;
 * logical length can reach Int32.MaxValue without materializing path×count.
 */
import { randomFillSync } from 'node:crypto'
import path from 'node:path'
import type { SlideshowOrder } from '@shared/schemas/slideshow'
import type { LastListLine } from '@shared/slideshow/compiledLists'
import { compareNames, nameSortModeOf } from '@shared/fileNameCompare'
import { readDatIndex } from './compiledLists'
import { logMain } from '../logging'
import { settingsStore } from '../settings/store'

/** Match C# `int` max indexable length. */
export const COMPILED_PLAYLIST_MAX = 2_147_483_647

/** Above this, use Feistel permutation instead of a Uint32Array shuffle buffer. */
const SHUFFLE_ARRAY_MAX = 50_000_000

/** Flat expandComposite refuse threshold (debug / legacy IPC only). */
export const EXPAND_COMPOSITE_SAFE_MAX = 500_000

type Segment = {
  paths: string[]
  repeat: number
  /** Exclusive end of this segment in logical space (prefix sum). */
  end: number
}

type VirtualPlaylist = {
  segments: Segment[]
  total: number
  truncated: boolean
  /** playPos → logicalIndex when random + total ≤ SHUFFLE_ARRAY_MAX */
  perm: Uint32Array | null
  /** Feistel key when random + total > SHUFFLE_ARRAY_MAX */
  feistelKey: number
  order: SlideshowOrder
  ascending: boolean
  /** Identity of the last.txt lines this session was built from. */
  linesKey: string
  listCounts: { path: string; fileCount: number }[]
  skip: Set<string>
}

/** Last image the slideshow actually showed. Rebuilds keep this instead of jumping to 0. */
let committedIndex = 0
let committedPath: string | null = null

let session: VirtualPlaylist | null = null

function sortPathsByName(paths: string[], ascending: boolean): void {
  const dir = ascending ? 1 : -1
  paths.sort((a, b) => {
    const an = path.basename(a)
    const bn = path.basename(b)
    return compareNames(an, bn, nameSortModeOf(settingsStore().get().nameSortMode)) * dir
  })
}

/** Fast Fisher–Yates on Uint32Array using crypto random blocks. */
function shuffleUint32(arr: Uint32Array): void {
  const n = arr.length
  const buf = new Uint32Array(256)
  let bi = buf.length
  const nextRand = (): number => {
    if (bi >= buf.length) {
      randomFillSync(buf)
      bi = 0
    }
    return buf[bi++]!
  }
  for (let i = n - 1; i > 0; i--) {
    const j = nextRand() % (i + 1)
    const t = arr[i]!
    arr[i] = arr[j]!
    arr[j] = t
  }
}

function buildIdentityPerm(n: number): Uint32Array {
  const perm = new Uint32Array(n)
  for (let i = 0; i < n; i++) perm[i] = i
  shuffleUint32(perm)
  return perm
}

/** Power-of-two Feistel cycle-walk: bijective-ish map playPos → [0, n) without a perm buffer. */
function feistelIndex(playPos: number, n: number, key: number): number {
  if (n <= 1) return 0
  let m = 1
  while (m < n && m < 0x40000000) m <<= 1
  if (m < n) m = n
  let x = ((playPos % m) + m) % m
  for (let guard = 0; guard < 16; guard++) {
    let v = x >>> 0
    for (let r = 0; r < 5; r++) {
      const l = v >>> 16
      const rg = v & 0xffff
      const f = (Math.imul(rg + key + r * 0x9e3779b9, 0x85ebca6b) >>> 0) & 0xffff
      v = ((rg << 16) | ((l ^ f) & 0xffff)) >>> 0
    }
    const y = v % m
    if (y < n) return y
    x = (x + 1) % m
  }
  return playPos % n
}

function logicalFromPlayPos(playPos: number, vp: VirtualPlaylist): number {
  const n = vp.total
  if (n <= 0) return 0
  const p = ((playPos % n) + n) % n
  if (vp.order === 'random') {
    if (vp.perm) return vp.perm[p]!
    return feistelIndex(p, n, vp.feistelKey)
  }
  return p
}

function resolveLogical(logical: number, vp: VirtualPlaylist): string | null {
  if (vp.total <= 0 || logical < 0 || logical >= vp.total) return null
  const segs = vp.segments
  let lo = 0
  let hi = segs.length - 1
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (logical < segs[mid]!.end) hi = mid
    else lo = mid + 1
  }
  const seg = segs[lo]!
  const start = lo === 0 ? 0 : segs[lo - 1]!.end
  const offset = logical - start
  const len = seg.paths.length
  if (len === 0) return null
  return seg.paths[offset % len] ?? null
}

export type CompiledPlaylistSnapshot = {
  total: number
  index: number
  path: string | null
  truncated: boolean
  /** Expanded image counts per list file (for Nb. Files after on-the-fly compile). */
  listCounts?: { path: string; fileCount: number }[]
}

export function clearVirtualPlaylist(): void {
  session = null
  committedIndex = 0
  committedPath = null
}

function pathIfLive(playIndex: number, vp: VirtualPlaylist): string | null {
  if (vp.total <= 0 || playIndex < 0 || playIndex >= vp.total) return null
  const logical = logicalFromPlayPos(playIndex, vp)
  const p = resolveLogical(logical, vp)
  if (!p) return null
  if (vp.skip.has(p.toLowerCase())) return null
  return p
}

/**
 * Walk play indexes until a path that is still in the list is found.
 * `includeStart` true = Home/End/seek may stay on `start`.
 */
export function findLivePlayIndex(
  start: number,
  dir: 1 | -1,
  loop: boolean,
  includeStart: boolean
): { index: number; path: string } | null {
  const vp = session
  if (!vp || vp.total <= 0) return null
  const n = vp.total
  const cap = Math.min(n, 100_000)
  let i = Math.max(0, Math.min(Math.floor(start), n - 1))
  if (!includeStart) {
    i += dir
    if (i >= n || i < 0) {
      if (!loop) return null
      i = i >= n ? 0 : n - 1
    }
  }
  for (let step = 0; step < cap; step++) {
    const p = pathIfLive(i, vp)
    if (p) return { index: i, path: p }
    i += dir
    if (i >= n || i < 0) {
      if (!loop) return null
      i = i >= n ? 0 : n - 1
    }
  }
  return null
}

export function commitPlayCursor(index: number, path: string | null): void {
  committedIndex = index
  committedPath = path
}

export function committedPlayCursor(): { index: number; path: string | null } {
  return { index: committedIndex, path: committedPath }
}

export function getVirtualPlaylistTotal(): number {
  return session?.total ?? 0
}

export function pathAtPlayIndex(playIndex: number): string | null {
  const vp = session
  if (!vp || vp.total <= 0) return null
  const i = Math.max(0, Math.min(Math.floor(playIndex), vp.total - 1))
  return pathIfLive(i, vp)
}

export function snapshotAt(playIndex: number): CompiledPlaylistSnapshot {
  const vp = session
  if (!vp) {
    return { total: 0, index: 0, path: null, truncated: false }
  }
  const found = findLivePlayIndex(playIndex, 1, false, true)
  if (!found) {
    return { total: vp.total, index: 0, path: null, truncated: vp.truncated }
  }
  return {
    total: vp.total,
    index: found.index,
    path: found.path,
    truncated: vp.truncated
  }
}

/**
 * Build virtual playlist from last.txt-style lines. Loads each list file once.
 */
export async function buildVirtualPlaylist(
  lines: LastListLine[],
  order: SlideshowOrder,
  ascending: boolean
): Promise<CompiledPlaylistSnapshot & { built: true }> {
  const linesKey = lines.map((l) => `${l.datPath.toLowerCase()}\0${l.count}`).join('\n')
  if (
    session &&
    session.linesKey === linesKey &&
    session.order === order &&
    session.ascending === ascending
  ) {
    return {
      ...snapshotAt(committedIndex),
      built: true,
      listCounts: session.listCounts
    }
  }

  const prevSkip = session?.skip
  const segments: Segment[] = []
  const listCounts: { path: string; fileCount: number }[] = []
  let total = 0
  let truncated = false

  for (const line of lines) {
    if (line.count <= 0) continue
    let paths: string[]
    try {
      paths = await readDatIndex(line.datPath)
    } catch {
      continue
    }
    listCounts.push({ path: line.datPath, fileCount: paths.length })
    if (paths.length === 0) continue

    // Own copy — same list file may appear in multiple lines.
    paths = paths.slice()
    if (order === 'name' || order === 'size' || order === 'dimensions') {
      // Per-segment name sort only (size/dimensions treated as name for compiled virtual).
      sortPathsByName(paths, ascending)
    }

    const repeat = Math.max(0, Math.floor(line.count))
    const add = paths.length * repeat
    if (add <= 0) continue

    if (total >= COMPILED_PLAYLIST_MAX) {
      truncated = true
      break
    }
    let useRepeat = repeat
    if (total + add > COMPILED_PLAYLIST_MAX) {
      const room = COMPILED_PLAYLIST_MAX - total
      useRepeat = Math.floor(room / paths.length)
      truncated = true
      if (useRepeat <= 0) break
    }
    total += paths.length * useRepeat
    segments.push({ paths, repeat: useRepeat, end: total })
  }

  let perm: Uint32Array | null = null
  let feistelKey = (Math.random() * 0xffffffff) >>> 0
  if (order === 'random' && total > 1) {
    if (total <= SHUFFLE_ARRAY_MAX) {
      try {
        perm = buildIdentityPerm(total)
      } catch (e) {
        logMain(
          'warn',
          `virtual playlist shuffle alloc failed (${total}): ${e instanceof Error ? e.message : String(e)} — using Feistel`
        )
        perm = null
        feistelKey = (Math.random() * 0xffffffff) >>> 0
      }
    }
  }

  session = {
    segments,
    total,
    truncated,
    perm,
    feistelKey,
    order,
    ascending,
    linesKey,
    listCounts,
    skip: prevSkip ? new Set(prevSkip) : new Set()
  }

  if (truncated) {
    logMain('warn', `Compiled playlist truncated to ${COMPILED_PLAYLIST_MAX} (C# int max)`)
  }
  logMain(
    'info',
    `Virtual compiled playlist: ${total} entries, ${segments.length} segment(s), order=${order}${perm ? ', Uint32 shuffle' : order === 'random' ? ', Feistel' : ''}`
  )

  return { ...snapshotAt(0), built: true, listCounts }
}

/** Prefer keeping the same image path when rebuilding; else clamp play index. */
export function snapshotPreferPath(
  preferPath: string | null | undefined,
  fallbackIndex: number
): CompiledPlaylistSnapshot {
  const vp = session
  if (!vp || vp.total <= 0) {
    return { total: 0, index: 0, path: null, truncated: vp?.truncated ?? false }
  }
  if (preferPath) {
    const want = preferPath.toLowerCase()
    // Scan a bounded window around fallback for the preferred path via resolve
    // Full scan of 42M is impossible — search segments for membership, then pick first play pos that maps near it.
    for (const seg of vp.segments) {
      const idx = seg.paths.findIndex((p) => p.toLowerCase() === want)
      if (idx < 0) continue
      // Approximate play index: start of segment + idx (sequential) — good enough for name order;
      // for random, just keep fallbackIndex if path still resolvable there, else 0.
      const start = seg === vp.segments[0] ? 0 : vp.segments[vp.segments.indexOf(seg) - 1]!.end
      const logical = start + idx
      if (vp.skip.has(want)) break
      if (vp.order !== 'random') {
        return {
          total: vp.total,
          index: Math.min(logical, vp.total - 1),
          path: preferPath,
          truncated: vp.truncated
        }
      }
      const atFallback = pathAtPlayIndex(Math.max(0, Math.min(fallbackIndex, vp.total - 1)))
      if (atFallback && atFallback.toLowerCase() === want) {
        return {
          total: vp.total,
          index: Math.max(0, Math.min(fallbackIndex, vp.total - 1)),
          path: preferPath,
          truncated: vp.truncated
        }
      }
      break
    }
  }
  return snapshotAt(Math.max(0, Math.min(fallbackIndex, vp.total - 1)))
}

export function markSkipped(filePath: string): void {
  if (!session) return
  session.skip.add(filePath.toLowerCase())
}

export function unmarkSkipped(filePath: string): void {
  if (!session) return
  session.skip.delete(filePath.toLowerCase())
}

/** Estimate flat expand size without allocating (for expandComposite guard). */
export async function estimateExpandedCount(lines: LastListLine[]): Promise<number> {
  let total = 0
  for (const line of lines) {
    if (line.count <= 0) continue
    try {
      const paths = await readDatIndex(line.datPath)
      total += paths.length * Math.max(0, Math.floor(line.count))
      if (total > EXPAND_COMPOSITE_SAFE_MAX) return total
    } catch {
      /* skip */
    }
  }
  return total
}
