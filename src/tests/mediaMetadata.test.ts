import { describe, expect, it } from 'vitest'
import {
  parseMediaFileName,
  parseMediaSearchAs,
  parseMediaSourceInput,
  mediaSearchStem,
  isMediaNameMissError,
  parseMediaMetadataJson,
  decideNamedMatches,
  normalizeMediaTitle,
  pickIdFromStored,
  formatMediaRating,
  formatEpisodeCode,
  normalizeEpisodeFields,
  episodeIconLabel,
  episodeIconTitle,
  isEpisodeListEntry,
  isGenericMediaFolderName,
  isMediaTitleFolder,
  isSeasonFolderName,
  classifyMediaFromNames,
  isMoviePartVideoName,
  isMultipartMovieFolder,
  isMediaMetadataVideoName,
  matchesMediaLibraryFilter,
  mediaContainerIgnoresFoldersFirst,
  MEDIA_METADATA_ADS,
  MEDIA_METADATA_CONTAINER_ADS,
  MEDIA_METADATA_THUMB_ADS
} from '../shared/mediaMetadata'
import {
  classifyMediaRatingSource,
  formatMediaRatingCopyLine,
  formatMediaRatingScore
} from '../shared/mediaRatings'
import { isMediaApiLimitPayload, mediaApiLimitMessage } from '../shared/mediaApiLimit'
import {
  appendPlexToken,
  allPhotosFromXml,
  firstMetadataFromXml,
  plexCoverUrlsFromItem,
  resolvePlexImageUrl
} from '../main/mediaMetadata/plexUrls'
import {
  normalizePlexBaseUrl,
  plexBundleRelDir,
  plexMediaUriToRelPath,
  plexMetadataUriPosterName
} from '../main/mediaMetadata/plexLocal'
import {
  compareCoverSize,
  parseCoverSourceId,
  plexFileCoverId,
  plexUrlCoverId,
  tmdbCoverId
} from '../main/mediaMetadata/covers'
import { isPortraitCover } from '../main/mediaMetadata/coverImage'

describe('parseMediaFileName', () => {
  it('parses a movie with year and tags', () => {
    const p = parseMediaFileName('The.Matrix.1999.1080p.BluRay.x264.mkv')
    expect(p.title).toBe('The Matrix')
    expect(p.year).toBe(1999)
    expect(p.kind).toBe('movie')
  })

  it('parses SxxExx episodes', () => {
    const p = parseMediaFileName('Breaking.Bad.S01E07.720p.mkv')
    expect(p.title).toBe('Breaking Bad')
    expect(p.season).toBe(1)
    expect(p.episode).toBe(7)
    expect(p.kind).toBe('episode')
  })

  it('parses NxNN episodes', () => {
    const p = parseMediaFileName('Game of Thrones 1x09.mkv')
    expect(p.season).toBe(1)
    expect(p.episode).toBe(9)
    expect(p.kind).toBe('episode')
  })

  it('parses 01x03 in a spaced title', () => {
    const p = parseMediaFileName('3 Body Problem 01x03 - Release by Wentworth_Miller.mkv')
    expect(p.title).toBe('3 Body Problem')
    expect(p.season).toBe(1)
    expect(p.episode).toBe(3)
    expect(p.kind).toBe('episode')
  })

  it('strips scene tags and the release group after SxxExx', () => {
    const p = parseMediaFileName('Dexter.S02E01.BDRip.x265-ION265.mp4')
    expect(p.title).toBe('Dexter')
    expect(p.season).toBe(2)
    expect(p.episode).toBe(1)
    expect(p.kind).toBe('episode')
  })

  it('strips a trailing -GROUP on movies without eating hyphenated titles', () => {
    const movie = parseMediaFileName('The.Matrix.1999.1080p.BluRay.x264-SPARKS.mkv')
    expect(movie.title).toBe('The Matrix')
    expect(movie.year).toBe(1999)
    expect(parseMediaFileName('Spider-Man').title).toBe('Spider-Man')
    expect(parseMediaFileName('Catch-22.S01E01.mkv').title).toBe('Catch-22')
  })

  it('uses a folder-style name without year as unknown', () => {
    const p = parseMediaFileName('The Office')
    expect(p.title).toBe('The Office')
    expect(p.kind).toBe('unknown')
  })

  it('keeps a sort-order number in the search stem so the user can edit it', () => {
    expect(mediaSearchStem('Babylon 5 - 5 - A Call to Arms.avi')).toBe(
      'Babylon 5 - 5 - A Call to Arms'
    )
    expect(parseMediaFileName('Babylon 5 - A Call to Arms').title).toBe('Babylon 5 - A Call to Arms')
  })

  it('strips scene words that a typed Search as must keep', () => {
    expect(parseMediaFileName('Season of the Witch').title).toBe('of the Witch')
    expect(parseMediaFileName('Ruby Complete').title).toBe('Ruby')
  })
})

