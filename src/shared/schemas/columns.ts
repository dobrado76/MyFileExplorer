import { z } from 'zod'
import { isValidAdsStreamName } from '../ads/paths'
import { FOLDER_STATS_COLUMN_IDS } from '../folderStats'

export const ADS_FIELD_COLUMN_PREFIX = 'adsField:'
export const ADS_FIELD_COLUMN_DEFAULT_WIDTH = 140
export const MAX_ADS_FIELD_COLUMNS = 32
/** Built-in async columns plus room for user stream-value columns. */
export const MAX_META_FETCH_COLUMNS = 80

/** Built-in file columns filled from DirEntry (sync), plus opt-in async ADS. */
export const FILE_COLUMN_IDS = [
  'folder',
  'mtime',
  'ctime',
  'type',
  'size',
  'ext',
  'ads',
  'itemNote',
  'itemNoteStatus',
  'itemHasNote',
  'itemNoteTodos'
] as const

/** Image technical columns (Sharp / headers). */
export const IMAGE_COLUMN_IDS = [
  'dimensions',
  'width',
  'height',
  'bitDepth',
  'colorSpace',
  'orientation',
  'hasAlpha',
  'imageFormat'
] as const

/** Audio / video technical columns. */
export const MEDIA_COLUMN_IDS = [
  'duration',
  'bitrate',
  'sampleRate',
  'channels',
  'codec',
  'container',
  'frameRate',
  'mediaWidth',
  'mediaHeight'
] as const

/** Common media tags. */
export const TAG_COLUMN_IDS = [
  'title',
  'artist',
  'album',
  'albumArtist',
  'year',
  'genre',
  'track',
  'disc',
  'comment'
] as const

/** A1111 / Comfy-style generation fields (images). */
export const GEN_COLUMN_IDS = [
  'genSeed',
  'genModel',
  'genModelHash',
  'genSteps',
  'genSampler',
  'genCfg',
  'genSize',
  'genPrompt',
  'genNegative'
] as const

export const DETAILS_COLUMN_IDS = [
  ...FILE_COLUMN_IDS,
  ...FOLDER_STATS_COLUMN_IDS,
  ...IMAGE_COLUMN_IDS,
  ...MEDIA_COLUMN_IDS,
  ...TAG_COLUMN_IDS,
  ...GEN_COLUMN_IDS
] as const

export type BuiltinDetailsColumnId = (typeof DETAILS_COLUMN_IDS)[number]
export type AdsFieldColumnId = `${typeof ADS_FIELD_COLUMN_PREFIX}${string}`
export type DetailsColumnId = BuiltinDetailsColumnId | AdsFieldColumnId

export function isBuiltinDetailsColumnId(id: string): id is BuiltinDetailsColumnId {
  return (DETAILS_COLUMN_IDS as readonly string[]).includes(id)
}

export function parseAdsFieldColumnName(id: string): string | null {
  if (!id.startsWith(ADS_FIELD_COLUMN_PREFIX)) return null
  const name = id.slice(ADS_FIELD_COLUMN_PREFIX.length)
  return isValidAdsStreamName(name) ? name : null
}

export function isAdsFieldColumnId(id: string): id is AdsFieldColumnId {
  return parseAdsFieldColumnName(id) != null
}

export function adsFieldColumnId(name: string): AdsFieldColumnId {
  return `${ADS_FIELD_COLUMN_PREFIX}${name}`
}

export type AdsFieldColumnDef = {
  stream: string
  /** Pretty header; omitted or empty → use `stream`. */
  label?: string
}

export const adsFieldColumnDefSchema = z.object({
  stream: z.string().min(1).max(255),
  label: z.string().min(1).max(80).optional()
})

export const ADS_FIELD_LABEL_MAX = 80

function normalizeAdsFieldLabel(label: string | undefined, stream: string): string | undefined {
  const t = label?.trim()
  if (!t || t === stream) return undefined
  return t.slice(0, ADS_FIELD_LABEL_MAX)
}

export function adsFieldDisplayLabel(
  catalog: readonly AdsFieldColumnDef[],
  stream: string
): string {
  const key = stream.toLowerCase()
  const hit = catalog.find((c) => c.stream.toLowerCase() === key)
  return hit?.label?.trim() || hit?.stream || stream
}

export function adsFieldStreamNames(catalog: readonly AdsFieldColumnDef[]): string[] {
  return catalog.map((c) => c.stream)
}

