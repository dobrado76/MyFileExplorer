import { useCallback, useEffect, useRef, useState, type JSX, type PointerEvent as ReactPointerEvent } from 'react'
import type { UsnQueryResponse, UsnRecentEntry } from '@shared/schemas/usn'
import type { Settings } from '@shared/schemas/settings'
import {
  bytesToMib,
  clampUsnJournalSizes,
  DEFAULT_USN_JOURNAL_DELTA_BYTES,
  DEFAULT_USN_JOURNAL_MAX_BYTES,
  driveLetterLabel,
  formatUsnId,
  formatUsnReasons,
  formatUsnTimestamp,
  isUsnProbeFileName,
  mibToBytes,
  usnJournalFillRatio
} from '@shared/usn/format'
import { useAppStore } from '../store/appStore'
import { api, call, IpcError } from '../lib/ipc'
import { formatBytes } from '../lib/format'
import { CloseIcon } from '../lib/icons'

type Bounds = { x: number; y: number; width: number; height: number }
type ResizeEdge = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw'

const MIN_W = 560
const MIN_H = 420
const DEFAULT_W = 860
const DEFAULT_H = 640

const STATUS_LABEL: Record<UsnQueryResponse['status'], string> = {
  active: 'Active',
  absent: 'Not present',
  deleting: 'Deleting…',
  'not-ntfs': 'Not NTFS',
  'access-denied': 'Access denied',
  unsupported: 'Unsupported'
}

const REINDEX_WARNING =
  'Search “Index this drive” on this volume will stop incremental USN updates until you reindex.'

const VOLUME_SCAN_WARNING =
  'Windows does not just remove a small log file. It walks every file on the volume (the entire MFT) and resets each file’s USN. On a drive with millions of files this can take many hours. It cannot be cancelled and continues after you close this app or reboot.'

function confirmVolumeScan(letter: string, action: string): boolean {
  if (
    !window.confirm(
      `${action} the USN journal on ${letter}?\n\n${VOLUME_SCAN_WARNING}\n\n${REINDEX_WARNING}`
    )
  ) {
    return false
  }
  return window.confirm(
    `This cannot be cancelled.\n\nStart the full-volume scan on ${letter} now?`
  )
}

function formatElapsed(ms: number): string {
  const sec = Math.max(0, Math.floor(ms / 1000))
  const m = Math.floor(sec / 60)
  const s = sec % 60
  if (m <= 0) return `${s}s`
  return `${m}m ${s.toString().padStart(2, '0')}s`
}

