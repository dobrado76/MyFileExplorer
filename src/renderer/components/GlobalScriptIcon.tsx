import { useEffect, useState, type JSX } from 'react'
import {
  SCRIPT_TOOLBAR_LUCIDE_COLOR,
  SCRIPT_TOOLBAR_LUCIDE_DEFAULT,
  type ScriptDefinition,
  type ScriptLanguage
} from '@shared/schemas/scripts'
import { normalizeIconPack } from '@shared/schemas/iconPack'
import { api, call } from '../lib/ipc'
import { packIconElement } from '../lib/iconPacks'
import { cacheQuickLaunchIconUrl } from './QuickLaunchIcon'
import { ShellIcon } from './ShellIcon'

function languageLucideName(language: ScriptLanguage): string {
  switch (language) {
    case 'powershell':
      return 'Terminal'
    case 'python':
      return 'FileCode'
    case 'cmd':
      return 'SquareTerminal'
    case 'bash':
      return 'Terminal'
  }
}

/** Toolbar glyph for a Global script (Lucide / Phosphor / Tabler / custom / file icon). */
export function GlobalScriptIcon({
  script,
  size = 16
}: {
  script: ScriptDefinition
  size?: number
}): JSX.Element {
  const customId = script.iconKind === 'custom' ? script.iconId : undefined
  const [url, setUrl] = useState<string | null>(null)
  const shellPath =
    script.sourceKind === 'external' && script.externalPath?.trim()
      ? script.externalPath.trim()
      : ''
  const pack = normalizeIconPack(script.lucidePack)
  const color = script.lucideColor || SCRIPT_TOOLBAR_LUCIDE_COLOR

  useEffect(() => {
    if (!customId) {
      setUrl(null)
      return
    }
    let live = true
    void call(api.quickLaunch.iconUrl({ id: customId }))
      .then((r) => {
        if (!live) return
        if (r.mediaUrl) {
          cacheQuickLaunchIconUrl(customId, r.mediaUrl)
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

  if (script.iconKind === 'lucide') {
    const el = packIconElement(pack, script.lucideName || SCRIPT_TOOLBAR_LUCIDE_DEFAULT, {
      size,
      color,
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

  if (shellPath) {
    return <ShellIcon path={shellPath} size={size} />
  }

  const fallback = packIconElement('lucide', languageLucideName(script.language), {
    size,
    color,
    strokeWidth: 2,
    className: 'quick-launch-lucide-icon',
    style: { width: size, height: size, flexShrink: 0 },
    'aria-hidden': true
  })
  if (fallback) return fallback

  const scroll = packIconElement('lucide', SCRIPT_TOOLBAR_LUCIDE_DEFAULT, {
    size,
    color: SCRIPT_TOOLBAR_LUCIDE_COLOR,
    strokeWidth: 2,
    className: 'quick-launch-lucide-icon',
    style: { width: size, height: size, flexShrink: 0 },
    'aria-hidden': true
  })
  if (scroll) return scroll
  return <span className="global-script-icon-fallback" aria-hidden style={{ width: size, height: size }} />
}