export function sanitizeAdsFieldColumns(raw: unknown): AdsFieldColumnDef[] {
  if (!Array.isArray(raw)) return []
  const seen = new Set<string>()
  const out: AdsFieldColumnDef[] = []
  for (const item of raw) {
    let stream: string
    let label: string | undefined
    if (typeof item === 'string') {
      stream = item.trim()
    } else if (item && typeof item === 'object') {
      const o = item as { stream?: unknown; name?: unknown; label?: unknown }
      const s = typeof o.stream === 'string' ? o.stream : typeof o.name === 'string' ? o.name : ''
      stream = s.trim()
      if (typeof o.label === 'string') label = o.label
    } else {
      continue
    }
    if (!isValidAdsStreamName(stream)) continue
    const key = stream.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    const pretty = normalizeAdsFieldLabel(label, stream)
    out.push(pretty ? { stream, label: pretty } : { stream })
    if (out.length >= MAX_ADS_FIELD_COLUMNS) break
  }
  return out
}

export function mergeAdsFieldColumns(
  catalog: readonly AdsFieldColumnDef[],
  ...extras: readonly (readonly string[] | readonly AdsFieldColumnDef[])[]
): AdsFieldColumnDef[] {
  const byKey = new Map<string, AdsFieldColumnDef>()
  const add = (stream: string, label?: string): void => {
    if (!isValidAdsStreamName(stream)) return
    const key = stream.toLowerCase()
    const existing = byKey.get(key)
    const pretty = normalizeAdsFieldLabel(label, existing?.stream ?? stream)
    if (!existing) {
      byKey.set(key, pretty ? { stream, label: pretty } : { stream })
      return
    }
    if (pretty) byKey.set(key, { stream: existing.stream, label: pretty })
  }
  for (const item of catalog) add(item.stream, item.label)
  for (const list of extras) {
    for (const item of list) {
      if (typeof item === 'string') add(item)
      else add(item.stream, item.label)
    }
  }
  return [...byKey.values()].slice(0, MAX_ADS_FIELD_COLUMNS)
}

export function mergeAdsFieldColumnNames(...lists: readonly (readonly string[])[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const list of lists) {
    for (const name of list) {
      if (!isValidAdsStreamName(name)) continue
      const key = name.toLowerCase()
      if (seen.has(key)) continue
      seen.add(key)
      out.push(name)
      if (out.length >= MAX_ADS_FIELD_COLUMNS) return out
    }
  }
  return out
}

export function adsFieldNamesFromColumnIds(ids: readonly string[]): string[] {
  const names: string[] = []
  for (const id of ids) {
    const name = parseAdsFieldColumnName(id)
    if (name) names.push(name)
  }
  return names
}

export const detailsColumnIdSchema = z.string().refine(
  (id): id is DetailsColumnId => isBuiltinDetailsColumnId(id) || isAdsFieldColumnId(id),
  { message: 'Invalid column id' }
)

export type ColumnGroup =
  | 'file'
  | 'adsFields'
  | 'folderStats'
  | 'image'
  | 'media'
  | 'tags'
  | 'generation'

export type DetailsColumnMeta = {
  id: DetailsColumnId
  label: string
  group: ColumnGroup
  defaultWidth: number
  /** Right-align numeric-ish values. */
  numeric?: boolean
  /** Needs async metadata extract (not on DirEntry). */
  async?: boolean
}

