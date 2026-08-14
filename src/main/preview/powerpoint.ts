import crypto from 'node:crypto'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { app } from 'electron'
import JSZip from 'jszip'
import type { PptSlideItem, PptSlidePreview } from '@shared/schemas/preview'
import { mediaUrlFor } from '../media/protocol'
import { protocolAllowlist } from '../security/paths'

const DISPLAY_CAP = 1024 * 1024
const SLIDE_CAP = 80
const IMAGES_PER_SLIDE = 12
const MAX_IMAGE_BYTES = 40 * 1024 * 1024
const RAW_WRITE_MAX = 2 * 1024 * 1024
const PREVIEW_MAX_EDGE = 1600
const RASTER_EXT = new Set([
  'png',
  'jpg',
  'jpeg',
  'jfif',
  'jpe',
  'gif',
  'webp',
  'bmp',
  'tif',
  'tiff',
  'svg',
  'avif',
  'ico'
])
const NS = '(?:[A-Za-z0-9]+:)?'

const DEFAULT_SLIDE_CX = 12_192_000
const DEFAULT_SLIDE_CY = 6_858_000

type Box = { x: number; y: number; w: number; h: number }

type TextPara = { text: string; bold: boolean; sizePt: number | null }

type SlideText = {
  kind: 'text'
  box: Box | null
  ph: string | null
  paras: TextPara[]
}

type SlidePic = { kind: 'pic'; box: Box | null; embed: string }

type SlideItem = SlideText | SlidePic

let cacheRoot: string | null = null

function pptxCacheRoot(): string {
  if (!cacheRoot) {
    cacheRoot = path.join(app.getPath('userData'), 'pptx-preview')
    protocolAllowlist.allowDirPermanently(cacheRoot)
  }
  return cacheRoot
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function decodeXmlEntities(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, n: string) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, '&')
}

function xmlAttr(tag: string, name: string): string | undefined {
  const m = new RegExp(`\\b${name}=(?:"([^"]*)"|'([^']*)')`, 'i').exec(tag)
  return m?.[1] ?? m?.[2]
}

type ZipIndex = Map<string, string>

function normZipName(name: string): string {
  return name.replace(/\\/g, '/').replace(/^\/+/, '').toLowerCase()
}

function indexZip(zip: JSZip): ZipIndex {
  const map: ZipIndex = new Map()
  for (const name of Object.keys(zip.files)) {
    if (zip.files[name]?.dir) continue
    map.set(normZipName(name), name)
  }
  return map
}

function zipEntry(zip: JSZip, index: ZipIndex, name: string): JSZip.JSZipObject | null {
  const actual = index.get(normZipName(name))
  return actual ? zip.file(actual) : null
}

function zipEntryLoose(zip: JSZip, index: ZipIndex, name: string): JSZip.JSZipObject | null {
  const hit = zipEntry(zip, index, name)
  if (hit) return hit
  const base = normZipName(name).split('/').pop()
  if (!base) return null
  for (const [k, actual] of index) {
    if (k === base || k.endsWith(`/${base}`)) return zip.file(actual)
  }
  return null
}

function capHtml(html: string, warnings: string[]): string {
  if (html.length > DISPLAY_CAP) {
    warnings.push('Presentation preview truncated')
    return html.slice(0, DISPLAY_CAP) + '<p><em>…</em></p>'
  }
  return html
}

function slideIndex(name: string): number {
  const m = /slide(\d+)\.xml$/i.exec(name)
  return m ? Number(m[1]) : 0
}

function notesIndex(name: string): number {
  const m = /notesSlide(\d+)\.xml$/i.exec(name)
  return m ? Number(m[1]) : 0
}

/** Extract paragraph text runs from a PPTX slide XML part. */
export function extractPptxSlideParagraphs(xml: string): string[] {
  const paras: string[] = []
  const chunks = xml.split(new RegExp(`</${NS}p>`, 'i'))
  for (const chunk of chunks) {
    const runs: string[] = []
    const re = new RegExp(`<${NS}t(?:\\s[^>]*)?>([^<]*)</${NS}t>`, 'gi')
    let m: RegExpExecArray | null
    while ((m = re.exec(chunk))) {
      const t = decodeXmlEntities(m[1] ?? '')
      if (t.trim().length > 0) runs.push(t)
    }
    if (runs.length > 0) paras.push(runs.join('').replace(/\s+/g, ' ').trim())
  }
  return paras
}

