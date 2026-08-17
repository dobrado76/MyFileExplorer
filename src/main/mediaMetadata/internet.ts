import { AppError } from '@shared/result'
import { isMediaApiLimitPayload, mediaApiLimitMessage } from '@shared/mediaApiLimit'
import {
  decideNamedMatches,
  NeedsMediaPickError,
  type MediaMetadata,
  type MediaQueryKind,
  type NamedMatchDecision,
  type ParsedMediaName
} from '@shared/mediaMetadata'
import { getSettings } from '../settings/store'

type NetHit = {
  meta: MediaMetadata
  thumbUrl: string | null
}

function tmdbHeaders(key: string): Record<string, string> {
  if (key.startsWith('eyJ')) {
    return { Accept: 'application/json', Authorization: `Bearer ${key}` }
  }
  return { Accept: 'application/json' }
}

function tmdbUrl(pathAndQuery: string, key: string): string {
  const href = `https://api.themoviedb.org/3${pathAndQuery}`
  if (key.startsWith('eyJ')) return href
  const sep = href.includes('?') ? '&' : '?'
  return `${href}${sep}api_key=${encodeURIComponent(key)}`
}

function serviceForUrl(url: string): 'TMDB' | 'OMDb' | 'Internet' {
  if (/themoviedb\.org/i.test(url)) return 'TMDB'
  if (/omdbapi\.com/i.test(url)) return 'OMDb'
  return 'Internet'
}

function throwIfApiLimit(status: number, raw: string, data: unknown, url: string): void {
  if (!isMediaApiLimitPayload(status, raw, data)) return
  throw new AppError('busy', mediaApiLimitMessage(serviceForUrl(url)))
}

async function fetchJson(url: string, headers?: Record<string, string>): Promise<unknown> {
  const ac = new AbortController()
  const t = setTimeout(() => ac.abort(), 18000)
  try {
    const res = await fetch(url, { signal: ac.signal, headers })
    const raw = await res.text()
    let data: unknown = null
    if (raw.trim()) {
      try {
        data = JSON.parse(raw) as unknown
      } catch {
        data = null
      }
    }
    throwIfApiLimit(res.status, raw, data, url)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    if (data == null) throw new Error(`HTTP ${res.status}`)
    return data
  } finally {
    clearTimeout(t)
  }
}

function tmdbPosterUrl(posterPath: string | null | undefined): string | null {
  if (!posterPath) return null
  return `https://image.tmdb.org/t/p/original${posterPath}`
}

function pickNames(crew: unknown, job: string): string[] {
  if (!Array.isArray(crew)) return []
  return crew
    .filter((c) => c && typeof c === 'object' && String((c as { job?: string }).job) === job)
    .map((c) => String((c as { name?: string }).name ?? ''))
    .filter(Boolean)
}

function pickCast(cast: unknown, n: number): string[] {
  if (!Array.isArray(cast)) return []
  return cast
    .map((c) => String((c as { name?: string }).name ?? ''))
    .filter(Boolean)
    .slice(0, n)
}

function yearFromDate(iso?: string): number | undefined {
  const year = Number((iso ?? '').slice(0, 4))
  return Number.isFinite(year) && year > 1800 ? year : undefined
}

function clipOverview(s?: string): string | undefined {
  const t = s?.replace(/\s+/g, ' ').trim()
  if (!t) return undefined
  return t.length > 96 ? `${t.slice(0, 93)}…` : t
}

function parseTmdbPickId(pickId?: string): { kind: 'movie' | 'tv'; id: number } | null {
  if (!pickId) return null
  const m = /^tmdb:(movie|tv):(\d+)$/.exec(pickId)
  if (!m?.[1] || !m[2]) return null
  const id = Number(m[2])
  if (!Number.isFinite(id)) return null
  return { kind: m[1] as 'movie' | 'tv', id }
}

function parseOmdbPickId(pickId?: string): string | null {
  if (!pickId) return null
  const m = /^omdb:(tt\d+)$/i.exec(pickId)
  return m?.[1] ?? null
}