function clampBounds(b: Bounds): Bounds {
  const vw = window.innerWidth
  const vh = window.innerHeight
  const maxW = Math.max(MIN_W, Math.floor(vw * 0.96))
  const maxH = Math.max(MIN_H, Math.floor(vh * 0.92))
  const width = Math.min(Math.max(Math.round(b.width), MIN_W), maxW)
  const height = Math.min(Math.max(Math.round(b.height), MIN_H), maxH)
  const x = Math.min(Math.max(Math.round(b.x), 0), Math.max(0, vw - width))
  const y = Math.min(Math.max(Math.round(b.y), 0), Math.max(0, vh - height))
  return { x, y, width, height }
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

function boundsFromSettings(saved: Settings['usnManagerBounds']): Bounds {
  if (!saved) return defaultBounds()
  return clampBounds(saved)
}

function isElevationError(e: unknown): boolean {
  if (e instanceof IpcError && (e.code === 'not-allowed' || e.code === 'io')) return true
  const rem = e instanceof IpcError ? e.envelope.remediation : undefined
  if (typeof rem === 'string' && /administrator|elevat/i.test(rem)) return true
  const msg = e instanceof Error ? e.message : String(e)
  return /administrator|elevat|cancelled|windows error/i.test(msg)
}

export function UsnManager({ path }: { path: string }): JSX.Element {
  const closeDialog = useAppStore((s) => s.closeDialog)
  const notify = useAppStore((s) => s.notify)
  const applySettingsPatch = useAppStore((s) => s.applySettingsPatch)
  const settings = useAppStore((s) => s.settings)
  const letter = driveLetterLabel(path)

  const [bounds, setBounds] = useState<Bounds>(() => boundsFromSettings(settings.usnManagerBounds))
  const [query, setQuery] = useState<UsnQueryResponse | null>(null)
  const [entries, setEntries] = useState<UsnRecentEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const [probeNote, setProbeNote] = useState<string | null>(null)
  const [deletingSince, setDeletingSince] = useState<number | null>(null)
  const [nowMs, setNowMs] = useState(() => Date.now())
  const [maxMib, setMaxMib] = useState(() =>
    String(bytesToMib(settings.usnJournalMaxBytes ?? DEFAULT_USN_JOURNAL_MAX_BYTES))
  )
  const [deltaMib, setDeltaMib] = useState(() =>
    String(bytesToMib(settings.usnJournalDeltaBytes ?? DEFAULT_USN_JOURNAL_DELTA_BYTES))
  )

  const boundsRef = useRef(bounds)
  useEffect(() => {
    boundsRef.current = bounds
  }, [bounds])
  const dragRef = useRef<{
    kind: 'move' | ResizeEdge
    startX: number
    startY: number
    orig: Bounds
  } | null>(null)
  const endDragRef = useRef<() => void>(() => {})

  const persistBounds = useCallback(
    (next: Bounds) => {
      void applySettingsPatch({ usnManagerBounds: clampBounds(next) })
    },
    [applySettingsPatch]
  )

  useEffect(() => {
    const onResize = (): void => setBounds((b) => clampBounds(b))
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  const persistSizes = (maxBytes: number, deltaBytes: number): void => {
    void applySettingsPatch({ usnJournalMaxBytes: maxBytes, usnJournalDeltaBytes: deltaBytes })
  }

  const parsedSizes = (): { maxBytes: number; deltaBytes: number } =>
    clampUsnJournalSizes(mibToBytes(Number(maxMib)), mibToBytes(Number(deltaMib)))

  const refresh = useCallback(async (opts?: { silent?: boolean }): Promise<void> => {
    if (!opts?.silent) setLoading(true)
    try {
      const q = await call(api.usn.query({ path }))
      setQuery(q)
      if (q.journal) {
        setMaxMib(String(bytesToMib(Number(q.journal.maximumSize))))
        setDeltaMib(String(bytesToMib(Number(q.journal.allocationDelta))))
      }
      if (q.status === 'active') {
        const rec = await call(api.usn.recent({ path, limit: 200 }))
        setEntries(rec.entries)
      } else {
        setEntries([])
      }
    } catch (e) {
      notify(e instanceof Error ? e.message : String(e), true)
      setQuery(null)
      setEntries([])
    } finally {
      if (!opts?.silent) setLoading(false)
    }
  }, [path, notify])

  useEffect(() => {
    void refresh()
  }, [refresh])

  useEffect(() => {
    if (query?.status === 'deleting') {
      setDeletingSince((prev) => prev ?? Date.now())
    } else {
      setDeletingSince(null)
    }
  }, [query?.status])

  useEffect(() => {
    if (query?.status !== 'deleting') return
    const tick = window.setInterval(() => setNowMs(Date.now()), 1000)
    const poll = window.setInterval(() => {
      void refresh({ silent: true })
    }, 15_000)
    return () => {
      window.clearInterval(tick)
      window.clearInterval(poll)
    }
  }, [query?.status, refresh])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        closeDialog()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [closeDialog])

  const runMutate = async (
    fn: (elevate: boolean) => Promise<void>,
    elevate = false
  ): Promise<void> => {
    setBusy(true)
    setActionError(null)
    try {
      await fn(elevate)
      await refresh()
      setActionError(null)
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      if (!elevate && isElevationError(e)) {
        if (
          window.confirm(
            `${message}\n\nWindows needs an administrator prompt to change the USN journal.\n\nRetry as administrator?`
          )
        ) {
          setBusy(false)
          await runMutate(fn, true)
          return
        }
        setActionError(`${message} — Enable did not apply. Approve the administrator prompt to create the journal.`)
      } else {
        setActionError(message)
        notify(message, true)
      }
    } finally {
      setBusy(false)
    }
  }

  const onEnableOrResize = (forceElevate = false): void => {
    const sizes = parsedSizes()
    persistSizes(sizes.maxBytes, sizes.deltaBytes)
    const active = query?.status === 'active'
    const startElevated =
      forceElevate || query?.status === 'access-denied' || query?.needsElevation === true
    if (startElevated && !forceElevate) {
      if (
        !window.confirm(
          `Changing the USN journal on ${letter} needs administrator permission.\n\nWindows will show a UAC prompt.`
        )
      ) {
        return
      }
    }
    void runMutate(async (elevate) => {
      const result = await call(
        api.usn.enable({
          path,
          maxBytes: sizes.maxBytes,
          deltaBytes: sizes.deltaBytes,
          elevate
        })
      )
      if (result.probeName) {
        setProbeNote(
          `Created and deleted “${result.probeName}” so the journal has a Create and a Delete to show.`
        )
        notify(`Enabled USN journal on ${letter} — test file ${result.probeName} recorded`)
      } else {
        setProbeNote(null)
        notify(active ? `Updated USN journal size on ${letter}` : `Enabled USN journal on ${letter}`)
      }
    }, startElevated)
  }

  const onClear = (): void => {
    if (!confirmVolumeScan(letter, 'Clear')) return
    const sizes = parsedSizes()
    persistSizes(sizes.maxBytes, sizes.deltaBytes)
    void runMutate(async (elevate) => {
      const result = await call(
        api.usn.clear({
          path,
          maxBytes: sizes.maxBytes,
          deltaBytes: sizes.deltaBytes,
          elevate
        })
      )
      if (result.probeName) {
        setProbeNote(
          `Created and deleted “${result.probeName}” so the new journal has a Create and a Delete to show.`
        )
      } else {
        setProbeNote(null)
      }
      notify(`Cleared USN journal on ${letter}`)
    })
  }

  const onDisable = (): void => {
    if (!confirmVolumeScan(letter, 'Delete')) return
    void runMutate(async (elevate) => {
      await call(api.usn.disable({ path, elevate }))
      setProbeNote(null)
      notify(`Disabled USN journal on ${letter}`)
    })
  }

  const onPointerMove = useCallback((e: PointerEvent): void => {
    const drag = dragRef.current
    if (!drag) return
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
      persistBounds(boundsRef.current)
    }
  }, [onPointerMove, onPointerUp, persistBounds])

  const beginDrag = (kind: 'move' | ResizeEdge, e: ReactPointerEvent): void => {
    e.preventDefault()
    e.stopPropagation()
    dragRef.current = { kind, startX: e.clientX, startY: e.clientY, orig: boundsRef.current }
    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', onPointerUp)
    window.addEventListener('pointercancel', onPointerUp)
  }

  const edges: ResizeEdge[] = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw']
  const status = query?.status ?? 'unsupported'
  const journal = query?.journal
  const fill = journal
    ? usnJournalFillRatio(journal.firstUsn, journal.nextUsn, journal.maximumSize)
    : 0
  const canMutate =
    status === 'active' || status === 'absent' || status === 'access-denied' || status === 'deleting'
  const title = `USN journal — ${letter}`

  return (
    <div className="modal-backdrop" onMouseDown={() => closeDialog()}>
      <div
        className="modal modal-usn-manager"
        role="dialog"
        aria-label={title}
        style={{ left: bounds.x, top: bounds.y, width: bounds.width, height: bounds.height }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        {edges.map((edge) => (
          <div
            key={edge}
            className={`ads-resize-handle ${edge}`}
            onPointerDown={(e) => beginDrag(edge, e)}
          />
        ))}
        <div className="modal-title" onPointerDown={(e) => beginDrag('move', e)}>
          {title}
          <button
            type="button"
            className="modal-title-btn"
            aria-label="Close"
            title="Close"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={closeDialog}
          >
            <CloseIcon size={18} />
          </button>
        </div>
        <div className="modal-body modal-body-usn">
          {loading && !query ? (
            <p className="dim">Reading journal…</p>
          ) : (
            <>
              <section className="usn-status">
                <div className="usn-status-row">
                  <span className={`usn-badge usn-badge-${status}`}>{STATUS_LABEL[status]}</span>
                  {query?.fileSystem && <span className="dim">{query.fileSystem}</span>}
                  <button
                    type="button"
                    className="btn"
                    disabled={busy || loading}
                    onClick={() => void refresh()}
                  >
                    Refresh
                  </button>
                </div>
                <p className="usn-hint">
                  The USN journal is a circular NTFS change log. Creating or resizing it usually
                  needs a one-time Windows administrator (UAC) prompt. After it is Active, copy a
                  file on this same drive and click Refresh to see new records. When the journal
                  fills, Windows drops the oldest records in allocation-delta chunks.
                </p>
                {status === 'deleting' && (
                  <p className="usn-probe-note">
                    Windows is scanning every file on {letter} to reset USN attributes
                    {deletingSince ? ` (${formatElapsed(nowMs - deletingSince)} so far)` : ''}.
                    That is a volume-wide MFT walk, not a 64 MiB file delete. Tens of millions of
                    files can take many hours. You can close this dialog; it continues in the
                    background and cannot be cancelled. Enable only works after the badge becomes
                    Not present.
                  </p>
                )}
                {actionError && <p className="usn-action-error">{actionError}</p>}
                {probeNote && <p className="usn-probe-note">{probeNote}</p>}
                {journal && (
                  <>
                    <table className="props-table usn-meta">
                      <tbody>
                        <tr>
                          <td>Journal ID</td>
                          <td>{formatUsnId(journal.journalId)}</td>
                        </tr>
                        <tr>
                          <td>First USN</td>
                          <td>{formatUsnId(journal.firstUsn)}</td>
                        </tr>
                        <tr>
                          <td>Next USN</td>
                          <td>{formatUsnId(journal.nextUsn)}</td>
                        </tr>
                        <tr>
                          <td>Lowest valid</td>
                          <td>{formatUsnId(journal.lowestValidUsn)}</td>
                        </tr>
                        <tr>
                          <td>Max USN</td>
                          <td>{formatUsnId(journal.maxUsn)}</td>
                        </tr>
                        <tr>
                          <td>Maximum size</td>
                          <td>{formatBytes(Number(journal.maximumSize))}</td>
                        </tr>
                        <tr>
                          <td>Allocation delta</td>
                          <td>{formatBytes(Number(journal.allocationDelta))}</td>
                        </tr>
                      </tbody>
                    </table>
                    <div
                      className="props-capacity-bar usn-fill-bar"
                      title={`Estimated journal span ${Math.round(fill * 100)}% of maximum size`}
                    >
                      <div className="props-capacity-used" style={{ width: `${fill * 100}%` }} />
                    </div>
                    <p className="dim usn-fill-caption">
                      Estimated fill (Next − First USN vs maximum size): {Math.round(fill * 100)}%
                    </p>
                  </>
                )}
              </section>

              <section className="usn-sizes">
                <label>
                  Maximum size (MiB)
                  <input
                    type="number"
                    min={1}
                    step={1}
                    value={maxMib}
                    disabled={busy || !canMutate}
                    onChange={(e) => setMaxMib(e.target.value)}
                  />
                </label>
                <label>
                  Allocation delta (MiB)
                  <input
                    type="number"
                    min={0.5}
                    step={0.5}
                    value={deltaMib}
                    disabled={busy || !canMutate}
                    onChange={(e) => setDeltaMib(e.target.value)}
                  />
                </label>
                <div className="usn-actions">
                  <button
                    type="button"
                    className="btn primary"
                    disabled={busy || !canMutate}
                    onClick={() => onEnableOrResize()}
                  >
                    {status === 'active' ? 'Apply size' : 'Enable journal'}
                  </button>
                  {status !== 'active' && (
                    <button
                      type="button"
                      className="btn"
                      disabled={busy || !canMutate}
                      onClick={() => onEnableOrResize(true)}
                    >
                      Enable as administrator…
                    </button>
                  )}
                  <button
                    type="button"
                    className="btn"
                    disabled={busy || status !== 'active'}
                    onClick={onClear}
                  >
                    Clear journal…
                  </button>
                  <button
                    type="button"
                    className="btn"
                    disabled={busy || status !== 'active'}
                    onClick={onDisable}
                  >
                    Delete journal…
                  </button>
                </div>
              </section>

              <section className="usn-recent">
                <h3>Recent records</h3>
                {status !== 'active' ? (
                  <p className="dim">
                    {status === 'absent'
                      ? 'No journal on this volume — enable it to start recording changes.'
                      : status === 'deleting'
                        ? 'Windows is still scanning the volume to finish Disable. Leave it running; Enable will work when the badge is Not present.'
                        : status === 'not-ntfs'
                          ? 'USN journals exist only on NTFS volumes.'
                          : status === 'access-denied'
                            ? 'Cannot read the journal with the current permissions.'
                            : 'USN journal management is Windows / NTFS only.'}
                  </p>
                ) : entries.length === 0 ? (
                  <p className="dim">No recent records in the readable window.</p>
                ) : (
                  <div className="usn-table-wrap">
                    <table className="usn-table">
                      <thead>
                        <tr>
                          <th>Time</th>
                          <th>Name</th>
                          <th>Kind</th>
                          <th>Reason</th>
                          <th>USN</th>
                        </tr>
                      </thead>
                      <tbody>
                        {entries.map((e) => (
                          <tr
                            key={`${e.usn}-${e.name}`}
                            className={isUsnProbeFileName(e.name) ? 'usn-row-probe' : undefined}
                          >
                            <td>{formatUsnTimestamp(e.timeMs)}</td>
                            <td title={e.name}>{e.name}</td>
                            <td>{e.isDir ? 'Folder' : 'File'}</td>
                            <td>{formatUsnReasons(e.reason)}</td>
                            <td>{formatUsnId(e.usn)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
            </>
          )}
        </div>
        <div className="modal-actions">
          <button type="button" className="btn primary" onClick={closeDialog}>
            Close
          </button>
        </div>
      </div>
    </div>
  )
}
