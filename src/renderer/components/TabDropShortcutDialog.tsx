import { useEffect, useMemo, useState, type JSX } from 'react'
import type { DropTransferMode } from '@shared/tabDropShortcut'
import {
  normalizeChordFromEvent,
  validateTabDropShortcut
} from '@shared/tabDropShortcut'
import { useAppStore } from '../store/appStore'

export function TabDropShortcutDialog({ tabId }: { tabId: string }): JSX.Element | null {
  const tab = useAppStore((s) => s.tabs.find((t) => t.id === tabId))
  const tabs = useAppStore((s) => s.tabs)
  const setTabDropShortcut = useAppStore((s) => s.setTabDropShortcut)
  const closeDialog = useAppStore((s) => s.closeDialog)

  const [chord, setChord] = useState<string | null>(() => tab?.dropShortcut ?? null)
  const [mode, setMode] = useState<DropTransferMode>(() => tab?.dropTransfer ?? 'auto')
  const [listening, setListening] = useState(() => !(tab?.dropShortcut))

  const otherTabs = useMemo(
    () =>
      tabs.map((t) => ({
        id: t.id,
        title: t.title,
        path: t.path,
        dropShortcut: t.dropShortcut
      })),
    [tabs]
  )

  const validation = useMemo(() => {
    if (chord == null) return null
    return validateTabDropShortcut(chord, otherTabs, tabId)
  }, [chord, otherTabs, tabId])

  useEffect(() => {
    if (!tab) closeDialog()
  }, [tab, closeDialog])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        closeDialog()
        return
      }
      if (!listening) {
        e.stopPropagation()
        return
      }
      const next = normalizeChordFromEvent(e)
      if (!next) {
        e.preventDefault()
        e.stopPropagation()
        return
      }
      e.preventDefault()
      e.stopPropagation()
      setChord(next)
      setListening(false)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [closeDialog, listening])

  if (!tab) return null

  const canSave = chord != null && validation?.ok === true

  const save = (): void => {
    if (!canSave || !chord) return
    const res = setTabDropShortcut(tabId, chord, mode)
    if (!res.ok) return
    closeDialog()
  }

  const clear = (): void => {
    setTabDropShortcut(tabId, null, mode)
    closeDialog()
  }

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => e.target === e.currentTarget && closeDialog()}
    >
      <div className="modal" role="dialog" aria-label="Set tab drop shortcut">
        <div className="modal-title">Set drop shortcut</div>
        <div className="modal-body">
          <p className="settings-help">
            Press a key combination to send the focused pane’s selection into this tab’s current
            folder (same as dropping files on the tab).
          </p>
          <div className="tab-drop-shortcut-capture">
            <div className="tab-drop-shortcut-chord" aria-live="polite">
              {chord ?? (listening ? 'Press keys…' : '—')}
            </div>
            <button type="button" className="btn" onClick={() => setListening(true)}>
              {chord ? 'Re-record' : 'Record'}
            </button>
          </div>
          {validation && !validation.ok ? (
            <p className="settings-help tab-drop-shortcut-error" role="alert">
              {validation.reason}
            </p>
          ) : null}
          {validation?.ok ? (
            <p className="settings-help">Shortcut available.</p>
          ) : null}
          <fieldset className="tab-drop-shortcut-mode">
            <legend>Transfer mode</legend>
            {(
              [
                ['auto', 'Auto (like drag — Ctrl forces copy, Shift forces move)'],
                ['move', 'Always move'],
                ['copy', 'Always copy']
              ] as const
            ).map(([value, label]) => (
              <label key={value} className="tab-drop-shortcut-mode-row">
                <input
                  type="radio"
                  name="tab-drop-transfer"
                  checked={mode === value}
                  onChange={() => setMode(value)}
                />
                <span>{label}</span>
              </label>
            ))}
          </fieldset>
        </div>
        <div className="modal-actions">
          <div className="modal-action-start-group">
            <button
              type="button"
              className="btn"
              onClick={clear}
              disabled={!tab.dropShortcut}
            >
              Clear shortcut
            </button>
          </div>
          <button type="button" className="btn" onClick={closeDialog}>
            Cancel
          </button>
          <button type="button" className="btn primary" onClick={save} disabled={!canSave}>
            Save
          </button>
        </div>
      </div>
    </div>
  )
}
