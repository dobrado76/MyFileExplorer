import fsp from 'node:fs/promises'
import path from 'node:path'
import type { PreviewField, PreviewModel } from '@shared/schemas/preview'
import { mediaUrlFor } from '../media/protocol'
import { protocolAllowlist } from '../security/paths'
import { requireAbsolute, statPath } from '../fs/list'
import { settingsStore } from '../settings/store'
import { extractPngTextChunks } from './pngText'
import { parseA1111Parameters } from './a1111'
import {
  pushA1111GenerationFields,
  resolveGenerationParametersText,
  capGenText
} from './genFields'
import { listIndexRoots } from '../search'
import { buildSpreadsheetSheets } from './spreadsheet'
import { docxToHtml, docToHtml } from './office'
import { pptxToPreviewSlides, pptToHtml } from './powerpoint'
import { rtfToHtml } from './rtf'
import { rasterizePsd } from './psd'
import { needsWebRaster, rasterizeWebImage } from './rasterWebImage'
import { buildSafetensorsPreviewFields } from './safetensors'
import { buildUvwPreviewFields, parseUnityMetaGuid } from './uvw'
import { hdrPreviewFields, parseHdrHeader, unknownHdrFields } from './hdr'
import { decodeSamiBuffer } from './sami'
import { lnkDetailsToFields, readLnkDetails } from './lnk'
import { loadZipArchiveTree } from './zipArchive'
import { loadUnityPackageTree } from './unityPackage'
import { loadTarArchiveTree } from './tarArchive'
import { loadSevenZipArchiveTree } from './sevenZipList'
import { loadRarArchiveTree } from './rarArchive'
import { loadIsoArchiveTree } from './iso9660'
import {
  archiveTypeLabel,
  detectArchiveFormat,
  type PreviewArchiveFormat
} from './archiveFormat'
import { readApkManifestInfo } from './apkManifest'
import { readTtfNames } from './ttfNames'
import { sniff3ds, sniffFbx, summarizeObj } from './objMesh'
import { loadAudioPreviewMeta, loadMediaPreviewMeta } from './audioMeta'
import {
  chmTopicMediaUrl,
  ensureChmExtracted,
  isChmTopicPath,
  loadChmToc
} from './chm'
import { readPeVersionInfo } from './peVersion'
import { getShellIconUrl } from '../icons/shell'
import {
  CHROMIUM_WEAK_VIDEO_EXTS,
  resolveVideoPosterUrl,
  STRIP_ONLY_VIDEO_EXTS
} from './videoPoster'
import { cachedPlayableVideoUrl, ensurePlayableVideoUrl } from './videoRemux'
import { resolveVidThumbFrames } from '../thumbs/vidCache'

const EXE_PREVIEW_EXTS = new Set(['exe', 'dll', 'scr', 'ocx', 'cpl', 'sys', 'com'])
const FONT_EXTS = new Set(['ttf'])
const MODEL3D_EXTS = new Set(['obj', 'fbx', '3ds'])
const MODEL3D_MAX_BYTES = 96 * 1024 * 1024

const IMAGE_EXTS = new Set([
  'png',
  'jpg',
  'jpeg',
  'jfif',
  'webp',
  'gif',
  'bmp',
  'avif',
  'tiff',
  'tif',
  'tga',
  'svg',
  'ico'
])
const AUDIO_EXTS = new Set(['mp3', 'wav', 'flac', 'ogg', 'm4a', 'aac', 'wma', 'opus'])
const VIDEO_EXTS = new Set(['mp4', 'mkv', 'webm', 'avi', 'divx', 'mov', 'wmv', 'm4v', 'mpg', 'mpeg'])
const TEXT_EXTS = new Set([
  'txt',
  'json',
  'yaml',
  'yml',
  'wlt',
  'meta',
  'mat',
  'terrainlayer',
  'lighting',
  'shadergraph',
  'shader',
  'mtl',
  'csproj',
  'sln',
  'vsconfig',
  'csv',
  'tsv',
  'log',
  'ini',
  'cfg',
  'conf',
  'toml',
  'xml',
  'ffs_gui',
  'css',
  'scss',
  'less',
  'js',
  'jsx',
  'ts',
  'tsx',
  'mjs',
  'cjs',
  'py',
  'rb',
  'rs',
  'go',
  'java',
  'c',
  'h',
  'cpp',
  'hpp',
  'cs',
  'php',
  'sh',
  'ps1',
  'psm1',
  'psd1',
  'ps',
  'bat',
  'cmd',
  'vbs',
  'vbe',
  'sql',
  'gitignore',
  'env',
  'editorconfig',
  'prettierrc',
  'lua',
  'vue',
  'svelte',
  'srt'
])
const MARKDOWN_EXTS = new Set(['md', 'markdown'])
const HTML_EXTS = new Set(['html', 'htm'])
const SPREADSHEET_EXTS = new Set(['xls', 'xlsx', 'xlsm', 'xlsb', 'ods', 'csv'])
const WORD_DOCX_EXTS = new Set(['docx'])
const WORD_DOC_EXTS = new Set(['doc'])
const PPTX_EXTS = new Set(['pptx'])
const PPT_EXTS = new Set(['ppt'])
const RTF_EXTS = new Set(['rtf'])
const PSD_EXTS = new Set(['psd'])
const SAFETENSORS_EXTS = new Set(['safetensors'])

type CacheEntry = { mtimeMs: number; size: number; model: PreviewModel }
const cache = new Map<string, CacheEntry>()
const CACHE_MAX = 100
/** Bump when preview builders change shape/parsing so stale models are dropped. */
const PREVIEW_CACHE_REV = 21

