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
import { useVirtualizer } from '@tanstack/react-virtual'
import type { Settings } from '@shared/schemas/settings'
import type { UndeleteCandidate, UndeleteStatus } from '@shared/schemas/undelete'
import { CircleHelp } from 'lucide-react'
import { CloseIcon } from '../lib/icons'
import { useAppStore } from '../store/appStore'
import { api, call } from '../lib/ipc'
import { formatBytes, formatDate } from '../lib/format'

const UNDELETE_HELP =
  'Recycle Bin / Ctrl+Z undo everyday deletes. This tool recovers files after Empty, Shift+Del, or permanent unlink while MFT records and clusters remain — best-effort, not TRIM/overwrite miracle recovery. The list includes deleted folders (for path context); Recover writes files only and recreates their parent folders under the destination (not a flat dump). Progress walks the whole $MFT via its data runlist (not just the first fragment) — on a large volume that can be tens of millions of records; deleted items are a small subset.'

type Bounds = { x: number; y: number; width: number; height: number }
type ResizeEdge = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw'

const MIN_W = 720
const MIN_H = 480
const DEFAULT_W = 1080
const DEFAULT_H = 720
const ROW_H = 28

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

type StoredBounds = NonNullable<Settings['undeleteBounds']>

function normalBoundsFromSettings(saved: Settings['undeleteBounds']): Bounds {
  if (!saved) return defaultBounds()
  return clampBounds({ x: saved.x, y: saved.y, width: saved.width, height: saved.height })
}

function statusLabel(s: UndeleteStatus): string {
  if (s === 'good') return 'Good'
  if (s === 'poor') return 'Poor'
  return 'Unrecoverable'
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
  const savedBounds = useAppStore((s) => s.settings.undeleteBounds)

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
      void applySettingsPatch({ undeleteBounds: payload })
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
        className={`modal modal-undelete${maximized ? ' is-maximized' : ''}`}
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
            {maximized ? '❐' : '□'}
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
            <CloseIcon />
          </button>
        </div>
        <div className="modal-body modal-body-undelete">{children}</div>
        <div className="modal-actions">{actions}</div>
      </div>
    </div>
  )
}

function volumeLetter(path: string | undefined): string {
  if (!path) return ''
  const m = path.trim().match(/^([A-Za-z]):/)
  return m ? m[1]!.toUpperCase() : ''
}

