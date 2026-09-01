/** Built-in context-menu verbs the user can hide in Settings → Context menu. */

export const CONTEXT_MENU_BUILTIN_IDS = [
  'undo',
  'redo',
  'open',
  'open-with-default',
  'open-file-path',
  'open-file-in-new-tab',
  'edit-image',
  'version-control',
  'generate-video-preview',
  'open-in-new-tab',
  'open-as-root-in-new-tab',
  'add',
  'pin-quick-access',
  'customize-folder',
  'remove-folder-customization',
  'metadata-set',
  'remove-metadata-assignment',
  'video-previews',
  'cut',
  'copy',
  'paste',
  'paste-special',
  'paste-into-folder',
  'file-tools',
  'scripts',
  'rename',
  'power-rename',
  'delete',
  'delete-permanently',
  'compress-zip',
  'extract-zip',
  'copy-path',
  'copy-name',
  'show-in-system-explorer',
  'open-command-line',
  'hide-from-view',
  'search-index',
  'computer-manager',
  'device-manager',
  'control-panel',
  'map-network-drive',
  'disconnect-network-drive',
  'network-refresh',
  'item-note',
  'user-metadata',
  'item-icon',
  'git',
  'alternate-streams',
  'calculate-folder-statistics',
  'properties'
] as const

export type ContextMenuBuiltinId = (typeof CONTEXT_MENU_BUILTIN_IDS)[number]

export type ContextMenuBuiltinDef = {
  id: ContextMenuBuiltinId
  /** Settings checkbox label. */
  label: string
  /** Short hint under the label. */
  hint?: string
}

