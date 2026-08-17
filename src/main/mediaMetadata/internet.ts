import type { MediaMetadata, ParsedMediaName } from '@shared/mediaMetadata'
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

async function fetchJson(url: string, headers?: Record<string, string>): Promise<unknown> {
  const ac = new AbortController()
  const t = setTimeout(() => ac.abort(), 18000)
  try {
    const res = await fetch(url, { signal: ac.signal, headers })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return (await res.json()) as unknown
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

async function fromTmdb(parsed: ParsedMediaName, key: string): Promise<NetHit> {
  const headers = tmdbHeaders(key)
  if (parsed.kind === 'episode' && parsed.season != null && parsed.episode != null) {
    const search = (await fetchJson(
      tmdbUrl(`/search/tv?query=${encodeURIComponent(parsed.title)}`, key),
      headers
    )) as { results?: { id: number; name?: string; first_air_date?: string }[] }
    const show = search.results?.[0]
    if (!show) throw new Error(`TMDB: no TV show matching “${parsed.title}”`)
    const details = (await fetchJson(
      tmdbUrl(`/tv/${show.id}?append_to_response=credits`, key),
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
      tmdbUrl(`/tv/${show.id}/season/${parsed.season}/episode/${parsed.episode}`, key),
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
        sourceId: `tv:${show.id}:s${parsed.season}e${parsed.episode}`,
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
        showTitle: details.name || show.name,
        fetchedAt: new Date().toISOString()
      },
      thumbUrl: tmdbPosterUrl(ep.still_path) ?? tmdbPosterUrl(details.poster_path)
    }
  }

  const movieSearch = (await fetchJson(
    tmdbUrl(
      `/search/movie?query=${encodeURIComponent(parsed.title)}${parsed.year ? `&year=${parsed.year}` : ''}`,
      key
    ),
    headers
  )) as { results?: { id: number }[] }
  const movieId = movieSearch.results?.[0]?.id
  if (movieId == null) {
    const tvSearch = (await fetchJson(
      tmdbUrl(`/search/tv?query=${encodeURIComponent(parsed.title)}`, key),
      headers
    )) as { results?: { id: number }[] }
    const tvId = tvSearch.results?.[0]?.id
    if (tvId == null) throw new Error(`TMDB: no match for “${parsed.title}”`)
    const details = (await fetchJson(
      tmdbUrl(`/tv/${tvId}?append_to_response=credits`, key),
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
        sourceId: `tv:${tvId}`,
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

async function fromOmdb(parsed: ParsedMediaName, key: string): Promise<NetHit> {
  const params = new URLSearchParams({ apikey: key, t: parsed.title })
  if (parsed.year) params.set('y', String(parsed.year))
  if (parsed.kind === 'episode' && parsed.season != null && parsed.episode != null) {
    params.set('type', 'episode')
    params.set('Season', String(parsed.season))
    params.set('Episode', String(parsed.episode))
  } else if (parsed.kind === 'movie') {
    params.set('type', 'movie')
  }
  const data = (await fetchJson(`https://www.omdbapi.com/?${params.toString()}`)) as {
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
  if (data.Response === 'False') {
    throw new Error(data.Error || `OMDb: no match for “${parsed.title}”`)
  }
  const year = Number(String(data.Year ?? '').slice(0, 4))
  const ratings = (Array.isArray(data.Ratings) ? data.Ratings : []).map((r) => {
    const num = Number.parseFloat(r.Value)
    return { source: r.Source, value: Number.isFinite(num) ? num : 0, max: r.Value.includes('/') ? Number(r.Value.split('/')[1]) : undefined }
  }).filter((r) => r.value > 0)
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

export async function downloadFromInternet(parsed: ParsedMediaName): Promise<NetHit> {
  const s = getSettings().mediaMetadata
  const preferred = s.internetSource
  const tmdb = s.tmdbApiKey.trim()
  const omdb = s.omdbApiKey.trim()
  if (preferred === 'omdb' && omdb) return fromOmdb(parsed, omdb)
  if (tmdb) return fromTmdb(parsed, tmdb)
  if (omdb) return fromOmdb(parsed, omdb)
  throw new Error('Add a TMDB or OMDb API key in Settings → Media Metadata')
}

export async function downloadImage(url: string): Promise<Buffer | null> {
  try {
    const ac = new AbortController()
    const t = setTimeout(() => ac.abort(), 20000)
    try {
      const res = await fetch(url, { signal: ac.signal })
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
  } catch {
    return null
  }
}
