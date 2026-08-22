/**
 * Compiled file lists — build/read `.dat` (source folders → Index) and `.txt`
 * lists (folders and/or nested `.dat`/`.txt` refs).
 */
import fsp from 'node:fs/promises'
import path from 'node:path'
import { buildStreamPath } from '@shared/ads/paths'
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
  parseTxtBodyLines,
  sanitizeCompiledName,
  serializeLastList,
  type CompiledListEntry,
  type LastListLine
} from '@shared/slideshow/compiledLists'
import { requireAbsolute } from '../fs/list'
import { beginOp, type OpReporter } from '../fs/opProgress'
import { deleteStream, readStreamText, streamExists, writeStreamText } from '../fs/adsWin32'
import { logMain } from '../logging'
import { sortSlideshowImagePaths } from './listImages'
import type { SlideshowOrder } from '@shared/schemas/slideshow'

const IMAGE_RE = /\.(jpe?g|png)$/i

/** Progress hooks during recursive jpg/png walks (Update Lists). */
export type WalkProgress = {
  throwIfCancelled?(): void
  /** Current folder being scanned + images found so far for this list file. */
  onWalk?(info: { folder: string; imagesFound: number }): void
}

function isJpgPngPath(filePath: string): boolean {
  return IMAGE_RE.test(filePath)
}

async function walkJpgPng(
  root: string,
  out: string[],
  progress?: WalkProgress,
  /** Base count already in the Index for this file (other folders). */
  baseFound = 0
): Promise<void> {
  progress?.throwIfCancelled?.()
  let entries
  try {
    entries = await fsp.readdir(root, { withFileTypes: true })
  } catch {
    return
  }
  for (const ent of entries) {
    progress?.throwIfCancelled?.()
    const full = path.join(root, ent.name)
    if (ent.isDirectory()) {
      progress?.onWalk?.({ folder: full, imagesFound: baseFound + out.length })
      await walkJpgPng(full, out, progress, baseFound)
    } else if (ent.isFile() && IMAGE_RE.test(ent.name)) {
      out.push(full)
      if (out.length % 64 === 0) {
        progress?.onWalk?.({ folder: root, imagesFound: baseFound + out.length })
      }
    }
  }
}

/** Recursive jpg/png scan of one folder (no cross-list cache). */
async function scanFolderJpgPng(
  folder: string,
  progress?: WalkProgress,
  baseFound = 0
): Promise<string[]> {
  const abs = requireAbsolute(folder)
  const batch: string[] = []
  progress?.onWalk?.({ folder: abs, imagesFound: baseFound })
  await walkJpgPng(abs, batch, progress, baseFound)
  batch.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }))
  return batch
}

function listFileLabel(listPath: string): string {
  const base = path.basename(listPath)
  const cat = path.basename(path.dirname(listPath))
  return cat ? `${cat}\\${base}` : base
}

