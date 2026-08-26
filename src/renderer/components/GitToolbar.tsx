import { useEffect, useRef, useState, type JSX } from 'react'
import { createPortal } from 'react-dom'
import { GitBranch, MoreHorizontal } from 'lucide-react'
import type { GitBranchInfo, GitRepositoryStatus } from '@shared/schemas/git'
import { useAppStore } from '../store/appStore'
import { api, call, IpcError } from '../lib/ipc'
import { lookupGitForPath } from '../lib/gitUi'
import { isRemoteLocation } from '@shared/remotePaths'
import { ChevronDown } from '../lib/icons'
import {
  GitBranchCreateDialog,
  GitCommitDialog,
  GitPushDialog,
  GitStashDialog,
  gitCmdOk,
  looksLikeConflict
} from './git/GitDialogs'
import { GitChangesDialog } from './git/GitChangesDialog'

type LocalDialog =
  | { kind: 'commit' }
  | { kind: 'branch-create' }
  | { kind: 'stash' }
  | { kind: 'push' }
  | { kind: 'changes' }
  | null

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
            className="context-menu new-item-menu-panel git-toolbar-menu"
            style={{ position: 'fixed', top: menuPos.top, left: menuPos.left }}
            role="menu"
            onMouseDown={(e) => e.stopPropagation()}
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
            <button
              type="button"
              className="toolbar-git-meta toolbar-git-changes-btn"
              disabled={busy || status.changedCount < 1}
              title="Inspect changed files"
              onClick={() => setDialog({ kind: 'changes' })}
            >
              · {status.changedCount === 1 ? '1 change' : `${status.changedCount} changes`}
            </button>
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
          disabled={busy || status.changedCount < 1}
          title={
            status.stagedCount > 0
              ? `Commit ${status.stagedCount} staged change${status.stagedCount === 1 ? '' : 's'}`
              : `Commit ${status.changedCount} change${status.changedCount === 1 ? '' : 's'} (will stage all)`
          }
          onClick={() => setDialog({ kind: 'commit' })}
        >
          Commit ({status.stagedCount > 0 ? status.stagedCount : status.changedCount})
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
          onClick={() => setDialog({ kind: 'push' })}
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
          changedCount={status.changedCount}
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
      {dialog?.kind === 'push' ? (
        <GitPushDialog
          repoRoot={repoRoot}
          onClose={() => setDialog(null)}
          onDone={() => void refreshRepo()}
        />
      ) : null}
      {dialog?.kind === 'changes' ? (
        <GitChangesDialog
          repoRoot={repoRoot}
          onClose={() => setDialog(null)}
          onDone={() => void refreshRepo()}
        />
      ) : null}
    </>
  )
}
