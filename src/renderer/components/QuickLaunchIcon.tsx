import { useEffect, useState, type JSX } from 'react'
import {
  QUICK_LAUNCH_LUCIDE_COLOR,
  type QuickLaunchItem
} from '@shared/schemas/quickLaunch'
import { normalizeIconPack } from '@shared/schemas/iconPack'
import { api, call } from '../lib/ipc'
import { packIconElement } from '../lib/iconPacks'
import { ShellIcon } from './ShellIcon'

const urlCache = new Map<string, string>()

export function cacheQuickLaunchIconUrl(id: string, mediaUrl: string): void {
  urlCache.set(id, mediaUrl)
}

export function QuickLaunchIcon({
  item,
  size = 16
}: {
  item: QuickLaunchItem
  size?: number
}): JSX.Element {
  const customId = item.iconKind === 'custom' ? item.iconId : undefined
  const [url, setUrl] = useState(() => (customId ? (urlCache.get(customId) ?? null) : null))
  const [resolvedPath, setResolvedPath] = useState(item.path)

  useEffect(() => {
    if (!/%[A-Za-z0-9_]+%/.test(item.path)) {
      setResolvedPath(item.path)
      return
    }
    let live = true
    void call(api.app.expandPath({ path: item.path }))
      .then((r) => {
        if (live) setResolvedPath(r.path)
      })
      .catch(() => {
        if (live) setResolvedPath(item.path)
      })
    return () => {
      live = false
    }
  }, [item.path])

  useEffect(() => {
    if (!customId) {
      setUrl(null)
      return
    }
    const cached = urlCache.get(customId)
    if (cached) {
      setUrl(cached)
      return
    }
    let live = true
    void call(api.quickLaunch.iconUrl({ id: customId }))
      .then((r) => {
        if (!live) return
        if (r.mediaUrl) {
          urlCache.set(customId, r.mediaUrl)
          setUrl(r.mediaUrl)
        } else {
          setUrl(null)
        }
      })
      .catch(() => {
        if (live) setUrl(null)
      })
    return () => {
      live = false
    }
  }, [customId])

  if (item.iconKind === 'lucide') {
    const el = packIconElement(normalizeIconPack(item.lucidePack), item.lucideName ?? '', {
      size,
      color: item.lucideColor || QUICK_LAUNCH_LUCIDE_COLOR,
      strokeWidth: 2,
      className: 'quick-launch-lucide-icon',
      style: { width: size, height: size, flexShrink: 0 },
      'aria-hidden': true
    })
    if (el) return el
  }

  if (customId && url) {
    return (
      <img
        className="quick-launch-custom-icon"
        src={url}
        width={size}
        height={size}
        alt=""
        draggable={false}
      />
    )
  }

  return <ShellIcon path={resolvedPath} size={size} />
}