function formatWalkCurrent(listLabel: string, imagesFound: number, folder?: string): string {
  const bits = [`${listLabel} — ${imagesFound.toLocaleString()} images`]
  if (folder) bits.push(folder)
  return bits.join(' — ')
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
 * Compile one `.dat` list: body = source folder path(s) (and optional image
 * paths). Crawl folders for jpg/png, stream-write ADS Index + Count.
 * Does not change the body. Body `|=>n` is ignored — Index is a unique crawl.
 * No shared folder cache — peak memory is one folder batch + dedupe keys.
 */
export async function compileDatIndex(
  datPath: string,
  walkProgress?: WalkProgress
): Promise<{ count: number }> {
  const abs = requireAbsolute(datPath)
  const label = listFileLabel(abs)
  const rows = parseTxtBodyLines(await readBodyText(abs))
  const seen = new Set<string>()
  let count = 0
  let firstLine = true

  if (streamExists(abs, COMPILED_INDEX_STREAM)) {
    try {
      deleteStream(abs, COMPILED_INDEX_STREAM)
    } catch {
      /* recreate below */
    }
  }
  const fh = await fsp.open(buildStreamPath(abs, COMPILED_INDEX_STREAM), 'w')
  try {
    const appendUnique = async (p: string): Promise<void> => {
      const key = p.toLowerCase()
      if (seen.has(key)) return
      seen.add(key)
      if (!firstLine) await fh.write('\n')
      firstLine = false
      await fh.write(p)
      count += 1
    }

    for (const row of rows) {
      // Update Lists ignores `|=>` entirely — every line is included once.
      walkProgress?.throwIfCancelled?.()
      if (row.kind === 'list') {
        // Nested list refs are for `.txt` bodies; skip in `.dat` folder crawls.
        continue
      }
      if (isJpgPngPath(row.path)) {
        await appendUnique(path.normalize(row.path))
      } else {
        let batch: string[] = []
        try {
          batch = await scanFolderJpgPng(row.path, walkProgress, count)
        } catch {
          continue
        }
        for (let j = 0; j < batch.length; j++) {
          await appendUnique(batch[j]!)
        }
        batch.length = 0
      }
      walkProgress?.onWalk?.({
        folder: row.path,
        imagesFound: count
      })
    }
    // Match writeStreamText trailer: value + '\0\r\n'
    await fh.write('\0\r\n')
  } finally {
    await fh.close()
  }

  walkProgress?.onWalk?.({ folder: label, imagesFound: count })
  seen.clear()
  await writeStreamText(abs, COMPILED_COUNT_STREAM, String(count), true)
  return { count }
}

/** Recursively find `.dat` files; skip `!!Lists` directories entirely. */
async function collectCompiledDatFiles(dir: string, out: string[]): Promise<void> {
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
      await collectCompiledDatFiles(full, out)
    } else if (ent.isFile() && ent.name.toLowerCase().endsWith('.dat')) {
      out.push(full)
    }
  }
}

/** Recursively find `.dat` / `.txt` files; skip `!!Lists` directories entirely. */
async function collectCompiledListFiles(
  dir: string,
  out: { dats: string[]; txts: string[] }
): Promise<void> {
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
      await collectCompiledListFiles(full, out)
    } else if (ent.isFile()) {
      const lower = ent.name.toLowerCase()
      if (lower.endsWith('.dat')) out.dats.push(full)
      else if (lower.endsWith('.txt')) out.txts.push(full)
    }
  }
}

function walkHookForOp(op: OpReporter, listLabel: string): WalkProgress {
  return {
    throwIfCancelled: () => op.throwIfCancelled(),
    onWalk: ({ folder, imagesFound }) => {
      op.pulse(formatWalkCurrent(listLabel, imagesFound, folder))
    }
  }
}

/**
 * Update Lists: recompile ADS Index/Count on every `.dat` under the compiled
 * root (skip `!!Lists`), one file at a time (no in-memory folder cache).
 * Body = folders to crawl; `|=>` ignored. Does **not** write Index on `.txt`.
 */
export async function updateCompiledLists(
  compiledRoot: string,
  _entries: CompiledListEntry[]
): Promise<{
  updated: number
  totalFiles: number
  datUpdated: number
  txtUpdated: number
}> {
  const root = requireAbsolute(compiledRoot)
  await ensureListsDir(root)
  const dats: string[] = []
  await collectCompiledDatFiles(root, dats)
  const progress = beginOp(
    'compile-lists',
    Math.max(dats.length, 1),
    'Updating Lists…'
  )
  let updated = 0
  let totalFiles = 0
  let datUpdated = 0
  try {
    if (dats.length === 0) {
      progress.finish()
      return { updated: 0, totalFiles: 0, datUpdated: 0, txtUpdated: 0 }
    }
    for (const datPath of dats) {
      progress.throwIfCancelled()
      const label = listFileLabel(datPath)
      progress.pulse(formatWalkCurrent(label, 0))
      const hook = walkHookForOp(progress, label)
      const { count } = await compileDatIndex(datPath, hook)
      totalFiles += count
      updated += 1
      datUpdated += 1
      progress.tick(formatWalkCurrent(label, count))
    }
    progress.finish()
  } catch (e) {
    progress.fail()
    throw e
  }
  return { updated, totalFiles, datUpdated, txtUpdated: 0 }
}

export type CompiledListValidationKind = 'missing-folder' | 'missing-list'

