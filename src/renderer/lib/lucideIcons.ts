import { icons, type LucideIcon, type LucideProps } from 'lucide-react'
import type { TabIcon } from '@shared/schemas/session'
import { isCustomTabIcon, isLucideTabIcon } from '@shared/tabIcons'

/** All PascalCase Lucide icon names available in the picker. */
export const LUCIDE_ICON_NAMES: string[] = Object.keys(icons).sort((a, b) =>
  a.localeCompare(b, undefined, { sensitivity: 'base' })
)

const iconMap = icons as Record<string, LucideIcon>

function isLucideIcon(value: unknown): value is LucideIcon {
  // Lucide exports forwardRef exotic components (typeof === 'object'), not plain functions.
  if (typeof value === 'function') return true
  return typeof value === 'object' && value !== null && '$$typeof' in value
}

export function resolveLucideIcon(name: string): LucideIcon | null {
  const Comp = iconMap[name]
  return isLucideIcon(Comp) ? Comp : null
}

/** "FolderOpen" → "folder open" for search/labels. */
export function humanizeIconName(name: string): string {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .toLowerCase()
}

export function filterLucideIcons(query: string): string[] {
  const q = query.trim().toLowerCase().replace(/\s+/g, ' ')
  if (!q) return LUCIDE_ICON_NAMES
  const compact = q.replace(/\s+/g, '')
  return LUCIDE_ICON_NAMES.filter((name) => {
    const lower = name.toLowerCase()
    if (lower.includes(compact)) return true
    return humanizeIconName(name).includes(q)
  })
}

export function isValidTabIcon(icon: TabIcon): icon is NonNullable<TabIcon> {
  if (isCustomTabIcon(icon)) return /^[a-zA-Z0-9_-]{4,80}$/.test(icon.id)
  if (isLucideTabIcon(icon)) return resolveLucideIcon(icon.name) != null
  return false
}

export type { LucideProps }
