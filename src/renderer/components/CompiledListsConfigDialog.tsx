import { useCallback, useEffect, useMemo, useState, type JSX } from 'react'
import { compiledListsDir } from '@shared/slideshow/compiledLists'
import { useAppStore } from '../store/appStore'
import { api, call } from '../lib/ipc'

type Entry = { name: string; folder: string }

type ValidationIssue = {
  kind: 'missing-folder' | 'missing-list'
  listPath: string
  listLabel: string
  refPath?: string
  message: string
}

type Props = {
  returnSection?: string
}

function entryKey(e: Entry): string {
  return e.folder.trim().toLowerCase()
}

/** `null` saved selection → all categories; otherwise intersect with current rows. */
function checkedSetFromSaved(
  entries: Entry[],
  saved: string[] | null | undefined
): Set<string> {
  if (saved == null) {
    return new Set(entries.map(entryKey).filter(Boolean))
  }
  const want = new Set(saved.map((s) => s.trim().toLowerCase()).filter(Boolean))
  return new Set(entries.map(entryKey).filter((k) => k && want.has(k)))
}

function formatElapsed(ms: number): string {
  const sec = Math.floor(ms / 1000)
  const m = Math.floor(sec / 60)
  const s = sec % 60
  if (m <= 0) return `${s}s`
  return `${m}m ${s.toString().padStart(2, '0')}s`
}

/**
 * Configure category tabs (name = subfolder under compiled root).
 * Update Lists recompiles ADS Index on `.dat` under checked categories (skips !!Lists).
 * `.txt` lists always expand from body at play time — no Index.
 */
