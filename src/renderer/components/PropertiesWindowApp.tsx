import { useEffect, useState, type JSX } from 'react'
import type { Settings } from '@shared/schemas/settings'
import { api, call } from '../lib/ipc'
import { useAppStore } from '../store/appStore'
import { PropertiesPanel } from './PropertiesPanel'

function applyChromeSettings(settings: Settings): void {
  const rootEl = document.documentElement
  rootEl.dataset['theme'] = settings.theme === 'custom' ? 'dark' : settings.theme
  const custom = settings.theme === 'custom' ? settings.customTheme : null
  const vars: Record<string, string | null> = {
    '--bg': custom?.bg ?? null,
    '--bg-elevated': custom?.bgElevated ?? null,
    '--bg-panel': custom?.bg ?? null,
    '--border': custom?.border ?? null,
    '--text': custom?.text ?? null,
    '--text-dim': custom?.textDim ?? null,
    '--accent': custom?.accent ?? null
  }
  for (const [k, v] of Object.entries(vars)) {
    if (v) rootEl.style.setProperty(k, v)
    else rootEl.style.removeProperty(k)
  }
  rootEl.style.setProperty('--font-family', `'${settings.fontFamily}', system-ui, sans-serif`)
  rootEl.style.setProperty('--font-size', `${settings.fontSizePx}px`)
  rootEl.style.setProperty('--icon-size', `${settings.iconSizePx}px`)
}

function pathFromLocation(): string | null {
  try {
    const q = new URLSearchParams(window.location.search)
    const p = q.get('path')
    return p && p.trim() ? p : null
  } catch {
    return null
  }
}

/**
 * Detached Properties window. Do not call `app.ready()` (that drains CLI/protocol
 * opens meant for the main shell).
 */
export function PropertiesWindowApp(): JSX.Element {
  const [path] = useState(() => pathFromLocation())
  const [platform, setPlatform] = useState('win32')
  const [ready, setReady] = useState(false)

  useEffect(() => {
    let cancelled = false
    void call(api.settings.get())
      .then((s) => {
        if (cancelled) return
        applyChromeSettings(s)
        useAppStore.setState({ settings: s })
        setReady(true)
      })
      .catch(() => {
        if (!cancelled) setReady(true)
      })
    // Platform without app.ready(): UA is enough for USN button visibility.
    if (typeof navigator !== 'undefined' && /windows/i.test(navigator.userAgent)) {
      setPlatform('win32')
    } else {
      setPlatform(typeof navigator !== 'undefined' ? 'linux' : 'win32')
    }
    return () => {
      cancelled = true
    }
  }, [])

  if (!path) {
    return (
      <div className="properties-window-root">
        <p className="dim" style={{ padding: 18 }}>
          Missing path.
        </p>
      </div>
    )
  }

  if (!ready) {
    return (
      <div className="properties-window-root">
        <p className="dim" style={{ padding: 18 }}>
          Loading…
        </p>
      </div>
    )
  }

  return (
    <PropertiesPanel
      path={path}
      platform={platform}
      onClose={() => window.close()}
    />
  )
}