export function parsePptxSlideSize(presentationXml: string): { cx: number; cy: number } {
  const tag = new RegExp(`<${NS}sldSz\\b[^>]*>`, 'i').exec(presentationXml)?.[0]
  const cx = Number(tag ? xmlAttr(tag, 'cx') : NaN)
  const cy = Number(tag ? xmlAttr(tag, 'cy') : NaN)
  return {
    cx: Number.isFinite(cx) && cx > 0 ? cx : DEFAULT_SLIDE_CX,
    cy: Number.isFinite(cy) && cy > 0 ? cy : DEFAULT_SLIDE_CY
  }
}

export function parsePptxRelationships(relsXml: string): Map<string, { type: string; target: string }> {
  const out = new Map<string, { type: string; target: string }>()
  const re = /<Relationship\b[^>]*>/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(relsXml))) {
    const tag = m[0]!
    const id = xmlAttr(tag, 'Id')
    const type = xmlAttr(tag, 'Type') ?? ''
    const mode = xmlAttr(tag, 'TargetMode')
    if (mode && /external/i.test(mode)) continue
    let target = (xmlAttr(tag, 'Target') ?? '').replace(/\\/g, '/')
    try {
      target = decodeURIComponent(target)
    } catch {
      /* keep raw */
    }
    if (id && target) out.set(id, { type, target })
  }
  return out
}

export function parseXfrmBox(xml: string): Box | null {
  const block = new RegExp(`<${NS}xfrm\\b[^>]*>([\\s\\S]*?)</${NS}xfrm>`, 'i').exec(xml)?.[1]
  if (!block) return null
  const offTag = new RegExp(`<${NS}off\\b[^>]*>`, 'i').exec(block)?.[0]
  const extTag = new RegExp(`<${NS}ext\\b[^>]*>`, 'i').exec(block)?.[0]
  if (!offTag || !extTag) return null
  const x = Number(xmlAttr(offTag, 'x'))
  const y = Number(xmlAttr(offTag, 'y'))
  const w = Number(xmlAttr(extTag, 'cx'))
  const h = Number(xmlAttr(extTag, 'cy'))
  if (![x, y, w, h].every((n) => Number.isFinite(n))) return null
  return { x, y, w, h }
}

function parsePh(xml: string): { type: string; idx: string } | null {
  const tag = new RegExp(`<${NS}ph\\b[^>]*>`, 'i').exec(xml)?.[0]
  if (!tag) return null
  return { type: (xmlAttr(tag, 'type') ?? 'body').toLowerCase(), idx: xmlAttr(tag, 'idx') ?? '0' }
}

function parseBlipEmbed(xml: string): string | null {
  const tag = new RegExp(`<${NS}blip\\b[^>]*>`, 'i').exec(xml)?.[0]
  if (!tag) return null
  return xmlAttr(tag, 'r:embed') ?? xmlAttr(tag, 'embed') ?? xmlAttr(tag, 'r:link') ?? null
}

export function parseBgBlipEmbed(xml: string): string | null {
  const bg = new RegExp(`<${NS}bg\\b[\\s\\S]*?</${NS}bg>`, 'i').exec(xml)?.[0] ?? ''
  return parseBlipEmbed(bg)
}

function parseTextParas(xml: string): TextPara[] {
  const out: TextPara[] = []
  const chunks = xml.split(/<\/a:p>/i)
  for (const chunk of chunks) {
    const runs: { text: string; bold: boolean; sizePt: number | null }[] = []
    const re = /<a:r\b[^>]*>([\s\S]*?)<\/a:r>/gi
    let m: RegExpExecArray | null
    while ((m = re.exec(chunk))) {
      const run = m[1] ?? ''
      const t = /<a:t(?:\s[^>]*)?>([^<]*)<\/a:t>/i.exec(run)?.[1]
      if (t == null) continue
      const text = decodeXmlEntities(t).replace(/\s+/g, ' ')
      if (!text.trim()) continue
      const rPr = /<a:rPr\b[^>]*>/i.exec(run)?.[0] ?? ''
      const sz = Number(xmlAttr(rPr, 'sz'))
      runs.push({
        text,
        bold: xmlAttr(rPr, 'b') === '1',
        sizePt: Number.isFinite(sz) && sz > 0 ? sz / 100 : null
      })
    }
    if (runs.length === 0) {
      const loose = extractPptxSlideParagraphs(chunk)
      for (const text of loose) out.push({ text, bold: false, sizePt: null })
      continue
    }
    out.push({
      text: runs.map((r) => r.text).join('').trim(),
      bold: runs.some((r) => r.bold),
      sizePt: runs.find((r) => r.sizePt != null)?.sizePt ?? null
    })
  }
  return out.filter((p) => p.text.length > 0)
}

