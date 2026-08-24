import { useEffect, useState, type JSX } from 'react'
import type { CustomTabIcon } from '@shared/schemas/session'
import { tabCustomIconSizePx } from '@shared/tabIcons'
import { api, call } from '../lib/ipc'

const urlCache = new Map<string, string>()

export function cacheCustomTabIconUrl(id: string, mediaUrl: string): void {
  urlCache.set(id, mediaUrl)
}

export function TabCustomIcon({
  icon,
  className
}: {
  icon: CustomTabIcon
  className?: string
}): JSX.Element {
  const size = tabCustomIconSizePx(icon)
  const [url, setUrl] = useState(() => urlCache.get(icon.id) ?? null)

  useEffect(() => {
    const cached = urlCache.get(icon.id)
    if (cached) {
      setUrl(cached)
      return
    }
    let live = true
    void call(api.tabs.customIconUrl({ id: icon.id }))
      .then((r) => {
        if (!live) return
        if (r.mediaUrl) {
          urlCache.set(icon.id, r.mediaUrl)
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
  }, [icon.id])

  if (!url) {
    return (
      <span
        className={`tab-custom-icon-ph${className ? ` ${className}` : ''}`}
        style={{ width: size, height: size }}
        aria-hidden
      />
    )
  }

  return (
    <img
      className={`tab-custom-icon${className ? ` ${className}` : ''}`}
      src={url}
      width={size}
      height={size}
      alt=""
      draggable={false}
    />
  )
}
