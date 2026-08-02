import fsp from 'node:fs/promises'
import path from 'node:path'
import type { DetailsColumnId, EntryColumnValues } from '@shared/schemas/columns'
import { parseA1111Parameters } from '../preview/a1111'
import { extractPngTextChunks } from '../preview/pngText'

const IMAGE_EXTS = new Set([
  'png',
  'jpg',
  'jpeg',
  'webp',
  'gif',
  'bmp',
  'avif',
  'tiff',
  'tif',
  'psd'
])

const AV_EXTS = new Set([
  'mp3',
  'wav',
  'flac',
  'ogg',
  'm4a',
  'aac',
  'wma',
  'opus',
  'mp4',
  'm4v',
  'webm',
  'mkv',
  'avi',
  'mov',
  'wmv',
  'mpg',
  'mpeg'
])

const GEN_PARAM_KEYS = new Set([
  'genSeed',
  'genModel',
  'genModelHash',
  'genSteps',
  'genSampler',
  'genCfg',
  'genSize',
  'genPrompt',
  'genNegative'
] satisfies DetailsColumnId[])

const IMAGE_KEYS = new Set([
  'dimensions',
  'width',
  'height',
  'bitDepth',
  'colorSpace',
  'orientation',
  'hasAlpha',
  'imageFormat'
] satisfies DetailsColumnId[])

const AV_KEYS = new Set([
  'duration',
  'bitrate',
  'sampleRate',
  'channels',
  'codec',
  'container',
  'frameRate',
  'mediaWidth',
  'mediaHeight',
  'title',
  'artist',
  'album',
  'albumArtist',
  'year',
  'genre',
  'track',
  'disc',
  'comment'
] satisfies DetailsColumnId[])

function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return ''
  const s = Math.round(seconds)
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

function truncate(s: string, max = 240): string {
  const t = s.replace(/\s+/g, ' ').trim()
  if (t.length <= max) return t
  return t.slice(0, max - 1) + '…'
}

function pick<T extends DetailsColumnId>(
  wanted: Set<DetailsColumnId>,
  id: T,
  value: string | number | boolean | null | undefined,
  out: EntryColumnValues
): void {
  if (!wanted.has(id)) return
  if (value === null || value === undefined || value === '') return
  out[id] = typeof value === 'boolean' ? (value ? 'Yes' : 'No') : String(value)
}

async function extractImage(
  file: string,
  ext: string,
  wanted: Set<DetailsColumnId>
): Promise<EntryColumnValues> {
  const out: EntryColumnValues = {}
  const needImage = [...IMAGE_KEYS].some((k) => wanted.has(k))
  const needGen = [...GEN_PARAM_KEYS].some((k) => wanted.has(k))
  if (!needImage && !needGen) return out

  if (needImage && ext !== 'psd') {
    try {
      const { default: sharp } = await import('sharp')
      const meta = await sharp(file, { failOn: 'truncated', limitInputPixels: 512 * 1024 * 1024 }).metadata()
      const w = meta.width
      const h = meta.height
      if (w && h) pick(wanted, 'dimensions', `${w} × ${h}`, out)
      pick(wanted, 'width', w, out)
      pick(wanted, 'height', h, out)
      pick(wanted, 'bitDepth', meta.depth, out)
      pick(wanted, 'colorSpace', meta.space, out)
      pick(wanted, 'orientation', meta.orientation, out)
      pick(wanted, 'hasAlpha', meta.hasAlpha, out)
      pick(wanted, 'imageFormat', meta.format, out)
    } catch {
      // ignore
    }
  }

  if (needImage && ext === 'psd') {
    try {
      const { readPsd } = await import('ag-psd')
      const buf = await fsp.readFile(file)
      const psd = readPsd(buf, {
        skipLayerImageData: true,
        skipCompositeImageData: true,
        skipThumbnail: true
      })
      if (psd.width && psd.height) {
        pick(wanted, 'dimensions', `${psd.width} × ${psd.height}`, out)
        pick(wanted, 'width', psd.width, out)
        pick(wanted, 'height', psd.height, out)
      }
      pick(wanted, 'imageFormat', 'psd', out)
    } catch {
      // ignore
    }
  }

  if (needGen && ext === 'png') {
    try {
      const buf = await fsp.readFile(file)
      const chunks = extractPngTextChunks(buf)
      const paramsChunk =
        chunks.find((c) => c.keyword.toLowerCase() === 'parameters') ??
        chunks.find((c) => c.keyword.toLowerCase() === 'comment')
      if (paramsChunk) {
        const parsed = parseA1111Parameters(paramsChunk.text)
        if (parsed) {
          pick(wanted, 'genPrompt', truncate(parsed.prompt, 400), out)
          if (parsed.negative) pick(wanted, 'genNegative', truncate(parsed.negative, 300), out)
          const s = parsed.settings
          pick(wanted, 'genSeed', s['Seed'], out)
          pick(wanted, 'genModel', s['Model'], out)
          pick(wanted, 'genModelHash', s['Model hash'], out)
          pick(wanted, 'genSteps', s['Steps'], out)
          pick(wanted, 'genSampler', s['Sampler'], out)
          pick(wanted, 'genCfg', s['CFG scale'], out)
          pick(wanted, 'genSize', s['Size'], out)
        }
      }
    } catch {
      // ignore
    }
  }

  return out
}