/** Ordered catalog for the Settings → Context menu → Built-in checklist. */
export const CONTEXT_MENU_BUILTINS: ContextMenuBuiltinDef[] = [
  { id: 'undo', label: 'Undo', hint: 'When an undo action is available' },
  { id: 'redo', label: 'Redo', hint: 'When a redo action is available' },
  { id: 'open', label: 'Open' },
  { id: 'open-with-default', label: 'Open with default app', hint: 'Files only' },
  { id: 'open-file-path', label: 'Open File Path', hint: 'Search results' },
  { id: 'open-file-in-new-tab', label: 'Open File in new tab', hint: 'Search results' },
  { id: 'edit-image', label: 'Edit image…' },
  { id: 'version-control', label: 'Version Control', hint: 'Image ADS versions' },
  { id: 'generate-video-preview', label: 'Generate video preview(s)' },
  { id: 'open-in-new-tab', label: 'Open in new tab', hint: 'Folders' },
  { id: 'open-as-root-in-new-tab', label: 'Open as root in new tab', hint: 'Folders' },
  { id: 'add', label: 'Add', hint: 'New folder / file types' },
  { id: 'pin-quick-access', label: 'Pin / Unpin Quick access', hint: 'Folders' },
  { id: 'customize-folder', label: 'Customize this folder' },
  { id: 'remove-folder-customization', label: 'Remove folder customization' },
  { id: 'metadata-set', label: 'Metadata set…', hint: 'Assign set / No metadata to folder' },
  {
    id: 'remove-metadata-assignment',
    label: 'Remove explicit metadata assignment',
    hint: 'Return to inherited / default'
  },
  { id: 'video-previews', label: 'Video previews', hint: 'Folder / empty pane submenu' },
  { id: 'cut', label: 'Cut' },
  { id: 'copy', label: 'Copy' },
  { id: 'paste', label: 'Paste', hint: 'Empty pane background' },
  { id: 'paste-special', label: 'Paste Special', hint: 'Non-file clipboard formats' },
  { id: 'paste-into-folder', label: 'Paste into folder' },
  {
    id: 'file-tools',
    label: 'File Tools',
    hint: 'Copy To… / Move To… / Change Icon…'
  },
  {
    id: 'scripts',
    label: 'Scripts',
    hint: 'Saved local scripts + Generate / Manage (D51). Only appears when Settings → Scripting and AI is on.'
  },
  { id: 'rename', label: 'Rename' },
  { id: 'power-rename', label: 'Power Rename…' },
  { id: 'delete', label: 'Delete' },
  { id: 'delete-permanently', label: 'Delete permanently' },
  { id: 'compress-zip', label: 'Compress to ZIP file' },
  { id: 'extract-zip', label: 'Extract All…' },
  { id: 'copy-path', label: 'Copy path' },
  { id: 'copy-name', label: 'Copy name' },
  { id: 'show-in-system-explorer', label: 'Show in system Explorer' },
  {
    id: 'open-command-line',
    label: 'Open Command Line here',
    hint: 'Folders — cmd or PowerShell (Settings → Behavior); click = current user; Shift+click = Administrator'
  },
  { id: 'hide-from-view', label: 'Hide from view' },
  { id: 'search-index', label: 'Search index actions', hint: 'Add / remove / index this drive' },
  {
    id: 'computer-manager',
    label: 'Computer Manager',
    hint: 'Drives header — Windows Computer Management (This PC → Manage)'
  },
  {
    id: 'device-manager',
    label: 'Device Manager',
    hint: 'Drives header — Windows Device Manager'
  },
  {
    id: 'control-panel',
    label: 'Control Panel',
    hint: 'Drives header — classic Control Panel'
  },
  { id: 'map-network-drive', label: 'Map network drive…' },
  { id: 'disconnect-network-drive', label: 'Disconnect network drive', hint: 'Mapped letter or system dialog' },
  { id: 'network-refresh', label: 'Refresh Network', hint: 'Re-run LAN discovery' },
  { id: 'item-note', label: 'Note…', hint: 'NTFS note on the file or folder' },
  {
    id: 'user-metadata',
    label: 'Metadata…',
    hint: 'User-defined structured fields (D70)'
  },
  { id: 'item-icon', label: 'Set icon…', hint: 'Lucide, custom image, or tint the Windows icon' },
  {
    id: 'git',
    label: 'Git',
    hint: 'Stage / unstage / discard / gitignore and repo helpers when Settings → Git is enabled'
  },
  { id: 'alternate-streams', label: 'Alternate streams…' },
  {
    id: 'calculate-folder-statistics',
    label: 'Calculate Statistics',
    hint: 'Folders — attach FileCount / FolderCount ADS'
  },
  { id: 'properties', label: 'Properties' }
]

const BUILTIN_ID_SET = new Set<string>(CONTEXT_MENU_BUILTIN_IDS)

export function isContextMenuBuiltinId(id: string): id is ContextMenuBuiltinId {
  return BUILTIN_ID_SET.has(id)
}

/** Empty / unknown ids ignored. Missing from the list ⇒ shown (default on). */
export function sanitizeHiddenBuiltins(raw: unknown): ContextMenuBuiltinId[] {
  if (!Array.isArray(raw)) return []
  const out: ContextMenuBuiltinId[] = []
  const seen = new Set<string>()
  for (const item of raw) {
    if (typeof item !== 'string' || !isContextMenuBuiltinId(item) || seen.has(item)) continue
    seen.add(item)
    out.push(item)
  }
  return out
}

export function isContextMenuBuiltinEnabled(
  hiddenBuiltins: readonly string[] | undefined,
  id: ContextMenuBuiltinId
): boolean {
  if (!hiddenBuiltins?.length) return true
  return !hiddenBuiltins.includes(id)
}

/** Drop leading/trailing/duplicate separators after items were filtered out. */
export function collapseMenuSeparators<T extends { type: string }>(items: T[]): T[] {
  const out: T[] = []
  for (const it of items) {
    if (it.type === 'sep') {
      if (out.length === 0 || out[out.length - 1]!.type === 'sep') continue
      out.push(it)
      continue
    }
    out.push(it)
  }
  while (out.length > 0 && out[out.length - 1]!.type === 'sep') out.pop()
  return out
}

