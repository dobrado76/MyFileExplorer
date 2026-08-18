import { normalizeExtensions } from './contextMenuCommands'
import type { ScriptDefinition, ScriptScope } from './schemas/scripts'

function extensionOf(path: string): string {
  const base = path.replace(/[\\/]+$/, '')
  const name = base.includes('\\') ? base.slice(base.lastIndexOf('\\') + 1) : base
  const slash = name.includes('/') ? name.slice(name.lastIndexOf('/') + 1) : name
  const dot = slash.lastIndexOf('.')
  if (dot <= 0 || dot === slash.length - 1) return ''
  return slash.slice(dot + 1).toLowerCase()
}

export type ScriptMenuContext = {
  /** Current folder (empty pane or tree folder). */
  folderPath: string | null
  selectedPaths: string[]
  /** Uniform kind of the selection; mixed selections only match folder-or-selection scripts. */
  selectionKind: 'file' | 'folder' | 'mixed' | 'empty'
}

export function scriptHasScope(script: Pick<ScriptDefinition, 'scopes'>, scope: ScriptScope): boolean {
  return script.scopes.includes(scope)
}

/**
 * Whether a saved script should appear on the context Scripts menu.
 * Folder-scoped items show for the current folder / a single folder.
 * Selection-scoped items require a non-empty selection and optional extension / min-count filters.
 */
export function scriptMatchesMenu(
  script: Pick<
    ScriptDefinition,
    'contextMenuEnabled' | 'scopes' | 'matchExtensions' | 'minSelection'
  >,
  ctx: ScriptMenuContext
): boolean {
  if (!script.contextMenuEnabled) return false

  if (ctx.selectionKind === 'empty') {
    return scriptHasScope(script, 'folder') && !!ctx.folderPath
  }

  const selected = ctx.selectedPaths
  if (selected.length === 0) {
    return scriptHasScope(script, 'folder') && !!ctx.folderPath
  }

  const folderOk = scriptHasScope(script, 'folder') && ctx.selectionKind === 'folder'
  const selectionOk = scriptHasScope(script, 'selection')
  if (!folderOk && !selectionOk) return false

  if (selectionOk) {
    if (script.minSelection > 0 && selected.length < script.minSelection) return false
    const exts = normalizeExtensions(script.matchExtensions)
    if (exts.length > 0) {
      if (ctx.selectionKind !== 'file') return false
      const allowed = new Set(exts)
      if (!selected.every((p) => allowed.has(extensionOf(p)))) return false
    }
    return true
  }

  return folderOk
}

export function groupScriptsByCategory<T extends { category?: string; name: string }>(
  scripts: T[]
): { category: string; items: T[] }[] {
  const map = new Map<string, T[]>()
  for (const s of scripts) {
    const key = (s.category ?? '').trim()
    const list = map.get(key)
    if (list) list.push(s)
    else map.set(key, [s])
  }
  const keys = [...map.keys()].sort((a, b) => {
    if (!a) return 1
    if (!b) return -1
    return a.localeCompare(b, undefined, { sensitivity: 'base' })
  })
  return keys.map((category) => ({
    category,
    items: (map.get(category) ?? []).slice().sort((a, b) =>
      a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
    )
  }))
}
