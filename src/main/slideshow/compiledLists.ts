/**
 * Compiled file lists — build/read `.dat` (image paths) and `.txt` (folder lists).
 */
import fsp from 'node:fs/promises'
import path from 'node:path'
import {
  COMPILED_COUNT_STREAM,
  COMPILED_INDEX_STREAM,
  COMPILED_LAST_TXT,
  COMPILED_LISTS_SUBDIR,
  compiledLastTxtPath,
  compiledListsDir,
  isCompiledListFileName,
  lastListHasPositiveCounts,
  parseDatImageLines,
  parseLastListText,
  parseTxtFolderLines,
  sanitizeCompiledName,
  serializeLastList,
  type CompiledListEntry,
  type LastListLine
} from '@shared/slideshow/compiledLists'
import { requireAbsolute } from '../fs/list'
import { beginOp } from '../fs/opProgress'
import { readStreamText, streamExists, writeStreamText } from '../fs/adsWin32'
import { logMain } from '../logging'

const IMAGE_RE = /\.(jpe?g|png)$/i

async function walkJpgPng(
  root: string,
  out: string[],
  progress?: { pulse: (c?: string) => void }
): Promise<void> {
  let entries
  try {
    entries = await fsp.readdir(root, { withFileTypes: true })
  } catch {
    return
  }
  for (const ent of entries) {
    const full = path.join(root, ent.name)
    if (ent.isDirectory()) {
      progress?.pulse(full)
      await walkJpgPng(full, out, progress)
    } else if (ent.isFile() && IMAGE_RE.test(ent.name)) {
      out.push(full)
    }
  }
}

async function readBodyText(filePath: string): Promise<string> {
  try {
    return await fsp.readFile(filePath, 'utf8')
  } catch {
    return ''
  }
}

export async function ensureListsDir(compiledRoot: string): Promise<string> {
  const dir = compiledListsDir(requireAbsolute(compiledRoot))
  await fsp.mkdir(dir, { recursive: true })
  const last = compiledLastTxtPath(compiledRoot)
  try {
    await fsp.access(last)
  } catch {
    await fsp.writeFile(last, '', 'utf8')
  }
  return dir
}

/**
 * Compile one `.txt` list: walk body folders (honoring `|=>` repeats),
 * overwrite ADS Index + Count. Does not change the body.
 */
export async function compileTxtIndex(txtPath: string): Promise<{ count: number }> {
  const abs = requireAbsolute(txtPath)
  const folders = parseTxtFolderLines(await readBodyText(abs))
  const files: string[] = []
  for (const row of folders) {
    const batch: string[] = []
    try {
      await walkJpgPng(requireAbsolute(row.folder), batch)
    } catch {
      continue
    }
    batch.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }))
    for (let i = 0; i < row.count; i++) files.push(...batch)
  }
  const indexBody = files.join('\n')
  await writeStreamText(abs, COMPILED_INDEX_STREAM, indexBody, true)
  await writeStreamText(abs, COMPILED_COUNT_STREAM, String(files.length), true)
  return { count: files.length }
}