function throwIfAsk<T extends { numericId: number; id: string; title: string; year?: number; subtitle?: string }>(
  decision: NamedMatchDecision<T>
): number {
  if (decision.action === 'none') return -1
  if (decision.action === 'ask') throw new NeedsMediaPickError(decision.hits)
  return decision.hit.numericId
}

async function pickTmdbShowId(
  parsed: ParsedMediaName,
  key: string,
  headers: Record<string, string>,
  pickId?: string
): Promise<number> {
  const picked = parseTmdbPickId(pickId)
  if (picked?.kind === 'tv') return picked.id
  const search = (await fetchJson(
    tmdbUrl(`/search/tv?query=${encodeURIComponent(parsed.title)}`, key),
    headers
  )) as { results?: { id: number; name?: string; first_air_date?: string; overview?: string }[] }
  const rows = (search.results ?? [])
    .filter((r) => Number.isFinite(r.id))
    .map((r) => {
      const overview = clipOverview(r.overview)
      return {
        id: `tmdb:tv:${r.id}`,
        numericId: r.id,
        title: r.name ?? '',
        year: yearFromDate(r.first_air_date),
        subtitle: overview ? `TV show · ${overview}` : 'TV show'
      }
    })
  const decision = decideNamedMatches(rows, parsed.title, parsed.year)
  const id = throwIfAsk(decision)
  if (id < 0) throw new Error(`TMDB: no TV show matching “${parsed.title}”`)
  return id
}

async function pickTmdbMovieId(
  parsed: ParsedMediaName,
  key: string,
  headers: Record<string, string>,
  pickId?: string
): Promise<number> {
  const picked = parseTmdbPickId(pickId)
  if (picked?.kind === 'movie') return picked.id
  const search = (await fetchJson(
    tmdbUrl(`/search/movie?query=${encodeURIComponent(parsed.title)}`, key),
    headers
  )) as { results?: { id: number; title?: string; release_date?: string; overview?: string }[] }
  const rows = (search.results ?? [])
    .filter((r) => Number.isFinite(r.id))
    .map((r) => {
      const overview = clipOverview(r.overview)
      return {
        id: `tmdb:movie:${r.id}`,
        numericId: r.id,
        title: r.title ?? '',
        year: yearFromDate(r.release_date),
        subtitle: overview ? `Movie · ${overview}` : 'Movie'
      }
    })
  const decision = decideNamedMatches(rows, parsed.title, parsed.year)
  const id = throwIfAsk(decision)
  if (id < 0) throw new Error(`TMDB: no match for “${parsed.title}”`)
  return id
}

async function fromTmdbShow(
  parsed: ParsedMediaName,
  key: string,
  headers: Record<string, string>,
  pickId?: string
): Promise<NetHit> {
  const showId = await pickTmdbShowId(parsed, key, headers, pickId)
  const details = (await fetchJson(
    tmdbUrl(`/tv/${showId}?append_to_response=credits`, key),
    headers
  )) as {
    name?: string
    first_air_date?: string
    overview?: string
    original_language?: string
    origin_country?: string[]
    genres?: { name?: string }[]
    poster_path?: string
    vote_average?: number
    credits?: { crew?: unknown; cast?: unknown }
    created_by?: { name?: string }[]
  }
  const year = Number((details.first_air_date ?? '').slice(0, 4))
  return {
    meta: {
      version: 1,
      source: 'tmdb',
      sourceId: `tv:${showId}`,
      kind: 'show',
      title: details.name || parsed.title,
      year: Number.isFinite(year) && year > 1800 ? year : parsed.year,
      originalLanguage: details.original_language || undefined,
      country: details.origin_country,
      genres: (details.genres ?? []).map((g) => g.name ?? '').filter(Boolean),
      synopsis: details.overview || undefined,
      directors: (details.created_by ?? []).map((c) => c.name ?? '').filter(Boolean),
      actors: pickCast(details.credits?.cast, 20),
      ratings:
        details.vote_average != null
          ? [{ source: 'TMDB', value: Number(details.vote_average), max: 10 }]
          : undefined,
      fetchedAt: new Date().toISOString()
    },
    thumbUrl: tmdbPosterUrl(details.poster_path)
  }
}