describe('parseMediaSearchAs', () => {
  it('keeps words the filename parser strips', () => {
    expect(parseMediaSearchAs('Season of the Witch').title).toBe('Season of the Witch')
    expect(parseMediaSearchAs('Ruby Complete').title).toBe('Ruby Complete')
    expect(parseMediaSearchAs('The Complete Works').title).toBe('The Complete Works')
  })

  it('takes only a trailing parenthetical year', () => {
    const p = parseMediaSearchAs('Ruby Gloom (2006)')
    expect(p.title).toBe('Ruby Gloom')
    expect(p.year).toBe(2006)
    expect(parseMediaSearchAs('2001: A Space Odyssey').title).toBe('2001: A Space Odyssey')
    expect(parseMediaSearchAs('2001: A Space Odyssey').year).toBeUndefined()
  })

  it('does not treat a pasted filename as scene tags', () => {
    const p = parseMediaSearchAs('Ruby.EXTENDED.1080p.mkv')
    expect(p.title).toBe('Ruby.EXTENDED.1080p')
    expect(p.year).toBeUndefined()
  })
})

describe('parseMediaSourceInput', () => {
  it('reads TMDB movie and TV page URLs', () => {
    expect(parseMediaSourceInput('https://www.themoviedb.org/movie/550-fight-club')).toBe(
      'tmdb:movie:550'
    )
    expect(parseMediaSourceInput('https://www.themoviedb.org/tv/1396-breaking-bad?language=en-US')).toBe(
      'tmdb:tv:1396'
    )
    expect(parseMediaSourceInput('tmdb:movie:438631')).toBe('tmdb:movie:438631')
  })

  it('reads IMDb / OMDb ids', () => {
    expect(parseMediaSourceInput('https://www.imdb.com/title/tt0137523/?ref_=fn_al_tt_1')).toBe(
      'omdb:tt0137523'
    )
    expect(parseMediaSourceInput('https://www.omdbapi.com/?i=tt1160419&apikey=x')).toBe(
      'omdb:tt1160419'
    )
    expect(parseMediaSourceInput('tt0137523')).toBe('omdb:tt0137523')
    expect(parseMediaSourceInput('Season of the Witch')).toBeNull()
  })
})

describe('isMediaNameMissError', () => {
  it('treats Plex/TMDB/OMDb title misses as editable', () => {
    expect(isMediaNameMissError('No Plex match for Babylon 5 - 5 - A Call to Arms.avi')).toBe(true)
    expect(isMediaNameMissError('TMDB: no match for “Babylon 5”')).toBe(true)
    expect(isMediaNameMissError('Movie not found!')).toBe(true)
  })

  it('does not treat server or key problems as a name miss', () => {
    expect(isMediaNameMissError('Plex Media Server was not found on this PC')).toBe(false)
    expect(isMediaNameMissError('Add a TMDB or OMDb API key in Settings → Media Metadata')).toBe(
      false
    )
  })
})

describe('parseMediaMetadataJson', () => {
  it('accepts a valid descriptor', () => {
    const m = parseMediaMetadataJson(
      JSON.stringify({
        version: 1,
        source: 'tmdb',
        kind: 'movie',
        title: 'The Matrix',
        year: 1999,
        fetchedAt: '2026-01-01T00:00:00.000Z'
      })
    )
    expect(m?.title).toBe('The Matrix')
    expect(m?.source).toBe('tmdb')
  })

  it('keeps a watched flag', () => {
    const m = parseMediaMetadataJson(
      JSON.stringify({
        version: 1,
        source: 'tmdb',
        kind: 'movie',
        title: 'Heat',
        fetchedAt: '2026-01-01T00:00:00.000Z',
        watched: true
      })
    )
    expect(m?.watched).toBe(true)
  })

  it('rejects junk', () => {
    expect(parseMediaMetadataJson('{}')).toBeNull()
    expect(parseMediaMetadataJson('not json')).toBeNull()
  })
})

