import type { TabIcon } from './schemas/session'

/** Lucide defaults for new tabs (D32). User can still change or clear. */
export const DEFAULT_TAB_ICONS = {
  computer: { name: 'Monitor', color: '#60a5fa' },
  drive: { name: 'HardDrive', color: '#94a3b8' },
  folder: { name: 'Folder', color: '#fbbf24' }
} as const satisfies Record<string, NonNullable<TabIcon>>

/** `C:\` / `C:` — not a UNC share or a normal folder. */
export function isWindowsDriveRoot(path: string): boolean {
  const n = path.replace(/\//g, '\\').replace(/[\\/]+$/, '')
  return /^[a-zA-Z]:$/i.test(n)
}

/**
 * Icon for a newly opened tab.
 * - Unscoped (Computer / This PC tree) → Monitor, blue
 * - Scoped drive root → HardDrive, gray
 * - Scoped folder (or remote) → Folder, Windows yellow
 */
export function defaultTabIcon(_path: string, rootPath?: string | null): NonNullable<TabIcon> {
  const scope = rootPath?.trim() ? rootPath : null
  if (scope) {
    if (isWindowsDriveRoot(scope) || scope === '/') return DEFAULT_TAB_ICONS.drive
    return DEFAULT_TAB_ICONS.folder
  }
  return DEFAULT_TAB_ICONS.computer
}