async function fromTmdb(
  parsed: ParsedMediaName,
  key: string,
  queryKind?: MediaQueryKind,
  pickId?: string
): Promise<NetHit> {
  const headers = tmdbHeaders(key)
  const picked = parseTmdbPickId(pickId)
  if (queryKind === 'show' && parsed.kind !== 'episode') {
    return fromTmdbShow(parsed, key, headers, pickId)
  }
  if (picked?.kind === 'tv' && parsed.kind !== 'episode') {
    return fromTmdbShow(parsed, key, headers, pickId)
  }
  if (parsed.kind === 'episode' && parsed.season != null && parsed.episode != null) {
    const showId = await pickTmdbShowId(parsed, key, headers, pickId)
    const details = (await fetchJson(
      tmdbUrl(`/tv/${showId}?append_to_response=credits`, key),
      headers
    )) as {
      name?: string
      first_air_date?: string
      overview?: string
      original_language?: string
      origin_country?: string[]
      genres?: { name?: string }[]
      poster_path?: string
      vote_average?: number
      credits?: { crew?: unknown; cast?: unknown }
      created_by?: { name?: string }[]
    }
    const ep = (await fetchJson(
      tmdbUrl(`/tv/${showId}/season/${parsed.season}/episode/${parsed.episode}`, key),
      headers
    )) as {
      name?: string
      overview?: string
      still_path?: string
      vote_average?: number
      crew?: unknown
      guest_stars?: unknown
    }
    const year = Number((details.first_air_date ?? '').slice(0, 4))
    return {
      meta: {
        version: 1,
        source: 'tmdb',
        sourceId: `tv:${showId}:s${parsed.season}e${parsed.episode}`,
        kind: 'episode',
        title: ep.name || parsed.title,
        year: Number.isFinite(year) && year > 1800 ? year : parsed.year,
        originalLanguage: details.original_language || undefined,
        country: details.origin_country,
        genres: (details.genres ?? []).map((g) => g.name ?? '').filter(Boolean),
        synopsis: ep.overview || details.overview || undefined,
        directors: pickNames(ep.crew, 'Director'),
        actors: [
          ...pickCast(details.credits?.cast, 12),
          ...pickCast(ep.guest_stars, 8)
        ].slice(0, 20),
        ratings:
          ep.vote_average != null
            ? [{ source: 'TMDB', value: Number(ep.vote_average), max: 10 }]
            : undefined,
        season: parsed.season,
        episode: parsed.episode,
        showTitle: details.name || parsed.title,
        fetchedAt: new Date().toISOString()
      },
      thumbUrl: tmdbPosterUrl(ep.still_path) ?? tmdbPosterUrl(details.poster_path)
    }
  }

  if (queryKind !== 'movie' && picked?.kind !== 'movie') {
    try {
      return await fromTmdbShow(parsed, key, headers, pickId)
    } catch (e) {
      if (e instanceof NeedsMediaPickError) throw e
      /* fall through to movie */
    }
  }

  let movieId: number
  try {
    movieId = await pickTmdbMovieId(parsed, key, headers, pickId)
  } catch (e) {
    if (e instanceof NeedsMediaPickError) throw e
    if (queryKind === 'movie') {
      try {
        return await fromTmdbShow(parsed, key, headers, pickId)
      } catch (inner) {
        if (inner instanceof NeedsMediaPickError) throw inner
        throw new Error(`TMDB: no match for “${parsed.title}”`, { cause: inner })
      }
    }
    throw e instanceof Error ? e : new Error(`TMDB: no match for “${parsed.title}”`)
  }

  const details = (await fetchJson(
    tmdbUrl(`/movie/${movieId}?append_to_response=credits`, key),
    headers
  )) as {
    title?: string
    release_date?: string
    overview?: string
    original_language?: string
    production_countries?: { name?: string; iso_3166_1?: string }[]
    genres?: { name?: string }[]
    poster_path?: string
    vote_average?: number
    credits?: { crew?: unknown; cast?: unknown }
  }
  const year = Number((details.release_date ?? '').slice(0, 4))
  return {
    meta: {
      version: 1,
      source: 'tmdb',
      sourceId: `movie:${movieId}`,
      kind: 'movie',
      title: details.title || parsed.title,
      year: Number.isFinite(year) && year > 1800 ? year : parsed.year,
      originalLanguage: details.original_language || undefined,
      country: (details.production_countries ?? [])
        .map((c) => c.name || c.iso_3166_1 || '')
        .filter(Boolean),
      genres: (details.genres ?? []).map((g) => g.name ?? '').filter(Boolean),
      synopsis: details.overview || undefined,
      directors: pickNames(details.credits?.crew, 'Director'),
      actors: pickCast(details.credits?.cast, 20),
      ratings:
        details.vote_average != null
          ? [{ source: 'TMDB', value: Number(details.vote_average), max: 10 }]
          : undefined,
      fetchedAt: new Date().toISOString()
    },
    thumbUrl: tmdbPosterUrl(details.poster_path)
  }
}

