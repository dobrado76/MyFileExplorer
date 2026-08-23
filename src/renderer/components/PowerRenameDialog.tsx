import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type JSX,
  type PointerEvent as ReactPointerEvent,
  type ReactNode
} from 'react'
import {
  previewPowerRename,
  type PowerRenameApplyTo,
  type PowerRenameOptions
} from '@shared/powerRename'
import type { Settings } from '@shared/schemas/settings'
import { CloseIcon } from '../lib/icons'
import { useAppStore } from '../store/appStore'
import { basename } from '../lib/paths'
import type { UndoPathPair } from '../lib/undoHistory'

type Bounds = { x: number; y: number; width: number; height: number }
type ResizeEdge = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw'

const MIN_W = 640
const MIN_H = 420
const DEFAULT_W = 1040
const DEFAULT_H = 720

/** Keep option checkboxes stable if the dialog briefly remounts after an apply/refresh. */
let powerRenameFlagsDraft = {
  regex: false,
  matchAll: false,
  caseSensitive: false,
  applyTo: 'name' as PowerRenameApplyTo
}

function clampBounds(b: Bounds): Bounds {
  const vw = window.innerWidth
  const vh = window.innerHeight
  const maxW = Math.max(MIN_W, Math.floor(vw * 0.98))
  const maxH = Math.max(MIN_H, Math.floor(vh * 0.94))
  const width = Math.min(Math.max(Math.round(b.width), MIN_W), maxW)
  const height = Math.min(Math.max(Math.round(b.height), MIN_H), maxH)
  const x = Math.min(Math.max(Math.round(b.x), 0), Math.max(0, vw - width))
  const y = Math.min(Math.max(Math.round(b.y), 0), Math.max(0, vh - height))
  return { x, y, width, height }
}

function maximizedBounds(): Bounds {
  const pad = 6
  const vw = window.innerWidth
  const vh = window.innerHeight
  return {
    x: pad,
    y: pad,
    width: Math.max(MIN_W, vw - pad * 2),
    height: Math.max(MIN_H, vh - pad * 2)
  }
}

function defaultBounds(): Bounds {
  const vw = window.innerWidth
  const vh = window.innerHeight
  const width = Math.min(DEFAULT_W, Math.floor(vw * 0.96))
  const height = Math.min(DEFAULT_H, Math.floor(vh * 0.92))
  return clampBounds({
    x: (vw - width) / 2,
    y: (vh - height) / 2,
    width,
    height
  })
}

type StoredBounds = NonNullable<Settings['powerRenameBounds']>

