import { useEffect, useMemo, useState, type JSX, type ReactNode } from 'react'
import {
  previewPowerRename,
  type PowerRenameApplyTo,
  type PowerRenameOptions
} from '@shared/powerRename'
import { useAppStore } from '../store/appStore'
import { basename } from '../lib/paths'
import type { UndoPathPair } from '../lib/undoHistory'

function Modal({
  title,
  children,
  actions,
  onClose
}: {
  title: string
  children: ReactNode
  actions: ReactNode
  onClose(): void
}): JSX.Element {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
      e.stopPropagation()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose])

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal modal-wide modal-power-rename" role="dialog" aria-label={title}>
        <div className="modal-title">{title}</div>
        <div className="modal-body modal-body-power-rename">{children}</div>
        <div className="modal-actions">{actions}</div>
      </div>
    </div>
  )
}

export function PowerRenameDialog({ paths }: { paths: string[] }): JSX.Element {
  const closeDialog = useAppStore((s) => s.closeDialog)
  const applyPowerRename = useAppStore((s) => s.applyPowerRename)
  const undoPowerRenameApply = useAppStore((s) => s.undoPowerRenameApply)
  const notify = useAppStore((s) => s.notify)

  const [workingPaths, setWorkingPaths] = useState(paths)
  const items = useMemo(
    () => workingPaths.map((path) => ({ path, name: basename(path) })),
    [workingPaths]
  )

  const [search, setSearch] = useState('')
  const [replace, setReplace] = useState('')
  const [regex, setRegex] = useState(false)
  const [matchAll, setMatchAll] = useState(false)
  const [caseSensitive, setCaseSensitive] = useState(false)
  const [applyTo, setApplyTo] = useState<PowerRenameApplyTo>('full')
  const [checked, setChecked] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(paths.map((p) => [p, true]))
  )
  const [lastApply, setLastApply] = useState<UndoPathPair[] | null>(null)
  const [busy, setBusy] = useState(false)

  const opts: PowerRenameOptions = useMemo(
    () => ({ search, replace, regex, matchAll, caseSensitive, applyTo }),
    [search, replace, regex, matchAll, caseSensitive, applyTo]
  )

  const rows = useMemo(() => previewPowerRename(items, opts), [items, opts])

  const toggle = (path: string): void => {
    setChecked((c) => ({ ...c, [path]: !c[path] }))
  }

  const toggleAll = (on: boolean): void => {
    setChecked(Object.fromEntries(workingPaths.map((p) => [p, on])))
  }

  const canApply =
    search.length > 0 &&
    !busy &&
    rows.some((r) => checked[r.path] && r.willRename && !r.error)

  const onApply = async (): Promise<void> => {
    if (!canApply) return
    setBusy(true)
    try {
      const toRename = rows
        .filter((r) => checked[r.path] && r.willRename && !r.error)
        .map((r) => ({ path: r.path, newName: r.newName }))
      const { pairs, skipped } = await applyPowerRename(toRename)
      if (pairs.length > 0) {
        setLastApply(pairs)
        const renamed = new Map(pairs.map((p) => [p.from, p.to] as const))
        const nextPaths = workingPaths.map((p) => renamed.get(p) ?? p)
        setWorkingPaths(nextPaths)
        setChecked(Object.fromEntries(nextPaths.map((p) => [p, true])))
      }
      const parts: string[] = []
      if (pairs.length > 0) parts.push(`Renamed ${pairs.length}`)
      if (skipped.length > 0) parts.push(`skipped ${skipped.length}`)
      notify(
        parts.length > 0 ? parts.join(', ') : 'Nothing renamed',
        skipped.length > 0 && pairs.length === 0
      )
    } finally {
      setBusy(false)
    }
  }

  const onUndo = async (): Promise<void> => {
    if (!lastApply || busy) return
    setBusy(true)
    try {
      await undoPowerRenameApply(lastApply)
      const restored = new Map(lastApply.map((p) => [p.to, p.from] as const))
      const nextPaths = workingPaths.map((p) => restored.get(p) ?? p)
      setWorkingPaths(nextPaths)
      setChecked(Object.fromEntries(nextPaths.map((p) => [p, true])))
      setLastApply(null)
      notify('Power Rename undone')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      title="Power Rename"
      onClose={closeDialog}
      actions={
        <>
          <button type="button" className="btn" disabled={!lastApply || busy} onClick={() => void onUndo()}>
            Undo
          </button>
          <button type="button" className="btn" onClick={closeDialog}>
            Close
          </button>
          <button type="button" className="btn primary" disabled={!canApply} onClick={() => void onApply()}>
            Apply
          </button>
        </>
      }
    >
      <div className="power-rename-layout">
        <div className="power-rename-controls">
          <label className="power-rename-field">
            <span>Search for</span>
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              autoFocus
              spellCheck={false}
            />
          </label>
          <label className="power-rename-field">
            <span>Replace with</span>
            <input
              type="text"
              value={replace}
              onChange={(e) => setReplace(e.target.value)}
              spellCheck={false}
            />
          </label>
          <label className="power-rename-check">
            <input type="checkbox" checked={regex} onChange={(e) => setRegex(e.target.checked)} />
            Use regular expressions
          </label>
          <label className="power-rename-check">
            <input
              type="checkbox"
              checked={matchAll}
              onChange={(e) => setMatchAll(e.target.checked)}
            />
            Match all occurrences
          </label>
          <label className="power-rename-check">
            <input
              type="checkbox"
              checked={caseSensitive}
              onChange={(e) => setCaseSensitive(e.target.checked)}
            />
            Case sensitive
          </label>
          <label className="power-rename-field">
            <span>Apply to</span>
            <select
              value={applyTo}
              onChange={(e) => setApplyTo(e.target.value as PowerRenameApplyTo)}
            >
              <option value="full">Filename + extension</option>
              <option value="name">Filename only</option>
              <option value="ext">Extension only</option>
            </select>
          </label>
          <p className="power-rename-hint">
            Renames selected items only (files and folders). Does not recurse into folders.
          </p>
        </div>
        <div className="power-rename-preview">
          <div className="power-rename-preview-toolbar">
            <button type="button" className="btn btn-sm" onClick={() => toggleAll(true)}>
              Check all
            </button>
            <button type="button" className="btn btn-sm" onClick={() => toggleAll(false)}>
              Uncheck all
            </button>
            <span className="power-rename-preview-count">
              {rows.filter((r) => checked[r.path]).length} / {rows.length}
            </span>
          </div>
          <div className="power-rename-rows" role="list">
            {rows.map((row) => {
              const changed = row.willRename && !row.error
              return (
                <label
                  key={row.path}
                  className={[
                    'power-rename-row',
                    changed ? 'is-changed' : '',
                    row.error ? 'is-error' : '',
                    checked[row.path] === false ? 'is-unchecked' : ''
                  ]
                    .filter(Boolean)
                    .join(' ')}
                  role="listitem"
                >
                  <input
                    type="checkbox"
                    checked={checked[row.path] !== false}
                    onChange={() => toggle(row.path)}
                  />
                  <span className="power-rename-orig" title={row.originalName}>
                    {row.originalName}
                  </span>
                  <span className="power-rename-arrow" aria-hidden>
                    →
                  </span>
                  <span
                    className={['power-rename-new', changed ? 'is-changed' : ''].join(' ')}
                    title={row.error ?? row.newName}
                  >
                    {row.error ? `(${row.error})` : row.newName}
                  </span>
                </label>
              )
            })}
          </div>
        </div>
      </div>
    </Modal>
  )
}