export function UndeleteDialog({ volume }: { volume?: string }): JSX.Element {
  const closeDialog = useAppStore((s) => s.closeDialog)
  const notify = useAppStore((s) => s.notify)
  const drives = useAppStore((s) => s.drives)

  const localLetters = useMemo(() => {
    return drives
      .filter((d) => d.driveType !== 'remote' && d.driveType !== 'cdrom' && !d.offline)
      .map((d) => volumeLetter(d.path))
      .filter(Boolean)
      .sort()
  }, [drives])

  const [letter, setLetter] = useState(() => {
    const fromProp = volumeLetter(volume)
    if (fromProp && localLetters.includes(fromProp)) return fromProp
    return localLetters[0] ?? fromProp ?? 'C'
  })
  const [filter, setFilter] = useState('')
  const [items, setItems] = useState<UndeleteCandidate[]>([])
  const [selected, setSelected] = useState<Set<string>>(() => new Set())
  const [elevated, setElevated] = useState(false)
  const [busy, setBusy] = useState<'idle' | 'scan' | 'recover'>('idle')
  const [statusMsg, setStatusMsg] = useState('')
  const [helpOpen, setHelpOpen] = useState(false)
  const [progress, setProgress] = useState<{
    phase: 'scan' | 'recover'
    done: number
    total: number
    found?: number
    current?: string
    elevated?: boolean
  } | null>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const recoverCancelRef = useRef(false)

  useEffect(() => {
    return api.onEvent((ev) => {
      if (ev.type !== 'undelete-progress') return
      setProgress(ev.payload)
    })
  }, [])

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase()
    if (!q) return items
    return items.filter(
      (it) =>
        it.name.toLowerCase().includes(q) ||
        (it.pathHint?.toLowerCase().includes(q) ?? false)
    )
  }, [items, filter])

  const virtualizer = useVirtualizer({
    count: filtered.length,
    getScrollElement: () => listRef.current,
    estimateSize: () => ROW_H,
    overscan: 12
  })

  // Selection only ever stores recoverable file tokens — count is O(1).
  const selectedRecoverable = selected.size

  const selectableCount = useMemo(() => {
    let n = 0
    for (const it of filtered) {
      if (it.status !== 'unrecoverable' && !it.isDir) n++
    }
    return n
  }, [filtered])

  const onClose = useCallback((): void => {
    if (busy !== 'idle') {
      recoverCancelRef.current = true
      void call(api.undelete.cancel())
    }
    closeDialog()
  }, [busy, closeDialog])

  const runScan = useCallback(async (): Promise<void> => {
    if (!letter) {
      notify('Pick a drive letter', true)
      return
    }
    setBusy('scan')
    setProgress({ phase: 'scan', done: 0, total: 0, found: 0 })
    setStatusMsg('Scanning MFT for deleted files…')
    setItems([])
    setSelected(new Set())
    try {
      const res = await call(api.undelete.scan({ volume: `${letter}:` }))
      setItems(res.items)
      setElevated(res.elevated)
      setStatusMsg(
        `Found ${res.items.length.toLocaleString()} deleted item${res.items.length === 1 ? '' : 's'}` +
          ` · walked ${res.scannedRecords.toLocaleString()} / MFT` +
          (res.elevated ? ' · elevated' : '')
      )
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      setStatusMsg(msg.toLowerCase().includes('cancel') ? 'Cancelled' : '')
      if (!msg.toLowerCase().includes('cancel')) notify(msg, true)
    } finally {
      setBusy('idle')
      setProgress(null)
    }
  }, [letter, notify])

  const runRecover = useCallback(async (): Promise<void> => {
    // Open the folder picker immediately — never scan the selection first.
    if (selected.size === 0) {
      notify('Select at least one recoverable file', true)
      return
    }
    const folderRes = await call(api.app.pickFolder())
    if (!folderRes?.path) return

    const total = selected.size
    recoverCancelRef.current = false
    // Paint progress UI before any heavy work (spreading selection / IPC).
    setBusy('recover')
    setProgress({ phase: 'recover', done: 0, total })
    setStatusMsg(`Preparing recover of ${total.toLocaleString()} file${total === 1 ? '' : 's'}…`)
    await new Promise<void>((r) => setTimeout(r, 0))

    const tokens = [...selected]
    if (tokens.length === 0) {
      setBusy('idle')
      setProgress(null)
      notify('Select at least one recoverable file', true)
      return
    }
    setStatusMsg(`Recovering ${tokens.length.toLocaleString()} file${tokens.length === 1 ? '' : 's'}…`)
    setProgress({ phase: 'recover', done: 0, total: tokens.length })
    await new Promise<void>((r) => setTimeout(r, 0))

    // Small chunks keep IPC payloads light and the progress bar moving.
    const CHUNK = 48
    let ok = 0
    let fail = 0
    const failReasons = new Map<string, number>()
    let elevated = false
    let cancelled = false
    try {
      for (let i = 0; i < tokens.length; i += CHUNK) {
        if (recoverCancelRef.current) {
          cancelled = true
          break
        }
        const chunk = tokens.slice(i, i + CHUNK)
        const keepOpen = i + CHUNK < tokens.length
        setProgress({ phase: 'recover', done: i, total: tokens.length })
        const res = await call(
          api.undelete.recover({
            volume: `${letter}:`,
            tokens: chunk,
            destDir: folderRes.path,
            progressOffset: i,
            progressTotal: tokens.length,
            keepOpen
          })
        )
        elevated = elevated || res.elevated
        ok += res.recovered.length
        fail += res.failed.length
        for (const f of res.failed) {
          failReasons.set(f.message, (failReasons.get(f.message) ?? 0) + 1)
        }
        const done = Math.min(i + chunk.length, tokens.length)
        const pct = tokens.length ? Math.min(100, Math.round((100 * done) / tokens.length)) : 0
        setProgress({
          phase: 'recover',
          done,
          total: tokens.length,
          elevated: res.elevated || undefined,
          current: res.elevated ? 'Queuing / elevated…' : undefined
        })
        setStatusMsg(
          `Processed ${pct}% · ${done.toLocaleString()} / ${tokens.length.toLocaleString()}` +
            ` · wrote ${ok.toLocaleString()}` +
            (fail ? ` · failed ${fail.toLocaleString()}` : '')
        )
      }
      const topFails = [...failReasons.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([msg, n]) => `${msg} (${n.toLocaleString()})`)
      if (cancelled || recoverCancelRef.current) {
        setStatusMsg(
          `Cancelled · wrote ${ok.toLocaleString()}` +
            (fail ? ` · failed ${fail.toLocaleString()}` : '')
        )
      } else {
        setStatusMsg(
          `Wrote ${ok.toLocaleString()} of ${tokens.length.toLocaleString()}` +
            (fail ? ` · ${fail.toLocaleString()} failed` : '') +
            (elevated ? ' · elevated' : '') +
            (topFails.length ? ` · ${topFails[0]}` : '')
        )
        if (ok) {
          notify(`Wrote ${ok.toLocaleString()} file${ok === 1 ? '' : 's'} to ${folderRes.path}`)
        }
        if (fail) {
          notify(
            `Failed ${fail.toLocaleString()}: ${topFails.join('; ')}`,
            true
          )
        }
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      setStatusMsg(msg.toLowerCase().includes('cancel') ? 'Cancelled' : '')
      if (!msg.toLowerCase().includes('cancel')) notify(msg, true)
      void call(api.undelete.cancel())
    } finally {
      setBusy('idle')
      setProgress(null)
    }
  }, [selected, letter, notify])

  const cancelOp = useCallback((): void => {
    recoverCancelRef.current = true
    void call(api.undelete.cancel())
    setStatusMsg('Cancelling…')
  }, [])

  const toggleToken = (token: string, status: UndeleteStatus, isDir: boolean): void => {
    if (status === 'unrecoverable' || isDir) return
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(token)) next.delete(token)
      else next.add(token)
      return next
    })
  }

  const selectAllFiltered = (): void => {
    // Build once — do not merge with prev (avoids walking two huge sets).
    const next = new Set<string>()
    for (const it of filtered) {
      if (it.status !== 'unrecoverable' && !it.isDir) next.add(it.token)
    }
    setSelected(next)
  }

  const clearSelection = (): void => setSelected(new Set())

  return (
    <Modal
      title="NTFS Undelete"
      onClose={onClose}
      actions={
        <>
          <button
            type="button"
            className="btn"
            disabled={busy === 'idle'}
            onClick={cancelOp}
          >
            Cancel
          </button>
          <button type="button" className="btn" onClick={onClose} disabled={busy !== 'idle'}>
            Close
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={busy !== 'idle' || selectedRecoverable === 0}
            onClick={() => void runRecover()}
          >
            Recover…
          </button>
        </>
      }
    >
      <div className="undelete-toolbar">
        <button
          type="button"
          className="icon-btn undelete-help-btn"
          aria-label="About NTFS Undelete"
          aria-expanded={helpOpen}
          title="About NTFS Undelete"
          disabled={busy !== 'idle'}
          onClick={() => setHelpOpen((v) => !v)}
        >
          <CircleHelp size={16} />
        </button>
        <label className="undelete-field">
          Volume
          <select
            value={letter}
            disabled={busy !== 'idle'}
            onChange={(e) => setLetter(e.target.value.toUpperCase())}
          >
            {(localLetters.length ? localLetters : [letter || 'C']).map((L) => (
              <option key={L} value={L}>
                {L}:
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className="btn btn-primary"
          disabled={busy !== 'idle' || !letter}
          onClick={() => void runScan()}
        >
          {busy === 'scan' ? 'Scanning…' : 'Scan'}
        </button>
        <label className="undelete-field undelete-filter">
          Filter
          <input
            type="search"
            value={filter}
            placeholder="Filter name or path…"
            disabled={busy !== 'idle'}
            onChange={(e) => setFilter(e.target.value)}
          />
        </label>
        <button
          type="button"
          className="btn"
          disabled={busy !== 'idle' || selectableCount === 0}
          onClick={selectAllFiltered}
        >
          Select all
        </button>
        <button
          type="button"
          className="btn"
          disabled={busy !== 'idle' || selected.size === 0}
          onClick={clearSelection}
        >
          Clear
        </button>
      </div>
      {helpOpen ? (
        <p className="undelete-help" role="note">
          {UNDELETE_HELP}
        </p>
      ) : null}
      <div className="undelete-status" role="status">
        {busy === 'scan' && progress?.phase === 'scan'
          ? progress.elevated
            ? 'Scanning as administrator…'
            : progress.total > 0
              ? `Scanning MFT… ${Math.min(100, Math.round((100 * progress.done) / progress.total))}% · ${(progress.found ?? 0).toLocaleString()} found`
              : 'Starting scan…'
          : busy === 'recover' && progress?.phase === 'recover'
            ? progress.elevated
              ? `Recovering as administrator… ${progress.done.toLocaleString()} / ${progress.total.toLocaleString()}${progress.current ? ` · ${progress.current}` : ''}`
              : `Recovering… ${progress.total > 0 ? `${Math.min(100, Math.round((100 * progress.done) / progress.total))}% · ` : ''}${progress.done.toLocaleString()} / ${progress.total.toLocaleString()}${progress.current ? ` · ${progress.current}` : ''}`
            : busy === 'recover'
              ? statusMsg || 'Recovering…'
              : statusMsg || 'Scan a volume to list deleted files.'}
        {busy === 'idle' && elevated && items.length > 0 ? ' · Used administrator' : ''}
      </div>
      {busy !== 'idle' && (
        <div
          className={`undelete-progress${progress && progress.total > 0 && !progress.elevated ? '' : ' is-indeterminate'}`}
          aria-hidden
        >
          <div
            className="undelete-progress-bar"
            style={
              progress && progress.total > 0 && !progress.elevated
                ? { width: `${Math.min(100, (100 * progress.done) / progress.total)}%` }
                : undefined
            }
          />
        </div>
      )}
      <div className="undelete-table-head" aria-hidden>
        <span className="undelete-col-check" />
        <span className="undelete-col-name">Name</span>
        <span className="undelete-col-path">Path</span>
        <span className="undelete-col-size">Size</span>
        <span className="undelete-col-status">Status</span>
        <span className="undelete-col-date">Modified</span>
      </div>
      <div className="undelete-table-body" ref={listRef}>
        {filtered.length === 0 ? (
          <div className="undelete-empty dim">
            {items.length === 0 ? 'No results yet.' : 'No rows match the filter.'}
          </div>
        ) : (
          <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
            {virtualizer.getVirtualItems().map((row) => {
              const it = filtered[row.index]!
              const disabled = it.status === 'unrecoverable' || it.isDir
              const checked = selected.has(it.token)
              return (
                <div
                  key={it.token}
                  className={`undelete-row${disabled ? ' is-disabled' : ''}${checked ? ' is-selected' : ''}`}
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    height: ROW_H,
                    transform: `translateY(${row.start}px)`
                  }}
                  onClick={() => toggleToken(it.token, it.status, it.isDir)}
                >
                  <span className="undelete-col-check">
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={disabled}
                      onChange={() => toggleToken(it.token, it.status, it.isDir)}
                      onClick={(e) => e.stopPropagation()}
                    />
                  </span>
                  <span className="undelete-col-name" title={it.name}>
                    {it.isDir ? `${it.name}\\` : it.name}
                  </span>
                  <span className="undelete-col-path" title={it.pathHint ?? ''}>
                    {it.pathHint ?? '—'}
                  </span>
                  <span className="undelete-col-size">{formatBytes(it.size)}</span>
                  <span className={`undelete-col-status status-${it.status}`}>
                    {statusLabel(it.status)}
                  </span>
                  <span className="undelete-col-date">
                    {it.mtimeMs != null ? formatDate(it.mtimeMs) : '—'}
                  </span>
                </div>
              )
            })}
          </div>
        )}
      </div>
      <div className="undelete-footer dim">
        {selectedRecoverable} selected · {filtered.length.toLocaleString()} shown
        {items.length !== filtered.length ? ` / ${items.length.toLocaleString()} scanned` : ''}
      </div>
    </Modal>
  )
}