function applyGroup(parent: Box | null, child: Box | null, chOff: Box | null): Box | null {
  if (!child) return parent
  if (!parent || !chOff || chOff.w === 0 || chOff.h === 0) {
    if (!parent) return child
    return { x: parent.x + child.x, y: parent.y + child.y, w: child.w, h: child.h }
  }
  return {
    x: parent.x + ((child.x - chOff.x) * parent.w) / chOff.w,
    y: parent.y + ((child.y - chOff.y) * parent.h) / chOff.h,
    w: (child.w * parent.w) / chOff.w,
    h: (child.h * parent.h) / chOff.h
  }
}

function parseGroupChBox(grpXml: string): { off: Box | null; ch: Box | null } {
  const xfrm = /<p:grpSpPr\b[^>]*>([\s\S]*?)<\/p:grpSpPr>/i.exec(grpXml)?.[1] ?? grpXml
  const off = parseXfrmBox(xfrm)
  const chOffTag = /<a:chOff\b[^>]*>/i.exec(xfrm)?.[0]
  const chExtTag = /<a:chExt\b[^>]*>/i.exec(xfrm)?.[0]
  if (!chOffTag || !chExtTag) return { off, ch: off }
  const x = Number(xmlAttr(chOffTag, 'x'))
  const y = Number(xmlAttr(chOffTag, 'y'))
  const w = Number(xmlAttr(chExtTag, 'cx'))
  const h = Number(xmlAttr(chExtTag, 'cy'))
  if (![x, y, w, h].every((n) => Number.isFinite(n))) return { off, ch: off }
  return { off, ch: { x, y, w, h } }
}

function collectItems(xml: string, parent: Box | null, chOff: Box | null, out: SlideItem[]): void {
  const re = new RegExp(`<(${NS}(?:sp|pic|grpSp|graphicFrame))\\b`, 'gi')
  let m: RegExpExecArray | null
  while ((m = re.exec(xml))) {
    const qname = m[1]!
    const local = qname.includes(':') ? qname.slice(qname.indexOf(':') + 1).toLowerCase() : qname.toLowerCase()
    const openAt = m.index
    const close = findClose(xml, openAt, qname)
    if (close < 0) {
      re.lastIndex = openAt + 4
      continue
    }
    const block = xml.slice(openAt, close)
    re.lastIndex = close
    if (local === 'grpsp') {
      const g = parseGroupChBox(block)
      const nextParent = applyGroup(parent, g.off, chOff)
      collectItems(block.replace(new RegExp(`^<${NS}grpSp\\b[^>]*>`, 'i'), ''), nextParent, g.ch, out)
      continue
    }
    const xfrm = parseXfrmBox(block)
    const box = applyGroup(parent, xfrm, chOff) ?? xfrm
    const embed = parseBlipEmbed(block)
    if (local === 'graphicframe') {
      if (embed) out.push({ kind: 'pic', box, embed })
      const paras = parseTextParas(block)
      if (paras.length > 0) out.push({ kind: 'text', box, ph: null, paras })
      continue
    }
    if (local === 'pic' || embed) {
      if (embed) out.push({ kind: 'pic', box, embed })
      if (local === 'pic') continue
    }
    const paras = parseTextParas(block)
    const ph = parsePh(block)
    if (paras.length === 0 && !ph) continue
    out.push({ kind: 'text', box, ph: ph?.type ?? null, paras })
  }
}

function findClose(xml: string, openAt: number, qname: string): number {
  const openRe = new RegExp(`<${qname}\\b`, 'gi')
  const closeRe = new RegExp(`</${qname}\\s*>`, 'gi')
  openRe.lastIndex = openAt + 1
  closeRe.lastIndex = openAt + 1
  let depth = 1
  while (depth > 0) {
    const nextOpen = openRe.exec(xml)
    const nextClose = closeRe.exec(xml)
    if (!nextClose) return -1
    if (nextOpen && nextOpen.index < nextClose.index) {
      depth += 1
      closeRe.lastIndex = openRe.lastIndex
    } else {
      depth -= 1
      if (depth === 0) return nextClose.index + nextClose[0]!.length
      openRe.lastIndex = closeRe.lastIndex
    }
  }
  return -1
}

export function parsePptxSlideItems(slideXml: string): SlideItem[] {
  const tree =
    new RegExp(`<${NS}spTree\\b[^>]*>([\\s\\S]*?)</${NS}spTree>`, 'i').exec(slideXml)?.[1] ?? slideXml
  const out: SlideItem[] = []
  collectItems(tree, null, null, out)
  return out
}

