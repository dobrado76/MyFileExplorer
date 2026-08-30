import { createElement, type JSX } from 'react'
import type { ItemAdsRecord } from '@shared/schemas/itemAds'
import { resolveLucideIcon } from '../lib/lucideIcons'
import { ShellIcon, ShellTint } from './ShellIcon'

type Props = {
  path: string
  size: number
  isDir?: boolean
  renaming?: boolean
  overlay?: ItemAdsRecord | null
}

export function lookupItemAds(
  path: string,
  byPath: Record<string, ItemAdsRecord>
): ItemAdsRecord | null {
  return byPath[path] ?? null
}

/** File/folder glyph: Lucide or custom image replace the shell icon; shell+tint wraps it. */
export function ItemGlyph({ path, size, isDir, renaming, overlay }: Props): JSX.Element {
  const icon = overlay?.icon ?? null
  if (icon?.kind === 'lucide') {
    const Lucide = resolveLucideIcon(icon.name)
    if (Lucide) {
      return createElement(Lucide, {
        size,
        color: icon.color,
        strokeWidth: 2,
        className: 'item-lucide-icon',
        style: { width: size, height: size, flexShrink: 0 }
      })
    }
  }
  if (icon?.kind === 'custom' && overlay?.iconPngBase64) {
    return (
      <img
        className="item-custom-icon"
        src={`data:image/png;base64,${overlay.iconPngBase64}`}
        width={size}
        height={size}
        alt=""
        draggable={false}
        style={{ width: size, height: size, flexShrink: 0, objectFit: 'cover' }}
      />
    )
  }
  const shell = <ShellIcon path={path} size={size} isDir={isDir} renaming={renaming} />
  if (icon?.kind === 'shell') {
    return <ShellTint color={icon.color}>{shell}</ShellTint>
  }
  return shell
}
