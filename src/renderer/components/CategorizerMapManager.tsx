import { useEffect, useMemo, useState, type JSX } from 'react'
import type { CategorizerMapRow } from '@shared/slideshow/categorizerMap'
import { isDeleteMapRow } from '@shared/slideshow/categorizerMap'
import { CATEGORIZER_KEY_TOKENS, codeToKeyToken, isKnownKeyToken, normalizeKeyToken } from '@shared/slideshow/keys'
import { useAppStore } from '../store/appStore'
import { api, call } from '../lib/ipc'
import { basename } from '../lib/paths'

type Props = {
  /** Re-open Settings on this section when closing. */
  returnSection?: string
}

type Draft = {
  name: string
  keyToken: string
  path: string
  isDelete: boolean
}

const emptyDraft = (): Draft => ({
  name: '',
  keyToken: 'F5',
  path: '',
  isDelete: false
})

/**
 * Full-featured categorizer map editor (gated slideshow).
 * Edits in-memory rows; Load/Save in Settings (or here) persist the file format.
 */
export function CategorizerMapManager({ returnSection }: Props): JSX.Element {
  const closeDialog = useAppStore((s) => s.closeDialog)
  const openDialog = useAppStore((s) => s.openDialog)
  const rows = useAppStore((s) => s.slideshow.categorizerMap)
  const setCategorizerMap = useAppStore((s) => s.setCategorizerMap)
  const loadCategorizerMapDialog = useAppStore((s) => s.loadCategorizerMapDialog)
  const saveCategorizerMapDialog = useAppStore((s) => s.saveCategorizerMapDialog)
  const mapPath = useAppStore((s) => s.settings.slideshow.categorizerMapPath)
  const notify = useAppStore((s) => s.notify)

  const [selected, setSelected] = useState<number | null>(null)
  const [draft, setDraft] = useState<Draft>(emptyDraft)
  const [mode, setMode] = useState<'idle' | 'add' | 'edit'>('idle')
  const [capturing, setCapturing] = useState(false)
  const [filter, setFilter] = useState('')

  const finish = (): void => {
    if (returnSection) openDialog({ kind: 'settings', section: returnSection })
    else closeDialog()
  }

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase()
    if (!q) return rows.map((r, i) => ({ r, i }))
    return rows
      .map((r, i) => ({ r, i }))
      .filter(
        ({ r }) =>
          r.name.toLowerCase().includes(q) ||
          r.keyToken.toLowerCase().includes(q) ||
          r.path.toLowerCase().includes(q)
      )
  }, [rows, filter])

  useEffect(() => {
    if (capturing) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && mode === 'idle') {
        e.preventDefault()
        e.stopPropagation()
        finish()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [capturing, mode])

  useEffect(() => {
    if (!capturing) return
    const onKey = (e: KeyboardEvent): void => {
      e.preventDefault()
      e.stopPropagation()
      if (e.key === 'Escape') {
        setCapturing(false)
        return
      }
      const token = codeToKeyToken(e.code)
      if (!token) {
        notify('That key cannot be mapped (numpad reserved / unsupported)', true)
        return
      }
      setDraft((d) => ({ ...d, keyToken: token }))
      setCapturing(false)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [capturing, notify])

  const startAdd = (): void => {
    setMode('add')
    setSelected(null)
    setDraft(emptyDraft())
  }

  const startEdit = (index: number): void => {
    const row = rows[index]
    if (!row) return
    setMode('edit')
    setSelected(index)
    setDraft({
      name: row.name,
      keyToken: row.keyToken,
      path: row.path,
      isDelete: isDeleteMapRow(row)
    })
  }

  const cancelForm = (): void => {
    setMode('idle')
    setCapturing(false)
  }

  const validateDraft = (): string | null => {
    if (!draft.name.trim()) return 'Name is required'
    if (!draft.keyToken.trim()) return 'Key is required'
    const canon = normalizeKeyToken(draft.keyToken)
    if (!canon || !isKnownKeyToken(canon)) {
      return 'Unsupported key — use a System.Windows.Forms.Keys name (e.g. OemMinus, Back, F5)'
    }
    if (!draft.isDelete && !draft.path.trim()) return 'Folder path required (or mark as Delete)'
    const dup = rows.findIndex(
      (r, i) =>
        normalizeKeyToken(r.keyToken)?.toUpperCase() === canon.toUpperCase() &&
        !(mode === 'edit' && i === selected)
    )
    if (dup >= 0) return `Key Keys.${canon} is already used by "${rows[dup]!.name}"`
    return null
  }

  const commitForm = (): void => {
    const err = validateDraft()
    if (err) {
      notify(err, true)
      return
    }
    const canon = normalizeKeyToken(draft.keyToken)!
    const nextRow: CategorizerMapRow = {
      name: draft.name.trim(),
      keyToken: canon,
      path: draft.isDelete ? '' : draft.path.trim()
    }
    if (mode === 'add') {
      setCategorizerMap([...rows, nextRow])
      setSelected(rows.length)
    } else if (mode === 'edit' && selected != null) {
      const next = [...rows]
      next[selected] = nextRow
      setCategorizerMap(next)
    }
    setMode('idle')
    setCapturing(false)
  }

  const removeSelected = (): void => {
    if (selected == null) return
    const next = rows.filter((_, i) => i !== selected)
    setCategorizerMap(next)
    setSelected(null)
    setMode('idle')
  }

  const moveSelected = (dir: -1 | 1): void => {
    if (selected == null) return
    const j = selected + dir
    if (j < 0 || j >= rows.length) return
    const next = [...rows]
    const tmp = next[selected]!
    next[selected] = next[j]!
    next[j] = tmp
    setCategorizerMap(next)
    setSelected(j)
  }

  const browseFolder = async (): Promise<void> => {
    const res = await call(api.app.pickFolder())
    if (res.path) setDraft((d) => ({ ...d, path: res.path!, isDelete: false }))
  }

  return (
    <div className="modal-backdrop" onMouseDown={finish}>
      <div
        className="modal modal-categorizer-map"
        role="dialog"
        aria-label="Categorizer mapping manager"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="modal-title">Categorizer mapping manager</div>
        <div className="modal-body modal-body-categorizer">
          <div className="cmap-toolbar">
            <input
              className="cmap-filter"
              type="search"
              placeholder="Filter name, key, path…"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              aria-label="Filter mappings"
            />
            <div className="cmap-toolbar-actions">
              <button type="button" className="btn" onClick={startAdd} disabled={mode !== 'idle'}>
                Add…
              </button>
              <button
                type="button"
                className="btn"
                disabled={selected == null || mode !== 'idle'}
                onClick={() => selected != null && startEdit(selected)}
              >
                Edit…
              </button>
              <button
                type="button"
                className="btn"
                disabled={selected == null || mode !== 'idle'}
                onClick={removeSelected}
              >
                Remove
              </button>
              <button
                type="button"
                className="btn"
                disabled={selected == null || mode !== 'idle'}
                onClick={() => moveSelected(-1)}
                title="Move up"
              >
                ↑
              </button>
              <button
                type="button"
                className="btn"
                disabled={selected == null || mode !== 'idle'}
                onClick={() => moveSelected(1)}
                title="Move down"
              >
                ↓
              </button>
              <span className="toolbar-sep" aria-hidden />
              <button type="button" className="btn" onClick={() => void loadCategorizerMapDialog()}>
                Import…
              </button>
              <button
                type="button"
                className="btn"
                disabled={rows.length === 0}
                onClick={() => void saveCategorizerMapDialog()}
              >
                Export…
              </button>
            </div>
          </div>
          <p className="dim cmap-path">
            {rows.length} mapping{rows.length === 1 ? '' : 's'} · saved in app settings
            {mapPath ? ` · last file: ${mapPath}` : ''}
          </p>

          <div className="cmap-split">
            <div className="cmap-table-wrap">
              <table className="cmap-table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Key</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.length === 0 ? (
                    <tr>
                      <td colSpan={3} className="dim">
                        {rows.length === 0
                          ? 'No mappings — Add or Import a map file.'
                          : 'No rows match the filter.'}
                      </td>
                    </tr>
                  ) : (
                    filtered.map(({ r, i }) => (
                      <tr
                        key={`${i}-${r.keyToken}`}
                        className={selected === i ? 'selected' : undefined}
                        onClick={() => {
                          if (mode !== 'idle') return
                          setSelected(i)
                        }}
                        onDoubleClick={() => {
                          if (mode !== 'idle') return
                          startEdit(i)
                        }}
                      >
                        <td title={r.name}>{r.name}</td>
                        <td>
                          <code>Keys.{r.keyToken}</code>
                        </td>
                        <td title={r.path || 'Delete'}>
                          {isDeleteMapRow(r) ? (
                            <span className="cmap-delete-badge">Delete</span>
                          ) : (
                            <span className="cmap-path-cell">{r.path}</span>
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            {mode !== 'idle' && (
              <div className="cmap-form">
                <h3>{mode === 'add' ? 'Add mapping' : 'Edit mapping'}</h3>
                <label className="settings-field" htmlFor="cmap-name">
                  <span>Name</span>
                  <input
                    id="cmap-name"
                    type="text"
                    autoFocus
                    value={draft.name}
                    onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
                    placeholder="e.g. DonePerfectSX"
                  />
                </label>
                <label className="settings-field" htmlFor="cmap-key">
                  <span>Key</span>
                  <div className="settings-inline" style={{ gap: 8 }}>
                    <select
                      id="cmap-key"
                      value={draft.keyToken}
                      onChange={(e) => setDraft((d) => ({ ...d, keyToken: e.target.value }))}
                    >
                      {CATEGORIZER_KEY_TOKENS.map((t) => (
                        <option key={t} value={t}>
                          Keys.{t}
                        </option>
                      ))}
                      {draft.keyToken &&
                        !CATEGORIZER_KEY_TOKENS.includes(draft.keyToken) && (
                          <option value={draft.keyToken}>Keys.{draft.keyToken}</option>
                        )}
                    </select>
                    <button
                      type="button"
                      className={`btn${capturing ? ' primary' : ''}`}
                      onClick={() => setCapturing((v) => !v)}
                    >
                      {capturing ? 'Press a key…' : 'Capture key'}
                    </button>
                  </div>
                </label>
                <label className="settings-toggle" htmlFor="cmap-delete">
                  <span className="settings-toggle-text">
                    <span className="settings-toggle-label">Delete action</span>
                    <span className="settings-toggle-hint">
                      Empty path — virtual delete during slideshow (not a folder move)
                    </span>
                  </span>
                  <input
                    id="cmap-delete"
                    type="checkbox"
                    checked={draft.isDelete}
                    onChange={(e) =>
                      setDraft((d) => ({
                        ...d,
                        isDelete: e.target.checked,
                        path: e.target.checked ? '' : d.path
                      }))
                    }
                  />
                </label>
                {!draft.isDelete && (
                  <label className="settings-field" htmlFor="cmap-path">
                    <span>Destination folder</span>
                    <div className="settings-inline" style={{ gap: 8 }}>
                      <input
                        id="cmap-path"
                        type="text"
                        value={draft.path}
                        onChange={(e) => setDraft((d) => ({ ...d, path: e.target.value }))}
                        placeholder="C:\…"
                      />
                      <button type="button" className="btn" onClick={() => void browseFolder()}>
                        Browse…
                      </button>
                    </div>
                    {draft.path ? (
                      <span className="dim" style={{ marginTop: 4 }}>
                        {basename(draft.path.replace(/[/\\]+$/, '')) || draft.path}
                      </span>
                    ) : null}
                  </label>
                )}
                <div className="cmap-form-actions">
                  <button type="button" className="btn" onClick={cancelForm}>
                    Cancel
                  </button>
                  <button type="button" className="btn primary" onClick={commitForm}>
                    {mode === 'add' ? 'Add' : 'Apply'}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
        <div className="modal-actions">
          <button type="button" className="btn primary" onClick={finish}>
            Done
          </button>
        </div>
      </div>
    </div>
  )
}