async function extractAv(file: string, wanted: Set<DetailsColumnId>): Promise<EntryColumnValues> {
  const out: EntryColumnValues = {}
  if (![...AV_KEYS].some((k) => wanted.has(k))) return out
  try {
    const { parseFile } = await import('music-metadata')
    const meta = await parseFile(file, { duration: true, skipCovers: true })
    const fmt = meta.format
    const common = meta.common

    if (fmt.duration != null) pick(wanted, 'duration', formatDuration(fmt.duration), out)
    if (fmt.bitrate != null) pick(wanted, 'bitrate', formatBitrate(fmt.bitrate), out)
    pick(wanted, 'sampleRate', fmt.sampleRate ? `${fmt.sampleRate} Hz` : undefined, out)
    pick(wanted, 'channels', fmt.numberOfChannels, out)
    pick(wanted, 'codec', fmt.codec, out)
    pick(wanted, 'container', fmt.container, out)

    // Best-effort video geometry from track info when present.
    const tracks = fmt.trackInfo ?? []
    for (const t of tracks) {
      const anyT = t as {
        type?: string
        codecName?: string
        bitRate?: number
        samplingFrequency?: number
        numberOfChannels?: number
        duration?: number
      }
      if (anyT.type === 'video' || /video/i.test(anyT.codecName ?? '')) {
        if (!out.codec && anyT.codecName) pick(wanted, 'codec', anyT.codecName, out)
      }
    }

    // Some containers expose width/height on format via non-typed fields.
    const loose = fmt as { width?: number; height?: number; frameRate?: number }
    pick(wanted, 'mediaWidth', loose.width, out)
    pick(wanted, 'mediaHeight', loose.height, out)
    if (loose.frameRate != null) {
      pick(wanted, 'frameRate', `${Number(loose.frameRate.toFixed(3))} fps`, out)
    }

    pick(wanted, 'title', common.title, out)
    pick(wanted, 'artist', common.artist, out)
    pick(wanted, 'album', common.album, out)
    pick(wanted, 'albumArtist', common.albumartist, out)
    pick(wanted, 'year', common.year, out)
    if (common.genre?.length) pick(wanted, 'genre', common.genre.join('; '), out)
    if (common.track?.no != null) {
      const of = common.track.of != null ? `/${common.track.of}` : ''
      pick(wanted, 'track', `${common.track.no}${of}`, out)
    }
    if (common.disk?.no != null) {
      const of = common.disk.of != null ? `/${common.disk.of}` : ''
      pick(wanted, 'disc', `${common.disk.no}${of}`, out)
    }
    if (common.comment?.length) {
      const text = common.comment
        .map((c) => (typeof c === 'string' ? c : (c as { text?: string }).text ?? ''))
        .filter(Boolean)
        .join('; ')
      pick(wanted, 'comment', truncate(text), out)
    }
  } catch {
    // unsupported / corrupt
  }
  return out
}

export async function extractColumnValues(
  file: string,
  columns: DetailsColumnId[]
): Promise<EntryColumnValues> {
  const wanted = new Set(columns)
  let st
  try {
    st = await fsp.stat(file)
  } catch {
    return {}
  }
  if (!st.isFile()) return {}

  const ext = path.extname(file).slice(1).toLowerCase()
  if (IMAGE_EXTS.has(ext)) return extractImage(file, ext, wanted)
  if (AV_EXTS.has(ext)) return extractAv(file, wanted)
  return {}
}