/** Settings / persisted layout entry: a built-in verb, enabled Discover verb, or separator. */
export type ContextMenuBuiltinLayoutEntry =
  | { type: 'item'; id: ContextMenuBuiltinId }
  | { type: 'discovered'; id: string }
  | { type: 'sep'; id: string }

let sepSeq = 0
export function newBuiltinLayoutSepId(): string {
  sepSeq += 1
  return `sep-${Date.now().toString(36)}-${sepSeq}`
}

/** Default order + grouping for Settings and runtime menus (D41). */
export const DEFAULT_CONTEXT_MENU_BUILTIN_LAYOUT: ContextMenuBuiltinLayoutEntry[] = [
  { type: 'item', id: 'undo' },
  { type: 'item', id: 'redo' },
  { type: 'sep', id: 'sep-default-1' },
  { type: 'item', id: 'open' },
  { type: 'item', id: 'open-with-default' },
  { type: 'item', id: 'open-file-path' },
  { type: 'item', id: 'open-file-in-new-tab' },
  { type: 'item', id: 'edit-image' },
  { type: 'item', id: 'version-control' },
  { type: 'item', id: 'generate-video-preview' },
  { type: 'sep', id: 'sep-default-2' },
  { type: 'item', id: 'open-in-new-tab' },
  { type: 'item', id: 'open-as-root-in-new-tab' },
  { type: 'sep', id: 'sep-default-3' },
  { type: 'item', id: 'add' },
  { type: 'item', id: 'pin-quick-access' },
  { type: 'item', id: 'customize-folder' },
  { type: 'item', id: 'remove-folder-customization' },
  { type: 'item', id: 'metadata-set' },
  { type: 'item', id: 'remove-metadata-assignment' },
  { type: 'item', id: 'video-previews' },
  { type: 'sep', id: 'sep-default-4' },
  { type: 'item', id: 'cut' },
  { type: 'item', id: 'copy' },
  { type: 'item', id: 'paste' },
  { type: 'item', id: 'paste-special' },
  { type: 'item', id: 'paste-into-folder' },
  { type: 'item', id: 'file-tools' },
  { type: 'item', id: 'scripts' },
  { type: 'sep', id: 'sep-default-5' },
  { type: 'item', id: 'rename' },
  { type: 'item', id: 'power-rename' },
  { type: 'item', id: 'delete' },
  { type: 'item', id: 'delete-permanently' },
  { type: 'sep', id: 'sep-default-6' },
  { type: 'item', id: 'compress-zip' },
  { type: 'item', id: 'extract-zip' },
  { type: 'sep', id: 'sep-default-7' },
  { type: 'item', id: 'copy-path' },
  { type: 'item', id: 'copy-name' },
  { type: 'item', id: 'show-in-system-explorer' },
  { type: 'item', id: 'open-command-line' },
  { type: 'item', id: 'hide-from-view' },
  { type: 'item', id: 'search-index' },
  { type: 'sep', id: 'sep-default-8' },
  { type: 'item', id: 'computer-manager' },
  { type: 'item', id: 'device-manager' },
  { type: 'item', id: 'control-panel' },
  { type: 'sep', id: 'sep-default-8b' },
  { type: 'item', id: 'map-network-drive' },
  { type: 'item', id: 'disconnect-network-drive' },
  { type: 'item', id: 'network-refresh' },
  { type: 'sep', id: 'sep-default-9' },
  { type: 'item', id: 'item-note' },
  { type: 'item', id: 'user-metadata' },
  { type: 'item', id: 'item-icon' },
  { type: 'item', id: 'git' },
  { type: 'item', id: 'alternate-streams' },
  { type: 'item', id: 'calculate-folder-statistics' },
  { type: 'item', id: 'properties' }
]

