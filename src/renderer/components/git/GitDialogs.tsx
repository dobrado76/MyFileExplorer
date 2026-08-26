import { useEffect, useState, type JSX, type ReactNode } from 'react'
import { useAppStore } from '../../store/appStore'
import { api, call, IpcError } from '../../lib/ipc'

export function gitCmdOk(res: {
  success: boolean
  stderr: string
  stdout: string
}): string | null {
  if (res.success) return null
  const msg = (res.stderr || res.stdout || 'Git command failed').trim()
  const lower = msg.toLowerCase()
  if (
    lower.includes('authentication failed') ||
    lower.includes('could not read username') ||
    lower.includes('could not read password') ||
    lower.includes('fatal: user cancelled') ||
    lower.includes('access was denied') ||
    lower.includes('403') ||
    lower.includes('401')
  ) {
    return `Authentication failed or was cancelled. ${msg}`.slice(0, 400)
  }
  return msg.slice(0, 400)
}

export function looksLikeConflict(res: { stderr: string; stdout: string }): boolean {
  const text = `${res.stderr}\n${res.stdout}`.toLowerCase()
  return (
    text.includes('conflict') ||
    text.includes('fix conflicts') ||
    text.includes('unmerged paths') ||
    text.includes('needs merge')
  )
}

export function ModalShell({
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
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <div
        className="modal"
        role="dialog"
        aria-label={title}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="modal-title modal-title-chrome">
          <span className="modal-title-text">{title}</span>
          <button type="button" className="modal-title-btn" aria-label="Close" onClick={onClose}>
            ×
          </button>
        </div>
        <div className="modal-body">{children}</div>
        <div className="modal-actions">{actions}</div>
      </div>
    </div>
  )
}

export function GitCommitDialog({
  repoRoot,
  stagedCount,
  changedCount,
  onClose,
  onDone,
  onRequestPush
}: {
  repoRoot: string
  stagedCount: number
  changedCount: number
  onClose(): void
  onDone(): void
  /** After a successful commit, open the Push confirm dialog (credentials happen on Push). */
  onRequestPush?(): void
}): JSX.Element {
  const notify = useAppStore((s) => s.notify)
  const [message, setMessage] = useState('')
  const [pushAfter, setPushAfter] = useState(false)
  const [stageAll, setStageAll] = useState(stagedCount < 1 && changedCount > 0)
  const [busy, setBusy] = useState(false)

  const canCommit =
    message.trim().length > 0 && (stageAll ? changedCount > 0 : stagedCount > 0)

  const submit = async (): Promise<void> => {
    const msg = message.trim()
    if (!msg || busy || !canCommit) return
    setBusy(true)
    try {
      const res = await call(
        api.git.commit({
          repoRoot,
          message: msg,
          pushAfter: false,
          stageAll: stageAll || stagedCount < 1
        })
      )
      const err = gitCmdOk(res)
      if (err) {
        notify(err, true)
        return
      }
      notify('Committed')
      onDone()
      if (pushAfter) {
        onClose()
        onRequestPush?.()
        return
      }
      onClose()
    } catch (e) {
      notify(e instanceof IpcError ? e.message : String(e), true)
    } finally {
      setBusy(false)
    }
  }

  return (
    <ModalShell
      title="Commit"
      onClose={onClose}
      actions={
        <>
          <button type="button" className="btn" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button
            type="button"
            className="btn primary"
            disabled={busy || !canCommit}
            onClick={() => void submit()}
          >
            Commit
          </button>
        </>
      }
    >
      <p className="dim" style={{ marginTop: 0 }}>
        {stagedCount} staged · {changedCount} change{changedCount === 1 ? '' : 's'} total
      </p>
      {stagedCount < 1 && changedCount > 0 ? (
        <p className="dim">
          Nothing is staged yet. Enable “Stage all changes” below to include the {changedCount}{' '}
          working-tree change{changedCount === 1 ? '' : 's'}.
        </p>
      ) : null}
      <label className="settings-field" htmlFor="git-commit-msg">
        <span>Message</span>
        <textarea
          id="git-commit-msg"
          rows={4}
          value={message}
          autoFocus
          onChange={(e) => setMessage(e.target.value)}
          placeholder="Commit message"
        />
      </label>
      <label className="settings-toggle" htmlFor="git-commit-stage-all">
        <span className="settings-toggle-text">
          <span className="settings-toggle-label">Stage all changes</span>
        </span>
        <input
          id="git-commit-stage-all"
          type="checkbox"
          checked={stageAll}
          onChange={(e) => setStageAll(e.target.checked)}
        />
      </label>
      <label className="settings-toggle" htmlFor="git-commit-push">
        <span className="settings-toggle-text">
          <span className="settings-toggle-label">Open Push dialog after commit</span>
        </span>
        <input
          id="git-commit-push"
          type="checkbox"
          checked={pushAfter}
          onChange={(e) => setPushAfter(e.target.checked)}
        />
      </label>
    </ModalShell>
  )
}

