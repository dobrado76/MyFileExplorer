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
import { pptxToHtml, pptToHtml } from './powerpoint'
import { rtfToHtml } from './rtf'
import { rasterizePsd } from './psd'
import { buildSafetensorsPreviewFields } from './safetensors'
import { lnkDetailsToFields, readLnkDetails } from './lnk'
import { loadZipArchiveTree } from './zipArchive'
import { readPeVersionInfo } from './peVersion'
import { getShellIconUrl } from '../icons/shell'
import {
  CHROMIUM_WEAK_VIDEO_EXTS,
  resolveVideoPosterUrl,
  STRIP_ONLY_VIDEO_EXTS
} from './videoPoster'
import { cachedPlayableVideoUrl, ensurePlayableVideoUrl } from './videoRemux'
import { resolveVidThumbFrames } from '../thumbs/vidCache'

const EXE_PREVIEW_EXTS = new Set(['exe', 'dll', 'scr', 'ocx', 'cpl', 'sys', 'msi'])

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
  'svg',
  'ico'
])
const AUDIO_EXTS = new Set(['mp3', 'wav', 'flac', 'ogg', 'm4a', 'aac', 'wma', 'opus'])
const VIDEO_EXTS = new Set(['mp4', 'mkv', 'webm', 'avi', 'mov', 'wmv', 'm4v', 'mpg', 'mpeg'])
const TEXT_EXTS = new Set([
  'txt',
  'json',
  'yaml',
  'yml',
  'csv',
  'tsv',
  'log',
  'ini',
  'cfg',
  'conf',
  'toml',
  'xml',
  'html',
  'htm',
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
  'bat',
  'cmd',
  'sql',
  'gitignore',
  'env',
  'editorconfig',
  'prettierrc',
  'lua',
  'vue',
  'svelte'
])
const MARKDOWN_EXTS = new Set(['md', 'markdown'])
const SPREADSHEET_EXTS = new Set(['xls', 'xlsx', 'xlsm', 'xlsb', 'ods', 'csv'])
const WORD_DOCX_EXTS = new Set(['docx'])
const WORD_DOC_EXTS = new Set(['doc'])
const PPTX_EXTS = new Set(['pptx'])
const PPT_EXTS = new Set(['ppt'])
const RTF_EXTS = new Set(['rtf'])
const PSD_EXTS = new Set(['psd'])
const SAFETENSORS_EXTS = new Set(['safetensors'])

const DISPLAY_CAP = 64 * 1024 // cap long prompt/JSON display text

type CacheEntry = { mtimeMs: number; size: number; model: PreviewModel }
const cache = new Map<string, CacheEntry>()
const CACHE_MAX = 100
/** Bump when preview builders change shape/parsing so stale models are dropped. */
const PREVIEW_CACHE_REV = 2

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

function capText(s: string, warnings: string[], label: string): string {
  if (s.length > DISPLAY_CAP) {
    warnings.push(`${label} truncated for display`)
    return s.slice(0, DISPLAY_CAP)
  }
  return s
}

