/**
 * Parse audio/video tags + format via music-metadata; cache embedded cover under userData.
 */
import crypto from 'node:crypto'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { app } from 'electron'
import type { PreviewField, PreviewFieldGroup } from '@shared/schemas/preview'
import { mediaUrlFor } from '../media/protocol'
import { protocolAllowlist } from '../security/paths'

const MAX_COMMENT = 2000
const MAX_LYRICS = 4000

function coverCacheDir(): string {
  const dir = path.join(app.getPath('userData'), 'audio-covers')
  protocolAllowlist.allowDirPermanently(dir)
  return dir
}

function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return ''
  const s = Math.floor(seconds)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const r = s % 60
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`
  return `${m}:${String(r).padStart(2, '0')}`
}

function formatBitrate(bps: number): string {
  if (!Number.isFinite(bps) || bps <= 0) return ''
  if (bps >= 1_000_000) return `${(bps / 1_000_000).toFixed(2)} Mbps`
  return `${Math.round(bps / 1000)} kbps`
}

function joinList(v: string[] | undefined): string | undefined {
  if (!v?.length) return undefined
  const s = v.map((x) => x.trim()).filter(Boolean).join('; ')
  return s || undefined
}

function truncate(s: string, max: number): string {
  const t = s.trim()
  if (t.length <= max) return t
  return `${t.slice(0, max - 1)}…`
}

function commentsText(
  comments: Array<string | { text?: string }> | undefined
): string | undefined {
  if (!comments?.length) return undefined
  const text = comments
    .map((c) => (typeof c === 'string' ? c : (c.text ?? '')))
    .map((t) => t.trim())
    .filter(Boolean)
    .join('\n')
  return text ? truncate(text, MAX_COMMENT) : undefined
}

function lyricsText(
  lyrics: Array<{ text?: string; syncText?: Array<{ text: string }> } | string> | undefined
): string | undefined {
  if (!lyrics?.length) return undefined
  const text = lyrics
    .map((l) => {
      if (typeof l === 'string') return l
      if (l.text?.trim()) return l.text
      if (l.syncText?.length) return l.syncText.map((s) => s.text).join('\n')
      return ''
    })
    .map((t) => t.trim())
    .filter(Boolean)
    .join('\n\n')
  return text ? truncate(text, MAX_LYRICS) : undefined
}

function extForMime(mime: string | undefined): string {
  const m = (mime || '').toLowerCase()
  if (m.includes('png')) return '.png'
  if (m.includes('webp')) return '.webp'
  if (m.includes('gif')) return '.gif'
  return '.jpg'
}

async function cacheCover(
  filePath: string,
  mtimeMs: number,
  size: number,
  picture: { format?: string; data: Uint8Array; type?: string }
): Promise<string | undefined> {
  const ext = extForMime(picture.format)
  const key = crypto
    .createHash('sha1')
    .update(`${filePath.toLowerCase()}|${mtimeMs}|${size}|cover|v1`)
    .digest('hex')
  const dest = path.join(coverCacheDir(), `${key}${ext}`)
  try {
    await fsp.access(dest)
  } catch {
    await fsp.mkdir(path.dirname(dest), { recursive: true })
    const tmp = `${dest}.tmp`
    await fsp.writeFile(tmp, Buffer.from(picture.data))
    await fsp.rename(tmp, dest)
  }
  return mediaUrlFor(dest, `${mtimeMs}-${size}`)
}

export type MediaPreviewMeta = {
  fields: PreviewField[]
  subtitle?: string
  /** Embedded artwork URL (audio covers). Do not use as video still-frame poster. */
  coverUrl?: string
}

export type LoadMediaPreviewMetaOptions = {
  /** Field group id prefix + PreviewField.group */
  group: Extract<PreviewFieldGroup, 'audio' | 'video'>
  /** Cache and return embedded cover (audio). Off for video so player posters stay frame-based. */
  includeCover?: boolean
}

export async function loadAudioPreviewMeta(
  filePath: string,
  mtimeMs: number,
  size: number
): Promise<MediaPreviewMeta> {
  return loadMediaPreviewMeta(filePath, mtimeMs, size, {
    group: 'audio',
    includeCover: true
  })
}

export async function loadMediaPreviewMeta(
  filePath: string,
  mtimeMs: number,
  size: number,
  opts: LoadMediaPreviewMetaOptions
): Promise<MediaPreviewMeta> {
  const group = opts.group
  const includeCover = opts.includeCover !== false && group === 'audio'
  const prefix = group
  const fields: PreviewField[] = []
  const push = (id: string, label: string, value: string | number | undefined | null): void => {
    if (value == null) return
    const s = typeof value === 'number' ? String(value) : value.trim()
    if (!s) return
    fields.push({ id: `${prefix}.${id}`, label, value: s, group, copyable: true })
  }

  try {
    const { parseFile } = await import('music-metadata')
    const meta = await parseFile(filePath, { duration: true, skipCovers: !includeCover })
    const { common, format } = meta

    // Format / stream
    if (format.duration != null) push('duration', 'Duration', formatDuration(format.duration))
    if (format.bitrate != null) push('bitrate', 'Bitrate', formatBitrate(format.bitrate))
    if (format.sampleRate != null) push('sampleRate', 'Sample rate', `${format.sampleRate} Hz`)
    if (format.numberOfChannels != null) {
      const ch = format.numberOfChannels
      push('channels', 'Channels', ch === 1 ? 'Mono' : ch === 2 ? 'Stereo' : String(ch))
    }
    if (format.bitsPerSample != null) {
      push('bitsPerSample', 'Bit depth', `${format.bitsPerSample}-bit`)
    }
    push('codec', 'Codec', format.codec)
    push('container', 'Container', format.container)
    push('codecProfile', 'Codec profile', format.codecProfile)
    push('tool', 'Encoder', format.tool)
    if (format.lossless != null) push('lossless', 'Lossless', format.lossless ? 'Yes' : 'No')
    if (format.tagTypes?.length) {
      push('tagTypes', 'Tag types', format.tagTypes.join(', '))
    }
    if (format.chapters?.length) {
      push('chapters', 'Chapters', String(format.chapters.length))
    }

    // Video track geometry when present (MP4/MKV/etc.)
    const loose = format as { width?: number; height?: number; frameRate?: number }
    let width = loose.width
    let height = loose.height
    const frameRate = loose.frameRate
    let videoCodec: string | undefined
    let audioCodecFromTracks: string | undefined
    for (const t of format.trackInfo ?? []) {
      const anyT = t as {
        type?: string | number
        codecName?: string
        video?: { pixelWidth?: number; pixelHeight?: number }
        audio?: { samplingFrequency?: number; channels?: number; bitDepth?: number }
      }
      const isVideo =
        anyT.type === 'video' ||
        anyT.type === 1 ||
        Boolean(anyT.video) ||
        /video/i.test(anyT.codecName ?? '')
      const isAudio =
        anyT.type === 'audio' ||
        anyT.type === 2 ||
        Boolean(anyT.audio) ||
        /audio|aac|mp3|opus|vorbis|flac/i.test(anyT.codecName ?? '')
      if (isVideo) {
        if (!videoCodec && anyT.codecName) videoCodec = anyT.codecName
        if (anyT.video?.pixelWidth) width = width ?? anyT.video.pixelWidth
        if (anyT.video?.pixelHeight) height = height ?? anyT.video.pixelHeight
      }
      if (isAudio && !audioCodecFromTracks && anyT.codecName) {
        audioCodecFromTracks = anyT.codecName
      }
    }
    if (width != null && height != null) {
      push('dimensions', 'Dimensions', `${width} × ${height}`)
    } else if (width != null) {
      push('width', 'Width', width)
    } else if (height != null) {
      push('height', 'Height', height)
    }
    if (frameRate != null && Number.isFinite(frameRate)) {
      push('frameRate', 'Frame rate', `${Number(frameRate.toFixed(3))} fps`)
    }
    if (group === 'video') {
      if (videoCodec) push('videoCodec', 'Video codec', videoCodec)
      if (audioCodecFromTracks) push('audioCodec', 'Audio codec', audioCodecFromTracks)
      if (format.hasVideo != null) push('hasVideo', 'Has video', format.hasVideo ? 'Yes' : 'No')
      if (format.hasAudio != null) push('hasAudio', 'Has audio', format.hasAudio ? 'Yes' : 'No')
    }

    // Core tags
    push('title', 'Title', common.title)
    push('artists', 'Artist', joinList(common.artists) || common.artist)
    push('album', 'Album', common.album)
    push('albumArtist', 'Album artist', joinList(common.albumartists) || common.albumartist)
    push('genre', 'Genre', joinList(common.genre))
    if (common.year != null) push('year', 'Year', common.year)
    push('date', 'Date', common.date || common.releasedate)
    push('originalDate', 'Original date', common.originaldate)
    if (common.originalyear != null) push('originalYear', 'Original year', common.originalyear)

    if (common.track?.no != null) {
      const of = common.track.of != null ? `/${common.track.of}` : ''
      push('track', 'Track', `${common.track.no}${of}`)
    } else if (common.totaltracks) {
      push('track', 'Tracks', common.totaltracks)
    }
    if (common.disk?.no != null) {
      const of = common.disk.of != null ? `/${common.disk.of}` : ''
      push('disk', 'Disc', `${common.disk.no}${of}`)
    } else if (common.totaldiscs) {
      push('disk', 'Discs', common.totaldiscs)
    }
    push('discSubtitle', 'Disc subtitle', joinList(common.discsubtitle))

    push('composer', 'Composer', joinList(common.composer))
    push('lyricist', 'Lyricist', joinList(common.lyricist))
    push('writer', 'Writer', joinList(common.writer))
    push('conductor', 'Conductor', joinList(common.conductor))
    push('remixer', 'Remixer', joinList(common.remixer))
    push('arranger', 'Arranger', joinList(common.arranger))
    push('engineer', 'Engineer', joinList(common.engineer))
    push('producer', 'Producer', joinList(common.producer))
    push('publisher', 'Publisher', joinList(common.publisher))
    push('label', 'Label', joinList(common.label))
    push('mixer', 'Mixed by', joinList(common.mixer))
    push('djmixer', 'DJ mixer', joinList(common.djmixer))
    push('technician', 'Technician', joinList(common.technician))

    push('grouping', 'Grouping', common.grouping)
    push('subtitle', 'Subtitle', joinList(common.subtitle))
    push('description', 'Description', joinList(common.description))
    push('longDescription', 'Long description', common.longDescription)
    push('work', 'Work', common.work)
    push('movement', 'Movement', common.movement)
    if (common.movementIndex?.no != null) {
      const of = common.movementIndex.of != null ? `/${common.movementIndex.of}` : ''
      push('movementIndex', 'Movement #', `${common.movementIndex.no}${of}`)
    }
    if (common.movementTotal != null) {
      push('movementTotal', 'Movements', common.movementTotal)
    }

    if (common.bpm != null) push('bpm', 'BPM', common.bpm)
    push('key', 'Key', common.key)
    push('mood', 'Mood', common.mood)
    push('media', 'Media', common.media)
    if (common.compilation != null) {
      push('compilation', 'Compilation', common.compilation ? 'Yes' : 'No')
    }
    if (common.rating?.length) {
      const ratings = common.rating
        .map((r) => {
          if (r.rating == null) return ''
          const pct = Math.round(r.rating * 100)
          return r.source ? `${pct}% (${r.source})` : `${pct}%`
        })
        .filter(Boolean)
      if (ratings.length) push('rating', 'Rating', ratings.join('; '))
    }

    push('copyright', 'Copyright', common.copyright)
    push('license', 'License', common.license)
    push('encodedBy', 'Encoded by', common.encodedby)
    push('encoderSettings', 'Encoder settings', common.encodersettings)
    push('language', 'Language', common.language)
    push('script', 'Script', common.script)
    push('releaseCountry', 'Release country', common.releasecountry)
    push('releaseStatus', 'Release status', common.releasestatus)
    push('releaseType', 'Release type', joinList(common.releasetype))
    push('catalogNumber', 'Catalog number', joinList(common.catalognumber))
    push('barcode', 'Barcode', common.barcode)
    push('isrc', 'ISRC', joinList(common.isrc))
    push('asin', 'ASIN', common.asin)
    push('website', 'Website', common.website)

    push('originalAlbum', 'Original album', common.originalalbum)
    push('originalArtist', 'Original artist', common.originalartist)

    if (common.podcast != null) push('podcast', 'Podcast', common.podcast ? 'Yes' : 'No')
    push('podcastUrl', 'Podcast URL', common.podcasturl)
    push('podcastId', 'Podcast ID', common.podcastId)
    push('category', 'Category', joinList(common.category))
    push('keywords', 'Keywords', joinList(common.keywords))
    push('tvShow', 'TV show', common.tvShow)
    if (common.tvSeason != null) push('tvSeason', 'TV season', common.tvSeason)
    if (common.tvEpisode != null) push('tvEpisode', 'TV episode', common.tvEpisode)
    push('tvEpisodeId', 'TV episode ID', common.tvEpisodeId)
    push('tvNetwork', 'TV network', common.tvNetwork)

    push('musicbrainzRecordingId', 'MusicBrainz recording', common.musicbrainz_recordingid)
    push('musicbrainzTrackId', 'MusicBrainz track', common.musicbrainz_trackid)
    push('musicbrainzAlbumId', 'MusicBrainz album', common.musicbrainz_albumid)
    push('musicbrainzArtistId', 'MusicBrainz artist', joinList(common.musicbrainz_artistid))
    push('acoustidId', 'AcoustID', common.acoustid_id)

    const comment = commentsText(common.comment)
    if (comment) {
      fields.push({
        id: `${prefix}.comment`,
        label: 'Comment',
        value: comment,
        group,
        copyable: true
      })
    }
    const lyrics = lyricsText(common.lyrics)
    if (lyrics) {
      fields.push({
        id: `${prefix}.lyrics`,
        label: 'Lyrics',
        value: lyrics,
        group,
        mono: true,
        copyable: true
      })
    }

    let coverUrl: string | undefined
    const pictures = common.picture
    if (pictures?.length) {
      push('cover', 'Cover art', `Yes (${pictures.length})`)
      if (includeCover) {
        const preferred =
          pictures.find((p) => /front|cover/i.test(p.type || '')) ||
          pictures.find((p) => /front|cover/i.test(p.description || '')) ||
          pictures[0]!
        try {
          coverUrl = await cacheCover(filePath, mtimeMs, size, preferred)
        } catch {
          // omit cover image
        }
      }
    }

    const subtitleParts = [
      common.title,
      common.artist || joinList(common.artists),
      common.album
    ].filter((x): x is string => Boolean(x && String(x).trim()))
    return {
      fields,
      subtitle: subtitleParts.length ? subtitleParts.join(' · ') : undefined,
      coverUrl
    }
  } catch {
    return { fields }
  }
}