export function GitBranchCreateDialog({
  repoRoot,
  startPoint,
  onClose,
  onDone
}: {
  repoRoot: string
  /** When set, create the branch at this commit. */
  startPoint?: string
  onClose(): void
  onDone(): void
}): JSX.Element {
  const notify = useAppStore((s) => s.notify)
  const [name, setName] = useState('')
  const [switchTo, setSwitchTo] = useState(true)
  const [busy, setBusy] = useState(false)

  const submit = async (): Promise<void> => {
    const branch = name.trim()
    if (!branch || busy) return
    setBusy(true)
    try {
      const res = await call(
        api.git.createBranch({
          repoRoot,
          branch,
          switchTo,
          startPoint: startPoint || undefined
        })
      )
      const err = gitCmdOk(res)
      if (err) {
        notify(err, true)
        return
      }
      notify(switchTo ? `Created and switched to ${branch}` : `Created ${branch}`)
      onDone()
      onClose()
    } catch (e) {
      notify(e instanceof IpcError ? e.message : String(e), true)
    } finally {
      setBusy(false)
    }
  }

  return (
    <ModalShell
      title={startPoint ? 'Create branch here' : 'Create branch'}
      onClose={onClose}
      actions={
        <>
          <button type="button" className="btn" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button
            type="button"
            className="btn primary"
            disabled={busy || !name.trim()}
            onClick={() => void submit()}
          >
            Create
          </button>
        </>
      }
    >
      {startPoint ? (
        <p className="dim" style={{ marginTop: 0 }}>
          At {startPoint.slice(0, 7)}
        </p>
      ) : null}
      <label className="settings-field" htmlFor="git-branch-name">
        <span>Branch name</span>
        <input
          id="git-branch-name"
          type="text"
          value={name}
          autoFocus
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void submit()
          }}
        />
      </label>
      <label className="settings-toggle" htmlFor="git-branch-switch">
        <span className="settings-toggle-text">
          <span className="settings-toggle-label">Switch to new branch</span>
        </span>
        <input
          id="git-branch-switch"
          type="checkbox"
          checked={switchTo}
          onChange={(e) => setSwitchTo(e.target.checked)}
        />
      </label>
    </ModalShell>
  )
}

export function GitStashDialog({
  repoRoot,
  onClose,
  onDone
}: {
  repoRoot: string
  onClose(): void
  onDone(): void
}): JSX.Element {
  const notify = useAppStore((s) => s.notify)
  const [message, setMessage] = useState('')
  const [includeUntracked, setIncludeUntracked] = useState(false)
  const [busy, setBusy] = useState(false)

  const submit = async (): Promise<void> => {
    if (busy) return
    setBusy(true)
    try {
      const res = await call(
        api.git.stash({
          repoRoot,
          message: message.trim() || undefined,
          includeUntracked
        })
      )
      const err = gitCmdOk(res)
      if (err) {
        notify(err, true)
        return
      }
      notify('Stashed')
      onDone()
      onClose()
    } catch (e) {
      notify(e instanceof IpcError ? e.message : String(e), true)
    } finally {
      setBusy(false)
    }
  }

  return (
    <ModalShell
      title="Stash"
      onClose={onClose}
      actions={
        <>
          <button type="button" className="btn" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="button" className="btn primary" disabled={busy} onClick={() => void submit()}>
            Stash
          </button>
        </>
      }
    >
      <label className="settings-field" htmlFor="git-stash-msg">
        <span>Message (optional)</span>
        <input
          id="git-stash-msg"
          type="text"
          value={message}
          autoFocus
          onChange={(e) => setMessage(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void submit()
          }}
        />
      </label>
      <label className="settings-toggle" htmlFor="git-stash-untracked">
        <span className="settings-toggle-text">
          <span className="settings-toggle-label">Include untracked files</span>
        </span>
        <input
          id="git-stash-untracked"
          type="checkbox"
          checked={includeUntracked}
          onChange={(e) => setIncludeUntracked(e.target.checked)}
        />
      </label>
    </ModalShell>
  )
}