describe('formatMediaRating', () => {
  it('rounds noisy Plex floats', () => {
    expect(formatMediaRating(7.59999990463257)).toBe('7.6')
    expect(formatMediaRating(8)).toBe('8')
  })
})

describe('media rating brands', () => {
  it('classifies the sources we store', () => {
    expect(classifyMediaRatingSource('Plex')).toBe('plex')
    expect(classifyMediaRatingSource('Plex audience')).toBe('plex-audience')
    expect(classifyMediaRatingSource('TMDB')).toBe('tmdb')
    expect(classifyMediaRatingSource('Internet Movie Database')).toBe('imdb')
    expect(classifyMediaRatingSource('IMDb')).toBe('imdb')
    expect(classifyMediaRatingSource('Rotten Tomatoes')).toBe('rt')
    expect(classifyMediaRatingSource('Metacritic')).toBe('metacritic')
    expect(classifyMediaRatingSource('Letterboxd')).toBe('other')
  })

  it('formats scores and copy without parenthetical source text', () => {
    expect(formatMediaRatingScore({ source: 'Plex', value: 7.1, max: 10 }, 'plex')).toBe('7.1/10')
    expect(formatMediaRatingScore({ source: 'Rotten Tomatoes', value: 87 }, 'rt')).toBe('87%')
    expect(formatMediaRatingCopyLine({ source: 'Internet Movie Database', value: 7.6, max: 10 })).toBe(
      '7.6/10 IMDb'
    )
  })
})

describe('episode icon labels', () => {
  it('formats SxxExx from stored numbers', () => {
    expect(formatEpisodeCode(1, 7)).toBe('S01E07')
    expect(formatEpisodeCode(12, 3)).toBe('S12E03')
    expect(formatEpisodeCode(2, undefined)).toBe('S02')
    expect(formatEpisodeCode(undefined, 9)).toBe('S01E09')
    expect(formatEpisodeCode()).toBeNull()
  })

  it('fills season from the file name and defaults to 1', () => {
    const base = {
      version: 1 as const,
      source: 'plex' as const,
      kind: 'episode' as const,
      title: 'Destroyer of Worlds',
      fetchedAt: '2026-01-01T00:00:00.000Z'
    }
    expect(
      normalizeEpisodeFields(
        { ...base, episode: 3 },
        '3 Body Problem 01x03 - Release by Wentworth_Miller.mkv'
      ).season
    ).toBe(1)
    expect(normalizeEpisodeFields({ ...base, episode: 3 }).season).toBe(1)
    expect(normalizeEpisodeFields({ ...base, season: 2, episode: 4 }).season).toBe(2)
  })

  it('uses stored episode metadata only', () => {
    expect(episodeIconLabel({ kind: 'episode', season: 1, episode: 7 })).toBe('S01E07')
    expect(episodeIconLabel({ kind: 'show', season: 1, episode: 7 })).toBeNull()
    expect(episodeIconLabel({ kind: 'episode' })).toBeNull()
    expect(episodeIconLabel(undefined)).toBeNull()
  })

  it('shows a real episode title under SxxExx, not the show name', () => {
    expect(
      episodeIconTitle({ kind: 'episode', title: 'Waiting to Exhale', showTitle: 'Dexter' })
    ).toBe('Waiting to Exhale')
    expect(episodeIconTitle({ kind: 'episode', title: 'Dexter', showTitle: 'Dexter' })).toBeNull()
    expect(episodeIconTitle({ kind: 'episode', title: 'Untitled' })).toBeNull()
    expect(episodeIconTitle({ kind: 'episode', title: 'S02E01' })).toBeNull()
    expect(episodeIconTitle({ kind: 'show', title: 'Dexter' })).toBeNull()
  })

  it('treats SxxExx names and stored kind as episode rows', () => {
    expect(isEpisodeListEntry('Show.S01E01.mkv')).toBe(true)
    expect(isEpisodeListEntry('Movie.1999.mkv')).toBe(false)
    expect(isEpisodeListEntry('Special.mkv', { kind: 'episode' })).toBe(true)
  })
})