export type CompiledListValidationIssue = {
  kind: CompiledListValidationKind
  /** Absolute path of the list file that has the problem. */
  listPath: string
  /** Short label e.g. `Category\\name.dat`. */
  listLabel: string
  /** Missing folder or nested list path (when applicable). */
  refPath?: string
  message: string
}

export type ValidateCompiledListsResult = {
  ok: boolean
  checkedLists: number
  issueCount: number
  issues: CompiledListValidationIssue[]
}

async function pathExistsAsDir(folder: string): Promise<boolean> {
  try {
    const st = await fsp.stat(requireAbsolute(folder))
    return st.isDirectory()
  } catch {
    return false
  }
}

async function pathExistsAsFile(filePath: string): Promise<boolean> {
  try {
    const st = await fsp.stat(requireAbsolute(filePath))
    return st.isFile()
  } catch {
    return false
  }
}

/**
 * Validate compiled lists: missing source folders / nested list refs
 * (outside `!!Lists`). `.txt` never uses Index ADS — no Index check.
 */
export async function validateCompiledLists(
  compiledRoot: string
): Promise<ValidateCompiledListsResult> {
  const root = requireAbsolute(compiledRoot)
  const collected = { dats: [] as string[], txts: [] as string[] }
  await collectCompiledListFiles(root, collected)
  const queue = [
    ...collected.dats.map((p) => ({ path: p, kind: 'dat' as const })),
    ...collected.txts.map((p) => ({ path: p, kind: 'txt' as const }))
  ]
  const issues: CompiledListValidationIssue[] = []

  for (const item of queue) {
    const listLabel = listFileLabel(item.path)
    const rows = parseTxtBodyLines(await readBodyText(item.path))
    for (const row of rows) {
      if (row.count <= 0) continue
      if (row.kind === 'list') {
        if (!(await pathExistsAsFile(row.path))) {
          issues.push({
            kind: 'missing-list',
            listPath: item.path,
            listLabel,
            refPath: row.path,
            message: `${listLabel}: missing list “${row.path}”`
          })
        }
        continue
      }
      // Body may include legacy single image paths — not folder refs.
      if (isJpgPngPath(row.path)) continue
      if (!(await pathExistsAsDir(row.path))) {
        issues.push({
          kind: 'missing-folder',
          listPath: item.path,
          listLabel,
          refPath: row.path,
          message: `${listLabel}: missing folder “${row.path}”`
        })
      }
    }
  }

  return {
    ok: issues.length === 0,
    checkedLists: queue.length,
    issueCount: issues.length,
    issues
  }
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
  // Nb. Files: always prefer on-disk Count / Index ADS (.dat and .txt, including !!Lists).
  // Play still expands `.txt` from the body; Update Lists does not rewrite !!Lists.
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
  // No ADS: `.dat` can fall back to body image lines; `.txt` body is refs/folders — do not walk.
  if (kind === 'txt') {
    return { fileCount: 0, indexPresent: false }
  }
  const body = await readBodyText(filePath)
  return { fileCount: parseDatImageLines(body).length, indexPresent: false }
}

