import { describe, expect, it } from 'vitest'
import {
  parseMediaFileName,
  parseMediaMetadataJson,
  formatMediaRating,
  isGenericMediaFolderName,
  isMediaMetadataVideoName,
  MEDIA_METADATA_ADS,
  MEDIA_METADATA_THUMB_ADS
} from '../shared/mediaMetadata'
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
import { compareCoverSize } from '../main/mediaMetadata/covers'

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

  it('uses a folder-style name without year as unknown', () => {
    const p = parseMediaFileName('The Office')
    expect(p.title).toBe('The Office')
    expect(p.kind).toBe('unknown')
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

describe('isGenericMediaFolderName', () => {
  it('skips library and season dump names', () => {
    expect(isGenericMediaFolderName('Movies')).toBe(true)
    expect(isGenericMediaFolderName('Season 01')).toBe(true)
    expect(isGenericMediaFolderName('5 Centimeters per Second')).toBe(false)
  })
})

describe('isMediaMetadataVideoName', () => {
  it('accepts video files and rejects other documents', () => {
    expect(isMediaMetadataVideoName('Heat.mkv')).toBe(true)
    expect(isMediaMetadataVideoName('show.S01E01.m2ts')).toBe(true)
    expect(isMediaMetadataVideoName('notes.txt')).toBe(false)
    expect(isMediaMetadataVideoName('info.json')).toBe(false)
  })
})

describe('ADS names', () => {
  it('uses the requested stream names', () => {
    expect(MEDIA_METADATA_ADS).toBe('media_metadata')
    expect(MEDIA_METADATA_THUMB_ADS).toBe('media_metadata_thumbnail')
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

  it('lists every Photo in a Plex posters XML payload', () => {
    const photos = allPhotosFromXml(
      `<MediaContainer><Photo key="/library/metadata/7/posters/a" selected="1"/><Photo key="/library/metadata/7/posters/b"/></MediaContainer>`
    )
    expect(photos).toHaveLength(2)
    expect(photos[0]?.key).toBe('/library/metadata/7/posters/a')
    expect(photos[0]?.selected).toBe('1')
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