describe('classifyMediaFromNames', () => {
  it('treats SxxExx files as episodes', () => {
    expect(
      classifyMediaFromNames({ name: 'Breaking.Bad.S01E07.mkv', isDirectory: false })
    ).toBe('episode')
  })

  it('treats a yearless sibling of episodes as an episode', () => {
    expect(
      classifyMediaFromNames({
        name: 'Special.mkv',
        isDirectory: false,
        childNames: ['Show.S01E01.mkv', 'Special.mkv']
      })
    ).toBe('episode')
  })

  it('treats a year-tagged file as a movie', () => {
    expect(classifyMediaFromNames({ name: 'Heat.1995.mkv', isDirectory: false })).toBe('movie')
  })

  it('does not treat a movie as an episode just because a sibling is TV', () => {
    expect(
      classifyMediaFromNames({
        name: 'News.of.the.World.2020.AMZN.WEBRip.avi',
        isDirectory: false,
        childNames: [
          'News.of.the.World.2020.AMZN.WEBRip.avi',
          'Brooklyn.Nine-Nine.S01E01.mkv'
        ]
      })
    ).toBe('movie')
  })

  it('treats a folder with season dirs or episode files as a show', () => {
    expect(
      classifyMediaFromNames({
        name: 'Breaking Bad',
        isDirectory: true,
        childNames: ['Season 01', 'Season 02']
      })
    ).toBe('show')
    expect(
      classifyMediaFromNames({
        name: 'The Office',
        isDirectory: true,
        childNames: ['The.Office.S01E01.mkv', 'The.Office.S01E02.mkv']
      })
    ).toBe('show')
  })

  it('treats a year-tagged title folder as a movie', () => {
    expect(
      classifyMediaFromNames({
        name: 'Heat (1995)',
        isDirectory: true,
        childNames: ['Heat.1995.mkv']
      })
    ).toBe('movie')
  })

  it('asks when a yearless folder has no episode clues', () => {
    expect(
      classifyMediaFromNames({
        name: 'Dune',
        isDirectory: true,
        childNames: ['Dune.mkv']
      })
    ).toBe('ambiguous')
  })

  it('treats a CD-part movie folder as the movie, not a show', () => {
    const kids = [
      'Adventureland (2009) [Part 1].avi',
      'Adventureland (2009) [Part 2].avi'
    ]
    expect(isMoviePartVideoName(kids[0]!)).toBe(true)
    expect(isMultipartMovieFolder(kids)).toBe(true)
    expect(
      classifyMediaFromNames({
        name: 'Adventureland',
        isDirectory: true,
        childNames: kids
      })
    ).toBe('movie')
    expect(
      classifyMediaFromNames({
        name: 'The Stand',
        isDirectory: true,
        childNames: ['The.Stand.CD1.avi', 'The.Stand.CD2.avi', 'The.Stand.CD3.avi']
      })
    ).toBe('movie')
  })

  it('does not treat TV episode folders as multipart movies', () => {
    expect(
      isMultipartMovieFolder(['Dexter.S01E01.mkv', 'Dexter.S01E02.mkv'])
    ).toBe(false)
    expect(
      classifyMediaFromNames({
        name: 'Dexter',
        isDirectory: true,
        childNames: ['Dexter.S01E01.mkv', 'Dexter.S01E02.mkv']
      })
    ).toBe('show')
  })
})

describe('isSeasonFolderName', () => {
  it('matches season folders', () => {
    expect(isSeasonFolderName('Season 01')).toBe(true)
    expect(isSeasonFolderName('S02')).toBe(true)
    expect(isSeasonFolderName('Specials')).toBe(true)
    expect(isSeasonFolderName('Breaking Bad')).toBe(false)
  })
})

describe('isGenericMediaFolderName', () => {
  it('skips library and season dump names', () => {
    expect(isGenericMediaFolderName('Movies')).toBe(true)
    expect(isGenericMediaFolderName('Season 01')).toBe(true)
    expect(isGenericMediaFolderName('5 Centimeters per Second')).toBe(false)
  })
})

