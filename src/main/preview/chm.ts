/**
 * Compiled HTML Help (.chm) preview: decompile via Windows hh.exe into
 * userData, parse the .hhc contents tree, serve topics over mfe-media://chm/.
 */
import { app } from 'electron'
import { spawn } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import type { ArchiveTreeNode } from '@shared/schemas/preview'
import { chmMediaUrlFor, registerChmExtractRoot } from '../media/protocol'
import { isSameOrUnder, normalizeAbsolute, protocolAllowlist } from '../security/paths'

/** Cap TOC nodes so the preview pane stays responsive. */
export const MAX_CHM_TOC_NODES = 4000

/** Skip decompile for huge help files (bytes). */
const MAX_CHM_BYTES = 256 * 1024 * 1024

const READY_MARKER = '.mfe-chm-ready'
/** Bump when extract/layout rules change (invalidates userData cache). */
const EXTRACT_VER = '2'

type MutableToc = {
  name: string
  /** Topic path inside the CHM (`/` separators), when present. */
  local?: string
  children: MutableToc[]
}

export type ChmExtract = {
  hash: string
  rootDir: string
  cacheKey: string
}

const inflight = new Map<string, Promise<ChmExtract>>()

function chmPreviewRoot(): string {
  const dir = path.join(app.getPath('userData'), 'chm-preview')
  protocolAllowlist.allowDirPermanently(dir)
  return dir
}

function extractHash(chmPath: string, mtimeMs: number, size: number): string {
  return crypto
    .createHash('sha1')
    .update(`${chmPath.toLowerCase()}|${mtimeMs}|${size}|${EXTRACT_VER}`)
    .digest('hex')
}

/**
 * Resolve Windows HTML Help. On modern Windows the binary is usually
 * `%SystemRoot%\hh.exe` — not `System32\hh.exe` (often missing).
 */
export function resolveHhExePath(
  existsSync: (p: string) => boolean = fs.existsSync
): string | null {
  const root = process.env.SystemRoot || process.env.windir || 'C:\\Windows'
  const candidates = [
    path.join(root, 'hh.exe'),
    path.join(root, 'SysWOW64', 'hh.exe'),
    path.join(root, 'System32', 'hh.exe'),
    'C:\\Windows\\hh.exe',
    'C:\\Windows\\SysWOW64\\hh.exe'
  ]
  const seen = new Set<string>()
  for (const c of candidates) {
    const key = c.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    try {
      if (existsSync(c)) return c
    } catch {
      /* ignore */
    }
  }
  return null
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await fsp.access(p)
    return true
  } catch {
    return false
  }
}