function normalBoundsFromSettings(saved: Settings['powerRenameBounds']): Bounds {
  if (!saved) return defaultBounds()
  return clampBounds({ x: saved.x, y: saved.y, width: saved.width, height: saved.height })
}

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
  const applySettingsPatch = useAppStore((s) => s.applySettingsPatch)
  const savedBounds = useAppStore((s) => s.settings.powerRenameBounds)

  const [maximized, setMaximized] = useState(() => !!savedBounds?.maximized)
  const restoreBoundsRef = useRef<Bounds>(normalBoundsFromSettings(savedBounds))
  const [bounds, setBounds] = useState<Bounds>(() =>
    savedBounds?.maximized ? maximizedBounds() : normalBoundsFromSettings(savedBounds)
  )

  const boundsRef = useRef(bounds)
  useEffect(() => {
    boundsRef.current = bounds
  }, [bounds])
  const maximizedRef = useRef(maximized)
  useEffect(() => {
    maximizedRef.current = maximized
  }, [maximized])

  const dragRef = useRef<{
    kind: 'move' | ResizeEdge
    startX: number
    startY: number
    orig: Bounds
  } | null>(null)
  const endDragRef = useRef<() => void>(() => {})

  const persistState = useCallback(
    (normal: Bounds, isMax: boolean) => {
      const clamped = clampBounds(normal)
      const payload: StoredBounds = {
        ...clamped,
        maximized: isMax
      }
      void applySettingsPatch({ powerRenameBounds: payload })
    },
    [applySettingsPatch]
  )

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
      e.stopPropagation()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose])

  useEffect(() => {
    const onResize = (): void => {
      if (maximizedRef.current) {
        setBounds(maximizedBounds())
      } else {
        setBounds((b) => clampBounds(b))
      }
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  const toggleMaximize = useCallback((): void => {
    if (maximizedRef.current) {
      const restored = clampBounds(restoreBoundsRef.current)
      setBounds(restored)
      setMaximized(false)
      persistState(restored, false)
      return
    }
    restoreBoundsRef.current = boundsRef.current
    const next = maximizedBounds()
    setBounds(next)
    setMaximized(true)
    persistState(restoreBoundsRef.current, true)
  }, [persistState])

  const onPointerMove = useCallback((e: PointerEvent): void => {
    const drag = dragRef.current
    if (!drag || maximizedRef.current) return
    const dx = e.clientX - drag.startX
    const dy = e.clientY - drag.startY
    const o = drag.orig
    let next = { ...o }

    if (drag.kind === 'move') {
      next = { ...o, x: o.x + dx, y: o.y + dy }
    } else {
      const edge = drag.kind
      if (edge.includes('e')) next.width = o.width + dx
      if (edge.includes('s')) next.height = o.height + dy
      if (edge.includes('w')) {
        next.width = o.width - dx
        next.x = o.x + dx
      }
      if (edge.includes('n')) {
        next.height = o.height - dy
        next.y = o.y + dy
      }
      if (edge.includes('w') && next.width < MIN_W) {
        next.x = o.x + o.width - MIN_W
        next.width = MIN_W
      }
      if (edge.includes('n') && next.height < MIN_H) {
        next.y = o.y + o.height - MIN_H
        next.height = MIN_H
      }
    }
    setBounds(clampBounds(next))
  }, [])

  const onPointerUp = useCallback((): void => {
    endDragRef.current()
  }, [])

  useEffect(() => {
    endDragRef.current = (): void => {
      if (!dragRef.current) return
      dragRef.current = null
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', onPointerUp)
      window.removeEventListener('pointercancel', onPointerUp)
      if (!maximizedRef.current) {
        restoreBoundsRef.current = boundsRef.current
        persistState(boundsRef.current, false)
      }
    }
  }, [onPointerMove, onPointerUp, persistState])

  const onChromePointerDown = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>): void => {
      if (maximizedRef.current) return
      const kindAttr = e.currentTarget.dataset.dragKind
      const kind: 'move' | ResizeEdge =
        kindAttr === 'move' || !kindAttr ? 'move' : (kindAttr as ResizeEdge)
      e.preventDefault()
      e.stopPropagation()
      dragRef.current = {
        kind,
        startX: e.clientX,
        startY: e.clientY,
        orig: boundsRef.current
      }
      window.addEventListener('pointermove', onPointerMove)
      window.addEventListener('pointerup', onPointerUp)
      window.addEventListener('pointercancel', onPointerUp)
    },
    [onPointerMove, onPointerUp]
  )

  const edges: ResizeEdge[] = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw']

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        className={`modal modal-power-rename${maximized ? ' is-maximized' : ''}`}
        role="dialog"
        aria-label={title}
        style={{
          left: bounds.x,
          top: bounds.y,
          width: bounds.width,
          height: bounds.height
        }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        {!maximized &&
          edges.map((edge) => (
            <div
              key={edge}
              className={`modal-resize-handle ${edge}`}
              data-drag-kind={edge}
              onPointerDown={onChromePointerDown}
            />
          ))}
        <div
          className="modal-title modal-title-chrome"
          data-drag-kind="move"
          onPointerDown={onChromePointerDown}
          onDoubleClick={(e) => {
            e.preventDefault()
            toggleMaximize()
          }}
        >
          <span className="modal-title-text">{title}</span>
          <button
            type="button"
            className="modal-title-btn"
            aria-label={maximized ? 'Restore' : 'Maximize'}
            title={maximized ? 'Restore' : 'Maximize'}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation()
              toggleMaximize()
            }}
          >
            {maximized ? (
              <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden>
                <rect x="3" y="1" width="7" height="7" fill="none" stroke="currentColor" strokeWidth="1.2" />
                <rect x="1" y="3" width="7" height="7" fill="var(--bg, #1a1d24)" stroke="currentColor" strokeWidth="1.2" />
              </svg>
            ) : (
              <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden>
                <rect x="1.5" y="1.5" width="9" height="9" fill="none" stroke="currentColor" strokeWidth="1.2" />
              </svg>
            )}
          </button>
          <button
            type="button"
            className="modal-title-btn"
            aria-label="Close"
            title="Close"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation()
              onClose()
            }}
          >
            <CloseIcon size={16} />
          </button>
        </div>
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
  const [regex, setRegex] = useState(() => powerRenameFlagsDraft.regex)
  const [matchAll, setMatchAll] = useState(() => powerRenameFlagsDraft.matchAll)
  const [caseSensitive, setCaseSensitive] = useState(
    () => powerRenameFlagsDraft.caseSensitive
  )
  const [applyTo, setApplyTo] = useState<PowerRenameApplyTo>(() => powerRenameFlagsDraft.applyTo)
  const [checked, setChecked] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(paths.map((p) => [p, true]))
  )
  const [lastApply, setLastApply] = useState<UndoPathPair[] | null>(null)
  const [busy, setBusy] = useState(false)

  const opts: PowerRenameOptions = useMemo(
    () => ({ search, replace, regex, matchAll, caseSensitive, applyTo }),
    [search, replace, regex, matchAll, caseSensitive, applyTo]
  )

  useEffect(() => {
    powerRenameFlagsDraft = { regex, matchAll, caseSensitive, applyTo }
  }, [regex, matchAll, caseSensitive, applyTo])

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
