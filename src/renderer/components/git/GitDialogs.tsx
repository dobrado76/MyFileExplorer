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
  onClose,
  onDone
}: {
  repoRoot: string
  stagedCount: number
  onClose(): void
  onDone(): void
}): JSX.Element {
  const notify = useAppStore((s) => s.notify)
  const [message, setMessage] = useState('')
  const [pushAfter, setPushAfter] = useState(false)
  const [busy, setBusy] = useState(false)

  const submit = async (): Promise<void> => {
    const msg = message.trim()
    if (!msg || busy) return
    setBusy(true)
    try {
      const res = await call(api.git.commit({ repoRoot, message: msg, pushAfter }))
      const err = gitCmdOk(res)
      if (err) {
        notify(err, true)
        return
      }
      notify(pushAfter ? 'Committed and pushed' : 'Committed')
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
            disabled={busy || !message.trim() || stagedCount < 1}
            onClick={() => void submit()}
          >
            Commit
          </button>
        </>
      }
    >
      <p className="dim" style={{ marginTop: 0 }}>
        {stagedCount === 1 ? '1 staged change' : `${stagedCount} staged changes`}
      </p>
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
      <label className="settings-toggle" htmlFor="git-commit-push">
        <span className="settings-toggle-text">
          <span className="settings-toggle-label">Push after commit</span>
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
  const [busy, setBusy] = useState(false)

  const submit = async (): Promise<void> => {
    const tag = name.trim()
    if (!tag || busy) return
    setBusy(true)
    try {
      const res = await call(api.git.createTag({ repoRoot, tag, commit }))
      const err = gitCmdOk(res)
      if (err) {
        notify(err, true)
        return
      }
      notify(`Created tag ${tag}`)
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
            Create
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
    </ModalShell>
  )
}
