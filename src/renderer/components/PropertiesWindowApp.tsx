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

function isCombinedQuery(): boolean {
  try {
    return new URLSearchParams(window.location.search).get('combined') === '1'
  } catch {
    return false
  }
}

/**
 * Detached Properties window. Do not call `app.ready()` (that drains CLI/protocol
 * opens meant for the main shell).
 */
export function PropertiesWindowApp(): JSX.Element {
  const [path, setPath] = useState<string | null>(() => pathFromLocation())
  const [paths, setPaths] = useState<string[] | null>(null)
  const [platform, setPlatform] = useState('win32')
  const [ready, setReady] = useState(false)
  const [bootError, setBootError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const s = await call(api.settings.get())
        if (cancelled) return
        applyChromeSettings(s)
        useAppStore.setState({ settings: s })
      } catch {
        /* theme defaults OK */
      }
      if (typeof navigator !== 'undefined' && /windows/i.test(navigator.userAgent)) {
        setPlatform('win32')
      } else {
        setPlatform(typeof navigator !== 'undefined' ? 'linux' : 'win32')
      }

      try {
        const args = await call(api.properties.getWindowArgs())
        if (cancelled) return
        if (args.mode === 'combined' && args.paths.length > 0) {
          setPaths(args.paths)
          setPath(null)
        } else if (args.mode === 'single' && args.path) {
          setPath(args.path)
          setPaths(null)
        } else if (isCombinedQuery()) {
          setBootError('Missing combined selection.')
        } else if (!pathFromLocation()) {
          setBootError('Missing path.')
        }
      } catch {
        // Fall back to ?path= from the URL (single-item windows).
        if (!pathFromLocation() && !isCombinedQuery()) {
          setBootError('Missing path.')
        }
      }
      if (!cancelled) setReady(true)
    })()
    return () => {
      cancelled = true
    }
  }, [])

  if (!ready) {
    return (
      <div className="properties-window-root">
        <p className="dim" style={{ padding: 18 }}>
          Loading…
        </p>
      </div>
    )
  }

  if (bootError) {
    return (
      <div className="properties-window-root">
        <p className="dim" style={{ padding: 18 }}>
          {bootError}
        </p>
      </div>
    )
  }

  if (paths && paths.length > 1) {
    return <PropertiesPanel paths={paths} platform={platform} onClose={() => window.close()} />
  }

  if (path) {
    return <PropertiesPanel path={path} platform={platform} onClose={() => window.close()} />
  }

  return (
    <div className="properties-window-root">
      <p className="dim" style={{ padding: 18 }}>
        Missing path.
      </p>
    </div>
  )
}