export function parseLayoutPlaceholderBoxes(layoutXml: string): Map<string, Box> {
  const map = new Map<string, Box>()
  for (const item of parsePptxSlideItems(layoutXml)) {
    if (item.kind !== 'text' || !item.ph || !item.box) continue
    map.set(item.ph, item.box)
  }
  return map
}

function allBlipEmbeds(xml: string): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  const re = new RegExp(`<${NS}blip\\b[^>]*>`, 'gi')
  let m: RegExpExecArray | null
  while ((m = re.exec(xml))) {
    const id = xmlAttr(m[0]!, 'r:embed') ?? xmlAttr(m[0]!, 'embed') ?? xmlAttr(m[0]!, 'r:link')
    if (!id || seen.has(id)) continue
    seen.add(id)
    out.push(id)
  }
  return out
}

function parseContentTypeImageExts(xml: string): Set<string> {
  const out = new Set<string>()
  const re = /<Default\b[^>]*>/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(xml))) {
    const tag = m[0]!
    const ext = (xmlAttr(tag, 'Extension') ?? '').toLowerCase()
    const ct = xmlAttr(tag, 'ContentType') ?? ''
    if (ext && /image\//i.test(ct)) out.add(ext)
  }
  return out
}

function isImageRel(
  rel: { type: string; target: string },
  imageExts: Set<string>
): boolean {
  if (/image/i.test(rel.type)) return true
  const ext = path.extname(rel.target).slice(1).toLowerCase()
  return RASTER_EXT.has(ext) || imageExts.has(ext)
}

function resolveZipTarget(fromPart: string, target: string): string {
  if (target.startsWith('/')) return target.replace(/^\/+/, '')
  const dir = fromPart.replace(/\/[^/]+$/, '')
  const parts = (dir ? `${dir}/${target}` : target).split('/')
  const out: string[] = []
  for (const p of parts) {
    if (p === '' || p === '.') continue
    if (p === '..') out.pop()
    else out.push(p)
  }
  return out.join('/')
}

function pct(n: number, total: number): number {
  if (total <= 0) return 0
  return Math.max(0, Math.min(100, (n / total) * 100))
}

function toPctBox(box: Box, cx: number, cy: number): { l: number; t: number; w: number; h: number } {
  return {
    l: pct(box.x, cx),
    t: pct(box.y, cy),
    w: Math.max(2, pct(box.w, cx)),
    h: Math.max(2, pct(box.h, cy))
  }
}

function isPlaceholderPrompt(s: string): boolean {
  return /^click to /i.test(s) || /^edit master/i.test(s)
}

function parseSolidBg(xml: string): string | null {
  const m = new RegExp(
    `<${NS}bg\\b[\\s\\S]*?<${NS}srgbClr\\b[^>]*\\bval="([0-9A-Fa-f]{6})"`,
    'i'
  ).exec(xml)
  return m ? `#${m[1]}` : null
}

function textToHtml(text: string): string {
  return text
    .split(/\r?\n\r?\n/)
    .map((p) => `<p>${escapeHtml(p).replace(/\r?\n/g, '<br/>')}</p>`)
    .join('')
}

/**
 * Best-effort text scrape from legacy binary `.ppt` (OLE).
 * Not a layout renderer — pulls readable UTF-16LE / ASCII runs.
 */
export function extractPptBinaryTexts(buf: Buffer): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  const MAX = 8 * 1024 * 1024
  const data = buf.length > MAX ? buf.subarray(0, MAX) : buf

  for (let i = 0; i + 3 < data.length; i += 2) {
    let j = i
    const chars: string[] = []
    while (j + 1 < data.length) {
      const code = data[j]! | (data[j + 1]! << 8)
      if (code === 0) break
      const ok =
        code === 0x09 ||
        code === 0x0a ||
        code === 0x0d ||
        (code >= 0x20 && code <= 0xd7ff) ||
        (code >= 0xe000 && code <= 0xfffd)
      if (!ok) break
      chars.push(String.fromCharCode(code))
      j += 2
      if (chars.length > 400) break
    }
    if (chars.length >= 4) {
      const s = chars.join('').replace(/\s+/g, ' ').trim()
      if (s.length >= 4 && !seen.has(s) && !looksLikeBinaryJunk(s)) {
        seen.add(s)
        out.push(s)
        if (out.length >= 80) break
      }
      i = j
    }
  }

  return out
}

