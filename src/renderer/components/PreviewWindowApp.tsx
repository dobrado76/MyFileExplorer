import { Component, useEffect, useState, type ErrorInfo, type JSX, type ReactNode } from 'react'
import type { PreviewWindowTarget } from '@shared/schemas/preview'
import type { Settings } from '@shared/schemas/settings'
import { basename } from '../lib/paths'
import { api, call } from '../lib/ipc'
import { CompressIcon, ExpandIcon } from '../lib/icons'
import { usePreviewFetch } from '../lib/usePreviewFetch'
import { PreviewView } from './preview/PreviewView'

class PreviewErrorBoundary extends Component<
  { resetKey: string; children: ReactNode },
  { failed: boolean }
> {
  override state = { failed: false }

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true }
  }

  override componentDidCatch(err: Error, info: ErrorInfo): void {
    console.error('preview window render failed', err, info.componentStack)
  }

  override componentDidUpdate(prev: { resetKey: string }): void {
    if (prev.resetKey !== this.props.resetKey && this.state.failed) {
      this.setState({ failed: false })
    }
  }

  override render(): ReactNode {
    if (this.state.failed) {
      return <div className="preview-empty">Preview failed. Select another file.</div>
    }
    return this.props.children
  }
}

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
  const [zen, setZen] = useState(false)
  const [textWordWrap, setTextWordWrap] = useState(false)

  useEffect(() => {
    void call(api.settings.get())
      .then((s) => {
        applyChromeSettings(s)
        setAutoplay(s.previewVideoAutoplay)
        setZen(s.previewWindowZen === true)
        setTextWordWrap(s.previewTextWordWrap === true)
      })
      .catch(() => {
        document.documentElement.dataset['theme'] = 'dark'
      })
  }, [])

  const toggleZen = (): void => {
    const next = !zen
    setZen(next)
    void api.settings.set({ previewWindowZen: next })
  }

  const toggleWordWrap = (): void => {
    const next = !textWordWrap
    setTextWordWrap(next)
    void api.settings.set({ previewTextWordWrap: next })
  }

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

  const resetKey = `${target.path ?? ''}|${target.ads ?? ''}|${target.stamp ?? ''}`

  return (
    <PreviewErrorBoundary resetKey={resetKey}>
      <PreviewView
        model={model}
        loading={loading}
        previewPath={target.path}
        previewVideoAutoplay={autoplay}
        zen={zen}
        textWordWrap={textWordWrap}
        onToggleTextWordWrap={toggleWordWrap}
        headerActions={
          <button
            type="button"
            className={`icon-btn preview-zen-btn${zen ? ' active' : ''}`}
            aria-label={zen ? 'Exit Zen mode' : 'Zen mode'}
            aria-pressed={zen}
            title={zen ? 'Exit Zen mode' : 'Zen mode — hide details'}
            onClick={toggleZen}
          >
            {zen ? <CompressIcon size={16} /> : <ExpandIcon size={16} />}
          </button>
        }
        onOpenPath={(path) => void api.shell.openPath({ path })}
        onExtractZip={(paths) => void api.fs.extractZip({ paths })}
        onRetryPlayableForce={retryPlayableForce}
      />
    </PreviewErrorBoundary>
  )
}
