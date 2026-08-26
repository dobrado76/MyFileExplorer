import { useCallback, useEffect, useState, type JSX } from 'react'
import type { LockingProcess } from '@shared/schemas/lockers'
import { api, call, IpcError } from '../lib/ipc'

type Props = {
  path: string
  /** Initial lockers from the error / OpIssue (refreshed on demand). */
  initialLockers?: LockingProcess[]
  /** Called after a successful End Task (so the parent can Retry). */
  onChanged?: () => void
  className?: string
}

function isProtectedName(name: string): boolean {
  const n = name.toLowerCase().replace(/\.exe$/i, '')
  return (
    n === 'system' ||
    n === 'smss' ||
    n === 'csrss' ||
    n === 'wininit' ||
    n === 'services' ||
    n === 'lsass' ||
    n === 'winlogon' ||
    n === 'svchost' ||
    n === 'explorer'
  )
}

/**
 * Shows who is locking a path and offers End Task / reveal exe / refresh.
 * Windows cannot safely “close handles” in another process — End Task is the unlock.
 */
export function FileLockersPanel({
  path,
  initialLockers,
  onChanged,
  className
}: Props): JSX.Element {
  const [lockers, setLockers] = useState<LockingProcess[]>(initialLockers ?? [])
  const [loading, setLoading] = useState(false)
  const [endingPid, setEndingPid] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [confirmPid, setConfirmPid] = useState<LockingProcess | null>(null)

  const refresh = useCallback(async (): Promise<void> => {
    setLoading(true)
    setError(null)
    try {
      const r = await call(api.fs.findLockers({ path }))
      setLockers(r.lockers)
    } catch (e) {
      setError(e instanceof IpcError ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [path])

  useEffect(() => {
    setLockers(initialLockers ?? [])
  }, [initialLockers, path])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const endTask = async (locker: LockingProcess): Promise<void> => {
    setConfirmPid(null)
    setEndingPid(locker.pid)
    setError(null)
    try {
      await call(api.fs.endProcess({ pid: locker.pid }))
      await refresh()
      onChanged?.()
    } catch (e) {
      setError(e instanceof IpcError ? e.message : String(e))
      await refresh()
    } finally {
      setEndingPid(null)
    }
  }

  const revealExe = async (locker: LockingProcess): Promise<void> => {
    if (!locker.exePath) return
    try {
      await call(api.shell.showItemInFolder({ path: locker.exePath }))
    } catch (e) {
      setError(e instanceof IpcError ? e.message : String(e))
    }
  }

  return (
    <div className={`file-lockers${className ? ` ${className}` : ''}`}>
      <div className="file-lockers-head">
        <span className="file-lockers-title">Open in</span>
        <button
          type="button"
          className="btn"
          disabled={loading || endingPid !== null}
          onClick={() => void refresh()}
        >
          {loading ? 'Checking…' : 'Refresh'}
        </button>
      </div>

      {lockers.length === 0 ? (
        <p className="file-lockers-empty">
          No locking process found. Another app may have released the file, or the lock is from a
          driver / antivirus / sync client that Windows does not list. Close obvious windows, then
          Retry.
        </p>
      ) : (
        <ul className="file-lockers-list">
          {lockers.map((p) => {
            const protectedProc = p.pid <= 4 || isProtectedName(p.name)
            const busy = endingPid === p.pid
            return (
              <li key={p.pid} className="file-lockers-row">
                <div className="file-lockers-info">
                  <span className="file-lockers-name" title={p.exePath ?? p.name}>
                    {p.name}
                  </span>
                  <span className="file-lockers-pid">PID {p.pid}</span>
                </div>
                <div className="file-lockers-actions">
                  {p.exePath ? (
                    <button
                      type="button"
                      className="btn"
                      disabled={busy}
                      title={p.exePath}
                      onClick={() => void revealExe(p)}
                    >
                      Locate
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className="btn danger"
                    disabled={protectedProc || busy || endingPid !== null}
                    title={
                      protectedProc
                        ? 'Protected system process — close it from its own window'
                        : `End ${p.name} and its child processes`
                    }
                    onClick={() => setConfirmPid(p)}
                  >
                    {busy ? 'Ending…' : 'End task'}
                  </button>
                </div>
              </li>
            )
          })}
        </ul>
      )}

      {error ? <div className="file-lockers-error">{error}</div> : null}

      {confirmPid ? (
        <div className="file-lockers-confirm" role="alertdialog" aria-labelledby="lock-end-title">
          <p id="lock-end-title">
            End <strong>{confirmPid.name}</strong> (PID {confirmPid.pid})? Unsaved work in that
            program may be lost.
          </p>
          <div className="file-lockers-confirm-actions">
            <button type="button" className="btn" onClick={() => setConfirmPid(null)}>
              Cancel
            </button>
            <button
              type="button"
              className="btn danger primary"
              autoFocus
              onClick={() => void endTask(confirmPid)}
            >
              End task
            </button>
          </div>
        </div>
      ) : null}
    </div>
  )
}