/** Properties stays last in layout (Windows File Explorer convention). */
function pinPropertiesLayoutLast(
  layout: ContextMenuBuiltinLayoutEntry[]
): ContextMenuBuiltinLayoutEntry[] {
  const idx = layout.findIndex((e) => e.type === 'item' && e.id === 'properties')
  if (idx < 0 || idx === layout.length - 1) return layout
  const props = layout[idx]!
  return [...layout.filter((_, i) => i !== idx), props]
}

/** This PC tools on the Drives header sit above Map network drive (Explorer-like). */
const DRIVES_HEADER_TOOLS: readonly ContextMenuBuiltinId[] = [
  'computer-manager',
  'device-manager',
  'control-panel'
]

function insertMissingBuiltin(
  layout: ContextMenuBuiltinLayoutEntry[],
  id: ContextMenuBuiltinId
): void {
  if ((DRIVES_HEADER_TOOLS as readonly string[]).includes(id)) {
    const mapIdx = layout.findIndex((e) => e.type === 'item' && e.id === 'map-network-drive')
    if (mapIdx >= 0) {
      layout.splice(mapIdx, 0, { type: 'item', id })
      return
    }
  }
  layout.push({ type: 'item', id })
}

/**
 * Prefer inserting user custom commands after the first of these that appears
 * in the ordered menu (matches historical “after Open with…” placement).
 */
const CUSTOM_COMMAND_INSERT_AFTER: readonly ContextMenuBuiltinId[] = [
  'open-with-default',
  'open',
  'generate-video-preview',
  'edit-image',
  'open-file-in-new-tab',
  'open-file-path',
  'open-as-root-in-new-tab',
  'open-in-new-tab'
]

/** Validate, dedupe, and append any missing built-in ids (catalog order). */
export function sanitizeBuiltinLayout(raw: unknown): ContextMenuBuiltinLayoutEntry[] {
  const out: ContextMenuBuiltinLayoutEntry[] = []
  const seenItems = new Set<string>()
  const seenSeps = new Set<string>()
  const seenDiscovered = new Set<string>()

  if (Array.isArray(raw)) {
    for (const entry of raw) {
      if (!entry || typeof entry !== 'object') continue
      const t = (entry as { type?: unknown }).type
      if (t === 'sep') {
        const rawId = (entry as { id?: unknown }).id
        const id =
          typeof rawId === 'string' && rawId.trim() ? rawId : newBuiltinLayoutSepId()
        if (seenSeps.has(id)) continue
        seenSeps.add(id)
        out.push({ type: 'sep', id })
        continue
      }
      if (t === 'discovered') {
        const id = (entry as { id?: unknown }).id
        if (typeof id !== 'string' || !id.trim() || seenDiscovered.has(id)) continue
        seenDiscovered.add(id)
        out.push({ type: 'discovered', id })
        continue
      }
      if (t === 'item') {
        const id = (entry as { id?: unknown }).id
        if (typeof id !== 'string' || !isContextMenuBuiltinId(id) || seenItems.has(id)) continue
        seenItems.add(id)
        out.push({ type: 'item', id })
      }
    }
  }

  for (const id of CONTEXT_MENU_BUILTIN_IDS) {
    if (seenItems.has(id)) continue
    seenItems.add(id)
    insertMissingBuiltin(out, id)
  }

  // Empty / junk-only input → ship the curated default (includes separators).
  if (!Array.isArray(raw) || raw.length === 0) {
    return DEFAULT_CONTEXT_MENU_BUILTIN_LAYOUT.slice()
  }

  return pinPropertiesLayoutLast(out)
}

/**
 * Reorder built-in / Discover menu rows per layout and inject layout separators.
 * Manual custom commands (no builtin / discoveredId) stay as a block after an open/edit anchor.
 * Hardcoded separators in `items` are discarded.
 */
export function applyBuiltinLayoutToMenu<
  T extends { type: string; builtin?: string; discoveredId?: string }