function bytesHuman(n: number): string {
  if (n < 1024) return `${n} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let v = n
  let u = -1
  do {
    v /= 1024
    u++
  } while (v >= 1024 && u < units.length - 1)
  return `${v.toFixed(v >= 100 ? 0 : 1)} ${units[u]}`
}

function dateHuman(ms: number): string {
  return ms > 0 ? new Date(ms).toLocaleString() : ''
}

export async function getPreview(
  rawPath: string,
  ads?: string | null
): Promise<PreviewModel> {
  const file = requireAbsolute(rawPath)

  // Remote files: stage under userData scratch, then reuse local preview handlers.
  // Keep model.path as the remote URI so selection / chrome stay wired correctly.
  if (file.toLowerCase().startsWith('mfe-remote://')) {
    const { remoteStat } = await import('../remote/sessionPool')
    const st = await remoteStat(file)
    if (!st) {
      return { path: file, kind: 'missing', fields: [] }
    }
    if (st.kind === 'dir') {
      const { parseRemoteLocation, remoteBasename } = await import('@shared/remotePaths')
      const loc = parseRemoteLocation(file)
      const name = loc ? remoteBasename(loc.remotePath) || loc.connectionId : file
      const fields: PreviewField[] = [
        {
          id: 'file.name',
          label: 'Name',
          value: name,
          group: 'file',
          copyable: true
        },
        { id: 'file.type', label: 'Type', value: 'Folder', group: 'file' }
      ]
      if (st.mtimeMs > 0) {
        fields.push({
          id: 'file.modified',
          label: 'Date modified',
          value: dateHuman(st.mtimeMs),
          group: 'file'
        })
      }
      fields.push({
        id: 'file.remote',
        label: 'Location',
        value: 'Remote repository',
        group: 'file'
      })
      return { path: file, kind: 'directory', fields }
    }
    const { ensureRemoteLocalFile } = await import('../remote/scratch')
    const { localPath } = await ensureRemoteLocalFile(file)
    const model = await getPreview(localPath, ads)
    return { ...model, path: file }
  }

  const st = await statPath(file)

  if (!st.exists) {
    return { path: file, kind: 'missing', fields: [] }
  }

  const adsCache =
    ads === undefined ? 'tip' : ads === null ? 'data' : `ads:${ads.toLowerCase()}`
  let verPart = 0
  try {
    const { isEditableImagePath } = await import('@shared/imageEdit')
    if (isEditableImagePath(file) && process.platform === 'win32') {
      const { readVerCount } = await import('../fs/imageEdit')
      verPart = await readVerCount(file)
    }
  } catch {
    /* ignore */
  }
  const cacheKey = `${PREVIEW_CACHE_REV}|${file.toLowerCase()}|v${verPart}|${adsCache}`
  const cached = cache.get(cacheKey)
  if (cached && cached.mtimeMs === st.mtimeMs && cached.size === st.size) {
    return cached.model
  }

  const warnings: string[] = []
  const fields: PreviewField[] = []
  const name = path.basename(file)
  const ext = path.extname(file).slice(1).toLowerCase()
  const archiveFmt = detectArchiveFormat(file)

  fields.push({ id: 'file.name', label: 'Name', value: name, group: 'file', copyable: true })

  let model: PreviewModel

  if (st.kind === 'dir') {
    fields.push({ id: 'file.type', label: 'Type', value: 'Folder', group: 'file' })
    fields.push({
      id: 'file.modified',
      label: 'Date modified',
      value: dateHuman(st.mtimeMs),
      group: 'file'
    })
    try {
      const children = await fsp.readdir(file)
      fields.push({
        id: 'dir.children',
        label: 'Items',
        value: String(children.length),
        group: 'file'
      })
    } catch {
      warnings.push('Could not count folder items')
    }
    try {
      const roots = listIndexRoots()
      const indexed = roots.some(
        (r) =>
          file.toLowerCase() === r.path.toLowerCase() ||
          file.toLowerCase().startsWith(r.path.toLowerCase() + path.sep)
      )
      fields.push({
        id: 'dir.indexed',
        label: 'Indexed for search',
        value: indexed ? 'Yes' : 'No',
        group: 'file'
      })
    } catch {
      // search db unavailable — omit row
    }
    model = { path: file, kind: 'directory', fields, warnings }
  } else {
    fields.push({
      id: 'file.type',
      label: 'Type',
      value: ext ? `${ext.toUpperCase()} file` : 'File',
      group: 'file'
    })
    fields.push({ id: 'file.size', label: 'Size', value: bytesHuman(st.size), group: 'file' })
    fields.push({
      id: 'file.modified',
      label: 'Date modified',
      value: dateHuman(st.mtimeMs),
      group: 'file'
    })
    if (st.birthtimeMs > 0) {
      fields.push({
        id: 'file.created',
        label: 'Date created',
        value: dateHuman(st.birthtimeMs),
        group: 'file'
      })
    }
    if (st.isReadonly) {
      fields.push({ id: 'file.readonly', label: 'Read-only', value: 'Yes', group: 'file' })
    }

    const mediaCacheKey = `${st.mtimeMs}-${st.size}`
    if (IMAGE_EXTS.has(ext)) {
      model = await buildImagePreview(file, ext, fields, warnings, mediaCacheKey, ads)
    } else if (AUDIO_EXTS.has(ext)) {
      model = await buildAudioPreview(file, st.mtimeMs, st.size, mediaCacheKey, fields, warnings)
    } else if (VIDEO_EXTS.has(ext)) {
      model = await buildVideoPreview(file, ext, st.mtimeMs, st.size, mediaCacheKey, fields, warnings)
    } else if (ext === 'pdf') {
      protocolAllowlist.allowDir(path.dirname(file))
      model = {
        path: file,
        kind: 'pdf',
        mediaUrl: mediaUrlFor(file, mediaCacheKey),
        fields,
        warnings
      }
    } else if (MARKDOWN_EXTS.has(ext)) {
      model = await buildMarkdownPreview(file, st.size, fields, warnings)
    } else if (HTML_EXTS.has(ext)) {
      model = await buildHtmlPreview(file, st.size, fields, warnings)
    } else if (ext === 'smi' || ext === 'sami') {
      model = await buildSamiPreview(file, st.size, fields, warnings)
    } else if (SPREADSHEET_EXTS.has(ext) && ext !== 'csv') {
      model = await buildOfficeSpreadsheetPreview(file, fields, warnings)
    } else if (WORD_DOCX_EXTS.has(ext)) {
      model = await buildWordPreview(file, 'docx', fields, warnings)
    } else if (WORD_DOC_EXTS.has(ext)) {
      model = await buildWordPreview(file, 'doc', fields, warnings)
    } else if (PPTX_EXTS.has(ext)) {
      model = await buildPowerPointPreview(file, 'pptx', fields, warnings)
    } else if (PPT_EXTS.has(ext)) {
      model = await buildPowerPointPreview(file, 'ppt', fields, warnings)
    } else if (RTF_EXTS.has(ext)) {
      model = await buildRtfPreview(file, st.size, fields, warnings)
    } else if (PSD_EXTS.has(ext)) {
      model = await buildPsdPreview(file, fields, warnings)
    } else if (SAFETENSORS_EXTS.has(ext)) {
      model = await buildSafetensorsPreview(file, fields, warnings)
    } else if (ext === 'lnk') {
      model = await buildShortcutPreview(file, fields, warnings)
    } else if (ext === 'uvw') {
      model = await buildUvwPreview(file, st.size, fields, warnings)
    } else if (ext === 'hdr') {
      model = await buildHdrPreview(file, st.size, fields, warnings)
    } else if (FONT_EXTS.has(ext)) {
      model = await buildFontPreview(file, fields, warnings, mediaCacheKey)
    } else if (MODEL3D_EXTS.has(ext)) {
      model = await buildModel3dPreview(file, ext, st.size, fields, warnings, mediaCacheKey)
    } else if (archiveFmt) {
      model = await buildArchivePreview(file, archiveFmt, fields, warnings)
    } else if (ext === 'chm') {
      model = await buildChmPreview(file, st.mtimeMs, st.size, fields, warnings)
    } else if (EXE_PREVIEW_EXTS.has(ext)) {
      model = await buildExecutablePreview(file, ext, fields, warnings)
    } else {
      // CSV stays as spreadsheet when small-enough to parse as workbook, else text.
      if (ext === 'csv') {
        try {
          model = await buildOfficeSpreadsheetPreview(file, fields, warnings)
        } catch {
          model = await buildTextOrBinaryPreview(file, ext, st.size, fields, warnings)
        }
      } else {
        model = await buildTextOrBinaryPreview(file, ext, st.size, fields, warnings)
      }
    }
  }

  cache.set(cacheKey, { mtimeMs: st.mtimeMs, size: st.size, model })
  if (cache.size > CACHE_MAX) {
    const oldest = cache.keys().next().value
    if (oldest !== undefined) cache.delete(oldest)
  }
  return model
}

async function buildImagePreview(
  file: string,
  ext: string,
  fields: PreviewField[],
  warnings: string[],
  mediaCacheKey: string,
  ads?: string | null
): Promise<PreviewModel> {
  protocolAllowlist.allowDir(path.dirname(file))

  let openPath = file
  let mediaAds: string | null | undefined = undefined
  let effectiveCacheKey = mediaCacheKey
  try {
    const { resolveImageAdsStream } = await import('../fs/imageEdit')
    const resolved = await resolveImageAdsStream(file, ads)
    openPath = resolved.openPath
    mediaAds = resolved.ads
    effectiveCacheKey = resolved.cacheKey
  } catch {
    /* fall back to $DATA */
  }

  let bytes: Buffer | null = null
  let exifBuf: Buffer | null = null
  let mediaUrl = mediaUrlFor(
    file,
    effectiveCacheKey,
    mediaAds !== undefined ? { ads: mediaAds } : undefined
  )

  if (needsWebRaster(ext)) {
    const raster = await rasterizeWebImage(openPath)
    if (raster) {
      mediaUrl = raster.mediaUrl
      if (raster.width && raster.height) {
        fields.push({
          id: 'image.dimensions',
          label: 'Dimensions',
          value: `${raster.width} × ${raster.height}`,
          group: 'file'
        })
      }
    } else {
      warnings.push('Could not decode image for preview (TIFF/TGA)')
    }
  } else {
    try {
      bytes = await fsp.readFile(openPath)
      const { default: sharp } = await import('sharp')
      // Read then close — sharp(path) can keep a Win32 handle on some builds.
      const meta = await sharp(bytes).metadata()
      if (meta.width && meta.height) {
        fields.push({
          id: 'image.dimensions',
          label: 'Dimensions',
          value: `${meta.width} × ${meta.height}`,
          group: 'file'
        })
      }
      if (meta.exif) exifBuf = Buffer.from(meta.exif)
    } catch {
      warnings.push('Could not read image metadata')
    }
  }

  if (bytes) {
    try {
      addImageGenerationFields(ext, bytes, exifBuf, fields, warnings)
    } catch {
      warnings.push('Generation metadata parse incomplete')
    }
  }

  return {
    path: file,
    kind: 'image',
    mediaUrl,
    fields,
    warnings
  }
}

function addImageGenerationFields(
  ext: string,
  bytes: Buffer,
  exifBuf: Buffer | null | undefined,
  fields: PreviewField[],
  warnings: string[]
): void {
  const paramsText = resolveGenerationParametersText(bytes, ext, exifBuf ?? null)
  if (paramsText) {
    const parsed = parseA1111Parameters(paramsText)
    if (parsed) {
      pushA1111GenerationFields(parsed, fields, warnings)
    } else {
      fields.push({
        id: 'gen.rawParameters',
        label: 'Raw parameters',
        value: capGenText(paramsText, warnings, 'Raw parameters'),
        group: 'generation',
        mono: true,
        copyable: true
      })
    }
  }

  // ComfyUI workflow JSON still lives in PNG tEXt.
  if (ext === 'png') {
    addPngComfyJsonFields(bytes, fields, warnings)
  }
}

function addPngComfyJsonFields(
  buf: Buffer,
  fields: PreviewField[],
  warnings: string[]
): void {
  const chunks = extractPngTextChunks(buf)
  if (chunks.length === 0) return

  const byKeyword = new Map<string, string>()
  for (const c of chunks) {
    if (!byKeyword.has(c.keyword)) byKeyword.set(c.keyword, c.text)
  }

  const addJsonField = (keyword: string, id: string, label: string): void => {
    const text = byKeyword.get(keyword)
    if (!text) return
    let pretty = text
    try {
      pretty = JSON.stringify(JSON.parse(text), null, 2)
    } catch {
      warnings.push(`${label} is not valid JSON`)
    }
    fields.push({
      id,
      label,
      value: capGenText(pretty, warnings, label),
      group: 'generation',
      mono: true,
      copyable: true
    })
  }
  // Only treat `prompt` as Comfy JSON when it parses as JSON (some tools store text there).
  const promptText = byKeyword.get('prompt')
  if (promptText) {
    try {
      JSON.parse(promptText)
      addJsonField('prompt', 'gen.comfyPromptJson', 'Comfy prompt (JSON)')
    } catch {
      // not Comfy — ignore
    }
  }
  addJsonField('workflow', 'gen.comfyWorkflowJson', 'Comfy workflow (JSON)')
}

async function buildPsdPreview(
  file: string,
  fields: PreviewField[],
  warnings: string[]
): Promise<PreviewModel> {
  const raster = await rasterizePsd(file, warnings)
  if (raster) {
    if (raster.width && raster.height) {
      fields.push({
        id: 'image.dimensions',
        label: 'Dimensions',
        value: `${raster.width} × ${raster.height}`,
        group: 'file'
      })
    }
    if (raster.layerCount > 0) {
      fields.push({
        id: 'image.layers',
        label: 'Layers',
        value: String(raster.layerCount),
        group: 'image'
      })
    }
    fields.push({
      id: 'image.psdSource',
      label: 'Preview source',
      value: raster.fromThumbnail ? 'Embedded thumbnail' : 'Composite image',
      group: 'image'
    })
    return {
      path: file,
      kind: 'image',
      mediaUrl: raster.mediaUrl,
      fields,
      warnings
    }
  }
  return { path: file, kind: 'binary', fields, warnings }
}

async function buildHdrPreview(
  file: string,
  fileSize: number,
  fields: PreviewField[],
  warnings: string[]
): Promise<PreviewModel> {
  const typeIdx = fields.findIndex((f) => f.id === 'file.type')
  if (typeIdx >= 0) {
    fields[typeIdx] = {
      id: 'file.type',
      label: 'Type',
      value: 'Radiance HDR',
      group: 'file'
    }
  }

  let unityGuid: string | null = null
  let unityMetaName: string | null = null
  try {
    const metaPath = `${file}.meta`
    const text = await fsp.readFile(metaPath, 'utf8')
    unityGuid = parseUnityMetaGuid(text)
    unityMetaName = path.basename(metaPath)
  } catch {
    /* no sibling .meta */
  }

  let header = null as ReturnType<typeof parseHdrHeader>
  try {
    const n = Math.min(16 * 1024, Math.max(0, fileSize))
    if (n > 0) {
      const handle = await fsp.open(file, 'r')
      try {
        const buf = Buffer.alloc(n)
        const { bytesRead } = await handle.read(buf, 0, n, 0)
        header = parseHdrHeader(buf.subarray(0, bytesRead))
      } finally {
        await handle.close()
      }
    }
  } catch {
    warnings.push('Could not read HDR header')
  }

  if (!header) {
    if (typeIdx >= 0) {
      fields[typeIdx] = {
        id: 'file.type',
        label: 'Type',
        value: 'HDR file',
        group: 'file'
      }
    }
    fields.push(...unknownHdrFields())
    if (unityGuid) {
      fields.push({
        id: 'hdr.unityGuid',
        label: 'Unity GUID',
        value: unityGuid,
        group: 'other',
        copyable: true
      })
    }
    if (unityMetaName) {
      fields.push({
        id: 'hdr.unityMeta',
        label: 'Unity sidecar',
        value: unityMetaName,
        group: 'other',
        copyable: true
      })
    }
    return {
      path: file,
      kind: 'binary',
      subtitle: 'HDR file',
      fields,
      warnings: warnings.length ? warnings : undefined
    }
  }

  fields.push({
    id: 'image.dimensions',
    label: 'Dimensions',
    value: `${header.width} × ${header.height}`,
    group: 'file'
  })

  protocolAllowlist.allowDir(path.dirname(file))
  const raster = await rasterizeWebImage(file)
  const scale =
    raster && raster.width > 0
      ? Math.max(1, Math.round(header.width / raster.width))
      : 1
  fields.push(...hdrPreviewFields(header, { unityGuid, unityMetaName, scale }))

  if (!raster) {
    warnings.push('Could not decode Radiance HDR for preview')
    return {
      path: file,
      kind: 'binary',
      subtitle: 'Radiance HDR',
      fields,
      warnings
    }
  }

  return {
    path: file,
    kind: 'image',
    subtitle: 'Radiance HDR',
    mediaUrl: raster.mediaUrl,
    fields,
    warnings: warnings.length ? warnings : undefined
  }
}

async function buildUvwPreview(
  file: string,
  fileSize: number,
  fields: PreviewField[],
  warnings: string[]
): Promise<PreviewModel> {
  const typeIdx = fields.findIndex((f) => f.id === 'file.type')
  if (typeIdx >= 0) {
    fields[typeIdx] = {
      id: 'file.type',
      label: 'Type',
      value: '3ds Max UVW map',
      group: 'file'
    }
  }
  try {
    const built = await buildUvwPreviewFields(file, fileSize)
    fields.push(...built.fields)
    return {
      path: file,
      kind: 'binary',
      subtitle: built.subtitle,
      fields,
      warnings: warnings.length ? warnings : undefined
    }
  } catch {
    warnings.push('Could not read UVW file')
    return {
      path: file,
      kind: 'binary',
      subtitle: '3ds Max UVW map',
      fields,
      warnings
    }
  }
}

async function buildSafetensorsPreview(
  file: string,
  fields: PreviewField[],
  warnings: string[]
): Promise<PreviewModel> {
  let subtitle: string | undefined
  try {
    const built = await buildSafetensorsPreviewFields(file, warnings)
    if (built) {
      subtitle = built.subtitle
      fields.push(...built.fields)
    }
  } catch {
    warnings.push('SafeTensors metadata parse incomplete')
  }
  return { path: file, kind: 'binary', subtitle, fields, warnings }
}

async function readTextSample(
  file: string,
  size: number,
  warnings: string[]
): Promise<string | null> {
  const maxBytes = settingsStore().get().textPreviewMaxBytes
  const readBytes = Math.min(size, maxBytes)
  try {
    const handle = await fsp.open(file, 'r')
    let buf: Buffer
    try {
      buf = Buffer.alloc(readBytes)
      await handle.read(buf, 0, readBytes, 0)
    } finally {
      await handle.close()
    }
    let sample =
      buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe
        ? buf.subarray(2).toString('utf16le')
        : buf.toString('utf8')
    if (sample.charCodeAt(0) === 0xfeff) sample = sample.slice(1)
    if (size > readBytes) warnings.push('Preview truncated')
    return sample
  } catch {
    return null
  }
}

async function buildMarkdownPreview(
  file: string,
  size: number,
  fields: PreviewField[],
  warnings: string[]
): Promise<PreviewModel> {
  const textSample = await readTextSample(file, size, warnings)
  if (textSample === null) return { path: file, kind: 'binary', fields, warnings }
  return { path: file, kind: 'markdown', textSample, fields, warnings }
}

async function buildHtmlPreview(
  file: string,
  size: number,
  fields: PreviewField[],
  warnings: string[]
): Promise<PreviewModel> {
  const textSample = await readTextSample(file, size, warnings)
  if (textSample === null) return { path: file, kind: 'binary', fields, warnings }
  return { path: file, kind: 'html', textSample, fields, warnings }
}

async function buildSamiPreview(
  file: string,
  size: number,
  fields: PreviewField[],
  warnings: string[]
): Promise<PreviewModel> {
  const maxBytes = settingsStore().get().textPreviewMaxBytes
  const readBytes = Math.min(size, maxBytes)
  let buf: Buffer
  try {
    const handle = await fsp.open(file, 'r')
    try {
      buf = Buffer.alloc(readBytes)
      await handle.read(buf, 0, readBytes, 0)
    } finally {
      await handle.close()
    }
  } catch {
    return { path: file, kind: 'binary', fields, warnings }
  }
  const { text, encoding } = decodeSamiBuffer(buf)
  if (size > readBytes) warnings.push('Preview truncated')
  const typeIdx = fields.findIndex((f) => f.id === 'file.type')
  if (typeIdx >= 0) {
    fields[typeIdx] = { id: 'file.type', label: 'Type', value: 'SAMI subtitle', group: 'file' }
  }
  fields.push({
    id: 'sami.encoding',
    label: 'Encoding',
    value: encoding,
    group: 'other'
  })
  return {
    path: file,
    kind: 'html',
    subtitle: 'SAMI subtitle',
    textSample: text,
    fields,
    warnings
  }
}

async function buildOfficeSpreadsheetPreview(
  file: string,
  fields: PreviewField[],
  warnings: string[]
): Promise<PreviewModel> {
  try {
    const sheets = await buildSpreadsheetSheets(file, warnings)
    if (sheets.length > 0) {
      fields.push({
        id: 'sheet.count',
        label: 'Sheets',
        value: String(sheets.length),
        group: 'other'
      })
    }
    return { path: file, kind: 'spreadsheet', sheets, fields, warnings }
  } catch (e) {
    warnings.push(e instanceof Error ? e.message : 'Could not parse spreadsheet')
    return { path: file, kind: 'binary', fields, warnings }
  }
}

async function buildWordPreview(
  file: string,
  format: 'docx' | 'doc',
  fields: PreviewField[],
  warnings: string[]
): Promise<PreviewModel> {
  try {
    const htmlBody = format === 'docx' ? await docxToHtml(file, warnings) : await docToHtml(file, warnings)
    return { path: file, kind: 'document', htmlBody, fields, warnings }
  } catch (e) {
    warnings.push(e instanceof Error ? e.message : 'Could not parse Word document')
    return { path: file, kind: 'binary', fields, warnings }
  }
}

async function buildPowerPointPreview(
  file: string,
  format: 'pptx' | 'ppt',
  fields: PreviewField[],
  warnings: string[]
): Promise<PreviewModel> {
  try {
    if (format === 'pptx') {
      const pptSlides = await pptxToPreviewSlides(file, warnings)
      if (pptSlides.length > 0) {
        fields.push({
          id: 'ppt.slides',
          label: 'Slides',
          value: String(pptSlides.length),
          group: 'file'
        })
      }
      return {
        path: file,
        kind: 'document',
        subtitle: 'PowerPoint',
        pptSlides,
        fields,
        warnings
      }
    }
    const htmlBody = await pptToHtml(file, warnings)
    return {
      path: file,
      kind: 'document',
      subtitle: 'PowerPoint',
      htmlBody,
      fields,
      warnings
    }
  } catch (e) {
    warnings.push(e instanceof Error ? e.message : 'Could not parse PowerPoint file')
    return { path: file, kind: 'binary', fields, warnings }
  }
}

async function buildRtfPreview(
  file: string,
  size: number,
  fields: PreviewField[],
  warnings: string[]
): Promise<PreviewModel> {
  const maxBytes = Math.min(size, settingsStore().get().textPreviewMaxBytes)
  try {
    const handle = await fsp.open(file, 'r')
    let buf: Buffer
    try {
      buf = Buffer.alloc(maxBytes)
      await handle.read(buf, 0, maxBytes, 0)
    } finally {
      await handle.close()
    }
    if (size > maxBytes) warnings.push('Preview truncated')
    const htmlBody = rtfToHtml(buf.toString('latin1'), warnings)
    return { path: file, kind: 'rtf', htmlBody, fields, warnings }
  } catch (e) {
    warnings.push(e instanceof Error ? e.message : 'Could not parse RTF')
    return { path: file, kind: 'binary', fields, warnings }
  }
}

async function buildVideoPreview(
  file: string,
  ext: string,
  mtimeMs: number,
  size: number,
  mediaCacheKey: string,
  fields: PreviewField[],
  warnings: string[]
): Promise<PreviewModel> {
  protocolAllowlist.allowDir(path.dirname(file))

  const typeIdx = fields.findIndex((f) => f.id === 'file.type')
  if (typeIdx >= 0) {
    fields[typeIdx] = {
      id: 'file.type',
      label: 'Type',
      value: ext ? `${ext.toUpperCase()} video` : 'Video',
      group: 'file'
    }
  }

  // Do not await music-metadata here — large files can scan the whole stream for
  // duration and would block mediaUrl / the player. Renderer loads tags via getMediaMeta.

  // AVI: no in-pane player — animated !VIDTHUMB_CACHE strip + Open (D33).
  if (STRIP_ONLY_VIDEO_EXTS.has(ext)) {
    const stripFrames = await resolveVidThumbFrames(file)
    return {
      path: file,
      kind: 'video',
      stripFrames: stripFrames.length > 0 ? stripFrames : undefined,
      mediaMetaPending: true,
      fields,
      warnings: warnings.length ? warnings : undefined
    }
  }

  let mediaUrl: string | undefined
  let posterUrl: string | undefined
  let needsPlayable = false

  if (CHROMIUM_WEAK_VIDEO_EXTS.has(ext)) {
    // Fast path: poster + cached remux if any. Full remux is async via ensurePlayable.
    posterUrl = (await resolveVideoPosterUrl(file, mtimeMs, size)) ?? undefined
    mediaUrl = (await cachedPlayableVideoUrl(file, mtimeMs, size)) ?? undefined
    needsPlayable = !mediaUrl
    if (!posterUrl && !mediaUrl) {
      warnings.push('Could not prepare an in-app preview — open with the default app to watch')
    }
  } else {
    mediaUrl = mediaUrlFor(file, mediaCacheKey)
  }

  return {
    path: file,
    kind: 'video',
    mediaUrl,
    posterUrl,
    needsPlayable: needsPlayable || undefined,
    mediaMetaPending: true,
    fields,
    warnings: warnings.length ? warnings : undefined
  }
}

/** Remux/transcode weak-container video to MP4 for `<video>` playback (userData cache). */
export async function ensurePlayablePreview(
  rawPath: string,
  opts?: { force?: boolean }
): Promise<{ mediaUrl: string | null }> {
  let file = requireAbsolute(rawPath)
  if (file.toLowerCase().startsWith('mfe-remote://')) {
    const { ensureRemoteLocalFile } = await import('../remote/scratch')
    file = (await ensureRemoteLocalFile(file)).localPath
  }
  const st = await statPath(file)
  if (!st.exists || st.kind === 'dir') return { mediaUrl: null }
  const ext = path.extname(file).replace(/^\./, '').toLowerCase()
  if (STRIP_ONLY_VIDEO_EXTS.has(ext)) return { mediaUrl: null }
  if (!CHROMIUM_WEAK_VIDEO_EXTS.has(ext)) {
    protocolAllowlist.allowDir(path.dirname(file))
    return { mediaUrl: mediaUrlFor(file, `${st.mtimeMs}-${st.size}`) }
  }
  const url = await ensurePlayableVideoUrl(file, st.mtimeMs, st.size, opts)
  return { mediaUrl: url }
}

/**
 * Load A/V format/tag fields for the preview pane (async follow-up after fast get).
 * May scan large files for duration — must not block `preview:get` / mediaUrl.
 */
export async function getMediaPreviewMeta(rawPath: string): Promise<{
  fields: PreviewField[]
  subtitle?: string
  coverUrl?: string
}> {
  let file = requireAbsolute(rawPath)
  if (file.toLowerCase().startsWith('mfe-remote://')) {
    const { ensureRemoteLocalFile } = await import('../remote/scratch')
    file = (await ensureRemoteLocalFile(file)).localPath
  }
  const st = await statPath(file)
  if (!st.exists || st.kind === 'dir') return { fields: [] }
  const ext = path.extname(file).replace(/^\./, '').toLowerCase()
  if (AUDIO_EXTS.has(ext)) {
    try {
      const meta = await loadAudioPreviewMeta(file, st.mtimeMs, st.size)
      return { fields: meta.fields, subtitle: meta.subtitle, coverUrl: meta.coverUrl }
    } catch {
      return { fields: [] }
    }
  }
  if (VIDEO_EXTS.has(ext)) {
    try {
      const meta = await loadMediaPreviewMeta(file, st.mtimeMs, st.size, {
        group: 'video',
        includeCover: false
      })
      return { fields: meta.fields, subtitle: meta.subtitle }
    } catch {
      return { fields: [] }
    }
  }
  return { fields: [] }
}

async function buildAudioPreview(
  file: string,
  mtimeMs: number,
  size: number,
  mediaCacheKey: string,
  fields: PreviewField[],
  warnings: string[]
): Promise<PreviewModel> {
  protocolAllowlist.allowDir(path.dirname(file))
  const typeIdx = fields.findIndex((f) => f.id === 'file.type')
  if (typeIdx >= 0) {
    const ext = path.extname(file).slice(1).toLowerCase()
    fields[typeIdx] = {
      id: 'file.type',
      label: 'Type',
      value: ext ? `${ext.toUpperCase()} audio` : 'Audio',
      group: 'file'
    }
  }

  // Tags/cover load async via getMediaMeta so playback can start immediately.
  return {
    path: file,
    kind: 'audio',
    mediaUrl: mediaUrlFor(file, mediaCacheKey),
    mediaMetaPending: true,
    fields,
    warnings: warnings.length ? warnings : undefined
  }
}

async function allowModelSidecars(file: string): Promise<void> {
  const dir = path.dirname(file)
  protocolAllowlist.allowDir(dir)
  try {
    const ents = await fsp.readdir(dir, { withFileTypes: true })
    let n = 0
    for (const e of ents) {
      if (!e.isDirectory()) continue
      protocolAllowlist.allowDir(path.join(dir, e.name))
      if (++n >= 32) break
    }
  } catch {
    /* listing optional */
  }
}

async function buildModel3dPreview(
  file: string,
  ext: string,
  fileSize: number,
  fields: PreviewField[],
  warnings: string[],
  mediaCacheKey: string
): Promise<PreviewModel> {
  const typeIdx = fields.findIndex((f) => f.id === 'file.type')
  const labels: Record<string, string> = {
    obj: 'Wavefront OBJ',
    fbx: 'Autodesk FBX',
    '3ds': '3ds Max mesh'
  }
  const typeLabel = labels[ext] ?? '3D model'
  if (typeIdx >= 0) {
    fields[typeIdx] = { id: 'file.type', label: 'Type', value: typeLabel, group: 'file' }
  }

  fields.push({
    id: 'model3d.format',
    label: 'Format',
    value: typeLabel,
    group: 'other'
  })
  fields.push({
    id: 'model3d.note',
    label: 'Preview',
    value: 'Orbit WebGL view (drag to rotate, scroll to zoom).',
    group: 'other'
  })

  if (ext === 'obj') {
    try {
      const n = Math.min(fileSize, 4 * 1024 * 1024)
      const handle = await fsp.open(file, 'r')
      let buf: Buffer
      try {
        buf = Buffer.alloc(n)
        const { bytesRead } = await handle.read(buf, 0, n, 0)
        buf = buf.subarray(0, bytesRead)
      } finally {
        await handle.close()
      }
      const sum = summarizeObj(buf.toString('utf8'))
      if (sum.vertices) {
        fields.push({
          id: 'model3d.vertices',
          label: 'Vertices',
          value: sum.vertices.toLocaleString('en-US'),
          group: 'other'
        })
      }
      if (sum.triangles) {
        fields.push({
          id: 'model3d.triangles',
          label: 'Triangles',
          value:
            sum.triangles.toLocaleString('en-US') +
            (sum.faces !== sum.triangles ? ` (${sum.faces.toLocaleString('en-US')} faces)` : ''),
          group: 'other'
        })
      }
      if (sum.mtllib) {
        fields.push({
          id: 'model3d.mtllib',
          label: 'Material library',
          value: sum.mtllib,
          group: 'other',
          copyable: true
        })
      }
      if (fileSize > n) warnings.push('OBJ counts from the first 4 MiB')
    } catch {
      warnings.push('Could not summarize OBJ')
    }
  } else if (ext === 'fbx') {
    try {
      const handle = await fsp.open(file, 'r')
      let buf: Buffer
      try {
        buf = Buffer.alloc(Math.min(256, fileSize))
        const { bytesRead } = await handle.read(buf, 0, buf.length, 0)
        buf = buf.subarray(0, bytesRead)
      } finally {
        await handle.close()
      }
      const kind = sniffFbx(buf)
      if (kind) {
        fields.push({
          id: 'model3d.fbxKind',
          label: 'FBX encoding',
          value: kind === 'binary' ? 'Binary' : 'ASCII',
          group: 'other'
        })
      }
    } catch {
      /* optional */
    }
  } else if (ext === '3ds') {
    try {
      const handle = await fsp.open(file, 'r')
      let buf: Buffer
      try {
        buf = Buffer.alloc(Math.min(8, fileSize))
        const { bytesRead } = await handle.read(buf, 0, buf.length, 0)
        buf = buf.subarray(0, bytesRead)
      } finally {
        await handle.close()
      }
      if (!sniff3ds(buf)) warnings.push('File does not start with a 3DS main chunk')
    } catch {
      /* optional */
    }
  }

  await allowModelSidecars(file)
  const tooBig = fileSize > MODEL3D_MAX_BYTES
  if (tooBig) {
    warnings.push(`Larger than ${Math.round(MODEL3D_MAX_BYTES / (1024 * 1024))} MiB — WebGL preview skipped`)
  }

  return {
    path: file,
    kind: 'model3d',
    subtitle: typeLabel,
    mediaUrl: tooBig ? undefined : mediaUrlFor(file, mediaCacheKey),
    fields,
    warnings: warnings.length ? warnings : undefined
  }
}

async function buildFontPreview(
  file: string,
  fields: PreviewField[],
  warnings: string[],
  mediaCacheKey: string
): Promise<PreviewModel> {
  const typeIdx = fields.findIndex((f) => f.id === 'file.type')
  if (typeIdx >= 0) {
    fields[typeIdx] = {
      id: 'file.type',
      label: 'Type',
      value: 'TrueType font',
      group: 'file'
    }
  }

  try {
    const names = readTtfNames(file)
    const push = (id: string, label: string, value: string | null): void => {
      if (!value) return
      fields.push({ id, label, value, group: 'other', copyable: true })
    }
    push('font.family', 'Family', names.family)
    push('font.fullName', 'Full name', names.fullName)
    push('font.version', 'Version', names.version)
    push('font.copyright', 'Copyright', names.copyright)
    protocolAllowlist.allowDir(path.dirname(file))
    return {
      path: file,
      kind: 'font',
      subtitle: names.fullName || names.family || 'TrueType font',
      mediaUrl: mediaUrlFor(file, mediaCacheKey),
      fields,
      warnings: warnings.length ? warnings : undefined
    }
  } catch (e) {
    warnings.push(e instanceof Error ? e.message : 'Could not read font')
    protocolAllowlist.allowDir(path.dirname(file))
    return {
      path: file,
      kind: 'font',
      subtitle: 'TrueType font',
      mediaUrl: mediaUrlFor(file, mediaCacheKey),
      fields,
      warnings
    }
  }
}

async function buildExecutablePreview(
  file: string,
  ext: string,
  fields: PreviewField[],
  warnings: string[]
): Promise<PreviewModel> {
  const typeIdx = fields.findIndex((f) => f.id === 'file.type')
  if (typeIdx >= 0) {
    const typeLabel =
      ext === 'dll'
        ? 'Application extension (DLL)'
        : ext === 'com'
          ? 'MS-DOS application'
          : 'Application'
    fields[typeIdx] = {
      id: 'file.type',
      label: 'Type',
      value: typeLabel,
      group: 'file'
    }
  }

  const hadVersion = pushPeVersionFields(file, fields)
  // Classic .com binaries are not PE — missing VERSIONINFO is normal.
  if (!hadVersion && process.platform === 'win32' && ext !== 'com') {
    warnings.push('No version resource in this file')
  }

  let mediaUrl: string | undefined
  try {
    const icon = await getShellIconUrl(file, 32, false)
    if (icon.url) mediaUrl = icon.url
  } catch {
    // keep preview without icon
  }

  const subtitle =
    fields.find((f) => f.id === 'exe.fileDescription')?.value?.trim() ||
    fields.find((f) => f.id === 'exe.productName')?.value?.trim() ||
    (ext === 'dll' ? 'Dynamic-link library' : ext === 'com' ? 'MS-DOS application' : 'Application')

  return {
    path: file,
    kind: 'executable',
    subtitle,
    mediaUrl,
    fields,
    warnings: warnings.length ? warnings : undefined
  }
}

async function loadArchiveTree(format: PreviewArchiveFormat, file: string) {
  switch (format) {
    case 'zip':
    case 'apk':
      return loadZipArchiveTree(file)
    case 'unitypackage':
      return loadUnityPackageTree(file)
    case '7z':
    case 'msi':
      return loadSevenZipArchiveTree(file)
    case 'iso':
    case 'img':
      return loadIsoArchiveTree(file)
    case 'rar':
      return loadRarArchiveTree(file)
    case 'tar':
      return loadTarArchiveTree(file, false)
    case 'targz':
      return loadTarArchiveTree(file, true)
  }
}

function archiveShortName(format: PreviewArchiveFormat): string {
  switch (format) {
    case 'targz':
      return 'TAR.GZ'
    case 'unitypackage':
      return 'Unity package'
    case 'apk':
      return 'APK'
    case 'msi':
      return 'MSI'
    case 'iso':
      return 'ISO'
    case 'img':
      return 'IMG'
    default:
      return format.toUpperCase()
  }
}

/** @returns true when any VERSIONINFO string was present. */
function pushPeVersionFields(file: string, fields: PreviewField[]): boolean {
  const ver = readPeVersionInfo(file)
  if (!ver) return false
  const push = (id: string, label: string, value: string | null): void => {
    if (!value) return
    fields.push({ id, label, value, group: 'executable', copyable: true })
  }
  push('exe.fileDescription', 'File description', ver.fileDescription)
  push('exe.fileVersion', 'File version', ver.fileVersion)
  push('exe.productName', 'Product name', ver.productName)
  push('exe.productVersion', 'Product version', ver.productVersion)
  push('exe.copyright', 'Copyright', ver.copyright)
  push('exe.company', 'Company', ver.companyName)
  push('exe.language', 'Language', ver.language)
  push('exe.originalFilename', 'Original filename', ver.originalFilename)
  push('exe.internalName', 'Internal name', ver.internalName)
  push('exe.comments', 'Comments', ver.comments)
  push('exe.legalTrademarks', 'Legal trademarks', ver.legalTrademarks)
  push('exe.privateBuild', 'Private build', ver.privateBuild)
  push('exe.specialBuild', 'Special build', ver.specialBuild)
  return true
}

async function enrichMsiArchivePreview(
  file: string,
  fields: PreviewField[]
): Promise<string | undefined> {
  pushPeVersionFields(file, fields)
  try {
    const icon = await getShellIconUrl(file, 32, false)
    return icon.url || undefined
  } catch {
    return undefined
  }
}

async function enrichApkArchivePreview(file: string, fields: PreviewField[]): Promise<string | undefined> {
  try {
    const info = await readApkManifestInfo(file)
    const push = (id: string, label: string, value: string | null): void => {
      if (!value) return
      fields.push({ id, label, value, group: 'other', copyable: true })
    }
    push('apk.package', 'Package', info.packageName)
    push('apk.versionName', 'Version', info.versionName)
    push('apk.versionCode', 'Version code', info.versionCode)
    if (info.packageName && info.versionName) return `${info.packageName} · ${info.versionName}`
    if (info.packageName) return info.packageName
    if (info.versionName) return info.versionName
  } catch {
    // omit APK metadata on parse failure
  }
  return undefined
}

async function buildArchivePreview(
  file: string,
  format: PreviewArchiveFormat,
  fields: PreviewField[],
  warnings: string[]
): Promise<PreviewModel> {
  const typeIdx = fields.findIndex((f) => f.id === 'file.type')
  if (typeIdx >= 0) {
    fields[typeIdx] = {
      id: 'file.type',
      label: 'Type',
      value: archiveTypeLabel(format),
      group: 'file'
    }
  }

  const shortName = archiveShortName(format)
  let mediaUrl: string | undefined
  let metaSubtitle: string | undefined

  if (format === 'msi') {
    mediaUrl = await enrichMsiArchivePreview(file, fields)
  } else if (format === 'apk') {
    metaSubtitle = await enrichApkArchivePreview(file, fields)
  }

  try {
    const listed = await loadArchiveTree(format, file)
    if (listed.truncated) {
      warnings.push('Contents list truncated for preview')
    }
    fields.push({
      id: 'archive.files',
      label: format === 'unitypackage' ? 'Assets' : 'Files',
      value: String(listed.fileCount) + (listed.truncated ? '+' : ''),
      group: 'file'
    })
    fields.push({
      id: 'archive.folders',
      label: 'Folders',
      value: String(listed.folderCount) + (listed.truncated ? '+' : ''),
      group: 'file'
    })
    const countSubtitle =
      listed.fileCount + listed.folderCount === 0
        ? `Empty ${shortName}`
        : `${listed.fileCount} ${format === 'unitypackage' ? 'asset' : 'file'}${listed.fileCount === 1 ? '' : 's'} · ${listed.folderCount} folder${listed.folderCount === 1 ? '' : 's'}${listed.truncated ? '…' : ''}`
    const subtitle = metaSubtitle ? `${metaSubtitle} · ${countSubtitle}` : countSubtitle
    return {
      path: file,
      kind: 'archive',
      subtitle,
      mediaUrl,
      archiveTree: listed.tree,
      archiveFormat: format,
      fields,
      warnings: warnings.length ? warnings : undefined
    }
  } catch (e) {
    warnings.push(e instanceof Error ? e.message : `Could not read ${shortName} contents`)
    return {
      path: file,
      kind: 'archive',
      subtitle: metaSubtitle || archiveTypeLabel(format),
      mediaUrl,
      archiveTree: [],
      archiveFormat: format,
      fields,
      warnings
    }
  }
}

async function buildChmPreview(
  file: string,
  mtimeMs: number,
  size: number,
  fields: PreviewField[],
  warnings: string[]
): Promise<PreviewModel> {
  const typeIdx = fields.findIndex((f) => f.id === 'file.type')
  if (typeIdx >= 0) {
    fields[typeIdx] = {
      id: 'file.type',
      label: 'Type',
      value: 'Compiled HTML Help',
      group: 'file'
    }
  }

  try {
    const extract = await ensureChmExtracted(file, mtimeMs, size)
    const toc = await loadChmToc(extract.rootDir)
    if (toc.truncated) warnings.push('Contents list truncated for preview')
    fields.push({
      id: 'chm.topics',
      label: 'Topics',
      value: String(toc.topicCount) + (toc.truncated ? '+' : ''),
      group: 'file'
    })

    let mediaUrl: string | undefined
    if (toc.defaultTopic) {
      try {
        mediaUrl = await chmTopicMediaUrl(file, mtimeMs, size, toc.defaultTopic)
      } catch (e) {
        warnings.push(e instanceof Error ? e.message : 'Could not open default topic')
      }
    } else {
      warnings.push('No HTML topics found after decompile')
    }

    const subtitle =
      toc.topicCount === 0
        ? 'Compiled HTML Help'
        : `${toc.topicCount} topic${toc.topicCount === 1 ? '' : 's'}${toc.truncated ? '…' : ''}`

    return {
      path: file,
      kind: 'chm',
      subtitle,
      mediaUrl,
      archiveTree: toc.tree,
      fields,
      warnings: warnings.length ? warnings : undefined
    }
  } catch (e) {
    warnings.push(e instanceof Error ? e.message : 'Could not open CHM')
    return {
      path: file,
      kind: 'chm',
      subtitle: 'Compiled HTML Help',
      archiveTree: [],
      fields,
      warnings
    }
  }
}

/** Resolve a CHM TOC topic to an allowlisted mfe-media://chm/ URL. */
export async function getChmTopicPreview(
  rawPath: string,
  topic: string
): Promise<{ mediaUrl: string }> {
  const file = requireAbsolute(rawPath)
  const st = await statPath(file)
  if (!st.exists || st.kind === 'dir') {
    throw new Error('CHM file not found')
  }
  if (!isChmTopicPath(topic)) {
    throw new Error('Invalid CHM topic')
  }
  const mediaUrl = await chmTopicMediaUrl(file, st.mtimeMs, st.size, topic)
  return { mediaUrl }
}

async function buildShortcutPreview(
  file: string,
  fields: PreviewField[],
  warnings: string[]
): Promise<PreviewModel> {
  const typeIdx = fields.findIndex((f) => f.id === 'file.type')
  if (typeIdx >= 0) {
    fields[typeIdx] = { id: 'file.type', label: 'Type', value: 'Shortcut', group: 'file' }
  }
  try {
    const details = await readLnkDetails(file)
    fields.push(...lnkDetailsToFields(details))
    const subtitle = details.targetPath
      ? `Shortcut → ${path.basename(details.targetPath) || details.targetPath}`
      : 'Shortcut'
    return {
      path: file,
      kind: 'shortcut',
      subtitle,
      fields,
      warnings: warnings.length ? warnings : undefined
    }
  } catch (e) {
    warnings.push(e instanceof Error ? e.message : 'Could not read shortcut')
    return {
      path: file,
      kind: 'shortcut',
      subtitle: 'Shortcut',
      fields,
      warnings
    }
  }
}

async function buildTextOrBinaryPreview(
  file: string,
  ext: string,
  size: number,
  fields: PreviewField[],
  warnings: string[]
): Promise<PreviewModel> {
  const maxBytes = settingsStore().get().textPreviewMaxBytes
  const readBytes = Math.min(size, maxBytes)
  let buf: Buffer
  try {
    const handle = await fsp.open(file, 'r')
    try {
      buf = Buffer.alloc(readBytes)
      await handle.read(buf, 0, readBytes, 0)
    } finally {
      await handle.close()
    }
  } catch {
    return { path: file, kind: 'binary', fields, warnings }
  }

  const knownText = TEXT_EXTS.has(ext)
  let sample: string | null = null

  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) {
    sample = buf.subarray(2).toString('utf16le')
  } else if (knownText || looksLikeUtf8Text(buf)) {
    sample = buf.toString('utf8')
  }

  if (sample === null) {
    return { path: file, kind: 'binary', fields, warnings }
  }
  if (size > readBytes) warnings.push('Preview truncated')
  const subtitle =
    ext === 'srt' ? 'SubRip subtitle' : ext === 'sub' ? 'Subtitle' : undefined
  if (subtitle) {
    const typeIdx = fields.findIndex((f) => f.id === 'file.type')
    if (typeIdx >= 0) {
      fields[typeIdx] = { id: 'file.type', label: 'Type', value: subtitle, group: 'file' }
    }
  }
  return {
    path: file,
    kind: 'text',
    textSample: sample,
    fields,
    warnings,
    ...(subtitle ? { subtitle } : {})
  }
}

function looksLikeUtf8Text(buf: Buffer): boolean {
  if (buf.length === 0) return true
  const probe = buf.subarray(0, Math.min(buf.length, 4096))
  let control = 0
  for (const byte of probe) {
    if (byte === 0) return false
    if (byte < 9 || (byte > 13 && byte < 32)) control++
  }
  return control / probe.length < 0.02
}
