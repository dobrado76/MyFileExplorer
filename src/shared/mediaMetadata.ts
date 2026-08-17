/** NTFS ADS names for experimental media metadata (DEV-gated). */
export const MEDIA_METADATA_ADS = 'media_metadata'
export const MEDIA_METADATA_THUMB_ADS = 'media_metadata_thumbnail'
/** Folder flag: this directory holds media that has metadata (toolbar filters). */
export const MEDIA_METADATA_CONTAINER_ADS = 'media_metadata_container'

export const MEDIA_METADATA_VERSION = 1 as const

export type MediaMetadataSource = 'plex' | 'tmdb' | 'omdb'

export type MediaMetadataKind = 'movie' | 'show' | 'episode'

export type MediaMetadataRating = {
  source: string
  value: number
  max?: number
}

export type MediaMetadata = {
  version: typeof MEDIA_METADATA_VERSION
  source: MediaMetadataSource
  sourceId?: string
  kind: MediaMetadataKind
  title: string
  year?: number
  originalLanguage?: string
  country?: string[]
  genres?: string[]
  synopsis?: string
  directors?: string[]
  actors?: string[]
  ratings?: MediaMetadataRating[]
  season?: number
  episode?: number
  showTitle?: string
  fetchedAt: string
  /** User-set; preserved across extract / download / update. */
  watched?: boolean
}

export type MediaWatchedFilter = 'all' | 'watched' | 'unwatched'

export type MediaLibraryItemFlags = {
  watched: boolean
  genres: string[]
  kind?: MediaMetadataKind
  season?: number
  episode?: number
}

export function matchesMediaLibraryFilter(
  flags: MediaLibraryItemFlags | undefined,
  watched: MediaWatchedFilter,
  genre: string | null
): boolean {
  const isWatched = flags?.watched === true
  if (watched === 'watched' && !isWatched) return false
  if (watched === 'unwatched' && isWatched) return false
  if (genre) {
    const want = genre.toLowerCase()
    if (!(flags?.genres ?? []).some((g) => g.toLowerCase() === want)) return false
  }
  return true
}

export type ParsedMediaName = {
  title: string
  year?: number
  season?: number
  episode?: number
  kind: 'movie' | 'episode' | 'unknown'
}

const VIDEO_EXT_RE = /\.(mp4|mkv|webm|avi|divx|mov|wmv|m4v|mpg|mpeg|ts|m2ts|vob)$/i

export function isMediaMetadataVideoName(name: string): boolean {
  return VIDEO_EXT_RE.test(name)
}

const JUNK_RE =
  /\b(1080p|720p|2160p|480p|4k|uhd|bluray|blu-?ray|webrip|web-?dl|webdl|hdtv|dvdrip|brrip|bdrip|x264|x265|h\.?264|h\.?265|hevc|avc|aac|ac3|dts|truehd|atmos|hdr10|hdr|dv|dolby|remux|proper|repack|extended|unrated|directors?\.?cut|multi|yify|rarbg|etrg|sparks|amiable|internal|limited|complete|season|disc\d+|cd\d+)\b/gi

const EPISODE_RE = /(?:^|[.\s_-])(?:s(\d{1,2})e(\d{1,3})|(\d{1,2})x(\d{1,3}))(?:[.\s_-]|$)/i

const YEAR_RE = /(?:^|[.\s(_-])((?:19|20)\d{2})(?:[.\s)_-]|$)/

export function stripVideoExtension(name: string): string {
  return name.replace(VIDEO_EXT_RE, '')
}

export function parseMediaFileName(rawName: string): ParsedMediaName {
  let s = stripVideoExtension(rawName.trim())
  s = s.replace(/[._]+/g, ' ').replace(/\s+/g, ' ').trim()

  let season: number | undefined
  let episode: number | undefined
  const ep = EPISODE_RE.exec(s)
  if (ep) {
    season = Number(ep[1] || ep[3])
    episode = Number(ep[2] || ep[4])
    s = (s.slice(0, ep.index) + ' ' + s.slice(ep.index + ep[0].length)).trim()
  }

  let year: number | undefined
  const ym = YEAR_RE.exec(s)
  if (ym) {
    year = Number(ym[1])
    s = (s.slice(0, ym.index) + ' ' + s.slice(ym.index + ym[0].length)).trim()
  }

  s = s.replace(JUNK_RE, ' ')
  s = s.replace(/[[\](){}]/g, ' ').replace(/\s+/g, ' ').trim()
  const title = s || stripVideoExtension(rawName).replace(/[._]+/g, ' ').trim()

  const kind: ParsedMediaName['kind'] =
    season != null && episode != null ? 'episode' : year != null ? 'movie' : 'unknown'
  return { title, year, season, episode, kind }
}