async function countFiles(dir: string, limit = 8): Promise<number> {
  let n = 0
  async function walk(d: string): Promise<void> {
    if (n >= limit) return
    let entries
    try {
      entries = await fsp.readdir(d, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      if (e.name === READY_MARKER) continue
      if (e.isFile()) {
        n++
        if (n >= limit) return
      } else if (e.isDirectory()) {
        await walk(path.join(d, e.name))
        if (n >= limit) return
      }
    }
  }
  await walk(dir)
  return n
}

async function runHhDecompile(chmPath: string, destDir: string): Promise<void> {
  const hh = resolveHhExePath()
  if (!hh) {
    throw new Error('Windows HTML Help (hh.exe) not found')
  }
  await fsp.mkdir(destDir, { recursive: true })

  await new Promise<void>((resolve, reject) => {
    const child = spawn(hh, ['-decompile', destDir, chmPath], {
      windowsHide: true,
      stdio: 'ignore'
    })
    const timer = setTimeout(() => {
      child.kill()
      reject(new Error('CHM decompile timed out'))
    }, 90_000)
    child.on('error', (err) => {
      clearTimeout(timer)
      reject(err)
    })
    child.on('close', () => {
      clearTimeout(timer)
      // hh.exe exit codes are unreliable — success is verified by output files.
      resolve()
    })
  })

  // hh.exe sometimes returns before the last files land — brief poll.
  const deadline = Date.now() + 8_000
  while (Date.now() < deadline) {
    if ((await countFiles(destDir)) > 0) return
    await new Promise((r) => setTimeout(r, 150))
  }
  if ((await countFiles(destDir)) === 0) {
    throw new Error('CHM decompile produced no files')
  }
}

/**
 * Ensure the CHM is decompiled under userData and registered for mfe-media://chm/.
 */
export async function ensureChmExtracted(
  chmPath: string,
  mtimeMs: number,
  size: number
): Promise<ChmExtract> {
  if (process.platform !== 'win32') {
    throw new Error('CHM preview requires Windows')
  }
  if (size <= 0) throw new Error('Empty CHM file')
  if (size > MAX_CHM_BYTES) {
    throw new Error(`CHM larger than ${Math.round(MAX_CHM_BYTES / (1024 * 1024))} MiB — open externally`)
  }

  const abs = normalizeAbsolute(chmPath)
  if (!abs) throw new Error('Invalid CHM path')

  const hash = extractHash(abs, mtimeMs, size)
  const pending = inflight.get(hash)
  if (pending) return pending

  const job = (async (): Promise<ChmExtract> => {
    const rootDir = path.join(chmPreviewRoot(), hash)
    const marker = path.join(rootDir, READY_MARKER)
    const cacheKey = `${mtimeMs}-${size}-${EXTRACT_VER}`

    if (await pathExists(marker)) {
      registerChmExtractRoot(hash, rootDir)
      return { hash, rootDir, cacheKey }
    }

    await fsp.rm(rootDir, { recursive: true, force: true }).catch(() => undefined)
    await runHhDecompile(abs, rootDir)
    await fsp.writeFile(marker, `${abs}\n${mtimeMs}\n${size}\n`, 'utf8')
    registerChmExtractRoot(hash, rootDir)
    return { hash, rootDir, cacheKey }
  })()

  inflight.set(hash, job)
  try {
    return await job
  } finally {
    inflight.delete(hash)
  }
}

function normalizeTopicPath(raw: string): string | null {
  const n = raw.replace(/\\/g, '/').replace(/^\/+/, '').trim()
  if (!n || n.includes('..')) return null
  // Strip URL fragment for file resolution; keep for display navigation later.
  const noHash = n.split('#')[0] ?? n
  if (!noHash || noHash.includes('..')) return null
  return noHash
}

function paramValue(block: string, name: string): string | undefined {
  const re = new RegExp(
    `<param\\s+name\\s*=\\s*["']${name}["']\\s+value\\s*=\\s*["']([^"']*)["']`,
    'i'
  )
  const m = re.exec(block)
  if (m?.[1] !== undefined) return decodeHtmlEntities(m[1])
  // Some HHC files swap attribute order.
  const re2 = new RegExp(
    `<param\\s+value\\s*=\\s*["']([^"']*)["']\\s+name\\s*=\\s*["']${name}["']`,
    'i'
  )
  const m2 = re2.exec(block)
  if (m2?.[1] !== undefined) return decodeHtmlEntities(m2[1])
  return undefined
}

function decodeHtmlEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&rsquo;/gi, '\u2019')
    .replace(/&lsquo;/gi, '\u2018')
    .replace(/&#(\d+);/g, (_, n: string) => {
      const code = Number.parseInt(n, 10)
      return Number.isFinite(code) ? String.fromCodePoint(code) : _
    })
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => {
      const code = Number.parseInt(h, 16)
      return Number.isFinite(code) ? String.fromCodePoint(code) : _
    })
    .replace(/&nbsp;/g, ' ')
}

/** True when every byte sequence is well-formed UTF-8 (no replacements). */
function isWellFormedUtf8(buf: Buffer): boolean {
  try {
    const dec = new TextDecoder('utf-8', { fatal: true })
    dec.decode(buf)
    return true
  } catch {
    return false
  }
}

/**
 * Windows-1252 bytes 0x80–0x9F → Unicode (WHATWG). Node’s TextDecoder label is
 * unreliable here (0x92 often stays as U+0092 instead of U+2019).
 */
const WIN1252_80_9F =
  '\u20AC\u0081\u201A\u0192\u201E\u2026\u2020\u2021' +
  '\u02C6\u2030\u0160\u2039\u0152\u008D\u017D\u008F' +
  '\u0090\u2018\u2019\u201C\u201D\u2022\u2013\u2014' +
  '\u02DC\u2122\u0161\u203A\u0153\u009D\u017E\u0178'

function decodeWindows1252(buf: Buffer): string {
  let out = ''
  for (let i = 0; i < buf.length; i++) {
    const b = buf[i]!
    if (b >= 0x80 && b <= 0x9f) out += WIN1252_80_9F[b - 0x80]!
    else out += String.fromCharCode(b)
  }
  return out
}

/**
 * Decode CHM sidecar text (.hhc / .hhp / …). HTML Help Workshop files are
 * typically Windows-1252 without a BOM — UTF-8 mis-decode turns `0x92` into U+FFFD.
 */
export function decodeChmTextBuffer(buf: Buffer): string {
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) {
    return buf.toString('utf16le')
  }
  if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) {
    return new TextDecoder('utf-16be').decode(buf)
  }
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) {
    return buf.subarray(3).toString('utf8')
  }
  if (isWellFormedUtf8(buf)) {
    return buf.toString('utf8')
  }
  return decodeWindows1252(buf)
}

