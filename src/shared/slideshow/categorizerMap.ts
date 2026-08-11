import { normalizeKeyToken } from './keys'

/** Categorizer map row — name preserved for round-trip / future UI. */
export type CategorizerMapRow = {
  name: string
  /** Token after `Keys.` e.g. `F5`, `Back`, `OemMinus` (Forms.Keys spelling). */
  keyToken: string
  /** Destination folder; empty string = delete action. */
  path: string
}

/** `"Name", Keys.Token, "path"` — path may contain backslashes; no escape sequences. */
const LINE_RE = /^"([^"]*)"\s*,\s*Keys\.(\w+)\s*,\s*"([^"]*)"\s*$/

/**
 * Parse categorizer map file text (`"Name", Keys.Token, "path"`).
 * Blank lines ignored. Key tokens normalized to Forms.Keys names.
 * Unknown Keys.* tokens are kept as-written so Save can round-trip; playback skips them.
 */
export function parseCategorizerMap(text: string): CategorizerMapRow[] {
  const rows: CategorizerMapRow[] = []
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line) continue
    const m = LINE_RE.exec(line)
    if (!m) continue
    const rawToken = m[2]!
    const canon = normalizeKeyToken(rawToken)
    rows.push({
      name: m[1]!,
      keyToken: canon ?? rawToken,
      path: m[3]!
    })
  }
  return rows
}

/** Serialize rows back to the file format. */
export function serializeCategorizerMap(rows: CategorizerMapRow[]): string {
  const lines = rows.map((r) => `"${r.name}", Keys.${r.keyToken}, "${r.path}"`)
  return lines.join('\n') + (lines.length > 0 ? '\n' : '')
}

export function isDeleteMapRow(row: CategorizerMapRow): boolean {
  return row.path.trim() === ''
}