async function listFilesInCategoryDir(
  dir: string,
  opts?: { excludeLastTxt?: boolean }
): Promise<CompiledDatInfo[]> {
  const dats: CompiledDatInfo[] = []
  let names: string[]
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

  let childDirs: string[]
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
 * Write ADS Count after an on-the-fly `.txt` expand (play / virtual playlist).
 * Skips the write when the stored value already matches. Does not write Index.
 */
async function persistTxtCompiledCount(filePath: string, count: number): Promise<void> {
  const n = Math.max(0, Math.floor(count))
  try {
    if (streamExists(filePath, COMPILED_COUNT_STREAM)) {
      const t = await readStreamText(filePath, COMPILED_COUNT_STREAM)
      const prev = Number.parseInt(t.trim(), 10)
      if (Number.isFinite(prev) && prev === n) return
    }
    await writeStreamText(filePath, COMPILED_COUNT_STREAM, String(n), true)
  } catch (e) {
    logMain(
      'warn',
      `compiled Count ADS write failed (${filePath}): ${e instanceof Error ? e.message : String(e)}`
    )
  }
}

/**
 * Resolve image full paths for one list file:
 * - `.dat`: ADS Index if present, else body = image paths (legacy) or empty until Update Lists
 * - `.txt`: always expand from body — folders (jpg/png walk) and nested `.dat`/`.txt`
 *   refs with `|=>` counts. After expand, refresh ADS Count so Nb. Files stays accurate.
 *   Cycles (A→B→A) yield no further expansion at the repeated node.
 */
export async function readDatIndex(listPath: string): Promise<string[]> {
  return expandListToImages(requireAbsolute(listPath), new Set())
}

/**
 * Expand a `.dat` / `.txt` list to image paths.
 * `visiting` is the active recursion stack (lowercase normalized paths) for cycle breaks.
 */
async function expandListToImages(
  listPath: string,
  visiting: Set<string>,
  opts: {
    walkProgress?: WalkProgress
  } = {}
): Promise<string[]> {
  let abs: string
  try {
    abs = path.normalize(requireAbsolute(listPath))
  } catch {
    return []
  }
  const key = abs.toLowerCase()
  if (visiting.has(key)) return []
  visiting.add(key)
  try {
    const ext = path.extname(abs).toLowerCase()
    if (ext === '.dat') {
      if (streamExists(abs, COMPILED_INDEX_STREAM)) {
        return parseDatImageLines(await readStreamText(abs, COMPILED_INDEX_STREAM))
      }
      return parseDatImageLines(await readBodyText(abs))
    }
    if (ext === '.txt') {
      const paths = await expandTxtBodyToImages(abs, visiting, opts)
      await persistTxtCompiledCount(abs, paths.length)
      return paths
    }
    return []
  } finally {
    visiting.delete(key)
  }
}

async function expandTxtBodyToImages(
  txtPath: string,
  visiting: Set<string>,
  opts: {
    walkProgress?: WalkProgress
  }
): Promise<string[]> {
  const rows = parseTxtBodyLines(await readBodyText(txtPath))
  const out: string[] = []
  for (const row of rows) {
    if (row.count <= 0) continue
    opts.walkProgress?.throwIfCancelled?.()
    let batch: readonly string[]
    if (row.kind === 'list') {
      try {
        batch = await expandListToImages(row.path, visiting, opts)
      } catch {
        continue
      }
    } else if (isJpgPngPath(row.path)) {
      batch = [path.normalize(row.path)]
    } else {
      try {
        batch = await scanFolderJpgPng(row.path, opts.walkProgress, out.length)
      } catch {
        continue
      }
    }
    for (let i = 0; i < row.count; i++) {
      for (let j = 0; j < batch.length; j++) out.push(batch[j]!)
    }
  }
  return out
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

/**
 * Expand composite lines into a flat image playlist (list file images × count),
 * then apply Settings → Slideshow order (random / name / size / dimensions).
 */
/** Flat expand refuse threshold (legacy IPC); use virtual playlist for huge lists. */
const EXPAND_COMPOSITE_SAFE_MAX = 500_000

/**
 * Expand composite lines into a flat image playlist (list × count) + sort.
 * Refuses when the result would exceed EXPAND_COMPOSITE_SAFE_MAX — use
 * virtual playlist apply for large compiled lists.
 */
export async function expandCompositePlaylist(
  lines: LastListLine[],
  order: SlideshowOrder = 'name',
  ascending = true
): Promise<string[]> {
  const out: string[] = []
  for (const line of lines) {
    if (line.count <= 0) continue
    const paths = await readDatIndex(line.datPath)
    if (paths.length === 0) continue
    for (let i = 0; i < line.count; i++) {
      for (let j = 0; j < paths.length; j++) {
        out.push(paths[j]!)
        if (out.length > EXPAND_COMPOSITE_SAFE_MAX) {
          throw new Error(
            `Expanded playlist exceeds ${EXPAND_COMPOSITE_SAFE_MAX.toLocaleString()} paths — use compiled virtual playlist`
          )
        }
      }
    }
  }
  return sortSlideshowImagePaths(out, order, ascending)
}
