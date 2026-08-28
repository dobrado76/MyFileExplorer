import { isThumbnailViewMode, type ViewMode } from './schemas/session'

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
  /** Episode title (not the show name). */
  title?: string
  showTitle?: string
}

/** Media-container listings can ignore global folders-first (covers mix with files). */
export function mediaContainerIgnoresFoldersFirst(
  mediaEnabled: boolean,
  mixFilesAndFolders: boolean,
  isContainer: boolean,
  viewMode: ViewMode
): boolean {
  return (
    mediaEnabled &&
    mixFilesAndFolders &&
    isContainer &&
    isThumbnailViewMode(viewMode)
  )
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

const VIDEO_EXT_RE =
  /\.(mp4|mkv|webm|avi|divx|mov|wmv|asf|m4v|mpg|mpeg|ts|m2ts|vob|flv|rmvb|rm)$/i

export function isMediaMetadataVideoName(name: string): boolean {
  return VIDEO_EXT_RE.test(name)
}

const JUNK_RE =
  /\b(1080p|720p|2160p|480p|4k|uhd|bluray|blu-?ray|webrip|web-?dl|webdl|hdtv|dvdrip|brrip|bdrip|x264|x265|h\.?264|h\.?265|hevc|avc|aac|ac3|dts|truehd|atmos|hdr10|hdr|dv|dolby|remux|proper|repack|extended|unrated|directors?\.?cut|multi|yify|rarbg|etrg|sparks|amiable|internal|limited|complete|season|disc\d+|cd\d+|part\s*\d+)\b/gi

/** Old CD rips: `[Part 1]`, `CD2`, `Disc 1`, `1of2`. Not TV `SxxExx`. */
const MOVIE_PART_RE =
  /(?:^|[.\s_\-[(])(?:(?:part|cd|disc)[\s._-]*\d{1,2}|\d{1,2}\s*(?:of|\/)\s*\d{1,2})(?:[.\s_\-)]|\]|$)/i

const EPISODE_RE = /(?:^|[.\s_-])(?:s(\d{1,2})e(\d{1,3})|(\d{1,2})x(\d{1,3}))(?:[.\s_-]|$)/i

const YEAR_RE = /(?:^|[.\s(_-])((?:19|20)\d{2})(?:[.\s)_-]|$)/

/** Scene/P2P `-GROUP` at the end (`x265-ION265`, `-RARBG`). Applied only on tagged names. */
const RELEASE_GROUP_RE = /\s*-[A-Za-z][A-Za-z0-9]{1,20}$/

export function stripVideoExtension(name: string): string {
  return name.replace(VIDEO_EXT_RE, '')
}

/** Filename/folder stem shown in the “search as” box (no video extension). */
export function mediaSearchStem(rawName: string): string {
  return stripVideoExtension(rawName.trim())
}

const SEARCH_AS_YEAR_RE = /\(\s*((?:19|20)\d{2})\s*\)\s*$/

/**
 * User-typed Search as query. Words are kept (no scene-tag strip).
 * Only a trailing `(1999)` is taken as the year so TMDB/OMDb can still filter remakes.
 */
export function parseMediaSearchAs(raw: string): ParsedMediaName {
  let s = stripVideoExtension(raw.trim()).replace(/\s+/g, ' ').trim()
  let year: number | undefined
  const yearHit = SEARCH_AS_YEAR_RE.exec(s)
  if (yearHit) {
    year = Number(yearHit[1])
    if (!Number.isFinite(year)) year = undefined
    else s = s.slice(0, yearHit.index).trim()
  }
  const title = s || stripVideoExtension(raw).trim()
  return { title, year, kind: year != null ? 'movie' : 'unknown' }
}

/** Lookup failed because the parsed title missed — user can edit the name and retry. */
export function isMediaNameMissError(message: string): boolean {
  const m = message.trim()
  if (/Plex Media Server was not found/i.test(m)) return false
  if (/Add a TMDB or OMDb API key/i.test(m)) return false
  return (
    /no plex match/i.test(m) ||
    /no match for/i.test(m) ||
    /no TV show matching/i.test(m) ||
    /movie not found/i.test(m) ||
    /series not found/i.test(m) ||
    /not found!/i.test(m)
  )
}

function hasJunkTags(s: string): boolean {
  JUNK_RE.lastIndex = 0
  const hit = JUNK_RE.test(s)
  JUNK_RE.lastIndex = 0
  return hit
}

function looksLikeSceneName(s: string): boolean {
  return EPISODE_RE.test(s) || YEAR_RE.test(s) || hasJunkTags(s)
}

function stripReleaseGroup(s: string): string {
  return s.replace(RELEASE_GROUP_RE, '').trim()
}

/** `-ION265` leftover after tags, not the hyphen in `Spider-Man`. */
function stripLeftoverGroup(s: string): string {
  return s.replace(/(?:^|\s)-[A-Za-z][A-Za-z0-9]{1,20}$/, '').trim()
}

function cleanTitlePart(s: string): string {
  JUNK_RE.lastIndex = 0
  s = s.replace(JUNK_RE, ' ')
  JUNK_RE.lastIndex = 0
  s = s.replace(/[[\](){}]/g, ' ').replace(/\s+/g, ' ').trim()
  return stripLeftoverGroup(s)
}

export function parseMediaFileName(rawName: string): ParsedMediaName {
  let s = stripVideoExtension(rawName.trim())
  s = s.replace(/[._]+/g, ' ').replace(/\s+/g, ' ').trim()
  if (looksLikeSceneName(s)) s = stripReleaseGroup(s)

  let season: number | undefined
  let episode: number | undefined
  const ep = EPISODE_RE.exec(s)
  const yearHit = YEAR_RE.exec(s)
  let year = yearHit ? Number(yearHit[1]) : undefined
  if (year != null && !Number.isFinite(year)) year = undefined

  if (ep) {
    season = Number(ep[1] || ep[3])
    episode = Number(ep[2] || ep[4])
    const before = s.slice(0, ep.index).trim()
    const after = s.slice(ep.index + ep[0].length).trim()
    s = before || after
  }

  if (year != null) {
    s = s.replace(YEAR_RE, ' ').replace(/\s+/g, ' ').trim()
  }

  s = cleanTitlePart(s)
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

/**
 * Episode title for icon tiles. Skips empty, “Untitled”, show-name duplicates,
 * and labels that are only an SxxExx code.
 */
export function episodeIconTitle(
  flags: Pick<MediaLibraryItemFlags, 'kind' | 'title' | 'showTitle'> | undefined
): string | null {
  if (flags?.kind !== 'episode') return null
  const title = flags.title?.trim()
  if (!title || /^untitled$/i.test(title)) return null
  const show = flags.showTitle?.trim()
  if (show && title.toLowerCase() === show.toLowerCase()) return null
  const compact = title.replace(/[\s._-]+/g, '')
  if (/^s\d{1,2}e\d{1,3}$/i.test(compact)) return null
  return title
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

export function isMoviePartVideoName(name: string): boolean {
  if (!isMediaMetadataVideoName(name)) return false
  if (parseMediaFileName(name).kind === 'episode') return false
  return MOVIE_PART_RE.test(stripVideoExtension(name))
}

function moviePartGroupKey(name: string): string {
  const stripped = `${stripVideoExtension(name).replace(MOVIE_PART_RE, ' ').trim()}.mkv`
  return parseMediaFileName(stripped).title.toLowerCase()
}

/**
 * Folder whose videos are CD/part splits of one movie (not a TV show).
 * The folder is the title; the part files are not.
 */
export function isMultipartMovieFolder(childNames: string[]): boolean {
  if (childNames.some((n) => isSeasonFolderName(n))) return false
  const videos = childNames.filter((n) => isMediaMetadataVideoName(n))
  if (videos.some((n) => parseMediaFileName(n).kind === 'episode')) return false
  const parts = videos.filter((n) => isMoviePartVideoName(n))
  if (parts.length < 2) return false
  const counts = new Map<string, number>()
  for (const n of parts) {
    const key = moviePartGroupKey(n)
    if (!key) continue
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  return [...counts.values()].some((n) => n >= 2)
}

/**
 * Folders that get a movie/show card + cover.
 * Direct children of a library (selected root or a generic dump name) always qualify.
 */
export function isMediaTitleFolder(opts: {
  name: string
  parentName: string
  parentIsSelectedRoot: boolean
  nonSeasonChildFolderCount: number
}): boolean {
  if (isGenericMediaFolderName(opts.name) || isSeasonFolderName(opts.name)) return false
  if (opts.parentIsSelectedRoot || isGenericMediaFolderName(opts.parentName)) return true
  return opts.nonSeasonChildFolderCount <= 8
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
    if (parsed.kind === 'movie' || parsed.year != null) return 'movie'
    if (episodeVideos.length > 0) return 'episode'
    return 'ambiguous'
  }

  if (isGenericMediaFolderName(opts.name) || isSeasonFolderName(opts.name)) return 'ambiguous'
  if (seasonDirs.length > 0 || episodeVideos.length > 0) return 'show'
  if (isMultipartMovieFolder(children)) return 'movie'
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

/** Cap how many remakes / same-title hits we show in the picker. */
export const MEDIA_PICK_MAX = 12

export type MediaPickCandidate = {
  id: string
  title: string
  year?: number
  subtitle?: string
}

export type NamedYearHit = {
  title: string
  year?: number
}

export type NamedMatchDecision<T> =
  | { action: 'auto'; hit: T }
  | { action: 'ask'; hits: T[] }
  | { action: 'none' }

export function normalizeMediaTitle(s: string): string {
  return s
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

/**
 * Auto-pick when the year or a unique exact title is enough.
 * Ask only when several results share the same exact title and the year
 * does not uniquely choose one (Dune 1984 vs 2021).
 */
export function decideNamedMatches<T extends NamedYearHit>(
  results: T[],
  queryTitle: string,
  queryYear?: number
): NamedMatchDecision<T> {
  if (results.length === 0) return { action: 'none' }
  if (results.length === 1) return { action: 'auto', hit: results[0]! }
  const q = normalizeMediaTitle(queryTitle)
  const exact = results.filter((r) => normalizeMediaTitle(r.title) === q)
  const pool = exact.length > 0 ? exact : results
  if (queryYear != null) {
    const yearHits = pool.filter((r) => r.year === queryYear)
    if (yearHits.length === 1) return { action: 'auto', hit: yearHits[0]! }
    if (yearHits.length > 1) return { action: 'ask', hits: yearHits.slice(0, MEDIA_PICK_MAX) }
    if (exact.length === 1) return { action: 'auto', hit: exact[0]! }
    if (exact.length > 1) return { action: 'ask', hits: exact.slice(0, MEDIA_PICK_MAX) }
    return { action: 'auto', hit: results[0]! }
  }
  if (exact.length > 1) return { action: 'ask', hits: exact.slice(0, MEDIA_PICK_MAX) }
  if (exact.length === 1) return { action: 'auto', hit: exact[0]! }
  return { action: 'auto', hit: results[0]! }
}

export class NeedsMediaPickError extends Error {
  readonly candidates: MediaPickCandidate[]
  constructor(candidates: MediaPickCandidate[]) {
    super('Multiple titles match')
    this.name = 'NeedsMediaPickError'
    this.candidates = candidates
  }
}

export function isNeedsMediaPickError(e: unknown): e is NeedsMediaPickError {
  return e instanceof NeedsMediaPickError
}

/**
 * Search as may be a TMDB / IMDb / OMDb title URL (or a raw `tt…` / `tmdb:movie:id`).
 * Returns the same pick id Download already understands, or null to treat as a title.
 */
export function parseMediaSourceInput(raw: string): string | null {
  const s = raw.trim().replace(/^['"]+|['"]+$/g, '')
  if (!s) return null
  const tmdbPick = /^tmdb:(movie|tv):(\d+)$/i.exec(s)
  if (tmdbPick?.[1] && tmdbPick[2]) return `tmdb:${tmdbPick[1].toLowerCase()}:${tmdbPick[2]}`
  const omdbPick = /^omdb:(tt\d+)$/i.exec(s)
  if (omdbPick?.[1]) return `omdb:${omdbPick[1].toLowerCase()}`
  const imdbId = /^(tt\d+)$/i.exec(s)
  if (imdbId?.[1]) return `omdb:${imdbId[1].toLowerCase()}`

  const tmdbPage = /(?:themoviedb\.org|tmdb\.org)\/(movie|tv)\/(\d+)/i.exec(s)
  if (tmdbPage?.[1] && tmdbPage[2]) return `tmdb:${tmdbPage[1].toLowerCase()}:${tmdbPage[2]}`

  const imdbPage = /imdb\.com\/title\/(tt\d+)/i.exec(s)
  if (imdbPage?.[1]) return `omdb:${imdbPage[1].toLowerCase()}`
  const omdbApi = /omdbapi\.com\/[^#]*[?&]i=(tt\d+)/i.exec(s)
  if (omdbApi?.[1]) return `omdb:${omdbApi[1].toLowerCase()}`
  return null
}

/** Re-fetch the same internet title on Update without searching again. */
export function pickIdFromStored(meta: MediaMetadata): string | undefined {
  if (meta.source === 'tmdb' && meta.sourceId) {
    const movie = /^movie:(\d+)/.exec(meta.sourceId)
    if (movie?.[1]) return `tmdb:movie:${movie[1]}`
    const tv = /^tv:(\d+)/.exec(meta.sourceId)
    if (tv?.[1]) return `tmdb:tv:${tv[1]}`
  }
  if (meta.source === 'omdb' && meta.sourceId) return `omdb:${meta.sourceId}`
  return undefined
}
