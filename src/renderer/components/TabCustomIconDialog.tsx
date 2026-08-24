import { useEffect, useState, type JSX } from 'react'
import { TAB_CUSTOM_ICON_SIZES, type CustomTabIcon } from '@shared/schemas/session'
import { isCustomTabIcon } from '@shared/tabIcons'
import { useAppStore } from '../store/appStore'
import { api, call, IpcError } from '../lib/ipc'
import { TabCustomIcon, cacheCustomTabIconUrl } from './TabCustomIcon'

export function TabCustomIconDialog({ tabId }: { tabId: string }): JSX.Element | null {
  const tab = useAppStore((s) => s.tabs.find((t) => t.id === tabId))
  const setTabIcon = useAppStore((s) => s.setTabIcon)
  const closeDialog = useAppStore((s) => s.closeDialog)
  const openDialog = useAppStore((s) => s.openDialog)

  const existing = tab && isCustomTabIcon(tab.icon) ? tab.icon : null
  const [id, setId] = useState<string | null>(existing?.id ?? null)
  const [showLabel, setShowLabel] = useState(existing?.showLabel ?? false)
  const [sizePx, setSizePx] = useState(existing?.sizePx ?? 32)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') closeDialog()
      e.stopPropagation()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [closeDialog])

  useEffect(() => {
    if (!tab) closeDialog()
  }, [tab, closeDialog])

  if (!tab) return null

  const previewIcon: CustomTabIcon | null = id
    ? { kind: 'custom', id, showLabel, sizePx }
    : null

  const browse = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      const result = await call(api.tabs.importCustomIcon())
      if (result.cancelled) return
      cacheCustomTabIconUrl(result.id, result.mediaUrl)
      setId(result.id)
    } catch (e) {
      setError(e instanceof IpcError ? e.message : 'Could not import that image')
    } finally {
      setBusy(false)
    }
  }

  const apply = (): void => {
    if (!id) return
    setTabIcon(tabId, { kind: 'custom', id, showLabel, sizePx })
    closeDialog()
  }

  const clear = (): void => {
    setTabIcon(tabId, null)
    closeDialog()
  }

  const backToLucide = (): void => {
    openDialog({ kind: 'tab-icon', tabId })
  }

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => e.target === e.currentTarget && closeDialog()}
    >
      <div className="modal modal-tab-custom-icon" role="dialog" aria-label="Custom tab icon">
        <div className="modal-title">Custom tab icon</div>
        <div className="modal-body modal-body-tab-custom-icon">
          <div className="tab-custom-icon-row">
            <div className="tab-custom-icon-preview" aria-hidden>
              {previewIcon ? (
                <TabCustomIcon icon={previewIcon} />
              ) : (
                <span className="dim">No image</span>
              )}
            </div>
            <div className="tab-custom-icon-meta">
              <p className="dim tab-custom-icon-hint">
                Choose a .png, .jpg, or .ico. It is resized and center-cropped to a square.
              </p>
              <button type="button" className="btn" onClick={() => void browse()} disabled={busy}>
                {busy ? 'Importing…' : id ? 'Change image…' : 'Choose image…'}
              </button>
              {error ? <div className="tab-custom-icon-error">{error}</div> : null}
            </div>
          </div>
          <label className="tab-custom-icon-check">
            <input
              type="checkbox"
              checked={showLabel}
              onChange={(e) => setShowLabel(e.target.checked)}
            />
            Show label
          </label>
          <fieldset className="tab-custom-icon-sizes">
            <legend>Icon size</legend>
            <div className="tab-custom-icon-size-row">
              {TAB_CUSTOM_ICON_SIZES.map((n) => (
                <button
                  key={n}
                  type="button"
                  className={`tab-custom-icon-size${sizePx === n ? ' active' : ''}`}
                  aria-pressed={sizePx === n}
                  onClick={() => setSizePx(n)}
                >
                  {n}
                </button>
              ))}
            </div>
          </fieldset>
        </div>
        <div className="modal-actions">
          <button
            type="button"
            className="btn modal-action-start"
            onClick={clear}
            disabled={!tab.icon}
          >
            Clear icon
          </button>
          <button type="button" className="btn" onClick={backToLucide}>
            Lucide icons…
          </button>
          <button type="button" className="btn" onClick={closeDialog}>
            Cancel
          </button>
          <button type="button" className="btn primary" onClick={apply} disabled={!id}>
            Apply
          </button>
        </div>
      </div>
    </div>
  )
}
