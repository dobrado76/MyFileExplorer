import { useCallback, useEffect, useState, type JSX } from 'react'
import type { GitCommitDetail, GitCommitFileChange, GitLogCommit } from '@shared/schemas/gitLog'
import { api, call, IpcError } from '../../lib/ipc'
import { joinPath } from '../../lib/paths'
import { SpinnerIcon } from '../../lib/icons'
import { useAppStore } from '../../store/appStore'
import { ModalShell } from './GitDialogs'

function shortHash(hash: string): string {
  return hash.slice(0, 7)
}

function statusLabel(row: GitCommitFileChange): string {
  switch (row.status) {
    case 'A':
      return 'Added'
    case 'M':
      return 'Modified'
    case 'D':
      return 'Deleted'
    case 'R':
      return 'Renamed'
    case 'C':
      return 'Copied'
    case 'T':
      return 'Type changed'
    default:
      return row.status
  }
}

export function GitCommitDetailDialog({
  repoRoot,
  commit,
  onClose,
  onNavigateCommit
}: {
  repoRoot: string
  commit: GitLogCommit
  onClose(): void
  onNavigateCommit?(hash: string): void
}): JSX.Element {
  const notify = useAppStore((s) => s.notify)
  const [detail, setDetail] = useState<GitCommitDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    void (async () => {
      try {
        const res = await call(api.git.showCommit({ repoRoot, commit: commit.hash }))
        if (!cancelled) setDetail(res)
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof IpcError ? e.message : String(e))
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [repoRoot, commit.hash])

  const runDiff = useCallback(
    async (relPath: string, atCommit: string) => {
      try {
        const abs = joinPath(repoRoot, relPath.replace(/\//g, '\\'))
        const res = await call(
          api.git.showDiff({ repoRoot, path: abs, commit: atCommit })
        )
        if (!res.launched) {
          notify(res.message || 'Diff tool not configured', true)
        }
      } catch (e) {
        notify(e instanceof IpcError ? e.message : String(e), true)
      }
    },
    [notify, repoRoot]
  )

  const shown = detail ?? {
    hash: commit.hash,
    parents: commit.parents,
    authorName: commit.authorName,
    authorEmail: commit.authorEmail,
    authorDate: commit.authorDate,
    subject: commit.subject,
    body: '',
    files: []
  }

  return (
    <ModalShell
      title={`Commit ${shortHash(commit.hash)}`}
      onClose={onClose}
      modalClassName="git-commit-detail-modal"
      bodyClassName="git-commit-detail-body"
      actions={
        <button type="button" className="btn" onClick={onClose}>
          Close
        </button>
      }
    >
      <div className="git-commit-detail-dialog">
        <div className="git-commit-detail-dialog-header">
          <div className="git-commit-detail-dialog-subject">{shown.subject || '(no message)'}</div>
          <div className="git-commit-detail-dialog-meta">
            <span>{shown.authorName}</span>
            {shown.authorEmail ? <span className="git-commit-detail-email">&lt;{shown.authorEmail}&gt;</span> : null}
            <span className="git-commit-detail-sep">·</span>
            <span title={shown.hash}>{new Date(shown.authorDate * 1000).toLocaleString()}</span>
          </div>
          <div className="git-commit-detail-dialog-hash" title="Click to copy full hash">
            <button
              type="button"
              className="btn btn-link git-commit-detail-copy-hash"
              onClick={() => {
                void navigator.clipboard.writeText(shown.hash)
                notify('Commit hash copied')
              }}
            >
              {shown.hash}
            </button>
          </div>
          {shown.parents.length > 0 ? (
            <div className="git-commit-detail-parents">
              <span className="git-commit-detail-parents-label">Parents:</span>
              {shown.parents.map((p) => (
                <button
                  key={p}
                  type="button"
                  className="btn btn-link git-commit-detail-parent"
                  onClick={() => onNavigateCommit?.(p)}
                  disabled={!onNavigateCommit}
                  title={p}
                >
                  {shortHash(p)}
                </button>
              ))}
            </div>
          ) : null}
        </div>

        {shown.body ? (
          <pre className="git-commit-detail-message">{shown.body}</pre>
        ) : null}

        <div className="git-commit-detail-files-head">
          <span>Changed files</span>
          {loading ? <SpinnerIcon size={14} /> : null}
          {error ? <span className="git-commit-detail-files-error">{error}</span> : null}
        </div>

        {shown.files.length > 0 ? (
          <div className="git-commit-detail-files" role="list">
            {shown.files.map((row) => {
              const path = row.path.replace(/\\/g, '/')
              const title =
                row.oldPath && row.oldPath !== row.path
                  ? `${row.oldPath} → ${row.path}`
                  : path
              return (
                <button
                  key={`${row.status}:${path}:${row.oldPath ?? ''}`}
                  type="button"
                  role="listitem"
                  className="git-commit-detail-file-row"
                  title={`Show changes in this commit — ${title}`}
                  onDoubleClick={() => void runDiff(path, shown.hash)}
                >
                  <span className={`git-commit-file-status status-${row.status}`}>
                    {row.status}
                  </span>
                  <span className="git-commit-file-label">{statusLabel(row)}</span>
                  <span className="git-commit-file-path">
                    {row.oldPath && row.oldPath !== row.path ? (
                      <>
                        <span className="git-commit-file-old">{row.oldPath}</span>
                        <span className="git-commit-file-arrow"> → </span>
                      </>
                    ) : null}
                    {path}
                  </span>
                </button>
              )
            })}
          </div>
        ) : !loading && !error ? (
          <div className="git-commit-detail-files-empty">No file changes recorded.</div>
        ) : null}

        <p className="git-commit-detail-hint">Double-click a file to open its diff in the configured diff tool.</p>
      </div>
    </ModalShell>
  )
}