export const DETAILS_COLUMN_META: Record<BuiltinDetailsColumnId, DetailsColumnMeta> = {
  /** Search results only — never shown in normal folder Details / column picker. */
  folder: {
    id: 'folder',
    label: 'Folder',
    group: 'file',
    defaultWidth: 280
  },
  mtime: { id: 'mtime', label: 'Date modified', group: 'file', defaultWidth: 150 },
  ctime: { id: 'ctime', label: 'Date created', group: 'file', defaultWidth: 150 },
  type: { id: 'type', label: 'Type', group: 'file', defaultWidth: 110 },
  size: { id: 'size', label: 'Size', group: 'file', defaultWidth: 90, numeric: true },
  ext: { id: 'ext', label: 'Extension', group: 'file', defaultWidth: 80 },
  ads: {
    id: 'ads',
    label: 'Alternate streams',
    group: 'file',
    defaultWidth: 180,
    async: true
  },
  itemNote: {
    id: 'itemNote',
    label: 'Note',
    group: 'file',
    defaultWidth: 200,
    async: true
  },
  itemNoteStatus: {
    id: 'itemNoteStatus',
    label: 'Status',
    group: 'file',
    defaultWidth: 110,
    async: true
  },
  itemHasNote: {
    id: 'itemHasNote',
    label: 'Has note',
    group: 'file',
    defaultWidth: 80,
    async: true
  },
  itemNoteTodos: {
    id: 'itemNoteTodos',
    label: 'Checklist',
    group: 'file',
    defaultWidth: 200,
    async: true
  },

  fsFileCount: {
    id: 'fsFileCount',
    label: 'Files',
    group: 'folderStats',
    defaultWidth: 72,
    numeric: true,
    async: true
  },
  fsFileTotCount: {
    id: 'fsFileTotCount',
    label: 'Total Files',
    group: 'folderStats',
    defaultWidth: 96,
    numeric: true,
    async: true
  },
  fsFolderCount: {
    id: 'fsFolderCount',
    label: 'Folders',
    group: 'folderStats',
    defaultWidth: 80,
    numeric: true,
    async: true
  },
  fsFolderTotCount: {
    id: 'fsFolderTotCount',
    label: 'Total Folders',
    group: 'folderStats',
    defaultWidth: 108,
    numeric: true,
    async: true
  },

  dimensions: {
    id: 'dimensions',
    label: 'Dimensions',
    group: 'image',
    defaultWidth: 110,
    async: true
  },
  width: { id: 'width', label: 'Width', group: 'image', defaultWidth: 70, numeric: true, async: true },
  height: {
    id: 'height',
    label: 'Height',
    group: 'image',
    defaultWidth: 70,
    numeric: true,
    async: true
  },
  bitDepth: {
    id: 'bitDepth',
    label: 'Bit depth',
    group: 'image',
    defaultWidth: 80,
    numeric: true,
    async: true
  },
  colorSpace: {
    id: 'colorSpace',
    label: 'Color space',
    group: 'image',
    defaultWidth: 100,
    async: true
  },
  orientation: {
    id: 'orientation',
    label: 'Orientation',
    group: 'image',
    defaultWidth: 90,
    async: true
  },
  hasAlpha: { id: 'hasAlpha', label: 'Alpha', group: 'image', defaultWidth: 70, async: true },
  imageFormat: {
    id: 'imageFormat',
    label: 'Image format',
    group: 'image',
    defaultWidth: 100,
    async: true
  },

  duration: {
    id: 'duration',
    label: 'Duration',
    group: 'media',
    defaultWidth: 90,
    numeric: true,
    async: true
  },
  bitrate: {
    id: 'bitrate',
    label: 'Bit rate',
    group: 'media',
    defaultWidth: 90,
    numeric: true,
    async: true
  },
  sampleRate: {
    id: 'sampleRate',
    label: 'Sample rate',
    group: 'media',
    defaultWidth: 100,
    numeric: true,
    async: true
  },
  channels: {
    id: 'channels',
    label: 'Channels',
    group: 'media',
    defaultWidth: 80,
    numeric: true,
    async: true
  },
  codec: { id: 'codec', label: 'Codec', group: 'media', defaultWidth: 100, async: true },
  container: {
    id: 'container',
    label: 'Container',
    group: 'media',
    defaultWidth: 90,
    async: true
  },
  frameRate: {
    id: 'frameRate',
    label: 'Frame rate',
    group: 'media',
    defaultWidth: 90,
    numeric: true,
    async: true
  },
  mediaWidth: {
    id: 'mediaWidth',
    label: 'Media width',
    group: 'media',
    defaultWidth: 90,
    numeric: true,
    async: true
  },
  mediaHeight: {
    id: 'mediaHeight',
    label: 'Media height',
    group: 'media',
    defaultWidth: 90,
    numeric: true,
    async: true
  },

  title: { id: 'title', label: 'Title', group: 'tags', defaultWidth: 160, async: true },
  artist: { id: 'artist', label: 'Artist', group: 'tags', defaultWidth: 140, async: true },
  album: { id: 'album', label: 'Album', group: 'tags', defaultWidth: 140, async: true },
  albumArtist: {
    id: 'albumArtist',
    label: 'Album artist',
    group: 'tags',
    defaultWidth: 140,
    async: true
  },
  year: { id: 'year', label: 'Year', group: 'tags', defaultWidth: 70, numeric: true, async: true },
  genre: { id: 'genre', label: 'Genre', group: 'tags', defaultWidth: 110, async: true },
  track: { id: 'track', label: 'Track', group: 'tags', defaultWidth: 70, numeric: true, async: true },
  disc: { id: 'disc', label: 'Disc', group: 'tags', defaultWidth: 70, numeric: true, async: true },
  comment: { id: 'comment', label: 'Comment', group: 'tags', defaultWidth: 180, async: true },

  genSeed: {
    id: 'genSeed',
    label: 'Seed',
    group: 'generation',
    defaultWidth: 110,
    async: true
  },
  genModel: {
    id: 'genModel',
    label: 'Model',
    group: 'generation',
    defaultWidth: 160,
    async: true
  },
  genModelHash: {
    id: 'genModelHash',
    label: 'Model hash',
    group: 'generation',
    defaultWidth: 100,
    async: true
  },
  genSteps: {
    id: 'genSteps',
    label: 'Steps',
    group: 'generation',
    defaultWidth: 70,
    numeric: true,
    async: true
  },
  genSampler: {
    id: 'genSampler',
    label: 'Sampler',
    group: 'generation',
    defaultWidth: 110,
    async: true
  },
  genCfg: {
    id: 'genCfg',
    label: 'CFG scale',
    group: 'generation',
    defaultWidth: 80,
    numeric: true,
    async: true
  },
  genSize: {
    id: 'genSize',
    label: 'Gen size',
    group: 'generation',
    defaultWidth: 100,
    async: true
  },
  genPrompt: {
    id: 'genPrompt',
    label: 'Prompt',
    group: 'generation',
    defaultWidth: 240,
    async: true
  },
  genNegative: {
    id: 'genNegative',
    label: 'Negative prompt',
    group: 'generation',
    defaultWidth: 200,
    async: true
  }
}

