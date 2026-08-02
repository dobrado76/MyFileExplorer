import fsp from 'node:fs/promises'
import path from 'node:path'
import type { PreviewField, PreviewModel } from '@shared/schemas/preview'
import { mediaUrlFor } from '../media/protocol'
import { protocolAllowlist } from '../security/paths'
import { requireAbsolute, statPath } from '../fs/list'
import { settingsStore } from '../settings/store'
import { extractPngTextChunks } from './pngText'
import { parseA1111Parameters } from './a1111'
import { listIndexRoots } from '../search'
import { buildSpreadsheetSheets } from './spreadsheet'
import { docxToHtml, docToHtml } from './office'
import { rtfToHtml } from './rtf'
import { rasterizePsd } from './psd'

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
const RTF_EXTS = new Set(['rtf'])
const PSD_EXTS = new Set(['psd'])

const DISPLAY_CAP = 64 * 1024 // cap long prompt/JSON display text

type CacheEntry = { mtimeMs: number; size: number; model: PreviewModel }
const cache = new Map<string, CacheEntry>()
const CACHE_MAX = 100

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

  const cached = cache.get(file.toLowerCase())
  if (cached && cached.mtimeMs === st.mtimeMs && cached.size === st.size) {
    return cached.model
  }

  const warnings: string[] = []
  const fields: PreviewField[] = []
  const name = path.basename(file)
  const ext = path.extname(file).slice(1).toLowerCase()

  fields.push({ id: 'file.name', label: 'Name', value: name, group: 'file', copyable: true })
  fields.push({ id: 'file.path', label: 'Path', value: file, group: 'file', copyable: true })

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

    if (IMAGE_EXTS.has(ext)) {
      model = await buildImagePreview(file, ext, fields, warnings)
    } else if (AUDIO_EXTS.has(ext)) {
      protocolAllowlist.allowDir(path.dirname(file))
      model = { path: file, kind: 'audio', mediaUrl: mediaUrlFor(file), fields, warnings }
    } else if (VIDEO_EXTS.has(ext)) {
      protocolAllowlist.allowDir(path.dirname(file))
      model = { path: file, kind: 'video', mediaUrl: mediaUrlFor(file), fields, warnings }
    } else if (ext === 'pdf') {
      protocolAllowlist.allowDir(path.dirname(file))
      model = { path: file, kind: 'pdf', mediaUrl: mediaUrlFor(file), fields, warnings }
    } else if (MARKDOWN_EXTS.has(ext)) {
      model = await buildMarkdownPreview(file, st.size, fields, warnings)
    } else if (SPREADSHEET_EXTS.has(ext) && ext !== 'csv') {
      model = await buildOfficeSpreadsheetPreview(file, fields, warnings)
    } else if (WORD_DOCX_EXTS.has(ext)) {
      model = await buildWordPreview(file, 'docx', fields, warnings)
    } else if (WORD_DOC_EXTS.has(ext)) {
      model = await buildWordPreview(file, 'doc', fields, warnings)
    } else if (RTF_EXTS.has(ext)) {
      model = await buildRtfPreview(file, st.size, fields, warnings)
    } else if (PSD_EXTS.has(ext)) {
      model = await buildPsdPreview(file, fields, warnings)
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
  warnings: string[]
): Promise<PreviewModel> {
  protocolAllowlist.allowDir(path.dirname(file))

  try {
    const { default: sharp } = await import('sharp')
    const meta = await sharp(file).metadata()
    if (meta.width && meta.height) {
      fields.push({
        id: 'image.dimensions',
        label: 'Dimensions',
        value: `${meta.width} × ${meta.height}`,
        group: 'image'
      })
    }
    if (meta.depth) {
      fields.push({
        id: 'image.depth',
        label: 'Bit depth',
        value: String(meta.depth),
        group: 'image'
      })
    }
  } catch {
    warnings.push('Could not read image metadata')
  }

  if (ext === 'png') {
    try {
      await addPngGenerationFields(file, fields, warnings)
    } catch {
      warnings.push('Generation metadata parse incomplete')
    }
  }

  return { path: file, kind: 'image', mediaUrl: mediaUrlFor(file), fields, warnings }
}

async function addPngGenerationFields(
  file: string,
  fields: PreviewField[],
  warnings: string[]
): Promise<void> {
  const buf = await fsp.readFile(file)
  const chunks = extractPngTextChunks(buf)
  if (chunks.length === 0) return

  const byKeyword = new Map<string, string>()
  for (const c of chunks) {
    if (!byKeyword.has(c.keyword)) byKeyword.set(c.keyword, c.text)
  }

  // A1111 / Forge
  const parametersText = byKeyword.get('parameters') ?? byKeyword.get('Comment')
  if (parametersText) {
    const parsed = parseA1111Parameters(parametersText)
    if (parsed) {
      if (parsed.prompt) {
        fields.push({
          id: 'gen.prompt',
          label: 'Prompt',
          value: capText(parsed.prompt, warnings, 'Prompt'),
          group: 'generation',
          mono: true,
          copyable: true
        })
      }
      if (parsed.negative) {
        fields.push({
          id: 'gen.negative',
          label: 'Negative prompt',
          value: capText(parsed.negative, warnings, 'Negative prompt'),
          group: 'generation',
          mono: true,
          copyable: true
        })
      }
      const s = parsed.settings
      const pick = (key: string, id: string, label: string): void => {
        const v = s[key]
        if (v) fields.push({ id, label, value: v, group: 'generation', copyable: true })
      }
      pick('Steps', 'gen.steps', 'Steps')
      pick('Sampler', 'gen.sampler', 'Sampler')
      pick('CFG scale', 'gen.cfg', 'CFG scale')
      pick('Seed', 'gen.seed', 'Seed')
      pick('Size', 'gen.size', 'Size')
      pick('Model', 'gen.model', 'Model')
      pick('Model hash', 'gen.modelHash', 'Model hash')
      fields.push({
        id: 'gen.rawParameters',
        label: 'Raw parameters',
        value: capText(parsed.raw, warnings, 'Raw parameters'),
        group: 'generation',
        mono: true,
        copyable: true
      })
    } else {
      // chunk exists but not structured — keep raw text (spec)
      fields.push({
        id: 'gen.rawParameters',
        label: 'Raw parameters',
        value: capText(parametersText, warnings, 'Raw parameters'),
        group: 'generation',
        mono: true,
        copyable: true
      })
    }
  }

  // ComfyUI
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
      value: capText(pretty, warnings, label),
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
        group: 'image'
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