export function CompiledListsConfigDialog({ returnSection }: Props): JSX.Element {
  const closeDialog = useAppStore((s) => s.closeDialog)
  const openDialog = useAppStore((s) => s.openDialog)
  const notify = useAppStore((s) => s.notify)
  const applySettingsPatch = useAppStore((s) => s.applySettingsPatch)
  const startCompiledSlideshow = useAppStore((s) => s.startCompiledSlideshow)
  const settings = useAppStore((s) => s.settings.slideshow)
  const fileOp = useAppStore((s) => s.fileOp)

  const [entries, setEntries] = useState<Entry[]>(() =>
    (settings.compiledListEntries ?? []).map((e) => ({ ...e }))
  )
  /** Category folders ticked for Update / Validate (persisted). */
  const [checkedKeys, setCheckedKeys] = useState<Set<string>>(() =>
    checkedSetFromSaved(settings.compiledListEntries ?? [], settings.compiledListUpdateFolders)
  )
  const [selected, setSelected] = useState<number | null>(null)
  const [draftName, setDraftName] = useState('')
  const [draftFolder, setDraftFolder] = useState('')
  const [mode, setMode] = useState<'idle' | 'add' | 'edit'>('idle')
  const [busy, setBusy] = useState(false)
  const [updating, setUpdating] = useState(false)
  const [updateStartedAt, setUpdateStartedAt] = useState<number | null>(null)
  const [elapsedMs, setElapsedMs] = useState(0)
  const [dragIndex, setDragIndex] = useState<number | null>(null)
  const [seededFromDisk, setSeededFromDisk] = useState(false)
  const [validationIssues, setValidationIssues] = useState<ValidationIssue[] | null>(null)
  const [validationSummary, setValidationSummary] = useState<string | null>(null)

  const compiledRoot = settings.compiledFileListsFolder.trim()

  const compileOp = updating ? fileOp : null

  const checkedEntries = useMemo(
    () => entries.filter((e) => checkedKeys.has(entryKey(e))),
    [entries, checkedKeys]
  )
  const allChecked = entries.length > 0 && checkedEntries.length === entries.length
  const someChecked = checkedEntries.length > 0 && !allChecked

  useEffect(() => {
    if (!updating || updateStartedAt == null) {
      setElapsedMs(0)
      return
    }
    const tick = (): void => setElapsedMs(Date.now() - updateStartedAt)
    tick()
    const id = window.setInterval(tick, 500)
    return () => window.clearInterval(id)
  }, [updating, updateStartedAt])

  const finish = useCallback((): void => {
    if (updating) return
    if (returnSection) openDialog({ kind: 'settings', section: returnSection })
    else closeDialog()
  }, [updating, returnSection, openDialog, closeDialog])

  const persistEntries = async (next: Entry[]): Promise<void> => {
    setEntries(next)
    await applySettingsPatch({ slideshow: { compiledListEntries: next } })
  }

  const persistChecked = async (next: Set<string>): Promise<void> => {
    setCheckedKeys(next)
    await applySettingsPatch({
      slideshow: { compiledListUpdateFolders: [...next] }
    })
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && mode === 'idle' && !updating) {
        e.preventDefault()
        e.stopPropagation()
        finish()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [mode, updating, finish])

  // Discover category folders; when the table is empty, seed rows from disk (first pass).
  useEffect(() => {
    if (!compiledRoot) return
    let cancelled = false
    void call(api.slideshow.listCompiledDats({ compiledRoot, entries: [] }))
      .then(async (res) => {
        if (cancelled) return
        const names = res.tabs.map((t) => t.name)
        if (seededFromDisk) return
        if ((settings.compiledListEntries?.length ?? 0) > 0) {
          setSeededFromDisk(true)
          return
        }
        if (names.length === 0) return
        const root = compiledRoot.replace(/[/\\]+$/, '')
        const seeded: Entry[] = names.map((name) => ({
          name,
          folder: `${root}\\${name}`
        }))
        setSeededFromDisk(true)
        setEntries(seeded)
        // First-time seed: leave selection null (all selected) unless user already saved one.
        if (settings.compiledListUpdateFolders != null) {
          setCheckedKeys(checkedSetFromSaved(seeded, settings.compiledListUpdateFolders))
        } else {
          setCheckedKeys(new Set(seeded.map(entryKey)))
        }
        await applySettingsPatch({ slideshow: { compiledListEntries: seeded } })
      })
      .catch(() => {
        /* ignore discovery failures */
      })
    return () => {
      cancelled = true
    }
    // Seed once per dialog open when settings rows are empty.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional one-shot seed
  }, [compiledRoot])

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
    const old = mode === 'edit' && selected != null ? entries[selected] : null
    await persistEntries(next)
    setMode('idle')
    setSelected(mode === 'add' ? next.length - 1 : selected)
    const nextKeys = new Set(checkedKeys)
    if (old) nextKeys.delete(entryKey(old))
    nextKeys.add(entryKey({ name, folder }))
    await persistChecked(nextKeys)
  }

  const removeSelected = async (): Promise<void> => {
    if (selected == null) return
    const removed = entries[selected]
    const next = entries.filter((_, i) => i !== selected)
    await persistEntries(next)
    if (removed) {
      const nextKeys = new Set(checkedKeys)
      nextKeys.delete(entryKey(removed))
      await persistChecked(nextKeys)
    }
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

  const toggleChecked = (e: Entry, on: boolean): void => {
    const k = entryKey(e)
    if (!k) return
    const n = new Set(checkedKeys)
    if (on) n.add(k)
    else n.delete(k)
    void persistChecked(n)
  }

  const toggleAllChecked = (on: boolean): void => {
    void persistChecked(
      on ? new Set(entries.map(entryKey).filter(Boolean)) : new Set()
    )
  }

  const updateLists = async (): Promise<void> => {
    if (!compiledRoot) {
      notify('Set Compiled file lists folder in Settings first', true)
      return
    }
    if (checkedEntries.length === 0) {
      notify('Tick at least one category to update', true)
      return
    }
    setBusy(true)
    setUpdating(true)
    setUpdateStartedAt(Date.now())
    setValidationIssues(null)
    setValidationSummary(null)
    try {
      // All ticked → whole compiled root (same as before). Subset → those folders only.
      const scope =
        checkedEntries.length === entries.length ? [] : checkedEntries
      const res = await call(
        api.slideshow.updateCompiledLists({ compiledRoot, entries: scope })
      )
      if (res.updated === 0) {
        notify('No .dat lists found to compile in the selected categories (outside !!Lists)')
      } else {
        notify(
          `Updated ${res.datUpdated} .dat — ${res.totalFiles.toLocaleString()} images in Index` +
            (checkedEntries.length < entries.length
              ? ` (${checkedEntries.length}/${entries.length} categories)`
              : '')
        )
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      if (/cancel/i.test(msg)) notify('Update Lists cancelled')
      else notify(msg, true)
    } finally {
      setUpdating(false)
      setUpdateStartedAt(null)
      setBusy(false)
    }
  }

  const cancelUpdate = (): void => {
    void api.fs.cancelOp()
  }

  const validateLists = async (): Promise<void> => {
    if (!compiledRoot) {
      notify('Set Compiled file lists folder in Settings first', true)
      return
    }
    if (checkedEntries.length === 0) {
      notify('Tick at least one category to validate', true)
      return
    }
    setBusy(true)
    setValidationIssues(null)
    setValidationSummary(null)
    try {
      const scopeEntries =
        checkedEntries.length === entries.length ? undefined : checkedEntries
      const res = await call(
        api.slideshow.validateCompiledLists({ compiledRoot, entries: scopeEntries })
      )
      setValidationIssues(res.issues)
      const scopeLabel =
        checkedEntries.length < entries.length
          ? ` (${checkedEntries.length}/${entries.length} categories)`
          : ''
      if (res.ok) {
        const summary = `Validate Lists: OK — checked ${res.checkedLists} list(s), no issues${scopeLabel}`
        setValidationSummary(summary)
        notify(summary)
      } else {
        const missingFolder = res.issues.filter((i) => i.kind === 'missing-folder').length
        const missingList = res.issues.filter((i) => i.kind === 'missing-list').length
        const bits = [
          missingFolder ? `${missingFolder} missing folder(s)` : null,
          missingList ? `${missingList} missing list(s)` : null
        ].filter(Boolean)
        const summary = `Validate Lists: ${res.issueCount} issue(s) in ${res.checkedLists} list(s) — ${bits.join(', ')}${scopeLabel}`
        setValidationSummary(summary)
        notify(summary, true)
      }
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

  const opDone = compileOp?.done ?? 0
  const opTotal = compileOp?.total ?? 0
  const opPct =
    opTotal > 0 ? Math.min(100, Math.round((Math.min(opDone, opTotal) / opTotal) * 100)) : 0

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
          Category folders under the compiled lists root are listed automatically (including{' '}
          <code>!!Lists</code>). Drag to reorder tabs; Add/Edit only if you need extras. Tick
          categories, then <strong>Update Lists</strong> / <strong>Validate Lists</strong> run on
          that subset only. Update crawls folders in each <code>.dat</code> body and writes ADS{' '}
          <code>Index</code>/<code>Count</code> outside <code>!!Lists</code> (<code>{'|=>'}</code>{' '}
          ignored; <code>.txt</code> is not indexed). Validate reports missing folders / nested list
          refs.
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
            <button
              type="button"
              className="btn primary"
              disabled={busy || checkedEntries.length === 0}
              title={
                checkedEntries.length === 0
                  ? 'Tick at least one category'
                  : checkedEntries.length < entries.length
                    ? `Update ${checkedEntries.length} selected categor${checkedEntries.length === 1 ? 'y' : 'ies'}`
                    : 'Update all categories'
              }
              onClick={() => void updateLists()}
            >
              Update Lists
              {checkedEntries.length > 0 && checkedEntries.length < entries.length
                ? ` (${checkedEntries.length})`
                : ''}
            </button>
            <button
              type="button"
              className="btn"
              disabled={busy || checkedEntries.length === 0}
              title={
                checkedEntries.length === 0
                  ? 'Tick at least one category'
                  : checkedEntries.length < entries.length
                    ? `Validate ${checkedEntries.length} selected categor${checkedEntries.length === 1 ? 'y' : 'ies'}`
                    : 'Validate all categories'
              }
              onClick={() => void validateLists()}
            >
              Validate Lists
              {checkedEntries.length > 0 && checkedEntries.length < entries.length
                ? ` (${checkedEntries.length})`
                : ''}
            </button>
            <button type="button" className="btn" disabled={busy} onClick={() => void start()}>
              Start
            </button>
          </div>

          {validationSummary ? (
            <div
              className={`compiled-validate-summary${validationIssues && validationIssues.length > 0 ? ' has-issues' : ''}`}
            >
              {validationSummary}
            </div>
          ) : null}
          {validationIssues && validationIssues.length > 0 ? (
            <div className="compiled-validate-issues" role="region" aria-label="Validation issues">
              <ul>
                {validationIssues.map((issue, i) => (
                  <li key={`${issue.kind}-${issue.listPath}-${issue.refPath ?? ''}-${i}`} title={issue.refPath}>
                    <span className={`compiled-validate-kind kind-${issue.kind}`}>
                      {issue.kind === 'missing-folder'
                        ? 'Folder'
                        : issue.kind === 'missing-list'
                          ? 'List'
                          : 'Index'}
                    </span>
                    {issue.message}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

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
                    <th className="cmap-check-col">
                      <input
                        type="checkbox"
                        checked={allChecked}
                        ref={(el) => {
                          if (el) el.indeterminate = someChecked
                        }}
                        disabled={busy || entries.length === 0}
                        aria-label="Select all categories"
                        title="Select all for Update / Validate"
                        onChange={(ev) => toggleAllChecked(ev.target.checked)}
                      />
                    </th>
                    <th>Name</th>
                    <th>Folder</th>
                  </tr>
                </thead>
                <tbody>
                  {entries.map((e, i) => {
                    const checked = checkedKeys.has(entryKey(e))
                    return (
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
                        <td
                          className="cmap-check-col"
                          onClick={(ev) => ev.stopPropagation()}
                          onDoubleClick={(ev) => ev.stopPropagation()}
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            disabled={busy}
                            aria-label={`Include ${e.name} in Update / Validate`}
                            onChange={(ev) => toggleChecked(e, ev.target.checked)}
                          />
                        </td>
                        <td>{e.name}</td>
                        <td className="dim" title={e.folder}>
                          {e.folder}
                        </td>
                      </tr>
                    )
                  })}
                  {entries.length === 0 ? (
                    <tr>
                      <td colSpan={3} className="dim">
                        {compiledRoot
                          ? 'No category folders found under the compiled lists root yet.'
                          : 'Set Compiled file lists folder in Settings first.'}
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          )}
        </div>
        <div className="modal-actions">
          <button type="button" className="btn" disabled={updating} onClick={finish}>
            Close
          </button>
        </div>

        {updating ? (
          <div className="compiled-update-progress" role="status" aria-live="polite">
            <div className="compiled-update-progress-inner">
              <div className="modal-title" style={{ marginBottom: 8 }}>
                Updating Lists…
              </div>
              <div className="compiled-update-track" aria-valuemin={0} aria-valuemax={100} aria-valuenow={opPct}>
                <div
                  className={`compiled-update-fill${opTotal <= 0 ? ' indeterminate' : ''}`}
                  style={opTotal > 0 ? { width: `${opPct}%` } : undefined}
                />
              </div>
              <p className="compiled-update-counts">
                {opTotal > 0
                  ? `${Math.min(opDone, opTotal)} of ${opTotal} lists`
                  : 'Scanning…'}
                {' · '}
                {formatElapsed(elapsedMs)}
              </p>
              {compileOp?.current ? (
                <p className="compiled-update-current dim" title={compileOp.current}>
                  {compileOp.current}
                </p>
              ) : (
                <p className="compiled-update-current dim">Starting…</p>
              )}
              <div className="compiled-update-actions">
                <button type="button" className="btn" onClick={cancelUpdate}>
                  Cancel
                </button>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  )
}
