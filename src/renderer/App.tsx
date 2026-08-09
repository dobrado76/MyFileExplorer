import { useEffect, useRef, type JSX } from 'react'
import { useAppStore } from './store/appStore'
import { ExplorerShell } from './screens/ExplorerShell'

export function App(): JSX.Element {
  const booted = useAppStore((s) => s.booted)
  const settings = useAppStore((s) => (s.booted ? s.settings : null))
  const bootStarted = useRef(false)

  useEffect(() => {
    if (!bootStarted.current) {
      bootStarted.current = true
      void useAppStore.getState().boot()
    }
  }, [])

  // Apply theme + font tokens live.
  useEffect(() => {
    if (!settings) return
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
  }, [settings])

  if (!booted) {
    return (
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100%',
          color: 'var(--text-dim)'
        }}
      >
        Loading…
      </div>
    )
  }
  return <ExplorerShell />
}
