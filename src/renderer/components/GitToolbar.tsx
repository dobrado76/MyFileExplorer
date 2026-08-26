import { useEffect, useRef, useState, type JSX, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { GitBranch, MoreHorizontal } from 'lucide-react'
import type { GitBranchInfo, GitRepositoryStatus } from '@shared/schemas/git'
import { useAppStore } from '../store/appStore'
import { api, call, IpcError } from '../lib/ipc'
import { lookupGitForPath } from '../lib/gitUi'
import { isRemoteLocation } from '@shared/remotePaths'
import { ChevronDown } from '../lib/icons'

type LocalDialog = { kind: 'commit' } | { kind: 'branch-create' } | { kind: 'stash' } | null

function gitCmdOk(res: { success: boolean; stderr: string; stdout: string }): string | null {
  if (res.success) return null
  const msg = (res.stderr || res.stdout || 'Git command failed').trim()
  return msg.slice(0, 400)
}

function looksLikeConflict(res: { stderr: string; stdout: string }): boolean {
  const text = `${res.stderr}\n${res.stdout}`.toLowerCase()
  return (
    text.includes('conflict') ||
    text.includes('fix conflicts') ||
    text.includes('unmerged paths') ||
    text.includes('needs merge')
  )
}

function ModalShell({
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

function GitCommitDialog({
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

function GitBranchCreateDialog({
  repoRoot,
  onClose,
  onDone
}: {
  repoRoot: string
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
      const res = await call(api.git.createBranch({ repoRoot, branch, switchTo }))
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
      title="Create branch"
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

function GitStashDialog({
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

function statusForActivePath(
  gitByRoot: Record<string, GitRepositoryStatus>,
  path: string
): GitRepositoryStatus | null {
  if (!path || isRemoteLocation(path)) return null
  return lookupGitForPath(gitByRoot, path)?.status ?? null
}

export function GitToolbar(): JSX.Element | null {
  const settings = useAppStore((s) => s.settings)
  const gitByRoot = useAppStore((s) => s.gitByRoot)
  const activePath = useAppStore((s) => s.activeTab().path)
  const notify = useAppStore((s) => s.notify)
  const navigate = useAppStore((s) => s.navigate)
  const refreshGitForPath = useAppStore((s) => s.refreshGitForPath)

  const [dialog, setDialog] = useState<LocalDialog>(null)
  const [branches, setBranches] = useState<GitBranchInfo[] | null>(null)
  const [branchOpen, setBranchOpen] = useState(false)
  const [moreOpen, setMoreOpen] = useState(false)
  const [menuPos, setMenuPos] = useState<{ top: number; left: number } | null>(null)
  const [busy, setBusy] = useState(false)
  const branchBtnRef = useRef<HTMLButtonElement>(null)
  const moreBtnRef = useRef<HTMLButtonElement>(null)

  const git = settings.git
  const status = statusForActivePath(gitByRoot, activePath)
  const repoRoot = status?.info.rootPath

  async function refreshRepo(): Promise<void> {
    if (!repoRoot) {
      await refreshGitForPath(activePath)
      return
    }
    try {
      const res = await call(api.git.refresh({ repoRoot }))
      useAppStore.getState().mergeGitStatus(res.status)
    } catch (e) {
      notify(e instanceof IpcError ? e.message : String(e), true)
    }
  }

  async function runOp(
    label: string,
    fn: () => Promise<{ success: boolean; stderr: string; stdout: string }>
  ): Promise<void> {
    if (busy || !repoRoot) return
    setBusy(true)
    try {
      const res = await fn()
      const err = gitCmdOk(res)
      if (err) {
        if (looksLikeConflict(res)) {
          notify(
            `Git reported conflicts. Resolve them in the working tree, then commit. ${err}`,
            true
          )
        } else {
          notify(err, true)
        }
        await refreshRepo()
        return
      }
      notify(label)
      await refreshRepo()
    } catch (e) {
      notify(e instanceof IpcError ? e.message : String(e), true)
      await refreshRepo()
    } finally {
      setBusy(false)
    }
  }

  async function loadBranches(): Promise<void> {
    if (!repoRoot) return
    try {
      const res = await call(api.git.listBranches({ repoRoot }))
      setBranches(res.branches)
    } catch (e) {
      notify(e instanceof IpcError ? e.message : String(e), true)
    }
  }

  useEffect(() => {
    if (!branchOpen && !moreOpen) {
      setMenuPos(null)
      return
    }
    const btn = branchOpen ? branchBtnRef.current : moreBtnRef.current
    if (!btn) return
    const place = (): void => {
      const r = btn.getBoundingClientRect()
      const width = 220
      let left = r.left
      if (left + width > window.innerWidth - 8) left = window.innerWidth - width - 8
      if (left < 8) left = 8
      setMenuPos({ top: r.bottom + 4, left })
    }
    place()
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => {
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
    }
  }, [branchOpen, moreOpen])

  useEffect(() => {
    if (!branchOpen && !moreOpen) return
    const onDown = (e: MouseEvent): void => {
      const t = e.target as Node
      if (branchBtnRef.current?.contains(t) || moreBtnRef.current?.contains(t)) return
      const panel = document.getElementById('git-toolbar-menu')
      if (panel?.contains(t)) return
      setBranchOpen(false)
      setMoreOpen(false)
    }
    window.addEventListener('mousedown', onDown)
    return () => window.removeEventListener('mousedown', onDown)
  }, [branchOpen, moreOpen])

  if (!git?.enabled || !git.showToolbar || !status || !repoRoot) {
    return null
  }

  const info = status.info
  const branchLabel = info.detachedHead
    ? `DETACHED @ ${(info.branch ?? 'HEAD').slice(0, 7)}`
    : (info.branch ?? 'HEAD')

  const menu =
    menuPos && (branchOpen || moreOpen)
      ? createPortal(
          <div
            id="git-toolbar-menu"
            className="new-item-menu-panel git-toolbar-menu"
            style={{ top: menuPos.top, left: menuPos.left }}
            role="menu"
          >
            {branchOpen
              ? (branches ?? []).map((b) => (
                  <button
                    key={b.name}
                    type="button"
                    className="menu-item"
                    role="menuitem"
                    disabled={busy || b.current}
                    onClick={() => {
                      setBranchOpen(false)
                      void runOp(`Switched to ${b.name}`, () =>
                        call(api.git.switchBranch({ repoRoot, branch: b.name }))
                      )
                    }}
                  >
                    {b.current ? '✓ ' : ''}
                    {b.name}
                  </button>
                ))
              : null}
            {moreOpen ? (
              <>
                <button
                  type="button"
                  className="menu-item"
                  role="menuitem"
                  disabled={busy}
                  onClick={() => {
                    setMoreOpen(false)
                    void runOp('Fetched', () => call(api.git.fetch({ repoRoot })))
                  }}
                >
                  Fetch
                </button>
                <button
                  type="button"
                  className="menu-item"
                  role="menuitem"
                  disabled={busy}
                  onClick={() => {
                    setMoreOpen(false)
                    void refreshRepo()
                  }}
                >
                  Refresh
                </button>
                <button
                  type="button"
                  className="menu-item"
                  role="menuitem"
                  onClick={() => {
                    setMoreOpen(false)
                    void navigate(repoRoot)
                  }}
                >
                  Open repository root
                </button>
                <button
                  type="button"
                  className="menu-item"
                  role="menuitem"
                  disabled={busy}
                  onClick={() => {
                    setMoreOpen(false)
                    void (async () => {
                      try {
                        await call(api.git.openTerminal({ repoRoot }))
                      } catch (e) {
                        notify(e instanceof IpcError ? e.message : String(e), true)
                      }
                    })()
                  }}
                >
                  Terminal
                </button>
                <button
                  type="button"
                  className="menu-item"
                  role="menuitem"
                  disabled={busy}
                  onClick={() => {
                    setMoreOpen(false)
                    setDialog({ kind: 'stash' })
                  }}
                >
                  Stash…
                </button>
                <button
                  type="button"
                  className="menu-item"
                  role="menuitem"
                  disabled={busy}
                  onClick={() => {
                    setMoreOpen(false)
                    void runOp('Stash popped', () => call(api.git.stashPop({ repoRoot })))
                  }}
                >
                  Pop stash
                </button>
                <button
                  type="button"
                  className="menu-item"
                  role="menuitem"
                  disabled={busy}
                  onClick={() => {
                    setMoreOpen(false)
                    setDialog({ kind: 'branch-create' })
                  }}
                >
                  Create branch…
                </button>
              </>
            ) : null}
          </div>,
          document.body
        )
      : null

  return (
    <>
      <div className="toolbar-edit toolbar-git" role="group" aria-label="Git">
        <span className="toolbar-sep" aria-hidden />
        <GitBranch size={14} aria-hidden className="toolbar-git-icon" />
        <span className="toolbar-git-summary" title={repoRoot}>
          <span className="toolbar-git-branch">{branchLabel}</span>
          {git.showChangedCount ? (
            <span className="toolbar-git-meta">
              · {status.changedCount === 1 ? '1 change' : `${status.changedCount} changes`}
            </span>
          ) : null}
          {git.showAheadBehind && (info.ahead != null || info.behind != null) ? (
            <span className="toolbar-git-meta">
              {info.ahead != null && info.ahead > 0 ? ` · ↑${info.ahead}` : ''}
              {info.behind != null && info.behind > 0 ? ` · ↓${info.behind}` : ''}
            </span>
          ) : null}
        </span>
        <button
          type="button"
          className="btn toolbar-btn"
          disabled={busy || status.stagedCount < 1}
          title="Commit staged changes"
          onClick={() => setDialog({ kind: 'commit' })}
        >
          Commit
        </button>
        <button
          type="button"
          className="btn toolbar-btn"
          disabled={busy}
          title="Pull"
          onClick={() => void runOp('Pulled', () => call(api.git.pull({ repoRoot })))}
        >
          Pull
        </button>
        <button
          type="button"
          className="btn toolbar-btn"
          disabled={busy}
          title="Push"
          onClick={() => void runOp('Pushed', () => call(api.git.push({ repoRoot })))}
        >
          Push
        </button>
        <button
          type="button"
          className="btn toolbar-btn"
          ref={branchBtnRef}
          disabled={busy}
          title="Switch branch"
          aria-haspopup="menu"
          aria-expanded={branchOpen}
          onClick={() => {
            setMoreOpen(false)
            const next = !branchOpen
            setBranchOpen(next)
            if (next) void loadBranches()
          }}
        >
          Branch
          <ChevronDown size={12} />
        </button>
        <button
          type="button"
          className="btn toolbar-btn"
          ref={moreBtnRef}
          disabled={busy}
          title="More Git actions"
          aria-haspopup="menu"
          aria-expanded={moreOpen}
          aria-label="More Git actions"
          onClick={() => {
            setBranchOpen(false)
            setMoreOpen((v) => !v)
          }}
        >
          <MoreHorizontal size={14} />
        </button>
      </div>
      {menu}
      {dialog?.kind === 'commit' ? (
        <GitCommitDialog
          repoRoot={repoRoot}
          stagedCount={status.stagedCount}
          onClose={() => setDialog(null)}
          onDone={() => void refreshRepo()}
        />
      ) : null}
      {dialog?.kind === 'branch-create' ? (
        <GitBranchCreateDialog
          repoRoot={repoRoot}
          onClose={() => setDialog(null)}
          onDone={() => void refreshRepo()}
        />
      ) : null}
      {dialog?.kind === 'stash' ? (
        <GitStashDialog
          repoRoot={repoRoot}
          onClose={() => setDialog(null)}
          onDone={() => void refreshRepo()}
        />
      ) : null}
    </>
  )
}