describe('isMediaTitleFolder', () => {
  it('writes a card on each show under a library folder', () => {
    expect(
      isMediaTitleFolder({
        name: '3 Body Problem',
        parentName: 'Series',
        parentIsSelectedRoot: true,
        nonSeasonChildFolderCount: 40
      })
    ).toBe(true)
    expect(
      isMediaTitleFolder({
        name: 'Alcatraz',
        parentName: 'Series',
        parentIsSelectedRoot: false,
        nonSeasonChildFolderCount: 2
      })
    ).toBe(true)
    expect(
      isMediaTitleFolder({
        name: 'Series',
        parentName: 'E:',
        parentIsSelectedRoot: true,
        nonSeasonChildFolderCount: 40
      })
    ).toBe(false)
    expect(
      isMediaTitleFolder({
        name: 'Season 01',
        parentName: 'Alcatraz',
        parentIsSelectedRoot: false,
        nonSeasonChildFolderCount: 0
      })
    ).toBe(false)
  })
})

describe('isMediaMetadataVideoName', () => {
  it('accepts video files and rejects other documents', () => {
    expect(isMediaMetadataVideoName('Heat.mkv')).toBe(true)
    expect(isMediaMetadataVideoName('show.S01E01.m2ts')).toBe(true)
    expect(isMediaMetadataVideoName('Old.Movie.2005.rmvb')).toBe(true)
    expect(isMediaMetadataVideoName('clip.rm')).toBe(true)
    expect(isMediaMetadataVideoName('stream.flv')).toBe(true)
    expect(isMediaMetadataVideoName('notes.txt')).toBe(false)
    expect(isMediaMetadataVideoName('info.json')).toBe(false)
  })
})

describe('ADS names', () => {
  it('uses the requested stream names', () => {
    expect(MEDIA_METADATA_ADS).toBe('media_metadata')
    expect(MEDIA_METADATA_THUMB_ADS).toBe('media_metadata_thumbnail')
    expect(MEDIA_METADATA_CONTAINER_ADS).toBe('media_metadata_container')
  })
})

describe('matchesMediaLibraryFilter', () => {
  it('treats missing flags as unwatched and without genre', () => {
    expect(matchesMediaLibraryFilter(undefined, 'all', null)).toBe(true)
    expect(matchesMediaLibraryFilter(undefined, 'unwatched', null)).toBe(true)
    expect(matchesMediaLibraryFilter(undefined, 'watched', null)).toBe(false)
    expect(matchesMediaLibraryFilter(undefined, 'all', 'Crime')).toBe(false)
  })

  it('filters watched and genre', () => {
    const flags = { watched: true, genres: ['Crime', 'Drama'] }
    expect(matchesMediaLibraryFilter(flags, 'watched', null)).toBe(true)
    expect(matchesMediaLibraryFilter(flags, 'unwatched', null)).toBe(false)
    expect(matchesMediaLibraryFilter(flags, 'all', 'crime')).toBe(true)
    expect(matchesMediaLibraryFilter(flags, 'all', 'Comedy')).toBe(false)
  })
})

describe('mediaContainerIgnoresFoldersFirst', () => {
  it('mixes tiles only in an enabled media container', () => {
    expect(mediaContainerIgnoresFoldersFirst(true, true, true)).toBe(true)
    expect(mediaContainerIgnoresFoldersFirst(true, true, false)).toBe(false)
    expect(mediaContainerIgnoresFoldersFirst(true, false, true)).toBe(false)
    expect(mediaContainerIgnoresFoldersFirst(false, true, true)).toBe(false)
  })
})

describe('media API limits', () => {
  it('detects HTTP 429 and OMDb / TMDB quota bodies', () => {
    expect(isMediaApiLimitPayload(429, '', null)).toBe(true)
    expect(isMediaApiLimitPayload(200, '', { Response: 'False', Error: 'Request limit reached!' })).toBe(
      true
    )
    expect(isMediaApiLimitPayload(200, '', { status_code: 25 })).toBe(true)
    expect(isMediaApiLimitPayload(200, '', { Response: 'False', Error: 'Movie not found!' })).toBe(false)
    expect(mediaApiLimitMessage('OMDb')).toMatch(/1,000/)
  })
})