/**
 * Parse a Microsoft HTML Help contents (.hhc) sitemap into a nested TOC.
 * Exported for unit tests.
 */
export function parseHhcContents(html: string): MutableToc[] {
  const root: MutableToc[] = []
  const stack: MutableToc[][] = [root]
  // Scan tags loosely — HHC is often not well-formed XML.
  const tokenRe = /<\/?\s*(ul|object)\b[^>]*>|<\/\s*object\s*>/gi
  let objectOpen: { start: number } | null = null
  let m: RegExpExecArray | null
  while ((m = tokenRe.exec(html))) {
    const tag = m[0]
    const name = (m[1] || 'object').toLowerCase()
    if (tag.startsWith('</')) {
      if (name === 'ul') {
        if (stack.length > 1) stack.pop()
      } else if (name === 'object' && objectOpen) {
        const block = html.slice(objectOpen.start, m.index + tag.length)
        objectOpen = null
        if (!/type\s*=\s*["']text\/sitemap["']/i.test(block)) continue
        const topicName = paramValue(block, 'Name')?.trim() || 'Topic'
        const localRaw = paramValue(block, 'Local')
        const local = localRaw ? normalizeTopicPath(localRaw) ?? undefined : undefined
        const node: MutableToc = { name: topicName, local, children: [] }
        stack[stack.length - 1]!.push(node)
      }
      continue
    }
    if (name === 'ul') {
      // Nested <UL> attaches to the previous sitemap entry; the root <UL> stays on root.
      const parentList = stack[stack.length - 1]!
      const parent = parentList[parentList.length - 1]
      if (parent) stack.push(parent.children)
    } else if (name === 'object') {
      objectOpen = { start: m.index }
    }
  }
  return root
}

function freezeToc(nodes: MutableToc[], folderSeq: { n: number }): {
  tree: ArchiveTreeNode[]
  truncated: boolean
  topicCount: number
} {
  const tree: ArchiveTreeNode[] = []
  let truncated = false
  let topicCount = 0
  let nodesUsed = 0

  const walk = (src: MutableToc[], dest: ArchiveTreeNode[]): void => {
    for (const item of src) {
      if (nodesUsed >= MAX_CHM_TOC_NODES) {
        truncated = true
        return
      }
      nodesUsed++
      const hasKids = item.children.length > 0
      const local = item.local
      if (local) topicCount++

      if (hasKids) {
        const folderPath = local ?? `__toc__/${++folderSeq.n}/${item.name}`
        const node: ArchiveTreeNode = {
          name: item.name,
          path: folderPath,
          kind: 'dir',
          children: []
        }
        dest.push(node)
        walk(item.children, node.children!)
        if (truncated) return
      } else if (local) {
        dest.push({ name: item.name, path: local, kind: 'file' })
      } else {
        dest.push({
          name: item.name,
          path: `__toc__/${++folderSeq.n}/${item.name}`,
          kind: 'dir'
        })
      }
    }
  }

  walk(nodes, tree)
  return { tree, truncated, topicCount }
}

async function findHhcFiles(rootDir: string): Promise<string[]> {
  const out: string[] = []
  async function walk(d: string, depth: number): Promise<void> {
    if (depth > 6 || out.length >= 20) return
    let entries
    try {
      entries = await fsp.readdir(d, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      const full = path.join(d, e.name)
      if (e.isFile() && e.name.toLowerCase().endsWith('.hhc')) {
        out.push(full)
      } else if (e.isDirectory() && !e.name.startsWith('.')) {
        await walk(full, depth + 1)
      }
    }
  }
  await walk(rootDir, 0)
  return out
}

async function readTextFile(file: string): Promise<string> {
  return decodeChmTextBuffer(await fsp.readFile(file))
}

async function findDefaultFromHhp(rootDir: string): Promise<string | null> {
  let entries
  try {
    entries = await fsp.readdir(rootDir, { withFileTypes: true })
  } catch {
    return null
  }
  for (const e of entries) {
    if (!e.isFile() || !e.name.toLowerCase().endsWith('.hhp')) continue
    try {
      const text = await readTextFile(path.join(rootDir, e.name))
      const m = /^\s*Default\s+topic\s*=\s*(.+)\s*$/im.exec(text)
      if (m?.[1]) {
        const local = normalizeTopicPath(m[1].trim())
        if (local) return local
      }
    } catch {
      /* skip */
    }
  }
  return null
}

function firstTopicPath(nodes: ArchiveTreeNode[]): string | null {
  for (const n of nodes) {
    if (n.kind === 'file') return n.path
    if (n.kind === 'dir' && !n.path.startsWith('__toc__/') && /\.(html?|htm)$/i.test(n.path)) {
      return n.path
    }
    if (n.children) {
      const inner = firstTopicPath(n.children)
      if (inner) return inner
    }
  }
  // Folder nodes that still carry a real Local path
  for (const n of nodes) {
    if (n.kind === 'dir' && n.children?.length && !n.path.startsWith('__toc__/')) {
      if (/\.(html?|htm)$/i.test(n.path)) return n.path
    }
  }
  return null
}

async function findFirstHtml(rootDir: string): Promise<string | null> {
  async function walk(d: string, depth: number): Promise<string | null> {
    if (depth > 8) return null
    let entries
    try {
      entries = await fsp.readdir(d, { withFileTypes: true })
    } catch {
      return null
    }
    const files = entries.filter((e) => e.isFile()).sort((a, b) => a.name.localeCompare(b.name))
    for (const e of files) {
      const lower = e.name.toLowerCase()
      if (lower.endsWith('.htm') || lower.endsWith('.html')) {
        return path.relative(rootDir, path.join(d, e.name)).replace(/\\/g, '/')
      }
    }
    const dirs = entries
      .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
      .sort((a, b) => a.name.localeCompare(b.name))
    for (const e of dirs) {
      const hit = await walk(path.join(d, e.name), depth + 1)
      if (hit) return hit
    }
    return null
  }
  return walk(rootDir, 0)
}

export type ChmTocResult = {
  tree: ArchiveTreeNode[]
  truncated: boolean
  topicCount: number
  defaultTopic: string | null
}

/** Build TOC + default topic from an extracted CHM directory. */
export async function loadChmToc(rootDir: string): Promise<ChmTocResult> {
  const hhcFiles = await findHhcFiles(rootDir)
  let best: MutableToc[] = []
  for (const file of hhcFiles) {
    try {
      const html = await readTextFile(file)
      const parsed = parseHhcContents(html)
      if (parsed.length > best.length) best = parsed
    } catch {
      /* try next */
    }
  }

  const frozen = freezeToc(best, { n: 0 })
  let defaultTopic =
    (await findDefaultFromHhp(rootDir)) || firstTopicPath(frozen.tree) || (await findFirstHtml(rootDir))

  if (defaultTopic) {
    const resolved = await resolveTopicFile(rootDir, defaultTopic)
    if (!resolved) defaultTopic = (await findFirstHtml(rootDir)) || defaultTopic
    else defaultTopic = path.relative(rootDir, resolved).replace(/\\/g, '/')
  }

  return {
    tree: frozen.tree,
    truncated: frozen.truncated,
    topicCount: frozen.topicCount,
    defaultTopic
  }
}

async function resolveTopicFile(rootDir: string, topicPath: string): Promise<string | null> {
  const normalized = normalizeTopicPath(topicPath)
  if (!normalized) return null
  const abs = path.resolve(rootDir, normalized)
  const rootNorm = normalizeAbsolute(rootDir)
  if (!rootNorm || !isSameOrUnder(abs, rootNorm)) return null
  try {
    const st = await fsp.stat(abs)
    if (st.isFile()) return abs
  } catch {
    /* try case-insensitive / alternate ext below */
  }

  // Windows decompile preserves case; some Locals disagree — search same folder.
  const dir = path.dirname(abs)
  const base = path.basename(abs)
  try {
    const entries = await fsp.readdir(dir)
    const hit = entries.find((e) => e.toLowerCase() === base.toLowerCase())
    if (hit) {
      const full = path.join(dir, hit)
      if (isSameOrUnder(full, rootNorm)) return full
    }
  } catch {
    /* missing */
  }
  return null
}

/** Resolve a topic path inside a CHM to an mfe-media://chm/ URL. */
export async function chmTopicMediaUrl(
  chmPath: string,
  mtimeMs: number,
  size: number,
  topicPath: string
): Promise<string> {
  const extract = await ensureChmExtracted(chmPath, mtimeMs, size)
  if (topicPath.startsWith('__toc__/')) {
    throw new Error('Not a help topic')
  }
  const file = await resolveTopicFile(extract.rootDir, topicPath)
  if (!file) throw new Error('Topic not found in CHM')
  const rel = path.relative(extract.rootDir, file).replace(/\\/g, '/')
  return chmMediaUrlFor(extract.hash, rel, extract.cacheKey)
}

export function isChmTopicPath(topicPath: string): boolean {
  if (!topicPath || topicPath.startsWith('__toc__/')) return false
  return !topicPath.includes('..')
}