export function isMediaMetadata(value: unknown): value is MediaMetadata {
  if (!value || typeof value !== 'object') return false
  const o = value as Record<string, unknown>
  return (
    o.version === MEDIA_METADATA_VERSION &&
    (o.source === 'plex' || o.source === 'tmdb' || o.source === 'omdb') &&
    (o.kind === 'movie' || o.kind === 'show' || o.kind === 'episode') &&
    typeof o.title === 'string' &&
    o.title.trim().length > 0
  )
}

export function formatMediaRating(value: number): string {
  if (!Number.isFinite(value)) return ''
  const rounded = Math.round(value * 10) / 10
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1)
}

/** Compact `S01E07`. Missing season becomes 1 when an episode number is present. */
export function formatEpisodeCode(season?: number, episode?: number): string | null {
  if (season == null && episode == null) return null
  const sNum = episode != null ? (season ?? 1) : season
  const s = sNum != null ? `S${String(sNum).padStart(2, '0')}` : ''
  const e = episode != null ? `E${String(episode).padStart(2, '0')}` : ''
  return `${s}${e}` || null
}

/** Fill S/E from the file name; default season to 1 for episode records. */
export function normalizeEpisodeFields(meta: MediaMetadata, fileName?: string): MediaMetadata {
  if (meta.kind !== 'episode') return meta
  const parsed = fileName ? parseMediaFileName(fileName) : { season: undefined, episode: undefined }
  const episode = meta.episode ?? parsed.episode
  const season = meta.season ?? parsed.season ?? 1
  return { ...meta, season, episode }
}

/** Icon/list label for an episode when stored S/E metadata exists. */
export function episodeIconLabel(
  flags: Pick<MediaLibraryItemFlags, 'kind' | 'season' | 'episode'> | undefined
): string | null {
  if (flags?.kind !== 'episode') return null
  return formatEpisodeCode(flags.season, flags.episode)
}

/** True for episode files (stored kind, or SxxExx / NxNN in the name). */
export function isEpisodeListEntry(
  name: string,
  flags?: Pick<MediaLibraryItemFlags, 'kind'>
): boolean {
  if (flags?.kind === 'episode') return true
  return parseMediaFileName(name).kind === 'episode'
}

const GENERIC_MEDIA_FOLDER_RE =
  /^(movies?|films?|tv|tvs|television|series|shows?|tv[ ._-]?shows?|tv[ ._-]?series|videos?|downloads?|media|anime|cartoons?|documentaries|documentary|collections?|kids|children|4k|uhd|hdr|1080p|720p|2160p|season\s*\d+|s\d{1,2}|specials|extras)$/i

export function isGenericMediaFolderName(name: string): boolean {
  return GENERIC_MEDIA_FOLDER_RE.test(name.trim())
}

export function isSeasonFolderName(name: string): boolean {
  return /^(season\s*\d+|s\d{1,2}|specials)$/i.test(name.trim())
}

export type MediaQueryKind = 'movie' | 'show' | 'episode'

/**
 * Infer movie / show / episode from a file or folder name plus optional children.
 * `ambiguous` is rare (yearless title, no episode siblings) — the UI should ask.
 */
export function classifyMediaFromNames(opts: {
  name: string
  isDirectory: boolean
  childNames?: string[]
}): MediaQueryKind | 'ambiguous' {
  const parsed = parseMediaFileName(opts.name)
  const children = opts.childNames ?? []
  const videos = children.filter((n) => isMediaMetadataVideoName(n))
  const episodeVideos = videos.filter((n) => parseMediaFileName(n).kind === 'episode')
  const seasonDirs = children.filter((n) => isSeasonFolderName(n))

  if (!opts.isDirectory) {
    if (parsed.kind === 'episode') return 'episode'
    if (episodeVideos.length > 0) return 'episode'
    if (parsed.kind === 'movie' || parsed.year != null) return 'movie'
    return 'ambiguous'
  }

  if (isGenericMediaFolderName(opts.name) || isSeasonFolderName(opts.name)) return 'ambiguous'
  if (seasonDirs.length > 0 || episodeVideos.length > 0) return 'show'
  if (parsed.kind === 'movie' || parsed.year != null) return 'movie'
  if (videos.length >= 3) return 'show'
  return 'ambiguous'
}

export function parseMediaMetadataJson(text: string): MediaMetadata | null {
  try {
    const raw = JSON.parse(text) as unknown
    return isMediaMetadata(raw) ? raw : null
  } catch {
    return null
  }
}
