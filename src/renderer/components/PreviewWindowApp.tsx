import { useEffect, useState, type JSX } from 'react'
import type { PreviewWindowTarget } from '@shared/schemas/preview'
import type { Settings } from '@shared/schemas/settings'
import { basename } from '../lib/paths'
import { api, call } from '../lib/ipc'
import { usePreviewFetch } from '../lib/usePreviewFetch'
import { PreviewView } from './preview/PreviewView'

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

/**
 * Detached preview window. Owns its own `preview:get` — do not call `app.ready()`
 * (that drains CLI/protocol opens meant for the main shell).
 */
export function PreviewWindowApp(): JSX.Element {
  const [target, setTarget] = useState<PreviewWindowTarget>({ path: null })
  const [autoplay, setAutoplay] = useState(false)

  useEffect(() => {
    void call(api.settings.get())
      .then((s) => {
        applyChromeSettings(s)
        setAutoplay(s.previewVideoAutoplay)
      })
      .catch(() => {
        document.documentElement.dataset['theme'] = 'dark'
      })
  }, [])

  useEffect(() => {
    let cancelled = false
    void api.preview.getTarget().then((res) => {
      if (!cancelled && res.ok) setTarget(res.value)
    })
    const unsub = api.onEvent((event) => {
      if (event.type === 'preview-target') setTarget(event.payload)
    })
    return () => {
      cancelled = true
      unsub()
    }
  }, [])

  const { model, loading, retryPlayableForce } = usePreviewFetch(
    target.path,
    target.ads,
    target.stamp ?? null
  )

  useEffect(() => {
    document.title = target.path ? basename(target.path) : 'Preview'
  }, [target.path])

  return (
    <PreviewView
      model={model}
      loading={loading}
      previewPath={target.path}
      previewVideoAutoplay={autoplay}
      onOpenPath={(path) => void api.shell.openPath({ path })}
      onExtractZip={(paths) => void api.fs.extractZip({ paths })}
      onRetryPlayableForce={retryPlayableForce}
    />
  )
}
