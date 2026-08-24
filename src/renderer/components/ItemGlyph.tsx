import { createElement, type JSX, type ReactNode } from 'react'
import type { ItemAdsRecord } from '@shared/schemas/itemAds'
import { resolveLucideIcon } from '../lib/lucideIcons'
import { ShellIcon } from './ShellIcon'

/** Tint only opaque shell-icon pixels (transparent areas stay clear). */
export function ShellTint({ color, children }: { color: string; children: ReactNode }): JSX.Element {
  const id = `mfe-shell-tint-${color.replace(/[^0-9a-fA-F]/g, '').toLowerCase()}`
  return (
    <span className="item-shell-tint">
      <svg className="item-shell-tint-defs" width="0" height="0" aria-hidden>
        <filter id={id} x="0" y="0" width="1" height="1" colorInterpolationFilters="sRGB">
          <feColorMatrix
            in="SourceGraphic"
            type="saturate"
            values="0"
            result="gray"
          />
          <feFlood floodColor={color} result="flood" />
          <feBlend in="flood" in2="gray" mode="color" result="tinted" />
          <feComposite in="tinted" in2="SourceAlpha" operator="in" />
        </filter>
      </svg>
      <span className="item-shell-tint-gfx" style={{ filter: `url(#${id})` }}>
        {children}
      </span>
    </span>
  )
}

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
