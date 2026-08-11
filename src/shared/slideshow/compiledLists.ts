/**
 * Compiled file lists — paths and last.txt / composite helpers.
 *
 * Per-category files under `{compiledRoot}/{Name}/`:
 * - `.dat` — body = source folder path(s) (optional image paths / `path|=>count`);
 *   ADS Index/Count = crawled jpg/png list after Update Lists (`|=>` ignored then)
 * - `.txt` — body = folders and/or other `.dat`/`.txt` list refs (optional `path|=>count`);
 *   never Index ADS — expand from body at play time
 *
 * `!!Lists/last.txt` (+ user-saved `!!Lists/*.txt`) = composite of those files:
 * `absoluteListPath|=>count`
 */

export const COMPILED_LISTS_SUBDIR = '!!Lists'
export const COMPILED_LAST_TXT = 'last.txt'
export const COMPILED_INDEX_STREAM = 'Index'
export const COMPILED_COUNT_STREAM = 'Count'
export const COMPILED_COUNT_SEP = '|=>'

export type CompiledListEntry = {
  name: string
  folder: string
}

export type LastListLine = {
  /** Absolute path to a `.dat` or `.txt` list file under a category folder. */
  datPath: string
  count: number
}

/** @deprecated Use TxtBodyLine — kept for older call sites. */
export type TxtFolderLine = {
  folder: string
  /** Repeat count from `|=>`; default 1 when omitted. */
  count: number
}

/** One line in a `.txt` list body: a folder to scan, or another list file to expand. */
export type TxtBodyLine = {
  path: string
  /** Repeat count from `|=>`; default 1 when omitted. */
  count: number
  kind: 'folder' | 'list'
}

/** Sanitize a display name into a Windows-safe folder / .dat basename. */
export function sanitizeCompiledName(name: string): string {
  // eslint-disable-next-line no-control-regex -- strip Windows-forbidden + C0 controls
  const t = name.trim().replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').replace(/\.+$/g, '')
  return t.slice(0, 120) || 'List'
}

export function compiledListsDir(compiledRoot: string): string {
  const root = compiledRoot.replace(/[/\\]+$/, '')
  return `${root}\\${COMPILED_LISTS_SUBDIR}`
}

export function compiledLastTxtPath(compiledRoot: string): string {
  return `${compiledListsDir(compiledRoot)}\\${COMPILED_LAST_TXT}`
}

export function compiledEntryDir(compiledRoot: string, name: string): string {
  const root = compiledRoot.replace(/[/\\]+$/, '')
  return `${root}\\${sanitizeCompiledName(name)}`
}

export function compiledEntryDatPath(compiledRoot: string, name: string): string {
  const safe = sanitizeCompiledName(name)
  return `${compiledEntryDir(compiledRoot, name)}\\${safe}.dat`
}

export function isCompiledListFileName(name: string): boolean {
  const lower = name.toLowerCase()
  return lower.endsWith('.dat') || lower.endsWith('.txt')
}

/** True if path points at a `.dat` / `.txt` list file (by extension). */
export function isCompiledListRefPath(p: string): boolean {
  const lower = p.trim().toLowerCase()
  return lower.endsWith('.dat') || lower.endsWith('.txt')
}

/** Non-empty body lines (skip blanks / # comments). */
export function parseBodyLines(text: string): string[] {
  const out: string[] = []
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    out.push(line)
  }
  return out
}

function parseCountSuffix(line: string): { path: string; count: number } | null {
  const sep = line.lastIndexOf(COMPILED_COUNT_SEP)
  if (sep > 0) {
    const p = line.slice(0, sep).trim()
    const count = Number.parseInt(line.slice(sep + COMPILED_COUNT_SEP.length).trim(), 10)
    if (!p) return null
    return {
      path: p,
      count: Number.isFinite(count) && count > 0 ? count : 1
    }
  }
  return { path: line, count: 1 }
}

/**
 * `.txt` body: folder paths and/or `.dat`/`.txt` list refs.
 * Optional `path|=>count` (spaces around `|=>` ok). Lines without `|=>` count as 1.
 */
export function parseTxtBodyLines(text: string): TxtBodyLine[] {
  const out: TxtBodyLine[] = []
  for (const line of parseBodyLines(text)) {
    const parsed = parseCountSuffix(line)
    if (!parsed) continue
    out.push({
      path: parsed.path,
      count: parsed.count,
      kind: isCompiledListRefPath(parsed.path) ? 'list' : 'folder'
    })
  }
  return out
}

/**
 * `.txt` body as folder lines only (legacy helper).
 * List-file refs (`.dat`/`.txt`) are still returned as `{ folder: path }` —
 * prefer `parseTxtBodyLines` for new code.
 */
export function parseTxtFolderLines(text: string): TxtFolderLine[] {
  return parseTxtBodyLines(text).map((r) => ({ folder: r.path, count: r.count }))
}

/** `.dat` body: image full paths (one per line). */
export function parseDatImageLines(text: string): string[] {
  return parseBodyLines(text)
}

/** Parse `path|=>count` composite lines (blank / # skipped). Requires `|=>`. */
export function parseLastListText(text: string): LastListLine[] {
  const out: LastListLine[] = []
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const sep = line.lastIndexOf(COMPILED_COUNT_SEP)
    if (sep <= 0) continue
    const datPath = line.slice(0, sep).trim()
    const count = Number.parseInt(line.slice(sep + COMPILED_COUNT_SEP.length).trim(), 10)
    if (!datPath || !Number.isFinite(count) || count < 0) continue
    out.push({ datPath, count })
  }
  return out
}

export function serializeLastList(lines: LastListLine[]): string {
  return lines
    .filter((l) => l.count > 0 && l.datPath.trim())
    .map((l) => `${l.datPath.trim()}${COMPILED_COUNT_SEP}${Math.floor(l.count)}`)
    .join('\n')
}

/** True if any line has count > 0. */
export function lastListHasPositiveCounts(lines: LastListLine[]): boolean {
  return lines.some((l) => l.count > 0)
}