function looksLikeBinaryJunk(s: string): boolean {
  if (/^[\d\s.]+$/.test(s)) return true
  if (/^[A-Z]{1,3}\d+$/.test(s)) return true
  const letters = (s.match(/\p{L}/gu) ?? []).length
  return letters < Math.min(4, Math.floor(s.length * 0.4))
}

async function readZipString(zip: JSZip, index: ZipIndex, name: string): Promise<string | null> {
  const f = zipEntry(zip, index, name)
  if (!f) return null
  return f.async('string')
}

async function extractSlideImage(
  zip: JSZip,
  index: ZipIndex,
  zipPath: string,
  destDir: string,
  used: Map<string, string>
): Promise<string | null> {
  const key = normZipName(zipPath)
  const hit = used.get(key)
  if (hit) return hit
  const entry = zipEntryLoose(zip, index, zipPath)
  if (!entry) return null
  const actual = entry.name
  const ext = path.extname(actual).slice(1).toLowerCase()
  if (!RASTER_EXT.has(ext)) return null
  const bytes = await entry.async('nodebuffer')
  if (bytes.length === 0 || bytes.length > MAX_IMAGE_BYTES) return null

  let destName = `${used.size + 1}.${ext === 'jpeg' || ext === 'jfif' || ext === 'jpe' ? 'jpg' : ext}`
  let destBytes: Buffer = bytes
  const needsResize = bytes.length > RAW_WRITE_MAX || ext === 'tif' || ext === 'tiff' || ext === 'bmp'
  if (needsResize && ext !== 'svg') {
    try {
      const { default: sharp } = await import('sharp')
      destBytes = await sharp(bytes, { failOn: 'truncated', limitInputPixels: 512 * 1024 * 1024 })
        .rotate()
        .resize(PREVIEW_MAX_EDGE, PREVIEW_MAX_EDGE, { fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 82 })
        .toBuffer()
      destName = `${used.size + 1}.jpg`
    } catch {
      if (bytes.length > RAW_WRITE_MAX * 4) return null
      destBytes = bytes
    }
  }

  const dest = path.join(destDir, destName)
  await fsp.writeFile(dest, destBytes)
  const url = mediaUrlFor(dest)
  used.set(key, url)
  used.set(normZipName(actual), url)
  return url
}

async function resolveEmbedUrl(
  zip: JSZip,
  index: ZipIndex,
  rels: Map<string, { type: string; target: string }>,
  relPart: string,
  embed: string,
  destDir: string,
  imageUrls: Map<string, string>,
  imageExts: Set<string>
): Promise<string | null> {
  const rel = rels.get(embed)
  if (!rel || !isImageRel(rel, imageExts)) return null
  const zipPath = resolveZipTarget(relPart, rel.target)
  return extractSlideImage(zip, index, zipPath, destDir, imageUrls)
}

async function loadRels(
  zip: JSZip,
  index: ZipIndex,
  partPath: string
): Promise<{ rels: Map<string, { type: string; target: string }>; relPart: string }> {
  const relPart = partPath.replace(/([^/]+)$/, '_rels/$1.rels')
  const xml = (await readZipString(zip, index, relPart)) ?? ''
  return { rels: parsePptxRelationships(xml), relPart }
}

async function urlsFromRels(
  zip: JSZip,
  index: ZipIndex,
  pack: { rels: Map<string, { type: string; target: string }>; relPart: string },
  destDir: string,
  imageUrls: Map<string, string>,
  imageExts: Set<string>
): Promise<string[]> {
  const urls: string[] = []
  for (const rel of pack.rels.values()) {
    if (!isImageRel(rel, imageExts)) continue
    const zipPath = resolveZipTarget(pack.relPart, rel.target)
    const url = await extractSlideImage(zip, index, zipPath, destDir, imageUrls)
    if (url) urls.push(url)
  }
  return urls
}

function firstRelTarget(
  rels: Map<string, { type: string; target: string }>,
  kind: RegExp
): string | null {
  for (const rel of rels.values()) {
    if (kind.test(rel.type)) return rel.target
  }
  return null
}