/** Recursively find `.txt` files; skip `!!Lists` directories entirely. */
async function collectTxtFiles(dir: string, out: string[]): Promise<void> {
  let entries
  try {
    entries = await fsp.readdir(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const ent of entries) {
    if (ent.name === COMPILED_LISTS_SUBDIR || ent.name.toLowerCase() === '!!lists') continue
    const full = path.join(dir, ent.name)
    if (ent.isDirectory()) {
      await collectTxtFiles(full, out)
    } else if (ent.isFile() && ent.name.toLowerCase().endsWith('.txt')) {
      out.push(full)
    }
  }
}

/**
 * Update Lists: recompile ADS Index/Count on every `.txt` under the compiled root
 * (skip `!!Lists`; ignore `.dat`). Pre-builds image paths so slideshow start
 * does not walk source folders.
 */
export async function updateCompiledLists(
  compiledRoot: string,
  _entries: CompiledListEntry[]
): Promise<{ updated: number; totalFiles: number }> {
  const root = requireAbsolute(compiledRoot)
  await ensureListsDir(root)
  const txtFiles: string[] = []
  await collectTxtFiles(root, txtFiles)
  const progress = beginOp(
    'zip',
    Math.max(txtFiles.length, 1),
    'Compiling .txt Indexes…'
  )
  let updated = 0
  let totalFiles = 0
  try {
    if (txtFiles.length === 0) {
      progress.finish()
      return { updated: 0, totalFiles: 0 }
    }
    for (const txt of txtFiles) {
      progress.throwIfCancelled()
      progress.pulse(path.basename(txt))
      const { count } = await compileTxtIndex(txt)
      totalFiles += count
      updated += 1
      progress.tick(path.basename(txt))
    }
    progress.finish()
  } catch (e) {
    progress.fail()
    throw e
  }
  return { updated, totalFiles }
}

export type CompiledDatInfo = {
  path: string
  name: string
  /** `.dat` | `.txt` */
  kind: 'dat' | 'txt'
  fileCount: number
  indexPresent: boolean
}

export type CompiledTabInfo = {
  name: string
  dats: CompiledDatInfo[]
}

async function fileCountForList(filePath: string, kind: 'dat' | 'txt'): Promise<{
  fileCount: number
  indexPresent: boolean
}> {
  const indexPresent = streamExists(filePath, COMPILED_INDEX_STREAM)
  if (streamExists(filePath, COMPILED_COUNT_STREAM)) {
    const t = await readStreamText(filePath, COMPILED_COUNT_STREAM)
    const n = Number.parseInt(t.trim(), 10)
    if (Number.isFinite(n) && n >= 0) return { fileCount: n, indexPresent }
  }
  if (indexPresent) {
    const idx = await readStreamText(filePath, COMPILED_INDEX_STREAM)
    return {
      fileCount: idx.split(/\r?\n/).filter((l) => l.trim()).length,
      indexPresent
    }
  }
  if (kind === 'dat') {
    const body = await readBodyText(filePath)
    return { fileCount: parseDatImageLines(body).length, indexPresent: false }
  }
  // .txt without Index/Count: don't walk folders during list (can be huge)
  return { fileCount: 0, indexPresent: false }
}

async function listFilesInCategoryDir(
  dir: string,
  opts?: { excludeLastTxt?: boolean }
): Promise<CompiledDatInfo[]> {
  const dats: CompiledDatInfo[] = []
  let names: string[] = []
  try {
    names = await fsp.readdir(dir)
  } catch {
    return dats
  }
  for (const fn of names) {
    if (!isCompiledListFileName(fn)) continue
    // Resume composite is not a selectable list row
    if (opts?.excludeLastTxt && fn.toLowerCase() === COMPILED_LAST_TXT.toLowerCase()) continue
    const p = path.join(dir, fn)
    let st
    try {
      st = await fsp.stat(p)
    } catch {
      continue
    }
    if (!st.isFile()) continue
    const kind: 'dat' | 'txt' = fn.toLowerCase().endsWith('.txt') ? 'txt' : 'dat'
    const { fileCount, indexPresent } = await fileCountForList(p, kind)
    dats.push({
      path: p,
      name: fn.replace(/\.(dat|txt)$/i, ''),
      kind,
      fileCount,
      indexPresent
    })
  }
  dats.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
  return dats
}

/**
 * Tabs = immediate child folders of the compiled root (including `!!Lists`).
 * Optional `entries` only affects tab order when names match existing folders.
 * `!!Lists` is always included when present (first tab) so its .dat/.txt can be
 * selected for slideshows; Update Lists still skips compiling inside it.
 */
export async function listCompiledDats(
  compiledRoot: string,
  entries: CompiledListEntry[]
): Promise<CompiledTabInfo[]> {
  const root = requireAbsolute(compiledRoot)
  await ensureListsDir(root)

  let childDirs: string[] = []
  try {
    const ents = await fsp.readdir(root, { withFileTypes: true })
    childDirs = ents.filter((e) => e.isDirectory()).map((e) => e.name)
  } catch {
    childDirs = []
  }

  const isListsDir = (name: string): boolean =>
    name === COMPILED_LISTS_SUBDIR || name.toLowerCase() === '!!lists'

  // Prefer settings entry order for known names; append any other folders found on disk.
  const ordered: string[] = []
  const seen = new Set<string>()

  // !!Lists first when present (C# "Lists" tab)
  const listsName = childDirs.find((d) => isListsDir(d))
  if (listsName) {
    ordered.push(listsName)
    seen.add(listsName.toLowerCase())
  }

  for (const entry of entries) {
    const name = sanitizeCompiledName(entry.name)
    if (isListsDir(name)) continue
    const match = childDirs.find((d) => d.toLowerCase() === name.toLowerCase())
    if (match && !seen.has(match.toLowerCase())) {
      ordered.push(match)
      seen.add(match.toLowerCase())
    }
  }
  for (const d of childDirs.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }))) {
    if (!seen.has(d.toLowerCase())) {
      ordered.push(d)
      seen.add(d.toLowerCase())
    }
  }

  const tabs: CompiledTabInfo[] = []
  for (const name of ordered) {
    const dir = path.join(root, name)
    const dats = await listFilesInCategoryDir(dir, { excludeLastTxt: isListsDir(name) })
    tabs.push({ name, dats })
  }
  return tabs
}