type OmdbTitlePayload = {
  Response?: string
  Error?: string
  Year?: string
  Type?: string
  Title?: string
  imdbID?: string
  Language?: string
  Country?: string
  Genre?: string
  Plot?: string
  Director?: string
  Actors?: string
  Poster?: string
  Ratings?: { Source: string; Value: string }[]
}

function omdbTypeParam(parsed: ParsedMediaName, queryKind?: MediaQueryKind): string | undefined {
  if (
    (queryKind === 'episode' || parsed.kind === 'episode') &&
    parsed.season != null &&
    parsed.episode != null
  ) {
    return 'episode'
  }
  if (queryKind === 'show') return 'series'
  if (queryKind === 'movie' || parsed.kind === 'movie') return 'movie'
  return undefined
}

async function fetchOmdbTitle(params: URLSearchParams, parsed: ParsedMediaName): Promise<NetHit> {
  const data = (await fetchJson(`https://www.omdbapi.com/?${params.toString()}`)) as OmdbTitlePayload
  if (data.Response === 'False') {
    if (isMediaApiLimitPayload(200, data.Error ?? '', data)) {
      throw new AppError('busy', mediaApiLimitMessage('OMDb'))
    }
    throw new Error(data.Error || `OMDb: no match for “${parsed.title}”`)
  }
  const year = Number(String(data.Year ?? '').slice(0, 4))
  const ratings = (Array.isArray(data.Ratings) ? data.Ratings : [])
    .map((r) => {
      const num = Number.parseFloat(r.Value)
      return {
        source: r.Source,
        value: Number.isFinite(num) ? num : 0,
        max: r.Value.includes('/') ? Number(r.Value.split('/')[1]) : undefined
      }
    })
    .filter((r) => r.value > 0)
  const kind: MediaMetadata['kind'] =
    data.Type === 'series' ? 'show' : data.Type === 'episode' ? 'episode' : 'movie'
  return {
    meta: {
      version: 1,
      source: 'omdb',
      sourceId: data.imdbID || undefined,
      kind,
      title: data.Title || parsed.title,
      year: Number.isFinite(year) && year > 1800 ? year : parsed.year,
      originalLanguage: data.Language ? data.Language.split(',')[0]?.trim() : undefined,
      country: data.Country ? data.Country.split(',').map((s) => s.trim()).filter(Boolean) : undefined,
      genres: data.Genre ? data.Genre.split(',').map((s) => s.trim()).filter(Boolean) : undefined,
      synopsis: data.Plot && data.Plot !== 'N/A' ? data.Plot : undefined,
      directors: data.Director && data.Director !== 'N/A' ? data.Director.split(',').map((s) => s.trim()) : undefined,
      actors: data.Actors && data.Actors !== 'N/A' ? data.Actors.split(',').map((s) => s.trim()) : undefined,
      ratings: ratings.length > 0 ? ratings : undefined,
      season: parsed.season,
      episode: parsed.episode,
      showTitle: kind === 'episode' ? parsed.title : undefined,
      fetchedAt: new Date().toISOString()
    },
    thumbUrl: data.Poster && data.Poster !== 'N/A' ? data.Poster : null
  }
}