export function GitTagCreateDialog({
  repoRoot,
  commit,
  onClose,
  onDone
}: {
  repoRoot: string
  commit: string
  onClose(): void
  onDone(): void
}): JSX.Element {
  const notify = useAppStore((s) => s.notify)
  const [name, setName] = useState('')
  const [pushToRemote, setPushToRemote] = useState(true)
  const [busy, setBusy] = useState(false)

  const submit = async (): Promise<void> => {
    const tag = name.trim()
    if (!tag || busy) return
    setBusy(true)
    try {
      const res = await call(
        api.git.createTag({
          repoRoot,
          tag,
          commit,
          pushToRemote
        })
      )
      const err = gitCmdOk(res)
      if (err) {
        notify(err, true)
        // Tag may still exist locally if only push failed
        onDone()
        return
      }
      notify(pushToRemote ? `Created and pushed tag ${tag}` : `Created tag ${tag}`)
      onDone()
      onClose()
    } catch (e) {
      notify(e instanceof IpcError ? e.message : String(e), true)
    } finally {
      setBusy(false)
    }
  }

  return (
    <ModalShell
      title="Create tag here"
      onClose={onClose}
      actions={
        <>
          <button type="button" className="btn" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button
            type="button"
            className="btn primary"
            disabled={busy || !name.trim()}
            onClick={() => void submit()}
          >
            {busy ? 'Creating…' : 'Create'}
          </button>
        </>
      }
    >
      <p className="dim" style={{ marginTop: 0 }}>
        At {commit.slice(0, 7)}
      </p>
      <label className="settings-field" htmlFor="git-tag-name">
        <span>Tag name</span>
        <input
          id="git-tag-name"
          type="text"
          value={name}
          autoFocus
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void submit()
          }}
        />
      </label>
      <label className="settings-toggle" htmlFor="git-tag-push">
        <span className="settings-toggle-text">
          <span className="settings-toggle-label">Push tag to origin</span>
        </span>
        <input
          id="git-tag-push"
          type="checkbox"
          checked={pushToRemote}
          onChange={(e) => setPushToRemote(e.target.checked)}
        />
      </label>
      <p className="dim" style={{ marginBottom: 0, fontSize: '0.88em' }}>
        Tags are not included in a normal branch Push. Check this to publish the tag to the remote.
      </p>
    </ModalShell>
  )
}

export function GitTagDeleteDialog({
  repoRoot,
  tag,
  onClose,
  onDone
}: {
  repoRoot: string
  tag: string
  onClose(): void
  onDone(): void
}): JSX.Element {
  const notify = useAppStore((s) => s.notify)
  const [deleteRemote, setDeleteRemote] = useState(true)
  const [busy, setBusy] = useState(false)

  const submit = async (): Promise<void> => {
    if (busy) return
    setBusy(true)
    try {
      const res = await call(
        api.git.deleteTag({
          repoRoot,
          tag,
          deleteRemote
        })
      )
      const err = gitCmdOk(res)
      if (err) {
        notify(err, true)
        onDone()
        return
      }
      notify(deleteRemote ? `Deleted tag ${tag} (local + origin)` : `Deleted local tag ${tag}`)
      onDone()
      onClose()
    } catch (e) {
      notify(e instanceof IpcError ? e.message : String(e), true)
    } finally {
      setBusy(false)
    }
  }

  return (
    <ModalShell
      title="Delete tag"
      onClose={onClose}
      actions={
        <>
          <button type="button" className="btn" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button
            type="button"
            className="btn primary"
            disabled={busy}
            onClick={() => void submit()}
          >
            {busy ? 'Deleting…' : 'Delete'}
          </button>
        </>
      }
    >
      <p className="dim" style={{ marginTop: 0 }}>
        Delete tag <strong>{tag}</strong>?
      </p>
      <label className="settings-toggle" htmlFor="git-tag-delete-remote">
        <span className="settings-toggle-text">
          <span className="settings-toggle-label">Also delete on origin</span>
        </span>
        <input
          id="git-tag-delete-remote"
          type="checkbox"
          checked={deleteRemote}
          onChange={(e) => setDeleteRemote(e.target.checked)}
        />
      </label>
    </ModalShell>
  )
}