>(
  items: T[],
  layout: readonly (
    | { type: 'item'; id: string }
    | { type: 'discovered'; id: string }
    | { type: 'sep'; id: string }
  )[]
): T[] {
  const byId = new Map<string, T>()
  const byDiscovered = new Map<string, T>()
  const others: T[] = []
  for (const it of items) {
    if (it.type === 'sep') continue
    if (it.discoveredId) {
      if (!byDiscovered.has(it.discoveredId)) byDiscovered.set(it.discoveredId, it)
    } else if (it.builtin) {
      if (!byId.has(it.builtin)) byId.set(it.builtin, it)
    } else {
      others.push(it)
    }
  }

  const out: T[] = []
  let pendingSep = false
  let customsInjected = others.length === 0

  const pushSep = (): void => {
    if (out.length === 0 || out[out.length - 1]!.type === 'sep') return
    out.push({ type: 'sep' } as T)
  }

  const tryInjectCustoms = (afterBuiltinId: string | null): void => {
    if (customsInjected || afterBuiltinId == null) return
    if (!(CUSTOM_COMMAND_INSERT_AFTER as readonly string[]).includes(afterBuiltinId)) return
    const emittedIds = new Set(
      out.filter((x) => x.type !== 'sep' && x.builtin).map((x) => x.builtin!)
    )
    const firstAnchor = CUSTOM_COMMAND_INSERT_AFTER.find((id) => emittedIds.has(id))
    if (firstAnchor !== afterBuiltinId) return
    pushSep()
    for (const o of others) out.push(o)
    pendingSep = true
    customsInjected = true
  }

  for (const entry of layout) {
    if (entry.type === 'sep') {
      pendingSep = true
      continue
    }
    if (entry.type === 'discovered') {
      const item = byDiscovered.get(entry.id)
      if (!item) continue
      byDiscovered.delete(entry.id)
      if (pendingSep) pushSep()
      pendingSep = false
      out.push(item)
      continue
    }
    const item = byId.get(entry.id)
    if (!item) continue
    byId.delete(entry.id)
    if (pendingSep) pushSep()
    pendingSep = false
    out.push(item)
    tryInjectCustoms(entry.id)
  }

  for (const id of CONTEXT_MENU_BUILTIN_IDS) {
    const item = byId.get(id)
    if (!item) continue
    byId.delete(id)
    if (pendingSep) pushSep()
    pendingSep = false
    out.push(item)
    tryInjectCustoms(id)
  }

  for (const item of byDiscovered.values()) {
    if (pendingSep) pushSep()
    pendingSep = false
    out.push(item)
  }

  if (!customsInjected && others.length > 0) {
    pushSep()
    for (const o of others) out.push(o)
  }

  return pinPropertiesMenuItemLast(collapseMenuSeparators(out))
}

/** Properties stays last in the rendered menu (Windows File Explorer convention). */
function pinPropertiesMenuItemLast<T extends { type: string; builtin?: string }>(
  items: T[]
): T[] {
  const idx = items.findIndex((it) => it.type !== 'sep' && it.builtin === 'properties')
  if (idx < 0 || idx === items.length - 1) return items
  const props = items[idx]!
  return collapseMenuSeparators([...items.filter((_, i) => i !== idx), props])
}

/** Keep discovered layout rows that are still enabled; append any newly enabled at the end. */
export function syncDiscoveredInLayout(
  layout: readonly ContextMenuBuiltinLayoutEntry[],
  enabledIds: readonly string[]
): ContextMenuBuiltinLayoutEntry[] {
  const enabled = new Set(enabledIds)
  const out: ContextMenuBuiltinLayoutEntry[] = []
  const seen = new Set<string>()
  for (const e of layout) {
    if (e.type === 'discovered') {
      if (!enabled.has(e.id) || seen.has(e.id)) continue
      seen.add(e.id)
      out.push(e)
      continue
    }
    out.push(e)
  }
  for (const id of enabledIds) {
    if (seen.has(id)) continue
    seen.add(id)
    out.push({ type: 'discovered', id })
  }
  return out
}