async function pickOmdbImdbId(
  parsed: ParsedMediaName,
  key: string,
  queryKind?: MediaQueryKind
): Promise<string | null> {
  const params = new URLSearchParams({ apikey: key, s: parsed.title })
  const type = omdbTypeParam(parsed, queryKind)
  if (type && type !== 'episode') params.set('type', type)
  const data = (await fetchJson(`https://www.omdbapi.com/?${params.toString()}`)) as {
    Response?: string
    Error?: string
    Search?: { Title?: string; Year?: string; imdbID?: string; Type?: string }[]
  }
  if (data.Response === 'False') {
    if (isMediaApiLimitPayload(200, data.Error ?? '', data)) {
      throw new AppError('busy', mediaApiLimitMessage('OMDb'))
    }
    return null
  }
  const rows = (data.Search ?? [])
    .filter((r) => typeof r.imdbID === 'string' && r.imdbID)
    .map((r) => {
      const kindLabel = r.Type === 'series' ? 'TV show' : r.Type === 'episode' ? 'Episode' : 'Movie'
      return {
        id: `omdb:${r.imdbID}`,
        numericId: 0,
        imdbID: r.imdbID!,
        title: r.Title ?? '',
        year: yearFromDate(r.Year),
        subtitle: kindLabel
      }
    })
  const decision = decideNamedMatches(rows, parsed.title, parsed.year)
  if (decision.action === 'none') return null
  if (decision.action === 'ask') {
    throw new NeedsMediaPickError(
      decision.hits.map(({ id, title, year, subtitle }) => ({ id, title, year, subtitle }))
    )
  }
  return decision.hit.imdbID
}

async function fromOmdb(
  parsed: ParsedMediaName,
  key: string,
  queryKind?: MediaQueryKind,
  pickId?: string
): Promise<NetHit> {
  const picked = parseOmdbPickId(pickId)
  const params = new URLSearchParams({ apikey: key })
  if (picked) {
    params.set('i', picked)
  } else if (
    !parsed.year &&
    parsed.kind !== 'episode' &&
    queryKind !== 'episode'
  ) {
    const imdb = await pickOmdbImdbId(parsed, key, queryKind)
    if (imdb) {
      params.set('i', imdb)
    } else {
      params.set('t', parsed.title)
    }
  } else {
    params.set('t', parsed.title)
    if (parsed.year) params.set('y', String(parsed.year))
  }
  if (
    (queryKind === 'episode' || parsed.kind === 'episode') &&
    parsed.season != null &&
    parsed.episode != null
  ) {
    params.set('type', 'episode')
    params.set('Season', String(parsed.season))
    params.set('Episode', String(parsed.episode))
  } else if (queryKind === 'show' && !params.has('i')) {
    params.set('type', 'series')
  } else if ((queryKind === 'movie' || parsed.kind === 'movie') && !params.has('i')) {
    params.set('type', 'movie')
  }
  return fetchOmdbTitle(params, parsed)
}

export function tmdbPosterPreviewUrl(posterPath: string): string {
  return `https://image.tmdb.org/t/p/w185${posterPath}`
}

export function tmdbPosterOriginalUrl(posterPath: string): string {
  return `https://image.tmdb.org/t/p/original${posterPath}`
}

export type TmdbPosterRef = { filePath: string; width: number; height: number }