/**
 * Resolve image full paths for one list file:
 * - `.dat`: ADS Index if present, else body = image paths
 * - `.txt`: ADS Index if present, else walk each body folder (`folder` or `folder|=>n`)
 */
export async function readDatIndex(listPath: string): Promise<string[]> {
  const p = requireAbsolute(listPath)
  const ext = path.extname(p).toLowerCase()

  if (ext === '.dat') {
    if (streamExists(p, COMPILED_INDEX_STREAM)) {
      const text = await readStreamText(p, COMPILED_INDEX_STREAM)
      return parseDatImageLines(text)
    }
    return parseDatImageLines(await readBodyText(p))
  }

  if (ext === '.txt') {
    // Prefer pre-compiled Index (from Update Lists). Avoid on-the-fly folder walks.
    if (streamExists(p, COMPILED_INDEX_STREAM)) {
      const text = await readStreamText(p, COMPILED_INDEX_STREAM)
      return parseDatImageLines(text)
    }
    logMain(
      'warn',
      `Compiled .txt missing Index ADS (run Update Lists): ${p}`
    )
    return []
  }

  return []
}

export async function readLastList(compiledRoot: string): Promise<LastListLine[]> {
  const root = requireAbsolute(compiledRoot)
  await ensureListsDir(root)
  const file = compiledLastTxtPath(root)
  try {
    const text = await fsp.readFile(file, 'utf8')
    return parseLastListText(text)
  } catch {
    return []
  }
}

export async function writeLastList(compiledRoot: string, lines: LastListLine[]): Promise<void> {
  const root = requireAbsolute(compiledRoot)
  await ensureListsDir(root)
  const file = compiledLastTxtPath(root)
  await fsp.writeFile(file, serializeLastList(lines), 'utf8')
}

export async function readCompositeList(filePath: string): Promise<LastListLine[]> {
  const p = requireAbsolute(filePath)
  const text = await fsp.readFile(p, 'utf8')
  return parseLastListText(text)
}

export async function writeCompositeList(filePath: string, lines: LastListLine[]): Promise<void> {
  const p = requireAbsolute(filePath)
  await fsp.mkdir(path.dirname(p), { recursive: true })
  await fsp.writeFile(p, serializeLastList(lines), 'utf8')
}

export async function lastListIsUsable(compiledRoot: string): Promise<boolean> {
  try {
    const lines = await readLastList(compiledRoot)
    return lastListHasPositiveCounts(lines)
  } catch (e) {
    logMain('warn', `lastListIsUsable: ${e instanceof Error ? e.message : String(e)}`)
    return false
  }
}

/** Expand composite lines into a flat image playlist (list file images × count). */
export async function expandCompositePlaylist(lines: LastListLine[]): Promise<string[]> {
  const out: string[] = []
  for (const line of lines) {
    if (line.count <= 0) continue
    const paths = await readDatIndex(line.datPath)
    for (let i = 0; i < line.count; i++) {
      out.push(...paths)
    }
  }
  return out
}
