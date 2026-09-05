import { createElement, type ComponentType, type CSSProperties, type ReactElement } from 'react'
import * as PhosphorIcons from '@phosphor-icons/react'
import * as TablerIcons from '@tabler/icons-react'
import type { TabIcon } from '@shared/schemas/session'
import {
  ICON_PACK_IDS,
  ICON_PACK_LABELS,
  normalizeIconPack,
  type IconPackId
} from '@shared/schemas/iconPack'
import { isCustomTabIcon, isLucideTabIcon } from '@shared/tabIcons'
import {
  filterLucideIcons,
  humanizeIconName,
  LUCIDE_ICON_NAMES,
  resolveLucideIcon
} from './lucideIcons'

export {
  ICON_PACK_IDS,
  ICON_PACK_LABELS,
  normalizeIconPack,
  humanizeIconName,
  type IconPackId
}

export type PackIconProps = {
  size?: number
  color?: string
  strokeWidth?: number
  className?: string
  style?: CSSProperties
  'aria-hidden'?: boolean | 'true' | 'false'
}

export type PackIconComponent = ComponentType<PackIconProps>

type AnyComp = ComponentType<Record<string, unknown>>

function isIconComponent(value: unknown): value is AnyComp {
  if (typeof value === 'function') return true
  return typeof value === 'object' && value !== null && '$$typeof' in value
}

function buildPhosphorRegistry(): { names: string[]; map: Record<string, AnyComp> } {
  const map: Record<string, AnyComp> = {}
  for (const key of Object.keys(PhosphorIcons)) {
    if (key.endsWith('Icon') || key === 'IconContext' || key === 'IconBase') continue
    const Comp = (PhosphorIcons as Record<string, unknown>)[key]
    if (!isIconComponent(Comp)) continue
    map[key] = Comp
  }
  const names = Object.keys(map).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }))
  return { names, map }
}

function buildTablerRegistry(): { names: string[]; map: Record<string, AnyComp> } {
  const map: Record<string, AnyComp> = {}
  for (const key of Object.keys(TablerIcons)) {
    if (!key.startsWith('Icon') || key.length <= 4) continue
    const Comp = (TablerIcons as Record<string, unknown>)[key]
    if (!isIconComponent(Comp)) continue
    const name = key.slice(4)
    map[name] = Comp
  }
  const names = Object.keys(map).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }))
  return { names, map }
}

const phosphor = buildPhosphorRegistry()
const tabler = buildTablerRegistry()

const PACK_NAMES: Record<IconPackId, string[]> = {
  lucide: LUCIDE_ICON_NAMES,
  phosphor: phosphor.names,
  tabler: tabler.names
}

export function packIconNames(pack: IconPackId): string[] {
  return PACK_NAMES[pack]
}

export function resolvePackIcon(pack: IconPackId, name: string): PackIconComponent | null {
  if (!name) return null
  if (pack === 'lucide') {
    return resolveLucideIcon(name) as PackIconComponent | null
  }
  if (pack === 'phosphor') {
    const Comp = phosphor.map[name]
    return Comp ? (Comp as PackIconComponent) : null
  }
  const Comp = tabler.map[name]
  return Comp ? (Comp as PackIconComponent) : null
}

export function filterPackIcons(pack: IconPackId, query: string): string[] {
  if (pack === 'lucide') return filterLucideIcons(query)
  const names = PACK_NAMES[pack]
  const q = query.trim().toLowerCase().replace(/\s+/g, ' ')
  if (!q) return names
  const compact = q.replace(/\s+/g, '')
  return names.filter((name) => {
    const lower = name.toLowerCase()
    if (lower.includes(compact)) return true
    return humanizeIconName(name).includes(q)
  })
}

/** When switching packs, keep the name if it exists; else Folder or the first icon. */
export function coerceIconNameForPack(pack: IconPackId, name: string): string {
  if (resolvePackIcon(pack, name)) return name
  if (resolvePackIcon(pack, 'Folder')) return 'Folder'
  return PACK_NAMES[pack][0] ?? name
}

export function packIconElement(
  pack: IconPackId,
  name: string,
  props: PackIconProps
): ReactElement | null {
  const Comp = resolvePackIcon(pack, name)
  if (!Comp) return null
  if (pack === 'phosphor') {
    const { strokeWidth: _sw, ...rest } = props
    return createElement(Comp as AnyComp, { ...rest, weight: 'regular' })
  }
  return createElement(Comp, props)
}

export function isValidTabIcon(icon: TabIcon): icon is NonNullable<TabIcon> {
  if (isCustomTabIcon(icon)) return /^[a-zA-Z0-9_-]{4,80}$/.test(icon.id)
  if (isLucideTabIcon(icon)) {
    return resolvePackIcon(normalizeIconPack(icon.pack), icon.name) != null
  }
  return false
}
