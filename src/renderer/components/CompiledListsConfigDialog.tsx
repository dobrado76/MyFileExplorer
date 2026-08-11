import { useEffect, useMemo, useState, type JSX } from 'react'
import { compiledListsDir } from '@shared/slideshow/compiledLists'
import { useAppStore } from '../store/appStore'
import { api, call } from '../lib/ipc'

type Entry = { name: string; folder: string }

type Props = {
  returnSection?: string
}

/**
 * Configure category tabs (name = subfolder under compiled root).
 * Update Lists recompiles ADS Index on every `.txt` under that root (skips !!Lists).
 */
export function CompiledListsConfigDialog({ returnSection }: Props): JSX.Element {
  const closeDialog = useAppStore((s) => s.closeDialog)
  const openDialog = useAppStore((s) => s.openDialog)
  const notify = useAppStore((s) => s.notify)
  const applySettingsPatch = useAppStore((s) => s.applySettingsPatch)
  const startCompiledSlideshow = useAppStore((s) => s.startCompiledSlideshow)
  const settings = useAppStore((s) => s.settings.slideshow)

  const [entries, setEntries] = useState<Entry[]>(() =>
    (settings.compiledListEntries ?? []).map((e) => ({ ...e }))
  )
  const [selected, setSelected] = useState<number | null>(null)
  const [draftName, setDraftName] = useState('')
  const [draftFolder, setDraftFolder] = useState('')
  const [mode, setMode] = useState<'idle' | 'add' | 'edit'>('idle')
  const [busy, setBusy] = useState(false)
  const [dragIndex, setDragIndex] = useState<number | null>(null)

  const compiledRoot = settings.compiledFileListsFolder.trim()

  const finish = (): void => {
    if (returnSection) openDialog({ kind: 'settings', section: returnSection })
    else closeDialog()
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && mode === 'idle') {
        e.preventDefault()
        e.stopPropagation()
        finish()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [mode])

  const persistEntries = async (next: Entry[]): Promise<void> => {
    setEntries(next)
    await applySettingsPatch({ slideshow: { compiledListEntries: next } })
  }

  const startAdd = (): void => {
    setMode('add')
    setSelected(null)
    setDraftName('')
    setDraftFolder('')
  }

  const startEdit = (i: number): void => {
    const row = entries[i]
    if (!row) return
    setMode('edit')
    setSelected(i)
    setDraftName(row.name)
    setDraftFolder(row.folder)
  }

  const cancelForm = (): void => {
    setMode('idle')
  }

  const commitForm = async (): Promise<void> => {
    const name = draftName.trim()
    const folder = draftFolder.trim()
    if (!name) {
      notify('Name is required', true)
      return
    }
    if (!folder) {
      notify('Folder is required', true)
      return
    }
    const dup = entries.findIndex(
      (e, i) => e.name.toLowerCase() === name.toLowerCase() && !(mode === 'edit' && i === selected)
    )
    if (dup >= 0) {
      notify(`Name "${name}" already used`, true)
      return
    }
    let next: Entry[]
    if (mode === 'add') next = [...entries, { name, folder }]
    else if (mode === 'edit' && selected != null) {
      next = [...entries]
      next[selected] = { name, folder }
    } else return
    await persistEntries(next)
    setMode('idle')
    setSelected(mode === 'add' ? next.length - 1 : selected)
  }

  const removeSelected = async (): Promise<void> => {
    if (selected == null) return
    const next = entries.filter((_, i) => i !== selected)
    await persistEntries(next)
    setSelected(null)
    setMode('idle')
  }

  const browseFolder = async (): Promise<void> => {
    const res = await call(api.app.pickFolder())
    if (res.path) setDraftFolder(res.path)
  }

  const onDropReorder = async (from: number, to: number): Promise<void> => {
    if (from === to || from < 0 || to < 0 || from >= entries.length || to >= entries.length) return
    const next = [...entries]
    const [item] = next.splice(from, 1)
    if (!item) return
    next.splice(to, 0, item)
    await persistEntries(next)
    setSelected(to)
  }

  const updateLists = async (): Promise<void> => {
    if (!compiledRoot) {
      notify('Set Compiled file lists folder in Settings first', true)
      return
    }
    if (entries.length === 0) {
      notify('Add at least one list entry', true)
      return
    }
    setBusy(true)
    try {
      const res = await call(
        api.slideshow.updateCompiledLists({ compiledRoot, entries })
      )
      notify(
        res.updated === 0
          ? 'No .txt lists found to compile (outside !!Lists)'
          : `Compiled ${res.updated} .txt list(s), ${res.totalFiles} images in Index`
      )
    } catch (e) {
      notify(e instanceof Error ? e.message : String(e), true)
    } finally {
      setBusy(false)
    }
  }

  const start = async (): Promise<void> => {
    if (!compiledRoot) {
      notify('Set Compiled file lists folder first', true)
      return
    }
    setBusy(true)
    try {
      await call(api.slideshow.openCompiledListsWindow())
      const usable = await call(api.slideshow.lastListUsable({ compiledRoot }))
      if (usable.usable) {
        closeDialog()
        await startCompiledSlideshow({ resume: true })
      } else {
        notify('Set counts in the lists window (or Load a saved list), then Start there')
        closeDialog()
      }
    } catch (e) {
      notify(e instanceof Error ? e.message : String(e), true)
    } finally {
      setBusy(false)
    }
  }

  const listsHint = useMemo(
    () => (compiledRoot ? compiledListsDir(compiledRoot) : ''),
    [compiledRoot]
  )

  return (
    <div className="modal-backdrop" onMouseDown={finish}>
      <div
        className="modal modal-compiled-config"
        role="dialog"
        aria-label="Compiled lists configuration"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="modal-title">Compiled lists</div>
        <p className="dim" style={{ margin: '0 16px 8px', fontSize: 12 }}>
          Category tabs are detected from subfolders under the compiled lists folder (including{' '}
          <code>!!Lists</code> as its own tab for selectable .dat/.txt). Optional rows below only set
          tab order. <strong>Update Lists</strong> recompiles ADS <code>Index</code> on every{' '}
          <code>.txt</code> <em>outside</em> <code>!!Lists</code>.
          {listsHint ? (
            <>
              {' '}
              Resume/composites: <code>{listsHint}</code>.
            </>
          ) : null}
        </p>
        <div className="modal-body modal-body-compiled-config">
          <div className="cmap-toolbar-actions" style={{ marginBottom: 8 }}>
            <button type="button" className="btn" disabled={busy} onClick={startAdd}>
              Add…
            </button>
            <button
              type="button"
              className="btn"
              disabled={busy || selected == null}
              onClick={() => selected != null && startEdit(selected)}
            >
              Edit…
            </button>
            <button
              type="button"
              className="btn"
              disabled={busy || selected == null}
              onClick={() => void removeSelected()}
            >
              Remove
            </button>
            <button type="button" className="btn primary" disabled={busy} onClick={() => void updateLists()}>
              Update Lists
            </button>
            <button type="button" className="btn" disabled={busy} onClick={() => void start()}>
              Start
            </button>
          </div>

          {mode !== 'idle' ? (
            <div className="ads-form">
              <label className="ads-field">
                <span>Name</span>
                <input value={draftName} onChange={(e) => setDraftName(e.target.value)} />
              </label>
              <label className="ads-field">
                <span>Folder</span>
                <div className="settings-inline" style={{ gap: 8 }}>
                  <input
                    style={{ flex: 1 }}
                    value={draftFolder}
                    onChange={(e) => setDraftFolder(e.target.value)}
                  />
                  <button type="button" className="btn" onClick={() => void browseFolder()}>
                    Browse…
                  </button>
                </div>
              </label>
              <div className="ads-form-actions">
                <button type="button" className="btn primary" onClick={() => void commitForm()}>
                  Save
                </button>
                <button type="button" className="btn" onClick={cancelForm}>
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <div className="cmap-table-wrap">
              <table className="cmap-table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Folder</th>
                  </tr>
                </thead>
                <tbody>
                  {entries.map((e, i) => (
                    <tr
                      key={`${e.name}-${i}`}
                      className={selected === i ? 'selected' : undefined}
                      draggable
                      onDragStart={() => setDragIndex(i)}
                      onDragOver={(ev) => ev.preventDefault()}
                      onDrop={() => {
                        if (dragIndex != null) void onDropReorder(dragIndex, i)
                        setDragIndex(null)
                      }}
                      onClick={() => setSelected(i)}
                      onDoubleClick={() => startEdit(i)}
                    >
                      <td>{e.name}</td>
                      <td className="dim" title={e.folder}>
                        {e.folder}
                      </td>
                    </tr>
                  ))}
                  {entries.length === 0 ? (
                    <tr>
                      <td colSpan={2} className="dim">
                        No entries — Add a named source folder.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          )}
        </div>
        <div className="modal-actions">
          <button type="button" className="btn" onClick={finish}>
            Close
          </button>
        </div>
      </div>
    </div>
  )
}