export const COLUMN_GROUP_LABELS: Record<ColumnGroup, string> = {
  file: 'File',
  adsFields: 'Stream values',
  folderStats: 'Folder statistics',
  image: 'Image',
  media: 'Audio / video',
  tags: 'Tags',
  generation: 'Generation'
}

export const COLUMN_GROUP_ORDER: ColumnGroup[] = [
  'file',
  'adsFields',
  'folderStats',
  'image',
  'media',
  'tags',
  'generation'
]

export function columnMeta(
  id: DetailsColumnId,
  adsFields: readonly AdsFieldColumnDef[] = []
): DetailsColumnMeta {
  if (isAdsFieldColumnId(id)) {
    const name = parseAdsFieldColumnName(id) ?? id.slice(ADS_FIELD_COLUMN_PREFIX.length)
    return {
      id,
      label: adsFieldDisplayLabel(adsFields, name),
      group: 'adsFields',
      defaultWidth: ADS_FIELD_COLUMN_DEFAULT_WIDTH,
      async: true
    }
  }
  return DETAILS_COLUMN_META[id]
}

export type MetaFetchOptions = {
  /** When false, do not fetch or treat Size / Files / Folders as directory meta. */
  showFolderStatistics?: boolean
}

export function isFolderStatsColumnId(id: string): boolean {
  return (FOLDER_STATS_COLUMN_IDS as readonly string[]).includes(id)
}

/** Columns fetched via meta.getMany for directory rows (includes sync Size when TotalSize ADS exists). */
export function isDirectoryMetaColumn(
  id: DetailsColumnId,
  opts?: MetaFetchOptions
): boolean {
  if (id === 'ads' || isItemNoteColumnId(id) || isAdsFieldColumnId(id)) return true
  if (opts?.showFolderStatistics === false) return false
  return columnNeedsDirectoryMeta(id) || id === 'size'
}

export function filterMetaFetchColumns(
  columns: DetailsColumnId[],
  opts?: MetaFetchOptions
): DetailsColumnId[] {
  const showStats = opts?.showFolderStatistics !== false
  return columns.filter((id) => {
    if (!showStats && (id === 'size' || isFolderStatsColumnId(id))) return false
    return isAsyncColumn(id) || id === 'size'
  })
}

/**
 * File-row meta only. `size` is already on `DirEntry`; folder TotalSize / stats
 * are directory-only and must not enqueue every file in a large listing.
 */
export function filterFileMetaFetchColumns(
  columns: DetailsColumnId[],
  opts?: MetaFetchOptions
): DetailsColumnId[] {
  return filterMetaFetchColumns(columns, opts).filter(
    (id) => id !== 'size' && !isFolderStatsColumnId(id)
  )
}

/** Directory-row meta (ADS, folder Size / Files / Folders). */
export function filterDirectoryMetaFetchColumns(
  columns: DetailsColumnId[],
  opts?: MetaFetchOptions
): DetailsColumnId[] {
  return columns.filter((id) => isDirectoryMetaColumn(id, opts))
}

export function isItemNoteColumnId(id: string): boolean {
  return (
    id === 'itemNote' ||
    id === 'itemNoteStatus' ||
    id === 'itemHasNote' ||
    id === 'itemNoteTodos'
  )
}

export function columnNeedsDirectoryMeta(id: DetailsColumnId): boolean {
  return (
    id === 'ads' ||
    isItemNoteColumnId(id) ||
    isAdsFieldColumnId(id) ||
    isFolderStatsColumnId(id)
  )
}

/** Columns that need main-process metadata extraction. */
export function isAsyncColumn(id: DetailsColumnId): boolean {
  return columnMeta(id).async === true
}

export const ASYNC_COLUMN_IDS = DETAILS_COLUMN_IDS.filter(isAsyncColumn)

/** Sparse string map of column id → display value. */
export type EntryColumnValues = Partial<Record<string, string>>
