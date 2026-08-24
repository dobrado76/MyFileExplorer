import type { CustomTabIcon, LucideTabIcon, TabIcon } from './schemas/session'
import { TAB_CUSTOM_ICON_SIZES } from './schemas/session'

/** Stored PNG edge — display size is CSS (`sizePx`). */
export const CUSTOM_TAB_ICON_STORE_PX = 128

export type { CustomTabIcon, LucideTabIcon }

export function isCustomTabIcon(icon: TabIcon): icon is CustomTabIcon {
  return icon != null && 'kind' in icon && icon.kind === 'custom'
}

export function isLucideTabIcon(icon: TabIcon): icon is LucideTabIcon {
  return icon != null && !isCustomTabIcon(icon)
}

/** Icon-only chrome: custom image with the label hidden. */
export function isIconOnlyTab(icon: TabIcon): boolean {
  return isCustomTabIcon(icon) && icon.showLabel === false
}

export function tabIconShowLabel(icon: TabIcon): boolean {
  if (!icon) return true
  if (isCustomTabIcon(icon)) return icon.showLabel !== false
  return true
}

export function tabCustomIconSizePx(icon: CustomTabIcon): number {
  const n = icon.sizePx
  if (TAB_CUSTOM_ICON_SIZES.includes(n as (typeof TAB_CUSTOM_ICON_SIZES)[number])) return n
  if (n >= 16 && n <= 64) return n
  return 32
}

/**
 * Largest centered square in the source (cover-crop). After this extract,
 * resize the square to `dest`×`dest`.
 */
export function coverCropRect(
  srcW: number,
  srcH: number
): { left: number; top: number; width: number; height: number } {
  const w = Math.max(1, srcW)
  const h = Math.max(1, srcH)
  const side = Math.min(w, h)
  return {
    left: (w - side) / 2,
    top: (h - side) / 2,
    width: side,
    height: side
  }
}

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
