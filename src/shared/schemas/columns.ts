import { z } from 'zod'
import { FOLDER_STATS_COLUMN_IDS } from '../folderStats'

/** Built-in file columns filled from DirEntry (sync), plus opt-in async ADS. */
export const FILE_COLUMN_IDS = ['folder', 'mtime', 'ctime', 'type', 'size', 'ext', 'ads'] as const

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

export type DetailsColumnId = (typeof DETAILS_COLUMN_IDS)[number]

export const detailsColumnIdSchema = z.enum(DETAILS_COLUMN_IDS)

export type ColumnGroup = 'file' | 'folderStats' | 'image' | 'media' | 'tags' | 'generation'

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

export const DETAILS_COLUMN_META: Record<DetailsColumnId, DetailsColumnMeta> = {
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
  folderStats: 'Folder statistics',
  image: 'Image',
  media: 'Audio / video',
  tags: 'Tags',
  generation: 'Generation'
}

export const COLUMN_GROUP_ORDER: ColumnGroup[] = [
  'file',
  'folderStats',
  'image',
  'media',
  'tags',
  'generation'
]

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
  if (id === 'ads') return true
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

/** Columns that need directory rows in async metadata fetch (ADS, folder stats). */
export function columnNeedsDirectoryMeta(id: DetailsColumnId): boolean {
  return id === 'ads' || isFolderStatsColumnId(id)
}

/** Columns that need main-process metadata extraction. */
export function isAsyncColumn(id: DetailsColumnId): boolean {
  return DETAILS_COLUMN_META[id].async === true
}

export const ASYNC_COLUMN_IDS = DETAILS_COLUMN_IDS.filter(isAsyncColumn)

/** Sparse string map of column id → display value. */
export type EntryColumnValues = Partial<Record<DetailsColumnId, string>>
