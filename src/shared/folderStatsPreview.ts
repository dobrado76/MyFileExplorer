/**
 * Rich folder-stats preview payload (ADS `FolderStatsPreview`) and merge helpers.
 * Used by Calculate Statistics and the folder preview pane.
 */
import {
  parseFolderStatInt,
  type FolderStatCounts,
  type FolderStatsCategoryKey,
  type FolderStatsCategoryStat,
  type FolderStatsLeaf,
  type FolderStatsPreviewPayload,
  type FolderStatsRecentEntry,
  FOLDER_STATS_CATEGORY_KEYS
} from './folderStats'

export const FOLDER_STATS_PREVIEW_JSON_MAX_BYTES = 16 * 1024 * 1024
export const FOLDER_STATS_TREEMAP_MAX_LEAVES_DEFAULT = 50_000
export const FOLDER_STATS_TREEMAP_MAX_LEAVES_MIN = 100
export const FOLDER_STATS_TREEMAP_MAX_LEAVES_MAX = 50_000

const IMAGE_EXTS = new Set([
  'jpg',
  'jpeg',
  'png',
  'gif',
  'webp',
  'heic',
  'heif',
  'bmp',
  'tif',
  'tiff',
  'ico',
  'svg',
  'avif',
  'jfif'
])
const VIDEO_EXTS = new Set([
  'mp4',
  'mkv',
  'webm',
  'mov',
  'avi',
  'wmv',
  'asf',
  'm4v',
  'mpg',
  'mpeg',
  'flv',
  'm2ts',
  'ts',
  '3gp'
])
const DOCUMENT_EXTS = new Set([
  'pdf',
  'doc',
  'docx',
  'xls',
  'xlsx',
  'ppt',
  'pptx',
  'txt',
  'md',
  'rtf',
  'odt',
  'ods',
  'odp',
  'csv',
  'tsv',
  'epub',
  'html',
  'htm',
  'json',
  'xml',
  'yml',
  'yaml'
])
const ARCHIVE_EXTS = new Set([
  'zip',
  '7z',
  'rar',
  'tar',
  'gz',
  'tgz',
  'bz2',
  'xz',
  'iso',
  'img',
  'cab',
  'lz',
  'zst'
])

export function clampFolderStatsTreemapMaxLeaves(n: unknown): number {
  const v = typeof n === 'number' ? n : Number(n)
  if (!Number.isFinite(v)) return FOLDER_STATS_TREEMAP_MAX_LEAVES_DEFAULT
  return Math.min(
    FOLDER_STATS_TREEMAP_MAX_LEAVES_MAX,
    Math.max(FOLDER_STATS_TREEMAP_MAX_LEAVES_MIN, Math.round(v))
  )
}

export function emptyCategoryStat(): FolderStatsCategoryStat {
  return { count: 0, bytes: 0 }
}

export function emptyCategories(): FolderStatsPreviewPayload['categories'] {
  return {
    images: emptyCategoryStat(),
    videos: emptyCategoryStat(),
    documents: emptyCategoryStat(),
    archives: emptyCategoryStat(),
    other: emptyCategoryStat()
  }
}

export function fileExtOf(name: string): string {
  const slash = Math.max(name.lastIndexOf('\\'), name.lastIndexOf('/'))
  const base = slash >= 0 ? name.slice(slash + 1) : name
  const i = base.lastIndexOf('.')
  if (i <= 0 || i === base.length - 1) return ''
  return base.slice(i + 1).toLowerCase()
}

export function classifyFolderStatsExt(ext: string): FolderStatsCategoryKey {
  const e = ext.startsWith('.') ? ext.slice(1).toLowerCase() : ext.toLowerCase()
  if (IMAGE_EXTS.has(e)) return 'images'
  if (VIDEO_EXTS.has(e)) return 'videos'
  if (DOCUMENT_EXTS.has(e)) return 'documents'
  if (ARCHIVE_EXTS.has(e)) return 'archives'
  return 'other'
}