/** `.pptx` → structured slides (images + text + master/layout backgrounds). */
export async function pptxToPreviewSlides(
  file: string,
  warnings: string[]
): Promise<PptSlidePreview[]> {
  const st = await fsp.stat(file)
  const buf = await fsp.readFile(file)
  const zip = await JSZip.loadAsync(buf)
  const index = indexZip(zip)
  const slideNames = [...index.entries()]
    .filter(([k]) => /^ppt\/slides\/slide\d+\.xml$/.test(k))
    .map(([, actual]) => actual)
    .sort((a, b) => slideIndex(a) - slideIndex(b))

  if (slideNames.length === 0) {
    warnings.push('No slides found in presentation')
    return []
  }

  const contentXml = (await readZipString(zip, index, '[Content_Types].xml')) ?? ''
  const imageExts = parseContentTypeImageExts(contentXml)
  const presXml = (await readZipString(zip, index, 'ppt/presentation.xml')) ?? ''
  const { cx, cy } = parsePptxSlideSize(presXml)
  const aspect = cy > 0 ? cx / cy : 16 / 9

  const key = crypto
    .createHash('sha1')
    .update(`${file.toLowerCase()}|${st.mtimeMs}|${st.size}`)
    .digest('hex')
    .slice(0, 16)
  const destDir = path.join(pptxCacheRoot(), key)
  await fsp.mkdir(destDir, { recursive: true })

  const notesBySlide = new Map<number, string[]>()
  for (const [k, name] of index) {
    if (!/^ppt\/notesslides\/notesslide\d+\.xml$/.test(k)) continue
    const xml = await readZipString(zip, index, name)
    if (!xml) continue
    const paras = extractPptxSlideParagraphs(xml).filter(
      (p) => !/^slide \d+$/i.test(p) && p.length > 1 && !isPlaceholderPrompt(p)
    )
    if (paras.length > 0) notesBySlide.set(notesIndex(name), paras.slice(-6))
  }

  const layoutBoxCache = new Map<string, Map<string, Box>>()
  const partCache = new Map<string, string>()
  const imageUrls = new Map<string, string>()
  const claimedMedia = new Set<string>()
  const slides: PptSlidePreview[] = []
  const shown = Math.min(slideNames.length, SLIDE_CAP)

  const readPart = async (p: string): Promise<string> => {
    const hit = partCache.get(p)
    if (hit != null) return hit
    const xml = (await readZipString(zip, index, p)) ?? ''
    partCache.set(p, xml)
    return xml
  }

  const claimUrl = (url: string): void => {
    for (const [k, v] of imageUrls) {
      if (v === url) claimedMedia.add(k)
    }
  }

  for (let i = 0; i < shown; i++) {
    const slideName = slideNames[i]!
    const xml = await readPart(slideName)
    if (!xml) continue
    const slideRels = await loadRels(zip, index, slideName)

    let layoutPath: string | null = null
    const layoutTarget = firstRelTarget(slideRels.rels, /slideLayout/i)
    if (layoutTarget) layoutPath = resolveZipTarget(slideRels.relPart, layoutTarget)

    let masterPath: string | null = null
    let layoutRels = {
      rels: new Map<string, { type: string; target: string }>(),
      relPart: ''
    }
    let layoutXml = ''
    if (layoutPath) {
      layoutXml = await readPart(layoutPath)
      layoutRels = await loadRels(zip, index, layoutPath)
      const masterTarget = firstRelTarget(layoutRels.rels, /slideMaster/i)
      if (masterTarget) masterPath = resolveZipTarget(layoutRels.relPart, masterTarget)
    }

    let masterXml = ''
    let masterRels = {
      rels: new Map<string, { type: string; target: string }>(),
      relPart: ''
    }
    if (masterPath) {
      masterXml = await readPart(masterPath)
      masterRels = await loadRels(zip, index, masterPath)
    }

    let layoutBoxes = layoutPath ? layoutBoxCache.get(layoutPath) : undefined
    if (layoutPath && !layoutBoxes) {
      layoutBoxes = layoutXml ? parseLayoutPlaceholderBoxes(layoutXml) : new Map()
      layoutBoxCache.set(layoutPath, layoutBoxes)
    }
    layoutBoxes = layoutBoxes ?? new Map()

    const slideItems = parsePptxSlideItems(xml)
    const layoutItems = parsePptxSlideItems(layoutXml)
    const masterItems = parsePptxSlideItems(masterXml)
    const layoutPics = layoutItems.filter((it) => it.kind === 'pic')
    const masterPics = masterItems.filter((it) => it.kind === 'pic')

    const resolveFrom = async (
      embed: string,
      pack: { rels: Map<string, { type: string; target: string }>; relPart: string }
    ): Promise<string | null> => {
      const a = await resolveEmbedUrl(
        zip, index, pack.rels, pack.relPart, embed, destDir, imageUrls, imageExts
      )
      if (a) return a
      const b = await resolveEmbedUrl(
        zip, index, slideRels.rels, slideRels.relPart, embed, destDir, imageUrls, imageExts
      )
      if (b) return b
      if (layoutRels.relPart) {
        const c = await resolveEmbedUrl(
          zip, index, layoutRels.rels, layoutRels.relPart, embed, destDir, imageUrls, imageExts
        )
        if (c) return c
      }
      if (masterRels.relPart) {
        return resolveEmbedUrl(
          zip, index, masterRels.rels, masterRels.relPart, embed, destDir, imageUrls, imageExts
        )
      }
      return null
    }

    const bgEmbed =
      parseBgBlipEmbed(xml) ?? parseBgBlipEmbed(layoutXml) ?? parseBgBlipEmbed(masterXml)
    let bgImageUrl: string | undefined
    if (bgEmbed) {
      bgImageUrl =
        (await resolveFrom(bgEmbed, slideRels)) ??
        (layoutRels.relPart ? await resolveFrom(bgEmbed, layoutRels) : null) ??
        (masterRels.relPart ? await resolveFrom(bgEmbed, masterRels) : null) ??
        undefined
    }
    const items: PptSlideItem[] = []
    let pics = 0
    const addPic = async (
      item: SlidePic,
      pack: { rels: Map<string, { type: string; target: string }>; relPart: string }
    ): Promise<void> => {
      if (pics >= IMAGES_PER_SLIDE) return
      const url = await resolveFrom(item.embed, pack)
      if (!url) return
      pics += 1
      if (!item.box) {
        if (!bgImageUrl) bgImageUrl = url
        return
      }
      items.push({ kind: 'pic', box: toPctBox(item.box, cx, cy), url })
    }

    for (const it of masterPics) {
      if (it.kind === 'pic') await addPic(it, masterRels)
    }
    for (const it of layoutPics) {
      if (it.kind === 'pic') await addPic(it, layoutRels)
    }
    for (const it of slideItems) {
      if (it.kind === 'pic') await addPic(it, slideRels)
    }

    const filledPh = new Set(
      slideItems.filter((it) => it.kind === 'text' && it.ph).map((it) => (it.kind === 'text' ? it.ph : null))
    )
    const addStaticText = (src: SlideItem[]): void => {
      for (const it of src) {
        if (it.kind !== 'text' || !it.box) continue
        if (it.ph && filledPh.has(it.ph)) continue
        const lines = it.paras.map((p) => p.text).filter((t) => !isPlaceholderPrompt(t))
        if (lines.length === 0) continue
        items.push({
          kind: 'text',
          box: toPctBox(it.box, cx, cy),
          title: it.ph === 'title' || it.ph === 'ctrtitle',
          lines
        })
      }
    }
    addStaticText(masterItems)
    addStaticText(layoutItems)

    const fallbackLines: string[] = []
    for (const it of slideItems) {
      if (it.kind !== 'text') continue
      const lines = it.paras.map((p) => p.text).filter((t) => !isPlaceholderPrompt(t))
      if (lines.length === 0) continue
      const box = it.box ?? (it.ph ? layoutBoxes.get(it.ph) ?? null : null)
      if (!box) {
        fallbackLines.push(...lines)
        continue
      }
      items.push({
        kind: 'text',
        box: toPctBox(box, cx, cy),
        title: it.ph === 'title' || it.ph === 'ctrtitle',
        lines
      })
    }

    if (fallbackLines.length === 0 && items.every((it) => it.kind !== 'text')) {
      fallbackLines.push(
        ...extractPptxSlideParagraphs(xml).filter((t) => !isPlaceholderPrompt(t))
      )
    }

    if (!bgImageUrl) {
      for (const embed of allBlipEmbeds(`${xml}\n${layoutXml}\n${masterXml}`)) {
        const url = await resolveFrom(embed, slideRels)
        if (url) {
          bgImageUrl = url
          break
        }
      }
    }

    const slideImageUrls = await urlsFromRels(zip, index, slideRels, destDir, imageUrls, imageExts)
    const usedUrls = new Set(
      items.filter((it) => it.kind === 'pic').map((it) => (it.kind === 'pic' ? it.url : ''))
    )
    if (bgImageUrl) usedUrls.add(bgImageUrl)
    const hasPositionedPic = items.some((it) => it.kind === 'pic')
    for (const url of slideImageUrls) {
      if (usedUrls.has(url)) continue
      if (!bgImageUrl) {
        bgImageUrl = url
        usedUrls.add(url)
        continue
      }
      if (hasPositionedPic || pics >= IMAGES_PER_SLIDE) {
        claimUrl(url)
        continue
      }
      pics += 1
      items.push({ kind: 'pic', box: { l: 0, t: 0, w: 100, h: 100 }, url })
      usedUrls.add(url)
    }

    if (bgImageUrl) claimUrl(bgImageUrl)
    for (const it of items) {
      if (it.kind === 'pic') claimUrl(it.url)
    }

    const n = slideIndex(slideName) || i + 1
    slides.push({
      index: i + 1,
      aspect,
      bg: parseSolidBg(xml) ?? parseSolidBg(layoutXml) ?? parseSolidBg(masterXml) ?? undefined,
      bgImageUrl,
      items,
      fallbackLines,
      notes: notesBySlide.get(n) ?? []
    })
  }

  const unusedMedia = [...index.entries()]
    .filter(([k]) => k.startsWith('ppt/media/') && RASTER_EXT.has(path.extname(k).slice(1)))
    .filter(([k]) => !claimedMedia.has(k))
    .sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }))

  for (const slide of slides) {
    const hasPic = Boolean(slide.bgImageUrl) || slide.items.some((it) => it.kind === 'pic')
    if (hasPic) continue
    const next = unusedMedia.shift()
    if (!next) break
    const url = await extractSlideImage(zip, index, next[1], destDir, imageUrls)
    if (url) slide.bgImageUrl = url
  }

  if (slideNames.length > SLIDE_CAP) {
    warnings.push(`Showing first ${SLIDE_CAP} of ${slideNames.length} slides`)
  }
  const skippedMedia = [...index.keys()].filter((k) => {
    if (!k.startsWith('ppt/media/')) return false
    const ext = path.extname(k).slice(1)
    return ext.length > 0 && !RASTER_EXT.has(ext)
  }).length
  const anyPic = slides.some((s) => s.bgImageUrl || s.items.some((it) => it.kind === 'pic'))
  if (skippedMedia > 0 && !anyPic) {
    warnings.push(
      `Could not preview ${skippedMedia} package image(s) (WMF/EMF or unsupported format)`
    )
  }
  warnings.push('Approximate slide layout — not a full PowerPoint render')
  return slides
}

