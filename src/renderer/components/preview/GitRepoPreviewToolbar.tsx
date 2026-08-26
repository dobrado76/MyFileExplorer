import { useEffect, useRef, useState, type JSX } from 'react'
import { createPortal } from 'react-dom'
import { GitBranch, MoreHorizontal, RefreshCw, Terminal } from 'lucide-react'
import type { GitBranchInfo, GitRepositoryStatus } from '@shared/schemas/git'
import { useAppStore } from '../../store/appStore'
import { api, call, IpcError } from '../../lib/ipc'
import { ChevronDown } from '../../lib/icons'
import {
  GitBranchCreateDialog,
  GitCommitDialog,
  GitStashDialog,
  gitCmdOk,
  looksLikeConflict
} from '../git/GitDialogs'

type LocalDialog = { kind: 'commit' } | { kind: 'branch-create' } | { kind: 'stash' } | null

export function GitRepoPreviewToolbar({
  repoRoot,
  status,
  filter,
  onFilterChange,
  onRefresh
}: {
  repoRoot: string
  status: GitRepositoryStatus | null
  filter: string
  onFilterChange(value: string): void
  onRefresh(): void
}): JSX.Element {
  const notify = useAppStore((s) => s.notify)
  const navigate = useAppStore((s) => s.navigate)
  const mergeGitStatus = useAppStore((s) => s.mergeGitStatus)

  const [dialog, setDialog] = useState<LocalDialog>(null)
  const [branches, setBranches] = useState<GitBranchInfo[] | null>(null)
  const [branchOpen, setBranchOpen] = useState(false)
  const [syncOpen, setSyncOpen] = useState(false)
  const [moreOpen, setMoreOpen] = useState(false)
  const [menuPos, setMenuPos] = useState<{ top: number; left: number } | null>(null)
  const [busy, setBusy] = useState(false)
  const branchBtnRef = useRef<HTMLButtonElement>(null)
  const syncBtnRef = useRef<HTMLButtonElement>(null)
  const moreBtnRef = useRef<HTMLButtonElement>(null)

  const info = status?.info
  const branchLabel = info?.detachedHead
    ? `DETACHED @ ${(info.branch ?? 'HEAD').slice(0, 7)}`
    : (info?.branch ?? '—')
  const stagedCount = status?.stagedCount ?? 0

  async function refreshRepo(): Promise<void> {
    try {
      const res = await call(api.git.refresh({ repoRoot }))
      mergeGitStatus(res.status)
    } catch (e) {
      notify(e instanceof IpcError ? e.message : String(e), true)
    }
    onRefresh()
  }

  async function runOp(
    label: string,
    fn: () => Promise<{ success: boolean; stderr: string; stdout: string }>
  ): Promise<void> {
    if (busy) return
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
    try {
      const res = await call(api.git.listBranches({ repoRoot }))
      setBranches(res.branches)
    } catch (e) {
      notify(e instanceof IpcError ? e.message : String(e), true)
    }
  }

  const openMenu = branchOpen ? 'branch' : syncOpen ? 'sync' : moreOpen ? 'more' : null

  useEffect(() => {
    if (!openMenu) {
      setMenuPos(null)
      return
    }
    const btn =
      openMenu === 'branch'
        ? branchBtnRef.current
        : openMenu === 'sync'
          ? syncBtnRef.current
          : moreBtnRef.current
    if (!btn) return
    const place = (): void => {
      const r = btn.getBoundingClientRect()
      const width = 200
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
  }, [openMenu])

  useEffect(() => {
    if (!openMenu) return
    const onDown = (e: MouseEvent): void => {
      const t = e.target as Node
      if (
        branchBtnRef.current?.contains(t) ||
        syncBtnRef.current?.contains(t) ||
        moreBtnRef.current?.contains(t)
      ) {
        return
      }
      const panel = document.getElementById('git-preview-toolbar-menu')
      if (panel?.contains(t)) return
      setBranchOpen(false)
      setSyncOpen(false)
      setMoreOpen(false)
    }
    window.addEventListener('mousedown', onDown)
    return () => window.removeEventListener('mousedown', onDown)
  }, [openMenu])

  const menu =
    menuPos && openMenu
      ? createPortal(
          <div
            id="git-preview-toolbar-menu"
            className="new-item-menu-panel git-toolbar-menu"
            style={{ top: menuPos.top, left: menuPos.left }}
            role="menu"
          >
            {openMenu === 'branch'
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
            {openMenu === 'sync' ? (
              <>
                <button
                  type="button"
                  className="menu-item"
                  role="menuitem"
                  disabled={busy}
                  onClick={() => {
                    setSyncOpen(false)
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
                    setSyncOpen(false)
                    void runOp('Pulled', () => call(api.git.pull({ repoRoot })))
                  }}
                >
                  Pull
                </button>
              </>
            ) : null}
            {openMenu === 'more' ? (
              <>
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
      <div className="git-repo-preview-toolbar" role="toolbar" aria-label="Git repository">
        <button
          type="button"
          className="btn toolbar-btn"
          disabled={busy}
          title="Refresh"
          aria-label="Refresh"
          onClick={() => void refreshRepo()}
        >
          <RefreshCw size={14} />
        </button>
        <span className="toolbar-sep" aria-hidden />
        <GitBranch size={14} aria-hidden className="toolbar-git-icon" />
        <button
          type="button"
          className="btn toolbar-btn git-preview-branch-btn"
          ref={branchBtnRef}
          disabled={busy}
          title={repoRoot}
          aria-haspopup="menu"
          aria-expanded={branchOpen}
          onClick={() => {
            setSyncOpen(false)
            setMoreOpen(false)
            const next = !branchOpen
            setBranchOpen(next)
            if (next) void loadBranches()
          }}
        >
          <span className="git-preview-branch-label">{branchLabel}</span>
          <ChevronDown size={12} />
        </button>
        {status ? (
          <span className="git-preview-toolbar-meta" title="Working tree">
            {status.changedCount} change{status.changedCount === 1 ? '' : 's'}
            {status.stagedCount > 0 ? ` · ${status.stagedCount} staged` : ''}
            {status.conflictCount > 0 ? ` · ${status.conflictCount} conflict` : ''}
            {info && (info.ahead != null || info.behind != null)
              ? ` · ↑${info.ahead ?? 0} ↓${info.behind ?? 0}`
              : ''}
          </span>
        ) : null}
        <span className="toolbar-sep" aria-hidden />
        <button
          type="button"
          className="btn toolbar-btn"
          ref={syncBtnRef}
          disabled={busy}
          title="Fetch / Pull"
          aria-haspopup="menu"
          aria-expanded={syncOpen}
          onClick={() => {
            setBranchOpen(false)
            setMoreOpen(false)
            setSyncOpen((v) => !v)
          }}
        >
          ↓
          <ChevronDown size={12} />
        </button>
        <button
          type="button"
          className="btn toolbar-btn"
          disabled={busy}
          title="Push"
          onClick={() => void runOp('Pushed', () => call(api.git.push({ repoRoot })))}
        >
          ↑
        </button>
        <button
          type="button"
          className="btn toolbar-btn"
          disabled={busy || stagedCount < 1}
          title="Commit staged changes"
          onClick={() => setDialog({ kind: 'commit' })}
        >
          Commit ({stagedCount})
        </button>
        <button
          type="button"
          className="btn toolbar-btn"
          ref={moreBtnRef}
          disabled={busy}
          title="More"
          aria-haspopup="menu"
          aria-expanded={moreOpen}
          aria-label="More Git actions"
          onClick={() => {
            setBranchOpen(false)
            setSyncOpen(false)
            setMoreOpen((v) => !v)
          }}
        >
          <MoreHorizontal size={14} />
        </button>
        <button
          type="button"
          className="btn toolbar-btn"
          disabled={busy}
          title="Open terminal at repository root"
          aria-label="Terminal"
          onClick={() => {
            void (async () => {
              try {
                await call(api.git.openTerminal({ repoRoot }))
              } catch (e) {
                notify(e instanceof IpcError ? e.message : String(e), true)
              }
            })()
          }}
        >
          <Terminal size={14} />
        </button>
        <label className="git-preview-filter" title="Filter commits">
          <input
            type="search"
            value={filter}
            placeholder="Filter…"
            aria-label="Filter commits"
            onChange={(e) => onFilterChange(e.target.value)}
          />
        </label>
      </div>
      {menu}
      {dialog?.kind === 'commit' ? (
        <GitCommitDialog
          repoRoot={repoRoot}
          stagedCount={stagedCount}
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