export function addFileToCategories(
  categories: FolderStatsPreviewPayload['categories'],
  ext: string,
  size: number
): void {
  const key = classifyFolderStatsExt(ext)
  const row = categories[key]
  row.count += 1
  row.bytes += size > 0 ? size : 0
}

export function mergeCategories(
  a: FolderStatsPreviewPayload['categories'],
  b: FolderStatsPreviewPayload['categories']
): FolderStatsPreviewPayload['categories'] {
  const out = emptyCategories()
  for (const key of FOLDER_STATS_CATEGORY_KEYS) {
    out[key] = {
      count: a[key].count + b[key].count,
      bytes: a[key].bytes + b[key].bytes
    }
  }
  return out
}

function leafKey(leaf: FolderStatsLeaf): string {
  return leaf.relativePath.toLowerCase()
}

/** Min-heap by size (smallest at front); keep at most `maxLeaves` largest. */
export function pushLeafHeap(heap: FolderStatsLeaf[], leaf: FolderStatsLeaf, maxLeaves: number): void {
  if (maxLeaves <= 0) return
  if (heap.length < maxLeaves) {
    heap.push(leaf)
    siftUp(heap, heap.length - 1)
    return
  }
  const smallest = heap[0]!
  if (leaf.size < smallest.size) return
  if (leaf.size === smallest.size && leafKey(leaf) >= leafKey(smallest)) return
  heap[0] = leaf
  siftDown(heap, 0)
}

function siftUp(heap: FolderStatsLeaf[], i: number): void {
  while (i > 0) {
    const p = (i - 1) >> 1
    if (compareLeafMin(heap[i]!, heap[p]!) >= 0) break
    ;[heap[i], heap[p]] = [heap[p]!, heap[i]!]
    i = p
  }
}

function siftDown(heap: FolderStatsLeaf[], i: number): void {
  const n = heap.length
  for (;;) {
    let best = i
    const l = i * 2 + 1
    const r = l + 1
    if (l < n && compareLeafMin(heap[l]!, heap[best]!) < 0) best = l
    if (r < n && compareLeafMin(heap[r]!, heap[best]!) < 0) best = r
    if (best === i) break
    ;[heap[i], heap[best]] = [heap[best]!, heap[i]!]
    i = best
  }
}

/** Ascending size; tie-break path lexicographic (for min-heap). */
function compareLeafMin(a: FolderStatsLeaf, b: FolderStatsLeaf): number {
  if (a.size !== b.size) return a.size - b.size
  return leafKey(a).localeCompare(leafKey(b))
}

/** Descending size for stored leaves. */
export function sortLeavesDesc(leaves: FolderStatsLeaf[]): FolderStatsLeaf[] {
  return [...leaves].sort((a, b) => {
    if (b.size !== a.size) return b.size - a.size
    return leafKey(a).localeCompare(leafKey(b))
  })
}

export function mergeLeafHeaps(
  a: readonly FolderStatsLeaf[],
  b: readonly FolderStatsLeaf[],
  maxLeaves: number
): FolderStatsLeaf[] {
  const heap: FolderStatsLeaf[] = []
  for (const leaf of a) pushLeafHeap(heap, leaf, maxLeaves)
  for (const leaf of b) pushLeafHeap(heap, leaf, maxLeaves)
  return sortLeavesDesc(heap)
}

export function remapLeafUnderChild(leaf: FolderStatsLeaf, childName: string): FolderStatsLeaf {
  const relativePath = `${childName}\\${leaf.relativePath}`
  return { ...leaf, relativePath }
}

export function remapRecentUnderChild(
  entry: FolderStatsRecentEntry,
  childName: string
): FolderStatsRecentEntry {
  return { ...entry, relativePath: `${childName}\\${entry.relativePath}` }
}

function compareRecentDesc(a: FolderStatsRecentEntry, b: FolderStatsRecentEntry): number {
  if (b.mtimeMs !== a.mtimeMs) return b.mtimeMs - a.mtimeMs
  return a.relativePath.toLowerCase().localeCompare(b.relativePath.toLowerCase())
}

