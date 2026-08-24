import { createElement, type JSX } from 'react'
import type { TabIcon } from '@shared/schemas/session'
import { isCustomTabIcon, isLucideTabIcon } from '@shared/tabIcons'
import { resolveLucideIcon } from '../lib/lucideIcons'
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
  const Comp = resolveLucideIcon(icon.name)
  if (!Comp) return null
  return createElement(Comp, {
    size,
    color: icon.color,
    strokeWidth: 2,
    'aria-hidden': true,
    className: 'tab-lucide-icon'
  })
}