describe('Plex cover URLs', () => {
  it('does not add a Plex token to CDN poster URLs', () => {
    const u = resolvePlexImageUrl(
      'http://127.0.0.1:32400',
      'tok',
      'https://metadata-static.plex.tv/poster.jpg'
    )
    expect(u).toBe('https://metadata-static.plex.tv/poster.jpg')
  })

  it('appends the token with & when the path already has a query', () => {
    expect(appendPlexToken('http://127.0.0.1:32400/library/metadata/1/thumb?t=2', 'abc')).toBe(
      'http://127.0.0.1:32400/library/metadata/1/thumb?t=2&X-Plex-Token=abc'
    )
  })

  it('prefers the Plex thumb field (with timestamp) for a movie', () => {
    const urls = plexCoverUrlsFromItem('http://127.0.0.1:32400', 'tok', {
      type: 'movie',
      ratingKey: '42',
      thumb: '/library/metadata/42/thumb/999'
    })
    expect(urls[0]).toBe('http://127.0.0.1:32400/library/metadata/42/thumb/999?X-Plex-Token=tok')
  })

  it('uses the show poster field for an episode', () => {
    const urls = plexCoverUrlsFromItem('http://127.0.0.1:32400', 'tok', {
      type: 'episode',
      ratingKey: '9',
      grandparentRatingKey: '3',
      grandparentThumb: '/library/metadata/3/thumb/8',
      thumb: '/library/metadata/9/thumb/1'
    })
    expect(urls[0]).toBe('http://127.0.0.1:32400/library/metadata/3/thumb/8?X-Plex-Token=tok')
  })

  it('maps localhost to 127.0.0.1 and builds the metadata bundle path', () => {
    expect(normalizePlexBaseUrl('http://localhost:32400/')).toBe('http://127.0.0.1:32400')
    expect(plexBundleRelDir('4f0e9c2b6d8a3779799387a0dd13d9bfddfd44fd', 1).replace(/\\/g, '/')).toBe(
      'Metadata/Movies/4/f0e9c2b6d8a3779799387a0dd13d9bfddfd44fd.bundle'
    )
    expect(plexMediaUriToRelPath('media://c/abc.bundle/Contents/Thumbnails/thumb1.jpg')?.replace(/\\/g, '/')).toBe(
      'Media/localhost/c/abc.bundle/Contents/Thumbnails/thumb1.jpg'
    )
    expect(
      plexMetadataUriPosterName('metadata://posters/com.plexapp.agents.imdb_91310faf1e9a609251bc5c91e2068afa4283a858')
    ).toBe('91310faf1e9a609251bc5c91e2068afa4283a858')
  })

  it('parses a Plex XML Video including thumb and genres', () => {
    const item = firstMetadataFromXml(
      `<MediaContainer><Video ratingKey="7" type="movie" title="Heat" year="1995" thumb="/library/metadata/7/thumb/1" summary="Cops."><Genre tag="Crime"/></Video></MediaContainer>`
    )
    expect(item?.title).toBe('Heat')
    expect(item?.thumb).toBe('/library/metadata/7/thumb/1')
    expect(item?.Genre).toEqual([{ tag: 'Crime' }])
  })

  it('parses episode parentIndex as the season', () => {
    const item = firstMetadataFromXml(
      `<MediaContainer><Video ratingKey="9" type="episode" title="Destroyer of Worlds" index="3" parentIndex="1" year="2024" grandparentTitle="3 Body Problem"/></MediaContainer>`
    )
    expect(item?.type).toBe('episode')
    expect(item?.index).toBe('3')
    expect(item?.parentIndex).toBe('1')
    expect(item?.grandparentTitle).toBe('3 Body Problem')
  })

  it('lists every Photo in a Plex posters XML payload', () => {
    const photos = allPhotosFromXml(
      `<MediaContainer><Photo key="/library/metadata/7/posters/a" selected="1"/><Photo key="/library/metadata/7/posters/b"/></MediaContainer>`
    )
    expect(photos).toHaveLength(2)
    expect(photos[0]?.key).toBe('/library/metadata/7/posters/a')
    expect(photos[0]?.selected).toBe('1')
  })
})

describe('isPortraitCover', () => {
  it('accepts taller-than-wide posters and rejects landscape stills', () => {
    expect(isPortraitCover(1000, 1500)).toBe(true)
    expect(isPortraitCover(1920, 1080)).toBe(false)
    expect(isPortraitCover(800, 800)).toBe(false)
    expect(isPortraitCover(0, 1200)).toBe(false)
  })
})