export function mergeRecent(
  a: readonly FolderStatsRecentEntry[],
  b: readonly FolderStatsRecentEntry[],
  limit = 5
): FolderStatsRecentEntry[] {
  return [...a, ...b].sort(compareRecentDesc).slice(0, limit)
}

export function mergeExtCounts(
  a: ReadonlyMap<string, number>,
  b: ReadonlyMap<string, number>
): Map<string, number> {
  const out = new Map(a)
  for (const [ext, count] of b) {
    out.set(ext, (out.get(ext) ?? 0) + count)
  }
  return out
}

export function topExtensionsFromMap(
  map: ReadonlyMap<string, number>,
  limit = 8
): { ext: string; count: number }[] {
  return [...map.entries()]
    .filter(([ext]) => ext.length > 0)
    .sort((a, b) => {
      if (b[1] !== a[1]) return b[1] - a[1]
      return a[0].localeCompare(b[0])
    })
    .slice(0, limit)
    .map(([ext, count]) => ({ ext, count }))
}

export function computeClump(
  leaves: readonly FolderStatsLeaf[],
  fileTotCount: number,
  totalSize: number
): { size: number; fileCount: number } | null {
  if (fileTotCount <= leaves.length) return null
  const leafBytes = leaves.reduce((s, l) => s + l.size, 0)
  return {
    size: Math.max(0, totalSize - leafBytes),
    fileCount: fileTotCount - leaves.length
  }
}

export type PreviewMergeState = {
  categories: FolderStatsPreviewPayload['categories']
  extCounts: Map<string, number>
  leaves: FolderStatsLeaf[]
  recent: FolderStatsRecentEntry[]
  newestMtimeMs: number
}

export function emptyPreviewMergeState(): PreviewMergeState {
  return {
    categories: emptyCategories(),
    extCounts: new Map(),
    leaves: [],
    recent: [],
    newestMtimeMs: 0
  }
}

export function addImmediateFile(
  state: PreviewMergeState,
  file: { name: string; size: number; mtimeMs: number },
  maxLeaves: number
): void {
  const ext = fileExtOf(file.name)
  addFileToCategories(state.categories, ext, file.size)
  if (ext) state.extCounts.set(ext, (state.extCounts.get(ext) ?? 0) + 1)
  pushLeafHeap(
    state.leaves,
    {
      relativePath: file.name,
      name: file.name,
      size: file.size,
      ext
    },
    maxLeaves
  )
  state.recent = mergeRecent(
    state.recent,
    [
      {
        name: file.name,
        relativePath: file.name,
        mtimeMs: file.mtimeMs,
        isDir: false
      }
    ],
    5
  )
  if (file.mtimeMs > state.newestMtimeMs) state.newestMtimeMs = file.mtimeMs
}

/**
 * Merge a child's in-memory merge state into the parent (paths remapped under `childName`).
 * `state.leaves` / `child.leaves` are min-heaps of size ≤ maxLeaves.
 */
export function mergeChildMergeState(
  state: PreviewMergeState,
  childName: string,
  child: PreviewMergeState,
  maxLeaves: number
): void {
  state.categories = mergeCategories(state.categories, child.categories)
  state.extCounts = mergeExtCounts(state.extCounts, child.extCounts)
  for (const leaf of child.leaves) {
    pushLeafHeap(state.leaves, remapLeafUnderChild(leaf, childName), maxLeaves)
  }
  const remappedRecent = child.recent.map((r) => remapRecentUnderChild(r, childName))
  const folderRecent: FolderStatsRecentEntry = {
    name: childName,
    relativePath: childName,
    mtimeMs: child.newestMtimeMs,
    isDir: true
  }
  state.recent = mergeRecent(state.recent, [...remappedRecent, folderRecent], 5)
  if (child.newestMtimeMs > state.newestMtimeMs) state.newestMtimeMs = child.newestMtimeMs
}

/**
 * Merge a child's finalized ADS preview into the parent (Shift+skip path).
 * Extension counts only include the child's stored topExtensions.
 */
