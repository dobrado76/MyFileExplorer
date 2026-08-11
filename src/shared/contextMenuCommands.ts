/** User-defined context-menu external commands (match + argv expansion). */

export const MAX_CONTEXT_MENU_COMMANDS = 30

export type ContextMenuCommandMatch =
  | { type: 'all' }
  | { type: 'extensions'; extensions: string[] }

export type ContextMenuCommand = {
  id: string
  label: string
  enabled: boolean
  /** Absolute path; may include `%ENV%` segments expanded in main. */
  executable: string
  /** Argv template, e.g. `{path}` or `--fullscreen {paths}`. */
  argsTemplate: string
  match: ContextMenuCommandMatch
}

/** Normalize extension tokens: strip dots, lowercase, dedupe, drop empties. */
export function normalizeExtensions(input: string | string[]): string[] {
  const parts = Array.isArray(input)
    ? input
    : input.split(/[\s,;]+/).map((s) => s.trim())
  const out: string[] = []
  const seen = new Set<string>()
  for (const raw of parts) {
    const e = raw.replace(/^\.+/, '').toLowerCase()
    if (!e || seen.has(e)) continue
    seen.add(e)
    out.push(e)
  }
  return out
}

function extensionOf(path: string): string {
  const base = path.replace(/[\\/]+$/, '')
  const name = base.includes('\\') ? base.slice(base.lastIndexOf('\\') + 1) : base
  const slash = name.includes('/') ? name.slice(name.lastIndexOf('/') + 1) : name
  const dot = slash.lastIndexOf('.')
  if (dot <= 0 || dot === slash.length - 1) return ''
  return slash.slice(dot + 1).toLowerCase()
}

function basenameOf(path: string): string {
  const n = path.replace(/[\\/]+$/, '')
  if (/^[a-zA-Z]:\\?$/.test(n)) return n.slice(0, 2)
  const i = Math.max(n.lastIndexOf('\\'), n.lastIndexOf('/'))
  return i >= 0 ? n.slice(i + 1) : n
}

function dirOf(path: string): string {
  const n = path.replace(/[\\/]+$/, '')
  if (/^[a-zA-Z]:\\?$/.test(n)) return n.endsWith('\\') ? n : n + '\\'
  const i = Math.max(n.lastIndexOf('\\'), n.lastIndexOf('/'))
  if (i < 0) return ''
  const parent = n.slice(0, i)
  if (/^[a-zA-Z]:$/.test(parent)) return parent + '\\'
  return parent
}

/**
 * Whether an enabled command should appear for the given selection.
 * `kind` is the uniform selection kind (caller ensures all paths are files or folders).
 * Match is all-or-nothing across paths.
 */
export function commandMatches(
  cmd: Pick<ContextMenuCommand, 'enabled' | 'match'>,
  paths: string[],
  kind: 'file' | 'folder'
): boolean {
  if (!cmd.enabled || paths.length === 0) return false
  if (kind === 'folder') {
    // Folder lists always use match.all in settings; still honor extensions if present.
    if (cmd.match.type === 'all') return true
    return false
  }
  if (cmd.match.type === 'all') return true
  const allowed = new Set(normalizeExtensions(cmd.match.extensions))
  if (allowed.size === 0) return false
  return paths.every((p) => allowed.has(extensionOf(p)))
}

const TOKEN_RE = /\{paths\}|\{path\}|\{name\}|\{dir\}|"([^"\\]|\\.)*"|'([^'\\]|\\.)*'|[^\s]+/g

function replaceScalarTokens(text: string, path: string): string {
  const name = basenameOf(path)
  const dir = dirOf(path)
  return text
    .replaceAll('{path}', path)
    .replaceAll('{name}', name)
    .replaceAll('{dir}', dir)
}

/**
 * Expand an args template into argv. `{paths}` becomes one argument per path;
 * other tokens use the first selected path. No shell evaluation.
 */
export function expandArgsTemplate(template: string, paths: string[]): string[] {
  const trimmed = template.trim()
  if (!trimmed) {
    return paths.length > 0 ? [paths[0]!] : []
  }
  const first = paths[0] ?? ''
  const out: string[] = []
  const matches = trimmed.match(TOKEN_RE)
  if (!matches) return []

  for (const raw of matches) {
    if (raw === '{paths}') {
      out.push(...paths)
      continue
    }
    let piece = raw
    if (
      (piece.startsWith('"') && piece.endsWith('"')) ||
      (piece.startsWith("'") && piece.endsWith("'"))
    ) {
      piece = piece.slice(1, -1).replace(/\\(["'\\])/g, '$1')
    }
    if (piece === '{paths}') {
      out.push(...paths)
      continue
    }
    // If a single token embeds `{paths}` among text, expand paths joined — prefer
    // dedicated `{paths}` token; otherwise replace with first path only for safety.
    if (piece.includes('{paths}')) {
      for (const p of paths) {
        out.push(replaceScalarTokens(piece.replaceAll('{paths}', p), p))
      }
      continue
    }
    out.push(replaceScalarTokens(piece, first))
  }
  return out
}

export function newContextMenuCommandId(): string {
  return `cmc_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}