describe('compareCoverSize', () => {
  it('orders larger pixel area first', () => {
    const items = [
      { width: 500, height: 750, bytes: 200_000 },
      { width: 2000, height: 3000, bytes: 80_000 },
      { width: 1000, height: 1500, bytes: 400_000 }
    ]
    const sorted = [...items].sort(compareCoverSize)
    expect(sorted.map((x) => x.width)).toEqual([2000, 1000, 500])
  })

  it('breaks equal area ties with file size', () => {
    const items = [
      { width: 1000, height: 1500, bytes: 50_000 },
      { width: 1000, height: 1500, bytes: 200_000 }
    ]
    const sorted = [...items].sort(compareCoverSize)
    expect(sorted[0]?.bytes).toBe(200_000)
  })
})

describe('cover source ids', () => {
  it('round-trips file, url, and tmdb refs', () => {
    const abs = 'C:\\Plex Media Server\\Metadata\\Movies\\ab\\cdef.bundle\\posters\\x.jpg'
    expect(parseCoverSourceId(plexFileCoverId(abs))).toEqual({ kind: 'plex-file', path: abs })
    expect(parseCoverSourceId(plexUrlCoverId('http://127.0.0.1/full', 'http://127.0.0.1/prev'))).toEqual({
      kind: 'plex-url',
      href: 'http://127.0.0.1/full',
      previewHref: 'http://127.0.0.1/prev'
    })
    expect(parseCoverSourceId(tmdbCoverId('/abc/poster.jpg'))).toEqual({
      kind: 'tmdb',
      posterPath: '/abc/poster.jpg'
    })
    expect(parseCoverSourceId('current')).toEqual({ kind: 'current' })
    expect(parseCoverSourceId('plex-local-3')).toBeNull()
  })
})

describe('decideNamedMatches', () => {
  const dune = [
    { title: 'Dune', year: 1984 },
    { title: 'Dune', year: 2021 },
    { title: 'Dune: Part Two', year: 2024 }
  ]

  it('asks when several exact titles exist and there is no year', () => {
    const d = decideNamedMatches(dune, 'Dune')
    expect(d.action).toBe('ask')
    if (d.action === 'ask') {
      expect(d.hits.map((h) => h.year)).toEqual([1984, 2021])
    }
  })

  it('auto-picks the year when the filename has one', () => {
    const d = decideNamedMatches(dune, 'Dune', 2021)
    expect(d.action).toBe('auto')
    if (d.action === 'auto') expect(d.hit.year).toBe(2021)
  })

  it('auto-picks a unique exact title among fuzzy extras', () => {
    const d = decideNamedMatches(dune, 'Dune Part Two')
    expect(d.action).toBe('auto')
    if (d.action === 'auto') expect(d.hit.year).toBe(2024)
  })

  it('auto-picks the only result', () => {
    const d = decideNamedMatches([{ title: 'Heat', year: 1995 }], 'Heat')
    expect(d.action).toBe('auto')
  })

  it('normalizes apostrophes and punctuation', () => {
    expect(normalizeMediaTitle("Ocean's Eleven")).toBe('oceans eleven')
    expect(normalizeMediaTitle('Dune: Part Two')).toBe('dune part two')
  })

  it('rebuilds a pick id from stored TMDB / OMDb metadata', () => {
    expect(
      pickIdFromStored({
        version: 1,
        source: 'tmdb',
        sourceId: 'movie:438631',
        kind: 'movie',
        title: 'Dune',
        fetchedAt: '2026-01-01T00:00:00.000Z'
      })
    ).toBe('tmdb:movie:438631')
    expect(
      pickIdFromStored({
        version: 1,
        source: 'tmdb',
        sourceId: 'tv:1396:s2e1',
        kind: 'episode',
        title: 'Seven Thirty-Seven',
        fetchedAt: '2026-01-01T00:00:00.000Z'
      })
    ).toBe('tmdb:tv:1396')
    expect(
      pickIdFromStored({
        version: 1,
        source: 'omdb',
        sourceId: 'tt1160419',
        kind: 'movie',
        title: 'Dune',
        fetchedAt: '2026-01-01T00:00:00.000Z'
      })
    ).toBe('omdb:tt1160419')
  })
})
