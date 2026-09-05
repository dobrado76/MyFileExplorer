import { type JSX } from 'react'
import type { TabIcon } from '@shared/schemas/session'
import { isCustomTabIcon, isLucideTabIcon, tabIconPack } from '@shared/tabIcons'
import { packIconElement } from '../lib/iconPacks'
import { TabCustomIcon } from './TabCustomIcon'

export function TabLucideIcon({
  icon,
  size = 14
}: {
  icon: TabIcon
  size?: number
}): JSX.Element | null {
  if (!icon) return null
  if (isCustomTabIcon(icon)) return <TabCustomIcon icon={icon} />
  if (!isLucideTabIcon(icon)) return null
  const el = packIconElement(tabIconPack(icon), icon.name, {
    size,
    color: icon.color,
    strokeWidth: 2,
    'aria-hidden': true,
    className: 'tab-lucide-icon'
  })
  return el
}