export function mergeChildPreview(
  state: PreviewMergeState,
  childName: string,
  child: FolderStatsPreviewPayload,
  maxLeaves: number
): void {
  mergeChildMergeState(state, childName, previewMergeStateFromPayload(child), maxLeaves)
}

export function finalizePreviewPayload(
  state: PreviewMergeState,
  stats: FolderStatCounts,
  maxLeaves: number,
  calculatedAtMs: number
): FolderStatsPreviewPayload {
  const leaves = sortLeavesDesc(state.leaves).slice(0, maxLeaves)
  const clump = computeClump(leaves, stats.fileTotCount, stats.totalSize)
  return {
    version: 1,
    calculatedAtMs,
    categories: state.categories,
    topExtensions: topExtensionsFromMap(state.extCounts, 8),
    largest: leaves.slice(0, 5),
    recent: state.recent.slice(0, 5),
    newestMtimeMs: state.newestMtimeMs,
    leaves,
    clump,
    maxLeaves
  }
}

/** Rebuild leaves/clump at a smaller N (full leaf list must be the candidate pool). */
export function rebuildPayloadAtMaxLeaves(
  payload: FolderStatsPreviewPayload,
  stats: FolderStatCounts,
  maxLeaves: number
): FolderStatsPreviewPayload {
  const leaves = sortLeavesDesc(payload.leaves).slice(0, maxLeaves)
  return {
    ...payload,
    leaves,
    largest: leaves.slice(0, 5),
    clump: computeClump(leaves, stats.fileTotCount, stats.totalSize),
    maxLeaves
  }
}

/**
 * If JSON exceeds the ADS size cap, step down N until it fits (or N hits min).
 * `candidateLeaves` should be the full top pool already collected (≤ original N).
 */
export function shrinkPreviewPayloadForAds(
  payload: FolderStatsPreviewPayload,
  stats: FolderStatCounts,
  maxBytes = FOLDER_STATS_PREVIEW_JSON_MAX_BYTES
): FolderStatsPreviewPayload {
  const current = payload
  const json = JSON.stringify(current)
  if (json.length <= maxBytes) return current

  let lo = 1
  let hi = Math.min(current.leaves.length, current.maxLeaves)
  let best = rebuildPayloadAtMaxLeaves(current, stats, Math.max(1, Math.min(lo, hi)))

  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2)
    const trial = rebuildPayloadAtMaxLeaves(current, stats, mid)
    const s = JSON.stringify(trial)
    if (s.length <= maxBytes) {
      best = trial
      lo = mid + 1
    } else {
      hi = mid - 1
    }
  }
  return best
}

export function previewMergeStateFromPayload(payload: FolderStatsPreviewPayload): PreviewMergeState {
  const extCounts = new Map<string, number>()
  for (const { ext, count } of payload.topExtensions) {
    extCounts.set(ext, count)
  }
  return {
    categories: {
      images: { ...payload.categories.images },
      videos: { ...payload.categories.videos },
      documents: { ...payload.categories.documents },
      archives: { ...payload.categories.archives },
      other: { ...payload.categories.other }
    },
    extCounts,
    leaves: [...payload.leaves],
    recent: [...payload.recent],
    newestMtimeMs: payload.newestMtimeMs
  }
}

function isCategoryStat(v: unknown): v is FolderStatsCategoryStat {
  if (!v || typeof v !== 'object') return false
  const o = v as { count?: unknown; bytes?: unknown }
  return (
    typeof o.count === 'number' &&
    Number.isFinite(o.count) &&
    o.count >= 0 &&
    typeof o.bytes === 'number' &&
    Number.isFinite(o.bytes) &&
    o.bytes >= 0
  )
}

function isLeaf(v: unknown): v is FolderStatsLeaf {
  if (!v || typeof v !== 'object') return false
  const o = v as FolderStatsLeaf
  return (
    typeof o.relativePath === 'string' &&
    o.relativePath.length > 0 &&
    typeof o.name === 'string' &&
    typeof o.size === 'number' &&
    Number.isFinite(o.size) &&
    typeof o.ext === 'string'
  )
}