/** `.pptx` → HTML with approximate slide layout + embedded images. */
export async function pptxToHtml(file: string, warnings: string[]): Promise<string> {
  const slides = await pptxToPreviewSlides(file, warnings)
  if (slides.length === 0) return '<p><em>(empty presentation)</em></p>'
  const parts = slides.map((s) => {
    const bits: string[] = []
    if (s.bgImageUrl) bits.push(`<img class="ppt-bg" src="${escapeHtml(s.bgImageUrl)}" alt="" />`)
    for (const it of s.items) {
      const st = `left:${it.box.l}%;top:${it.box.t}%;width:${it.box.w}%;height:${it.box.h}%`
      if (it.kind === 'pic') {
        bits.push(`<div class="ppt-abs ppt-pic" style="${st}"><img src="${escapeHtml(it.url)}" alt="" /></div>`)
      } else {
        bits.push(
          `<div class="ppt-abs ${it.title ? 'ppt-title' : 'ppt-body'}" style="${st}">${it.lines
            .map((t) => `<p>${escapeHtml(t)}</p>`)
            .join('')}</div>`
        )
      }
    }
    if (s.fallbackLines.length > 0 && s.items.every((it) => it.kind !== 'text')) {
      bits.push(`<div class="ppt-fallback">${s.fallbackLines.map((t) => `<p>${escapeHtml(t)}</p>`).join('')}</div>`)
    }
    const notes =
      s.notes.length > 0
        ? `<div class="ppt-notes">${s.notes.map((n) => `<p>${escapeHtml(n)}</p>`).join('')}</div>`
        : ''
    return `<section class="ppt-slide"><div class="ppt-slide-label">Slide ${s.index}</div><div class="ppt-stage" style="aspect-ratio:${s.aspect};${s.bg ? `background:${s.bg}` : ''}">${bits.join('')}</div>${notes}</section>`
  })
  return capHtml(`<div class="ppt-deck">${parts.join('\n')}</div>`, warnings)
}

/** Legacy `.ppt` → HTML via best-effort binary text scrape. */
export async function pptToHtml(file: string, warnings: string[]): Promise<string> {
  const buf = await fsp.readFile(file)
  const texts = extractPptBinaryTexts(buf)
  if (texts.length === 0) {
    warnings.push('Could not extract text from legacy .ppt')
    return '<p><em>No text preview for this .ppt file. Use Open with default app for a full view.</em></p>'
  }
  warnings.push('Legacy .ppt preview is text-only and may be incomplete')
  return capHtml(
    `<div class="ppt-deck ppt-legacy">${textToHtml(texts.join('\n\n'))}</div>`,
    warnings
  )
}
