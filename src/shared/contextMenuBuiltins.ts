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
  'video-previews',
  'cut',
  'copy',
  'paste',
  'paste-into-folder',
  'file-tools',
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
  'map-network-drive',
  'disconnect-network-drive',
  'network-refresh',
  'alternate-streams',
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
  { id: 'video-previews', label: 'Video previews', hint: 'Folder / empty pane submenu' },
  { id: 'cut', label: 'Cut' },
  { id: 'copy', label: 'Copy' },
  { id: 'paste', label: 'Paste', hint: 'Empty pane background' },
  { id: 'paste-into-folder', label: 'Paste into folder' },
  {
    id: 'file-tools',
    label: 'File Tools',
    hint: 'Copy To… / Move To… / Change Icon…'
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
    hint: 'Folders — Terminal / PowerShell; Shift+click = Administrator'
  },
  { id: 'hide-from-view', label: 'Hide from view' },
  { id: 'search-index', label: 'Search index actions', hint: 'Add / remove / index this drive' },
  { id: 'map-network-drive', label: 'Map network drive…' },
  { id: 'disconnect-network-drive', label: 'Disconnect network drive', hint: 'Mapped letter or system dialog' },
  { id: 'network-refresh', label: 'Refresh Network', hint: 'Re-run LAN discovery' },
  { id: 'alternate-streams', label: 'Alternate streams…' },
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
