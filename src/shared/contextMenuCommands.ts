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
 * Also accepts Windows-style `%1` / `%*` as aliases for `{path}` / `{paths}`.
 */
export function expandArgsTemplate(template: string, paths: string[]): string[] {
  const trimmed = template
    .trim()
    .replace(/%\*/g, '{paths}')
    .replace(/%1/gi, '{path}')
    .replace(/%L/gi, '{path}')
    .replace(/%V/gi, '{dir}')
    .replace(/%W/gi, '{dir}')
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

/** Split a custom command label into submenu path segments (`\` delimiter). */
export function parseCommandLabelSegments(label: string): string[] {
  if (!label.includes('\\')) {
    const t = label.trim()
    return t ? [t] : []
  }
  const segs = label.split('\\').map((s) => s.trim()).filter(Boolean)
  return segs.length > 0 ? segs : [label.trim()].filter(Boolean)
}

/** Leaf text shown on the menu row (last `\` segment). */
export function commandMenuLeafLabel(label: string): string {
  const segs = parseCommandLabelSegments(label)
  return segs.length > 0 ? segs[segs.length - 1]! : label
}

type CommandMenuLeaf = { type: 'leaf'; cmd: ContextMenuCommand; label: string }
type CommandMenuFolder = { type: 'folder'; label: string; tree: CommandMenuTree }

export type CommandMenuTree = {
  children: Array<CommandMenuLeaf | CommandMenuFolder>
}

export function emptyCommandMenuTree(): CommandMenuTree {
  return { children: [] }
}

function findFolder(tree: CommandMenuTree, name: string): CommandMenuTree | null {
  for (const ch of tree.children) {
    if (ch.type === 'folder' && ch.label === name) return ch.tree
  }
  return null
}

function ensureFolder(tree: CommandMenuTree, name: string): CommandMenuTree {
  const existing = findFolder(tree, name)
  if (existing) return existing
  const sub = emptyCommandMenuTree()
  tree.children.push({ type: 'folder', label: name, tree: sub })
  return sub
}

/** Group enabled custom commands by `\`-delimited label paths (stable command order). */
export function buildCommandMenuTree(commands: readonly ContextMenuCommand[]): CommandMenuTree {
  const root = emptyCommandMenuTree()
  for (const cmd of commands) {
    const segs = parseCommandLabelSegments(cmd.label)
    if (segs.length === 0) continue
    let tree = root
    for (let i = 0; i < segs.length - 1; i++) {
      tree = ensureFolder(tree, segs[i]!)
    }
    tree.children.push({
      type: 'leaf',
      cmd,
      label: segs[segs.length - 1]!
    })
  }
  return root
}

/** Minimal submenu row shape for custom-command trees (renderer maps to its SubEntry). */
export type CommandMenuSubRow = {
  label: string
  action?: () => void
  items?: CommandMenuSubRow[]
}

function treeToSubRows(
  tree: CommandMenuTree,
  run: (cmd: ContextMenuCommand) => void
): CommandMenuSubRow[] {
  const out: CommandMenuSubRow[] = []
  for (const ch of tree.children) {
    if (ch.type === 'leaf') {
      out.push({ label: ch.label, action: () => run(ch.cmd) })
      continue
    }
    const nested = treeToSubRows(ch.tree, run)
    if (nested.length > 0) out.push({ label: ch.label, items: nested })
  }
  return out
}

export type CommandMenuBuiltRow =
  | { type: 'item'; label: string; action: () => void }
  | { type: 'submenu'; label: string; items: CommandMenuSubRow[] }

/** Flatten a command tree into top-level menu rows (nested submenus in `items`). */
export function buildCommandMenuRows(
  commands: readonly ContextMenuCommand[],
  run: (cmd: ContextMenuCommand) => void
): CommandMenuBuiltRow[] {
  const root = buildCommandMenuTree(commands)
  const out: CommandMenuBuiltRow[] = []
  for (const ch of root.children) {
    if (ch.type === 'leaf') {
      out.push({ type: 'item', label: ch.label, action: () => run(ch.cmd) })
      continue
    }
    const items = treeToSubRows(ch.tree, run)
    if (items.length > 0) out.push({ type: 'submenu', label: ch.label, items })
  }
  return out
}