export function GitPushDialog({
  repoRoot,
  onClose,
  onDone
}: {
  repoRoot: string
  onClose(): void
  onDone(): void
}): JSX.Element {
  const notify = useAppStore((s) => s.notify)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [branch, setBranch] = useState<string | null>(null)
  const [upstream, setUpstream] = useState<string | null>(null)
  const [ahead, setAhead] = useState(0)
  const [behind, setBehind] = useState(0)
  const [commits, setCommits] = useState<{ hash: string; subject: string }[]>([])
  const [description, setDescription] = useState('')
  const [loadError, setLoadError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      setLoading(true)
      setLoadError(null)
      try {
        const res = await call(api.git.outgoing({ repoRoot }))
        if (cancelled) return
        setBranch(res.branch)
        setUpstream(res.upstream)
        setAhead(res.ahead)
        setBehind(res.behind)
        setCommits(res.commits)
        const dest = res.upstream ?? 'remote'
        const src = res.branch ?? 'HEAD'
        if (res.ahead < 1) {
          setDescription(`Nothing to push — ${src} is up to date with ${dest}`)
        } else if (res.commits[0]) {
          setDescription(
            res.ahead === 1
              ? res.commits[0].subject
              : `Push ${res.ahead} commits to ${dest}: ${res.commits[0].subject}`
          )
        } else {
          setDescription(`Push ${res.ahead} commit${res.ahead === 1 ? '' : 's'} to ${dest}`)
        }
      } catch (e) {
        if (!cancelled) setLoadError(e instanceof IpcError ? e.message : String(e))
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [repoRoot])

  const canPush = !loading && !loadError && ahead > 0 && Boolean(upstream)

  const submit = async (): Promise<void> => {
    if (busy || !canPush) return
    setBusy(true)
    try {
      const res = await call(api.git.push({ repoRoot }))
      const err = gitCmdOk(res)
      if (err) {
        notify(err, true)
        return
      }
      const detail = (res.stdout || res.stderr).trim()
      const note = description.trim()
      if (detail && /up.to.date|everything up-to-date|already up to date/i.test(detail)) {
        notify('Push — already up to date')
      } else if (note) {
        notify(`Pushed — ${note.slice(0, 120)}`)
      } else {
        notify(detail ? `Pushed — ${detail.slice(0, 160)}` : 'Pushed')
      }
      onDone()
      onClose()
    } catch (e) {
      notify(e instanceof IpcError ? e.message : String(e), true)
    } finally {
      setBusy(false)
    }
  }

  return (
    <ModalShell
      title="Push"
      onClose={onClose}
      actions={
        <>
          <button type="button" className="btn" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button
            type="button"
            className="btn primary"
            disabled={busy || !canPush}
            onClick={() => void submit()}
          >
            {busy ? 'Pushing…' : 'Push'}
          </button>
        </>
      }
    >
      {loading ? (
        <p className="dim" style={{ marginTop: 0 }}>
          Checking commits to push…
        </p>
      ) : loadError ? (
        <p className="dim" style={{ marginTop: 0, color: 'var(--danger)' }}>
          {loadError}
        </p>
      ) : (
        <>
          <p className="dim" style={{ marginTop: 0 }}>
            {branch ?? 'DETACHED'}
            {upstream ? ` → ${upstream}` : ' (no upstream set)'}
            {ahead > 0 || behind > 0 ? ` · ↑${ahead} ↓${behind}` : ''}
          </p>
          {!upstream ? (
            <p className="dim">This branch has no upstream remote. Set upstream before pushing.</p>
          ) : ahead < 1 ? (
            <p className="dim">Nothing to push — already up to date with the remote.</p>
          ) : (
            <div className="git-push-commits" role="list" aria-label="Commits to push">
              {commits.map((c) => (
                <div key={c.hash} className="git-push-commit" role="listitem">
                  <span className="git-push-commit-hash mono">{c.hash.slice(0, 7)}</span>
                  <span className="git-push-commit-subject">{c.subject || '(no message)'}</span>
                </div>
              ))}
              {ahead > commits.length ? (
                <div className="dim git-push-commit-more">…and {ahead - commits.length} more</div>
              ) : null}
            </div>
          )}
          <label className="settings-field" htmlFor="git-push-desc">
            <span>Description</span>
            <textarea
              id="git-push-desc"
              rows={3}
              value={description}
              disabled={busy}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What you are pushing (local note)"
            />
          </label>
          <p className="dim" style={{ marginBottom: 0, fontSize: '0.88em' }}>
            Cancel closes without contacting the remote. Push may open Git Credential Manager if
            authentication is required.
          </p>
        </>
      )}
    </ModalShell>
  )
}