export async function getPreview(rawPath: string): Promise<PreviewModel> {
  const file = requireAbsolute(rawPath)
  const st = await statPath(file)

  if (!st.exists) {
    return { path: file, kind: 'missing', fields: [] }
  }

  const cacheKey = `${PREVIEW_CACHE_REV}|${file.toLowerCase()}`
  const cached = cache.get(cacheKey)
  if (cached && cached.mtimeMs === st.mtimeMs && cached.size === st.size) {
    return cached.model
  }

  const warnings: string[] = []
  const fields: PreviewField[] = []
  const name = path.basename(file)
  const ext = path.extname(file).slice(1).toLowerCase()

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
      model = await buildImagePreview(file, ext, fields, warnings, mediaCacheKey)
    } else if (AUDIO_EXTS.has(ext)) {
      protocolAllowlist.allowDir(path.dirname(file))
      model = {
        path: file,
        kind: 'audio',
        mediaUrl: mediaUrlFor(file, mediaCacheKey),
        fields,
        warnings
      }
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
    } else if (ext === 'zip') {
      model = await buildZipArchivePreview(file, st.size, fields, warnings)
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

  cache.set(file.toLowerCase(), { mtimeMs: st.mtimeMs, size: st.size, model })
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
  mediaCacheKey: string
): Promise<PreviewModel> {
  protocolAllowlist.allowDir(path.dirname(file))

  let bytes: Buffer | null = null
  let exifBuf: Buffer | null = null
  try {
    bytes = await fsp.readFile(file)
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
    mediaUrl: mediaUrlFor(file, mediaCacheKey),
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

async function buildMarkdownPreview(
  file: string,
  size: number,
  fields: PreviewField[],
  warnings: string[]
): Promise<PreviewModel> {
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
    return {
      path: file,
      kind: 'markdown',
      textSample: capText(sample, warnings, 'Markdown'),
      fields,
      warnings
    }
  } catch {
    return { path: file, kind: 'binary', fields, warnings }
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
    const htmlBody = format === 'pptx' ? await pptxToHtml(file, warnings) : await pptToHtml(file, warnings)
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

  // AVI: no in-pane player — animated !VIDTHUMB_CACHE strip + Open (D33).
  if (STRIP_ONLY_VIDEO_EXTS.has(ext)) {
    const stripFrames = await resolveVidThumbFrames(file)
    return {
      path: file,
      kind: 'video',
      stripFrames: stripFrames.length > 0 ? stripFrames : undefined,
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
    fields,
    warnings: warnings.length ? warnings : undefined
  }
}

/** Remux/transcode weak-container video to MP4 for `<video>` playback (userData cache). */
export async function ensurePlayablePreview(
  rawPath: string,
  opts?: { force?: boolean }
): Promise<{ mediaUrl: string | null }> {
  const file = requireAbsolute(rawPath)
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
        : ext === 'msi'
          ? 'Windows Installer package'
          : 'Application'
    fields[typeIdx] = {
      id: 'file.type',
      label: 'Type',
      value: typeLabel,
      group: 'file'
    }
  }

  const ver = readPeVersionInfo(file)
  if (ver) {
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
  } else if (process.platform === 'win32') {
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
    ver?.fileDescription?.trim() ||
    ver?.productName?.trim() ||
    (ext === 'dll' ? 'Dynamic-link library' : 'Application')

  return {
    path: file,
    kind: 'executable',
    subtitle,
    mediaUrl,
    fields,
    warnings: warnings.length ? warnings : undefined
  }
}

async function buildZipArchivePreview(
  file: string,
  _size: number,
  fields: PreviewField[],
  warnings: string[]
): Promise<PreviewModel> {
  const typeIdx = fields.findIndex((f) => f.id === 'file.type')
  if (typeIdx >= 0) {
    fields[typeIdx] = {
      id: 'file.type',
      label: 'Type',
      value: 'Compressed (zipped) folder',
      group: 'file'
    }
  }

  try {
    const listed = await loadZipArchiveTree(file)
    if (listed.truncated) {
      warnings.push('Contents list truncated for preview')
    }
    fields.push({
      id: 'archive.files',
      label: 'Files',
      value: String(listed.fileCount) + (listed.truncated ? '+' : ''),
      group: 'file'
    })
    fields.push({
      id: 'archive.folders',
      label: 'Folders',
      value: String(listed.folderCount) + (listed.truncated ? '+' : ''),
      group: 'file'
    })
    const subtitle =
      listed.fileCount + listed.folderCount === 0
        ? 'Empty ZIP'
        : `${listed.fileCount} file${listed.fileCount === 1 ? '' : 's'} · ${listed.folderCount} folder${listed.folderCount === 1 ? '' : 's'}${listed.truncated ? '…' : ''}`
    return {
      path: file,
      kind: 'archive',
      subtitle,
      archiveTree: listed.tree,
      fields,
      warnings: warnings.length ? warnings : undefined
    }
  } catch (e) {
    warnings.push(e instanceof Error ? e.message : 'Could not read ZIP contents')
    return {
      path: file,
      kind: 'archive',
      subtitle: 'ZIP archive',
      archiveTree: [],
      fields,
      warnings
    }
  }
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
  return {
    path: file,
    kind: 'text',
    textSample: capText(sample, warnings, 'Text'),
    fields,
    warnings
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
