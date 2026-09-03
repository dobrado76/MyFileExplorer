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
  countActiveAdvanced,
  defaultPowerRenameAdvanced,
  previewPowerRename,
  type PowerRenameAdvanced,
  type PowerRenameApplyTo,
  type PowerRenameCaseMode,
  type PowerRenameCropMode,
  type PowerRenameDateFmt,
  type PowerRenameDateMode,
  type PowerRenameDateType,
  type PowerRenameExtMode,
  type PowerRenameLeadDots,
  type PowerRenameMoveMode,
  type PowerRenameNameMode,
  type PowerRenameNumberType,
  type PowerRenameOptions,
  type PowerRenamePlaceMode
} from '@shared/powerRename'
import type { Settings } from '@shared/schemas/settings'
import { CloseIcon } from '../lib/icons'
import { useAppStore } from '../store/appStore'
import { basename, samePath } from '../lib/paths'
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
  applyTo: 'name' as PowerRenameApplyTo,
  advancedOpen: false,
  advanced: defaultPowerRenameAdvanced()
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
  const listingEntries = useAppStore((s) => s.listing.entries)

  const [workingPaths, setWorkingPaths] = useState(paths)
  const items = useMemo(
    () =>
      workingPaths.map((path) => {
        const e = listingEntries.find((en) => samePath(en.path, path))
        return {
          path,
          name: basename(path),
          kind: e?.kind,
          mtimeMs: e?.mtimeMs,
          birthtimeMs: e?.birthtimeMs
        }
      }),
    [workingPaths, listingEntries]
  )

  const [search, setSearch] = useState('')
  const [replace, setReplace] = useState('')
  const [regex, setRegex] = useState(() => powerRenameFlagsDraft.regex)
  const [matchAll, setMatchAll] = useState(() => powerRenameFlagsDraft.matchAll)
  const [caseSensitive, setCaseSensitive] = useState(
    () => powerRenameFlagsDraft.caseSensitive
  )
  const [applyTo, setApplyTo] = useState<PowerRenameApplyTo>(() => powerRenameFlagsDraft.applyTo)
  const [advancedOpen, setAdvancedOpen] = useState(() => powerRenameFlagsDraft.advancedOpen)
  const [advanced, setAdvanced] = useState<PowerRenameAdvanced>(
    () => structuredClone(powerRenameFlagsDraft.advanced)
  )
  const [checked, setChecked] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(paths.map((p) => [p, true]))
  )
  const [lastApply, setLastApply] = useState<UndoPathPair[] | null>(null)
  const [busy, setBusy] = useState(false)

  const patchAdvanced = useCallback((patch: Partial<PowerRenameAdvanced>): void => {
    setAdvanced((a) => ({ ...a, ...patch }))
  }, [])

  const opts: PowerRenameOptions = useMemo(
    () => ({ search, replace, regex, matchAll, caseSensitive, applyTo, advanced }),
    [search, replace, regex, matchAll, caseSensitive, applyTo, advanced]
  )

  useEffect(() => {
    powerRenameFlagsDraft = {
      regex,
      matchAll,
      caseSensitive,
      applyTo,
      advancedOpen,
      advanced: structuredClone(advanced)
    }
  }, [regex, matchAll, caseSensitive, applyTo, advancedOpen, advanced])

  const rows = useMemo(() => previewPowerRename(items, opts), [items, opts])
  const activeAdv = countActiveAdvanced(advanced)

  // Dim + auto-uncheck rows excluded by selection filter; re-check when included again.
  useEffect(() => {
    setChecked((prev) => {
      let changed = false
      const next = { ...prev }
      for (const row of rows) {
        if (row.excluded) {
          if (next[row.path] !== false) {
            next[row.path] = false
            changed = true
          }
        }
      }
      return changed ? next : prev
    })
  }, [rows])

  const toggle = (path: string): void => {
    setChecked((c) => ({ ...c, [path]: !c[path] }))
  }

  const toggleAll = (on: boolean): void => {
    setChecked(
      Object.fromEntries(
        rows.map((r) => [r.path, on && !r.excluded])
      )
    )
  }

  const canApply =
    !busy && rows.some((r) => !r.excluded && checked[r.path] && r.willRename && !r.error)

  const onApply = async (): Promise<void> => {
    if (!canApply) return
    setBusy(true)
    try {
      const toRename = rows
        .filter((r) => !r.excluded && checked[r.path] && r.willRename && !r.error)
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

  const move1 = advanced.move1
  const move2 = advanced.move2

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
              placeholder={regex ? 'Regular expression' : 'Text or * ? wildcards'}
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
            {regex
              ? 'Search uses JavaScript regular expressions. Capture groups: $1, $2…'
              : 'Use * and ? as DOS wildcards (any run / one character), or turn on regular expressions.'}{' '}
            Renames the selection only — does not recurse into folders.
          </p>

          <div className="power-rename-advanced">
            <button
              type="button"
              className="power-rename-advanced-toggle"
              aria-expanded={advancedOpen}
              onClick={() => setAdvancedOpen((o) => !o)}
            >
              <span className="power-rename-advanced-chevron" aria-hidden>
                {advancedOpen ? '▾' : '▸'}
              </span>
              Advanced options
              {activeAdv > 0 ? (
                <span className="power-rename-advanced-badge">{activeAdv} active</span>
              ) : null}
            </button>
            {advancedOpen ? (
              <div className="power-rename-advanced-body">
                <div className="power-rename-advanced-toolbar">
                  <button
                    type="button"
                    className="btn btn-sm"
                    onClick={() => setAdvanced(defaultPowerRenameAdvanced())}
                  >
                    Reset advanced
                  </button>
                </div>
                <div className="power-rename-panels">
                  <fieldset className="power-rename-panel">
                    <legend>2 · Name</legend>
                    <label className="power-rename-field">
                      <span>Mode</span>
                      <select
                        value={advanced.nameMode}
                        onChange={(e) =>
                          patchAdvanced({ nameMode: e.target.value as PowerRenameNameMode })
                        }
                      >
                        <option value="keep">Keep</option>
                        <option value="remove">Remove</option>
                        <option value="fixed">Fixed</option>
                      </select>
                    </label>
                    <label className="power-rename-field">
                      <span>Fixed text</span>
                      <input
                        type="text"
                        value={advanced.nameFixed}
                        disabled={advanced.nameMode !== 'fixed'}
                        onChange={(e) => patchAdvanced({ nameFixed: e.target.value })}
                        spellCheck={false}
                      />
                    </label>
                  </fieldset>

                  <fieldset className="power-rename-panel">
                    <legend>4 · Case</legend>
                    <label className="power-rename-field">
                      <span>Mode</span>
                      <select
                        value={advanced.caseMode}
                        onChange={(e) =>
                          patchAdvanced({ caseMode: e.target.value as PowerRenameCaseMode })
                        }
                      >
                        <option value="same">Same</option>
                        <option value="lower">Lower</option>
                        <option value="upper">Upper</option>
                        <option value="title">Title</option>
                        <option value="sentence">Sentence</option>
                      </select>
                    </label>
                    <label className="power-rename-field">
                      <span>Except</span>
                      <input
                        type="text"
                        value={advanced.caseExcept}
                        onChange={(e) => patchAdvanced({ caseExcept: e.target.value })}
                        spellCheck={false}
                        placeholder="words to keep"
                      />
                    </label>
                  </fieldset>

                  <fieldset className="power-rename-panel power-rename-panel-wide">
                    <legend>5 · Remove</legend>
                    <div className="power-rename-inline">
                      <label className="power-rename-field">
                        <span>First n</span>
                        <input
                          type="number"
                          min={0}
                          value={advanced.removeFirst}
                          onChange={(e) =>
                            patchAdvanced({ removeFirst: Number(e.target.value) || 0 })
                          }
                        />
                      </label>
                      <label className="power-rename-field">
                        <span>Last n</span>
                        <input
                          type="number"
                          min={0}
                          value={advanced.removeLast}
                          onChange={(e) =>
                            patchAdvanced({ removeLast: Number(e.target.value) || 0 })
                          }
                        />
                      </label>
                      <label className="power-rename-field">
                        <span>From</span>
                        <input
                          type="number"
                          min={0}
                          value={advanced.removeFrom}
                          onChange={(e) =>
                            patchAdvanced({ removeFrom: Number(e.target.value) || 0 })
                          }
                        />
                      </label>
                      <label className="power-rename-field">
                        <span>To</span>
                        <input
                          type="number"
                          min={0}
                          value={advanced.removeTo}
                          onChange={(e) =>
                            patchAdvanced({ removeTo: Number(e.target.value) || 0 })
                          }
                        />
                      </label>
                    </div>
                    <label className="power-rename-field">
                      <span>Chars</span>
                      <input
                        type="text"
                        value={advanced.removeChars}
                        onChange={(e) => patchAdvanced({ removeChars: e.target.value })}
                        spellCheck={false}
                      />
                    </label>
                    <label className="power-rename-field">
                      <span>Words</span>
                      <input
                        type="text"
                        value={advanced.removeWords}
                        onChange={(e) => patchAdvanced({ removeWords: e.target.value })}
                        spellCheck={false}
                      />
                    </label>
                    <div className="power-rename-inline">
                      <label className="power-rename-field">
                        <span>Crop</span>
                        <select
                          value={advanced.cropMode}
                          onChange={(e) =>
                            patchAdvanced({ cropMode: e.target.value as PowerRenameCropMode })
                          }
                        >
                          <option value="none">None</option>
                          <option value="before">Before</option>
                          <option value="after">After</option>
                        </select>
                      </label>
                      <label className="power-rename-field">
                        <span>Crop text</span>
                        <input
                          type="text"
                          value={advanced.cropText}
                          onChange={(e) => patchAdvanced({ cropText: e.target.value })}
                          spellCheck={false}
                        />
                      </label>
                    </div>
                    <div className="power-rename-checks">
                      {(
                        [
                          ['removeDigits', 'Digits'],
                          ['removeHighAscii', 'High'],
                          ['removeTrim', 'Trim'],
                          ['removeDs', 'D/S'],
                          ['removeAccents', 'Accents'],
                          ['removeLetters', 'Chars'],
                          ['removeSymbols', 'Sym.']
                        ] as const
                      ).map(([key, label]) => (
                        <label key={key} className="power-rename-check">
                          <input
                            type="checkbox"
                            checked={advanced[key]}
                            onChange={(e) => patchAdvanced({ [key]: e.target.checked })}
                          />
                          {label}
                        </label>
                      ))}
                    </div>
                    <label className="power-rename-field">
                      <span>Lead dots</span>
                      <select
                        value={advanced.leadDots}
                        onChange={(e) =>
                          patchAdvanced({ leadDots: e.target.value as PowerRenameLeadDots })
                        }
                      >
                        <option value="same">Same</option>
                        <option value="remove">Remove</option>
                        <option value="keep-one">Keep one</option>
                      </select>
                    </label>
                  </fieldset>

                  <fieldset className="power-rename-panel power-rename-panel-wide">
                    <legend>6 · Move / Copy</legend>
                    {(
                      [
                        [move1, 'move1', '1'] as const,
                        [move2, 'move2', '2'] as const
                      ] as const
                    ).map(([seg, key, label]) => (
                      <div key={key} className="power-rename-inline">
                        <label className="power-rename-field">
                          <span>Seg {label}</span>
                          <select
                            value={seg.mode}
                            onChange={(e) =>
                              patchAdvanced({
                                [key]: {
                                  ...seg,
                                  mode: e.target.value as PowerRenameMoveMode
                                }
                              })
                            }
                          >
                            <option value="none">None</option>
                            <option value="move">Move</option>
                            <option value="copy">Copy</option>
                          </select>
                        </label>
                        <label className="power-rename-field">
                          <span>From</span>
                          <input
                            type="number"
                            min={0}
                            value={seg.from}
                            onChange={(e) =>
                              patchAdvanced({
                                [key]: { ...seg, from: Number(e.target.value) || 0 }
                              })
                            }
                          />
                        </label>
                        <label className="power-rename-field">
                          <span>To</span>
                          <input
                            type="number"
                            min={0}
                            value={seg.to}
                            onChange={(e) =>
                              patchAdvanced({
                                [key]: { ...seg, to: Number(e.target.value) || 0 }
                              })
                            }
                          />
                        </label>
                        <label className="power-rename-field">
                          <span>Sep.</span>
                          <input
                            type="text"
                            value={seg.sep}
                            onChange={(e) =>
                              patchAdvanced({ [key]: { ...seg, sep: e.target.value } })
                            }
                            spellCheck={false}
                          />
                        </label>
                      </div>
                    ))}
                  </fieldset>

                  <fieldset className="power-rename-panel">
                    <legend>7 · Add</legend>
                    <label className="power-rename-field">
                      <span>Prefix</span>
                      <input
                        type="text"
                        value={advanced.addPrefix}
                        onChange={(e) => patchAdvanced({ addPrefix: e.target.value })}
                        spellCheck={false}
                      />
                    </label>
                    <div className="power-rename-inline">
                      <label className="power-rename-field">
                        <span>Insert</span>
                        <input
                          type="text"
                          value={advanced.addInsert}
                          onChange={(e) => patchAdvanced({ addInsert: e.target.value })}
                          spellCheck={false}
                        />
                      </label>
                      <label className="power-rename-field">
                        <span>At pos.</span>
                        <input
                          type="number"
                          min={0}
                          value={advanced.addInsertAt}
                          onChange={(e) =>
                            patchAdvanced({ addInsertAt: Number(e.target.value) || 0 })
                          }
                        />
                      </label>
                    </div>
                    <label className="power-rename-field">
                      <span>Suffix</span>
                      <input
                        type="text"
                        value={advanced.addSuffix}
                        onChange={(e) => patchAdvanced({ addSuffix: e.target.value })}
                        spellCheck={false}
                      />
                    </label>
                  </fieldset>

                  <fieldset className="power-rename-panel">
                    <legend>8 · Auto date</legend>
                    <label className="power-rename-field">
                      <span>Mode</span>
                      <select
                        value={advanced.dateMode}
                        onChange={(e) =>
                          patchAdvanced({ dateMode: e.target.value as PowerRenameDateMode })
                        }
                      >
                        <option value="none">None</option>
                        <option value="prefix">Prefix</option>
                        <option value="suffix">Suffix</option>
                      </select>
                    </label>
                    <label className="power-rename-field">
                      <span>Type</span>
                      <select
                        value={advanced.dateType}
                        onChange={(e) =>
                          patchAdvanced({ dateType: e.target.value as PowerRenameDateType })
                        }
                      >
                        <option value="modified">Modified</option>
                        <option value="created">Created</option>
                        <option value="current">Current</option>
                      </select>
                    </label>
                    <label className="power-rename-field">
                      <span>Fmt</span>
                      <select
                        value={advanced.dateFmt}
                        onChange={(e) =>
                          patchAdvanced({ dateFmt: e.target.value as PowerRenameDateFmt })
                        }
                      >
                        <option value="ymd">YMD</option>
                        <option value="ydm">YDM</option>
                        <option value="dmy">DMY</option>
                        <option value="mdy">MDY</option>
                        <option value="ymd-hms">YMD HMS</option>
                        <option value="unix">Unix</option>
                      </select>
                    </label>
                    <div className="power-rename-inline">
                      <label className="power-rename-field">
                        <span>Sep.</span>
                        <input
                          type="text"
                          value={advanced.dateSep}
                          onChange={(e) => patchAdvanced({ dateSep: e.target.value })}
                          spellCheck={false}
                        />
                      </label>
                      <label className="power-rename-field">
                        <span>Seg.</span>
                        <input
                          type="text"
                          value={advanced.dateSeg}
                          onChange={(e) => patchAdvanced({ dateSeg: e.target.value })}
                          spellCheck={false}
                        />
                      </label>
                      <label className="power-rename-field">
                        <span>Off. days</span>
                        <input
                          type="number"
                          value={advanced.dateOffsetDays}
                          onChange={(e) =>
                            patchAdvanced({ dateOffsetDays: Number(e.target.value) || 0 })
                          }
                        />
                      </label>
                    </div>
                  </fieldset>

                  <fieldset className="power-rename-panel">
                    <legend>9 · Append folder</legend>
                    <label className="power-rename-field">
                      <span>Mode</span>
                      <select
                        value={advanced.folderMode}
                        onChange={(e) =>
                          patchAdvanced({
                            folderMode: e.target.value as PowerRenamePlaceMode
                          })
                        }
                      >
                        <option value="none">None</option>
                        <option value="prefix">Prefix</option>
                        <option value="suffix">Suffix</option>
                      </select>
                    </label>
                    <div className="power-rename-inline">
                      <label className="power-rename-field">
                        <span>Sep.</span>
                        <input
                          type="text"
                          value={advanced.folderSep}
                          onChange={(e) => patchAdvanced({ folderSep: e.target.value })}
                          spellCheck={false}
                        />
                      </label>
                      <label className="power-rename-field">
                        <span>Levels</span>
                        <input
                          type="number"
                          min={1}
                          value={advanced.folderLevels}
                          onChange={(e) =>
                            patchAdvanced({ folderLevels: Math.max(1, Number(e.target.value) || 1) })
                          }
                        />
                      </label>
                    </div>
                  </fieldset>

                  <fieldset className="power-rename-panel">
                    <legend>10 · Numbering</legend>
                    <label className="power-rename-field">
                      <span>Mode</span>
                      <select
                        value={advanced.numberMode}
                        onChange={(e) =>
                          patchAdvanced({
                            numberMode: e.target.value as PowerRenamePlaceMode
                          })
                        }
                      >
                        <option value="none">None</option>
                        <option value="prefix">Prefix</option>
                        <option value="suffix">Suffix</option>
                        <option value="insert">Insert</option>
                      </select>
                    </label>
                    <div className="power-rename-inline">
                      <label className="power-rename-field">
                        <span>Start</span>
                        <input
                          type="number"
                          value={advanced.numberStart}
                          onChange={(e) =>
                            patchAdvanced({ numberStart: Number(e.target.value) || 0 })
                          }
                        />
                      </label>
                      <label className="power-rename-field">
                        <span>Incr.</span>
                        <input
                          type="number"
                          value={advanced.numberIncr}
                          onChange={(e) =>
                            patchAdvanced({ numberIncr: Number(e.target.value) || 0 })
                          }
                        />
                      </label>
                      <label className="power-rename-field">
                        <span>Pad</span>
                        <input
                          type="number"
                          min={0}
                          value={advanced.numberPad}
                          onChange={(e) =>
                            patchAdvanced({ numberPad: Number(e.target.value) || 0 })
                          }
                        />
                      </label>
                    </div>
                    <div className="power-rename-inline">
                      <label className="power-rename-field">
                        <span>Type</span>
                        <select
                          value={advanced.numberType}
                          onChange={(e) =>
                            patchAdvanced({
                              numberType: e.target.value as PowerRenameNumberType
                            })
                          }
                        >
                          <option value="decimal">Decimal</option>
                          <option value="hex">Hex</option>
                          <option value="roman">Roman</option>
                        </select>
                      </label>
                      <label className="power-rename-field">
                        <span>At</span>
                        <input
                          type="number"
                          min={0}
                          value={advanced.numberAt}
                          onChange={(e) =>
                            patchAdvanced({ numberAt: Number(e.target.value) || 0 })
                          }
                        />
                      </label>
                      <label className="power-rename-field">
                        <span>Sep.</span>
                        <input
                          type="text"
                          value={advanced.numberSep}
                          onChange={(e) => patchAdvanced({ numberSep: e.target.value })}
                          spellCheck={false}
                        />
                      </label>
                    </div>
                    <label className="power-rename-check">
                      <input
                        type="checkbox"
                        checked={advanced.numberResetPerFolder}
                        onChange={(e) =>
                          patchAdvanced({ numberResetPerFolder: e.target.checked })
                        }
                      />
                      Reset per folder
                    </label>
                  </fieldset>

                  <fieldset className="power-rename-panel">
                    <legend>11 · Extension</legend>
                    <label className="power-rename-field">
                      <span>Mode</span>
                      <select
                        value={advanced.extMode}
                        onChange={(e) =>
                          patchAdvanced({ extMode: e.target.value as PowerRenameExtMode })
                        }
                      >
                        <option value="same">Same</option>
                        <option value="lower">Lower</option>
                        <option value="upper">Upper</option>
                        <option value="fixed">Fixed</option>
                        <option value="remove">Remove</option>
                      </select>
                    </label>
                    <label className="power-rename-field">
                      <span>Fixed ext</span>
                      <input
                        type="text"
                        value={advanced.extFixed}
                        disabled={advanced.extMode !== 'fixed'}
                        onChange={(e) => patchAdvanced({ extFixed: e.target.value })}
                        spellCheck={false}
                        placeholder="jpg"
                      />
                    </label>
                  </fieldset>

                  <fieldset className="power-rename-panel power-rename-panel-wide">
                    <legend>12 · Selection filter</legend>
                    <label className="power-rename-field">
                      <span>Filter</span>
                      <input
                        type="text"
                        value={advanced.filter}
                        onChange={(e) => patchAdvanced({ filter: e.target.value })}
                        spellCheck={false}
                        placeholder="*.jpg or regex"
                      />
                    </label>
                    <div className="power-rename-checks">
                      <label className="power-rename-check">
                        <input
                          type="checkbox"
                          checked={advanced.filterRegex}
                          onChange={(e) => patchAdvanced({ filterRegex: e.target.checked })}
                        />
                        Regex
                      </label>
                      <label className="power-rename-check">
                        <input
                          type="checkbox"
                          checked={advanced.filterMatchCase}
                          onChange={(e) => patchAdvanced({ filterMatchCase: e.target.checked })}
                        />
                        Match case
                      </label>
                      <label className="power-rename-check">
                        <input
                          type="checkbox"
                          checked={advanced.filterFiles}
                          onChange={(e) => patchAdvanced({ filterFiles: e.target.checked })}
                        />
                        Files
                      </label>
                      <label className="power-rename-check">
                        <input
                          type="checkbox"
                          checked={advanced.filterFolders}
                          onChange={(e) => patchAdvanced({ filterFolders: e.target.checked })}
                        />
                        Folders
                      </label>
                    </div>
                    <div className="power-rename-inline">
                      <label className="power-rename-field">
                        <span>Min name len</span>
                        <input
                          type="number"
                          min={0}
                          value={advanced.filterMinNameLen}
                          onChange={(e) =>
                            patchAdvanced({ filterMinNameLen: Number(e.target.value) || 0 })
                          }
                        />
                      </label>
                      <label className="power-rename-field">
                        <span>Max name len</span>
                        <input
                          type="number"
                          min={0}
                          value={advanced.filterMaxNameLen}
                          onChange={(e) =>
                            patchAdvanced({ filterMaxNameLen: Number(e.target.value) || 0 })
                          }
                        />
                      </label>
                    </div>
                  </fieldset>
                </div>
              </div>
            ) : null}
          </div>
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
              {rows.filter((r) => checked[r.path] && !r.excluded).length} / {rows.length}
            </span>
          </div>
          <div className="power-rename-rows" role="list">
            {rows.map((row) => {
              const changed = row.willRename && !row.error
              return (
                <div
                  key={row.path}
                  className={[
                    'power-rename-row',
                    changed ? 'is-changed' : '',
                    row.error ? 'is-error' : '',
                    row.excluded ? 'is-excluded' : '',
                    checked[row.path] === false ? 'is-unchecked' : ''
                  ]
                    .filter(Boolean)
                    .join(' ')}
                  role="listitem"
                >
                  <input
                    type="checkbox"
                    aria-label={`Select ${row.originalName}`}
                    checked={!row.excluded && checked[row.path] !== false}
                    disabled={!!row.excluded}
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
                    title={row.excluded ? 'Excluded by filter' : (row.error ?? row.newName)}
                  >
                    {row.excluded
                      ? '(excluded)'
                      : row.error
                        ? `(${row.error})`
                        : row.newName}
                  </span>
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </Modal>
  )
}

