import { useCallback, useEffect, useMemo, useState, type JSX } from 'react'
import type { GitFileLogEntry } from '@shared/schemas/gitLog'
import { api, call, IpcError } from '../../lib/ipc'
import { basename } from '../../lib/paths'
import { SpinnerIcon } from '../../lib/icons'
import { useAppStore } from '../../store/appStore'
import { useGitFileHistory } from '../../lib/gitFileHistory'
import { ModalShell } from './GitDialogs'

function shortHash(hash: string): string {
  return hash.slice(0, 7)
}

function relativeTime(unixSec: number, nowMs: number): string {
  const sec = Math.max(0, Math.floor(nowMs / 1000 - unixSec))
  if (sec < 86_400) return new Date(unixSec * 1000).toLocaleString()
  if (sec < 172_800) return 'yesterday'
  if (sec < 2_592_000) return `${Math.floor(sec / 86_400)} days ago`
  return new Date(unixSec * 1000).toLocaleDateString()
}

export function GitFileHistoryHost(): JSX.Element | null {
  const target = useGitFileHistory((s) => s.target)
  const close = useGitFileHistory((s) => s.close)
  if (!target) return null
  return (
    <GitFileHistoryDialog
      repoRoot={target.repoRoot}
      path={target.path}
      onClose={close}
    />
  )
}

export function GitFileHistoryDialog({
  repoRoot,
  path,
  onClose
}: {
  repoRoot: string
  path: string
  onClose(): void
}): JSX.Element {
  const notify = useAppStore((s) => s.notify)
  const [commits, setCommits] = useState<GitFileLogEntry[]>([])
  const [truncated, setTruncated] = useState(false)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [picked, setPicked] = useState<string[]>([])
  const [now] = useState(() => Date.now())

  const load = useCallback(
    async (opts?: { append?: boolean }) => {
      const append = opts?.append === true
      if (append) setLoadingMore(true)
      else {
        setLoading(true)
        setError(null)
      }
      try {
        const res = await call(
          api.git.logFile({
            repoRoot,
            path,
            skip: append ? commits.length : 0
          })
        )
        setCommits((prev) => (append ? [...prev, ...res.commits] : res.commits))
        setTruncated(res.truncated)
      } catch (e) {
        const msg = e instanceof IpcError ? e.message : String(e)
        if (!append) {
          setCommits([])
          setError(msg)
        } else {
          notify(msg, true)
        }
      } finally {
        setLoading(false)
        setLoadingMore(false)
      }
    },
    [commits.length, notify, path, repoRoot]
  )

  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset when target changes
  }, [repoRoot, path])

  const togglePick = useCallback((hash: string) => {
    setPicked((prev) => {
      if (prev.includes(hash)) return prev.filter((h) => h !== hash)
      if (prev.length >= 2) return [prev[1]!, hash]
      return [...prev, hash]
    })
  }, [])

  const pickedCommits = useMemo(
    () =>
      picked
        .map((h) => commits.find((c) => c.hash === h))
        .filter((c): c is GitFileLogEntry => c != null),
    [commits, picked]
  )

  const runDiff = useCallback(
    async (opts: { commit?: string; otherCommit?: string }) => {
      try {
        const res = await call(
          api.git.showDiff({
            repoRoot,
            path,
            commit: opts.commit,
            otherCommit: opts.otherCommit
          })
        )
        if (!res.launched) {
          notify(res.message || 'Diff tool not configured', true)
        }
      } catch (e) {
        notify(e instanceof IpcError ? e.message : String(e), true)
      }
    },
    [notify, path, repoRoot]
  )

  const onShowChanges = useCallback(() => {
    const hash = picked[0]
    if (!hash) return
    void runDiff({ commit: hash })
  }, [picked, runDiff])

  const onCompare = useCallback(() => {
    if (pickedCommits.length < 2) return
    const sorted = [...pickedCommits].sort((a, b) => a.authorDate - b.authorDate)
    void runDiff({
      otherCommit: sorted[0]!.hash,
      commit: sorted[1]!.hash
    })
  }, [pickedCommits, runDiff])

  const fileName = basename(path)

  return (
    <ModalShell
      title={`History — ${fileName}`}
      onClose={onClose}
      modalClassName="git-file-history-modal"
      bodyClassName="git-file-history-body"
      actions={
        <>
          <button
            type="button"
            className="btn"
            disabled={picked.length < 1}
            onClick={onShowChanges}
            title="Diff this version against its parent"
          >
            Changes in commit
          </button>
          <button
            type="button"
            className="btn"
            disabled={picked.length < 2}
            onClick={onCompare}
            title="Compare the two selected versions"
          >
            Compare selected
          </button>
          <button type="button" className="btn" onClick={onClose}>
            Close
          </button>
        </>
      }
    >
      <div className="git-file-history-dialog">
        <p className="git-file-history-hint">
          Select one commit for <strong>Changes in commit</strong>, or two for{' '}
          <strong>Compare selected</strong> (older → newer in the diff tool). Ctrl+click to
          multi-select.
        </p>

        {loading && commits.length === 0 ? (
          <div className="git-file-history-loading">
            <SpinnerIcon size={18} />
            <span>Loading history…</span>
          </div>
        ) : error && commits.length === 0 ? (
          <div className="git-file-history-error">{error}</div>
        ) : commits.length === 0 ? (
          <div className="git-file-history-empty">No commits found for this file.</div>
        ) : (
          <>
            <div className="git-file-history-list" role="list">
              {commits.map((c) => {
                const selected = picked.includes(c.hash)
                return (
                  <button
                    key={c.hash}
                    type="button"
                    role="listitem"
                    className={`git-file-history-row${selected ? ' selected' : ''}`}
                    onClick={(e) => {
                      if (e.ctrlKey || e.metaKey) {
                        togglePick(c.hash)
                        return
                      }
                      setPicked([c.hash])
                    }}
                  >
                    <span className="git-file-history-check" aria-hidden>
                      {selected ? '☑' : '☐'}
                    </span>
                    <span className="git-file-history-hash" title={c.hash}>
                      {shortHash(c.hash)}
                    </span>
                    <span className="git-file-history-subject" title={c.subject}>
                      {c.subject || '(no message)'}
                    </span>
                    <span className="git-file-history-author">{c.authorName || 'Unknown'}</span>
                    <span
                      className="git-file-history-date"
                      title={new Date(c.authorDate * 1000).toLocaleString()}
                    >
                      {relativeTime(c.authorDate, now)}
                    </span>
                  </button>
                )
              })}
            </div>
            {truncated ? (
              <div className="git-file-history-more">
                <button
                  type="button"
                  className="btn"
                  disabled={loadingMore}
                  onClick={() => void load({ append: true })}
                >
                  {loadingMore ? 'Loading…' : 'Load more'}
                </button>
              </div>
            ) : null}
          </>
        )}
      </div>
    </ModalShell>
  )
}