/** Parse and validate FolderStatsPreview JSON; null if missing/invalid. */
export function parseFolderStatsPreviewJson(raw: string | null | undefined): FolderStatsPreviewPayload | null {
  if (raw == null || !raw.trim()) return null
  let data: unknown
  try {
    data = JSON.parse(raw) as unknown
  } catch {
    return null
  }
  if (!data || typeof data !== 'object') return null
  const o = data as Record<string, unknown>
  if (o.version !== 1) return null
  if (typeof o.calculatedAtMs !== 'number' || !Number.isFinite(o.calculatedAtMs)) return null
  if (typeof o.newestMtimeMs !== 'number' || !Number.isFinite(o.newestMtimeMs)) return null
  if (typeof o.maxLeaves !== 'number' || !Number.isFinite(o.maxLeaves)) return null
  const cats = o.categories
  if (!cats || typeof cats !== 'object') return null
  const categories = emptyCategories()
  for (const key of FOLDER_STATS_CATEGORY_KEYS) {
    const row = (cats as Record<string, unknown>)[key]
    if (!isCategoryStat(row)) return null
    categories[key] = { count: row.count, bytes: row.bytes }
  }
  if (!Array.isArray(o.topExtensions) || !Array.isArray(o.largest) || !Array.isArray(o.recent)) {
    return null
  }
  if (!Array.isArray(o.leaves)) return null
  const leaves: FolderStatsLeaf[] = []
  for (const item of o.leaves) {
    if (!isLeaf(item)) return null
    leaves.push({
      relativePath: item.relativePath,
      name: item.name,
      size: item.size,
      ext: item.ext
    })
  }
  let clump: FolderStatsPreviewPayload['clump'] = null
  if (o.clump != null) {
    if (typeof o.clump !== 'object') return null
    const c = o.clump as { size?: unknown; fileCount?: unknown }
    if (
      typeof c.size !== 'number' ||
      !Number.isFinite(c.size) ||
      typeof c.fileCount !== 'number' ||
      !Number.isFinite(c.fileCount)
    ) {
      return null
    }
    clump = { size: c.size, fileCount: c.fileCount }
  }
  const recent: FolderStatsRecentEntry[] = []
  for (const item of o.recent) {
    if (!item || typeof item !== 'object') return null
    const r = item as FolderStatsRecentEntry
    if (
      typeof r.name !== 'string' ||
      typeof r.relativePath !== 'string' ||
      typeof r.mtimeMs !== 'number' ||
      typeof r.isDir !== 'boolean'
    ) {
      return null
    }
    recent.push({
      name: r.name,
      relativePath: r.relativePath,
      mtimeMs: r.mtimeMs,
      isDir: r.isDir
    })
  }
  const largest: FolderStatsLeaf[] = []
  for (const item of o.largest) {
    if (!isLeaf(item)) return null
    largest.push({
      relativePath: item.relativePath,
      name: item.name,
      size: item.size,
      ext: item.ext
    })
  }
  const topExtensions: { ext: string; count: number }[] = []
  for (const item of o.topExtensions) {
    if (!item || typeof item !== 'object') return null
    const t = item as { ext?: unknown; count?: unknown }
    if (typeof t.ext !== 'string' || typeof t.count !== 'number') return null
    topExtensions.push({ ext: t.ext, count: t.count })
  }
  return {
    version: 1,
    calculatedAtMs: o.calculatedAtMs,
    categories,
    topExtensions,
    largest,
    recent,
    newestMtimeMs: o.newestMtimeMs,
    leaves,
    clump,
    maxLeaves: o.maxLeaves
  }
}

/** Completeness for Shift+skip: five ints already known + valid preview JSON. */
export function folderStatsPreviewIsComplete(preview: FolderStatsPreviewPayload | null): boolean {
  return preview != null && preview.version === 1
}

/** Re-export parseFolderStatInt for callers that check ints alongside preview. */
export { parseFolderStatInt }
