import { useEffect, useState, type JSX } from 'react'
import type { ItemNote } from '@shared/schemas/itemAds'
import { useAppStore } from '../store/appStore'
import { api, call, IpcError } from '../lib/ipc'
import { basename } from '../lib/paths'

const STATUS_PRESETS = ['Needs review', 'Do not delete', 'Waiting', 'Archive']

export function ItemNoteDialog({ path }: { path: string }): JSX.Element {
  const closeDialog = useAppStore((s) => s.closeDialog)
  const bumpColumnMeta = useAppStore((s) => s.bumpColumnMeta)
  const notify = useAppStore((s) => s.notify)
  const [text, setText] = useState('')
  const [status, setStatus] = useState('')
  const [checklist, setChecklist] = useState<{ text: string; done: boolean }[]>([])
  const [busy, setBusy] = useState(false)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') closeDialog()
      e.stopPropagation()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [closeDialog])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const res = await api.itemAds.getMany({ paths: [path] })
      if (cancelled || !res.ok) {
        setLoaded(true)
        return
      }
      const note = res.value[path]?.note
      if (note) {
        setText(note.text)
        setStatus(note.status ?? '')
        setChecklist(note.checklist ?? [])
      }
      setLoaded(true)
    })()
    return () => {
      cancelled = true
    }
  }, [path])

  const save = async (clear: boolean): Promise<void> => {
    setBusy(true)
    try {
      const note: ItemNote | null = clear
        ? null
        : {
            text,
            status: status.trim() || undefined,
            checklist: checklist.filter((c) => c.text.trim()).slice(0, 40),
            updatedAt: Date.now()
          }
      if (note && !note.text.trim() && !note.status && !(note.checklist?.length)) {
        await call(api.itemAds.setNote({ path, note: null }))
      } else {
        await call(api.itemAds.setNote({ path, note }))
      }
      bumpColumnMeta(path)
      closeDialog()
    } catch (e) {
      notify(e instanceof IpcError ? e.message : 'Could not save the note', true)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => e.target === e.currentTarget && closeDialog()}
    >
      <div className="modal modal-item-note" role="dialog" aria-label="Note">
        <div className="modal-title">Note</div>
        <div className="modal-body">
          <p className="dim item-note-path" title={path}>
            {basename(path)}
          </p>
          <label className="item-note-field">
            <span>Note</span>
            <textarea
              rows={6}
              value={text}
              onChange={(e) => setText(e.target.value)}
              disabled={!loaded || busy}
              autoFocus
            />
          </label>
          <label className="item-note-field">
            <span>Status</span>
            <input
              list="item-note-status-presets"
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              disabled={!loaded || busy}
              maxLength={80}
            />
            <datalist id="item-note-status-presets">
              {STATUS_PRESETS.map((s) => (
                <option key={s} value={s} />
              ))}
            </datalist>
          </label>
          <div className="item-note-check-head">
            <span>Checklist</span>
            <button
              type="button"
              className="btn"
              disabled={busy || checklist.length >= 40}
              onClick={() => setChecklist((c) => [...c, { text: '', done: false }])}
            >
              Add item
            </button>
          </div>
          <ul className="item-note-check-list">
            {checklist.map((row, i) => (
              <li key={i}>
                <input
                  type="checkbox"
                  checked={row.done}
                  onChange={(e) =>
                    setChecklist((c) => c.map((x, j) => (j === i ? { ...x, done: e.target.checked } : x)))
                  }
                />
                <input
                  value={row.text}
                  onChange={(e) =>
                    setChecklist((c) => c.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)))
                  }
                  maxLength={200}
                />
                <button
                  type="button"
                  className="btn"
                  aria-label="Remove checklist item"
                  onClick={() => setChecklist((c) => c.filter((_, j) => j !== i))}
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        </div>
        <div className="modal-actions">
          <button type="button" className="btn modal-action-start" onClick={() => void save(true)} disabled={busy}>
            Clear note
          </button>
          <button type="button" className="btn" onClick={closeDialog} disabled={busy}>
            Cancel
          </button>
          <button type="button" className="btn primary" onClick={() => void save(false)} disabled={busy || !loaded}>
            Save
          </button>
        </div>
      </div>
    </div>
  )
}