export async function listTmdbPosterPaths(opts: {
  sourceId?: string
  title?: string
  year?: number
}): Promise<TmdbPosterRef[]> {
  const key = getSettings().mediaMetadata.tmdbApiKey.trim()
  if (!key) return []
  const headers = tmdbHeaders(key)
  let kind: 'movie' | 'tv' | null = null
  let id: number | null = null
  const sid = opts.sourceId ?? ''
  const movie = /^movie:(\d+)/.exec(sid)
  const tv = /^tv:(\d+)/.exec(sid)
  if (movie?.[1]) {
    kind = 'movie'
    id = Number(movie[1])
  } else if (tv?.[1]) {
    kind = 'tv'
    id = Number(tv[1])
  } else if (opts.title) {
    const q = encodeURIComponent(opts.title)
    const yearQ = opts.year ? `&year=${opts.year}` : ''
    try {
      const movies = (await fetchJson(tmdbUrl(`/search/movie?query=${q}${yearQ}`, key), headers)) as {
        results?: { id: number }[]
      }
      if (movies.results?.[0]?.id != null) {
        kind = 'movie'
        id = movies.results[0].id
      }
    } catch {
      /* try TV */
    }
    if (id == null) {
      try {
        const shows = (await fetchJson(tmdbUrl(`/search/tv?query=${q}`, key), headers)) as {
          results?: { id: number }[]
        }
        if (shows.results?.[0]?.id != null) {
          kind = 'tv'
          id = shows.results[0].id
        }
      } catch {
        return []
      }
    }
  }
  if (kind == null || id == null || !Number.isFinite(id)) return []
  try {
    const data = (await fetchJson(tmdbUrl(`/${kind}/${id}/images`, key), headers)) as {
      posters?: { file_path?: string; width?: number; height?: number }[]
    }
    const out: TmdbPosterRef[] = []
    for (const p of data.posters ?? []) {
      if (typeof p.file_path !== 'string' || !p.file_path) continue
      const width = typeof p.width === 'number' && p.width > 0 ? p.width : 0
      const height = typeof p.height === 'number' && p.height > 0 ? p.height : 0
      out.push({ filePath: p.file_path, width, height })
    }
    out.sort((a, b) => b.width * b.height - a.width * a.height)
    return out
  } catch {
    return []
  }
}

export async function downloadFromInternet(
  parsed: ParsedMediaName,
  queryKind?: MediaQueryKind,
  pickId?: string
): Promise<NetHit> {
  const s = getSettings().mediaMetadata
  const preferred = s.internetSource
  const tmdb = s.tmdbApiKey.trim()
  const omdb = s.omdbApiKey.trim()
  if (parseOmdbPickId(pickId) && omdb) return fromOmdb(parsed, omdb, queryKind, pickId)
  if (parseTmdbPickId(pickId) && tmdb) return fromTmdb(parsed, tmdb, queryKind, pickId)
  if (preferred === 'omdb' && omdb) return fromOmdb(parsed, omdb, queryKind, pickId)
  if (tmdb) return fromTmdb(parsed, tmdb, queryKind, pickId)
  if (omdb) return fromOmdb(parsed, omdb, queryKind, pickId)
  throw new Error('Add a TMDB or OMDb API key in Settings → Media Metadata')
}

export async function downloadImage(url: string): Promise<Buffer | null> {
  try {
    const ac = new AbortController()
    const t = setTimeout(() => ac.abort(), 20000)
    try {
      const res = await fetch(url, { signal: ac.signal })
      if (res.status === 429) throw new AppError('busy', mediaApiLimitMessage(serviceForUrl(url)))
      if (!res.ok) return null
      const buf = Buffer.from(await res.arrayBuffer())
      if (buf.length < 16) return null
      const jpeg = buf[0] === 0xff && buf[1] === 0xd8
      const png = buf[0] === 0x89 && buf[1] === 0x50
      const gif = buf[0] === 0x47 && buf[1] === 0x49
      const webp = buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42
      return jpeg || png || gif || webp ? buf : null
    } finally {
      clearTimeout(t)
    }
  } catch (e) {
    if (e instanceof AppError) throw e
    return null
  }
}
