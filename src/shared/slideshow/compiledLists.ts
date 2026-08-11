/**
 * Compiled file lists — paths and last.txt / composite helpers.
 *
 * Per-category files under `{compiledRoot}/{Name}/`:
 * - `.dat` — body (and usually ADS Index) = image full paths, one per line
 * - `.txt` — body = folders (optional `path|=>count`); may also have ADS Index
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

export type TxtFolderLine = {
  folder: string
  /** Repeat count from `|=>`; default 1 when omitted. */
  count: number
}

/** Sanitize a display name into a Windows-safe folder / .dat basename. */
export function sanitizeCompiledName(name: string): string {
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

/**
 * `.txt` body: folder paths, optional `folder|=>count` (spaces around `|=>` ok).
 * Lines without `|=>` count as 1.
 */
export function parseTxtFolderLines(text: string): TxtFolderLine[] {
  const out: TxtFolderLine[] = []
  for (const line of parseBodyLines(text)) {
    const sep = line.lastIndexOf(COMPILED_COUNT_SEP)
    if (sep > 0) {
      const folder = line.slice(0, sep).trim()
      const count = Number.parseInt(line.slice(sep + COMPILED_COUNT_SEP.length).trim(), 10)
      if (!folder) continue
      out.push({
        folder,
        count: Number.isFinite(count) && count > 0 ? count : 1
      })
    } else {
      out.push({ folder: line, count: 1 })
    }
  }
  return out
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
