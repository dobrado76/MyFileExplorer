import { useEffect, useLayoutEffect, useRef, useState, type JSX } from 'react'
import { createPortal } from 'react-dom'
import type { GitLogCommit } from '@shared/schemas/gitLog'
import type { GitResetMode } from '@shared/schemas/git'
import { useAppStore } from '../../store/appStore'
import { api, call, IpcError } from '../../lib/ipc'
import { gitCmdOk, looksLikeConflict } from '../git/GitDialogs'

type MenuPos = { x: number; y: number }

type SubKey = 'copy' | 'reset' | 'navigate' | 'view' | null

export function GitHistoryContextMenu({
  repoRoot,
  commit,
  commits,
  head,
  pos,
  onClose,
  onDone,
  onSelectHash,
  onOpenBranchDialog,
  onOpenTagDialog,
  onOpenDeleteTagDialog
}: {
  repoRoot: string
  commit: GitLogCommit
  commits: GitLogCommit[]
  head: string | null
  pos: MenuPos
  onClose(): void
  onDone(): void
  onSelectHash(hash: string): void
  onOpenBranchDialog(): void
  onOpenTagDialog(): void
  onOpenDeleteTagDialog(tag: string): void
}): JSX.Element {
  const notify = useAppStore((s) => s.notify)
  const askConfirm = useAppStore((s) => s.askConfirm)
  const [sub, setSub] = useState<SubKey>(null)
  const [busy, setBusy] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const subRef = useRef<HTMLDivElement>(null)
  const subAnchorRef = useRef<HTMLElement | null>(null)
  const [menuPlace, setMenuPlace] = useState<{
    left: number
    top: number
    maxHeight: number
    ready: boolean
  }>({ left: pos.x, top: pos.y, maxHeight: 400, ready: false })
  const [subPlace, setSubPlace] = useState<{
    flipX: boolean
    fixedTop: number
    fixedLeft: number
    maxHeight: number | null
    ready: boolean
  }>({ flipX: false, fixedTop: 0, fixedLeft: 0, maxHeight: null, ready: false })

  useLayoutEffect(() => {
    const el = menuRef.current
    if (!el) return
    const margin = 8
    const vh = window.visualViewport?.height ?? window.innerHeight
    const vTop = window.visualViewport?.offsetTop ?? 0
    const vw = window.innerWidth
    const maxHeight = Math.max(120, vh - margin * 2)
    el.style.maxHeight = `${maxHeight}px`
    el.style.overflowY = 'auto'
    const rect = el.getBoundingClientRect()
    const menuH = Math.min(rect.height, maxHeight)
    const menuW = rect.width
    let left = pos.x
    let top = pos.y
    if (left + menuW > vw - margin) left = Math.max(margin, vw - margin - menuW)
    if (left < margin) left = margin
    if (top + menuH > vTop + vh - margin) top = Math.max(vTop + margin, vTop + vh - margin - menuH)
    if (top < vTop + margin) top = vTop + margin
    setMenuPlace({ left, top, maxHeight, ready: true })
  }, [pos])

  useLayoutEffect(() => {
    if (!sub) {
      setSubPlace({ flipX: false, fixedTop: 0, fixedLeft: 0, maxHeight: null, ready: false })
      return
    }
    const wrap = subAnchorRef.current
    const subEl = subRef.current
    if (!wrap || !subEl) return
    const margin = 8
    const vw = window.innerWidth
    const vh = window.visualViewport?.height ?? window.innerHeight
    const vTop = window.visualViewport?.offsetTop ?? 0
    const wrapRect = wrap.getBoundingClientRect()
    const raw = subEl.getBoundingClientRect()
    const maxHeight = Math.max(80, vh - margin * 2)
    const height = Math.min(raw.height, maxHeight)
    const subW = raw.width
    const fitsRight = wrapRect.right + 2 + subW <= vw - margin
    const fitsLeft = wrapRect.left - 2 - subW >= margin
    const flipX = !fitsRight && fitsLeft
    const fixedLeft = flipX ? wrapRect.left - subW - 2 : wrapRect.right + 2
    let fixedTop = wrapRect.top - 5
    if (fixedTop + height > vTop + vh - margin) fixedTop = vTop + vh - margin - height
    if (fixedTop < vTop + margin) fixedTop = vTop + margin
    setSubPlace({ flipX, fixedTop, fixedLeft, maxHeight, ready: true })
  }, [sub])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    const onDown = (e: MouseEvent): void => {
      const t = e.target as Node
      if (menuRef.current?.contains(t)) return
      if (subRef.current?.contains(t)) return
      onClose()
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('mousedown', onDown)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('mousedown', onDown)
    }
  }, [onClose])

  const short = commit.hash.slice(0, 7)
  const parent0 = commit.parents[0]
  const parent1 = commit.parents[1]
  const parent0Loaded = parent0 ? commits.some((c) => c.hash === parent0) : false
  const parent1Loaded = parent1 ? commits.some((c) => c.hash === parent1) : false
  const tagsOnCommit = commit.refs.filter((r) => r.kind === 'tag')

  async function copy(text: string, label: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(text)
      notify(`Copied ${label}`)
    } catch {
      notify('Copy failed', true)
    }
    onClose()
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
        onDone()
        onClose()
        return
      }
      notify(label)
      onDone()
      onClose()
    } catch (e) {
      notify(e instanceof IpcError ? e.message : String(e), true)
      onDone()
      onClose()
    } finally {
      setBusy(false)
    }
  }

  async function confirmOp(
    title: string,
    body: string,
    danger: boolean,
    label: string,
    fn: () => Promise<{ success: boolean; stderr: string; stdout: string }>
  ): Promise<void> {
    const ok = await askConfirm({
      title,
      message: body,
      confirmLabel: title,
      danger
    })
    if (!ok) return
    await runOp(label, fn)
  }

  const openSub = (key: SubKey, el: HTMLElement): void => {
    subAnchorRef.current = el
    setSub(key)
  }

  const subPanel = (): JSX.Element | null => {
    if (!sub) return null
    let body: JSX.Element | null = null
    if (sub === 'copy') {
      body = (
        <>
          <button
            type="button"
            className="menu-item"
            role="menuitem"
            onClick={() => void copy(commit.hash, 'hash')}
          >
            Commit hash
          </button>
          <button
            type="button"
            className="menu-item"
            role="menuitem"
            onClick={() => void copy(short, 'short hash')}
          >
            Short hash
          </button>
          <button
            type="button"
            className="menu-item"
            role="menuitem"
            onClick={() => void copy(commit.subject, 'subject')}
          >
            Subject
          </button>
          <button
            type="button"
            className="menu-item"
            role="menuitem"
            onClick={() => void copy(commit.authorName, 'author')}
          >
            Author
          </button>
          <button
            type="button"
            className="menu-item"
            role="menuitem"
            onClick={() => void copy(commit.authorEmail, 'email')}
          >
            Author email
          </button>
          <button
            type="button"
            className="menu-item"
            role="menuitem"
            onClick={() =>
              void copy(
                `${commit.hash}\n${commit.subject}\n${commit.authorName} <${commit.authorEmail}>`,
                'commit info'
              )
            }
          >
            Full info
          </button>
        </>
      )
    } else if (sub === 'reset') {
      body = (
        <>
          {(
            [
              ['soft', 'Soft — keep index & worktree'],
              ['mixed', 'Mixed — keep worktree'],
              ['hard', 'Hard — discard all changes']
            ] as const
          ).map(([mode, label]) => (
            <button
              key={mode}
              type="button"
              className={`menu-item${mode === 'hard' ? ' danger' : ''}`}
              role="menuitem"
              disabled={busy}
              onClick={() => {
                const m = mode as GitResetMode
                void (async () => {
                  const ok = await askConfirm({
                    title: `Reset (${m})`,
                    message:
                      m === 'hard'
                        ? `HARD reset current branch to ${short}? Uncommitted changes will be permanently lost.`
                        : `Reset current branch to ${short} (${m})?`,
                    confirmLabel: `Reset ${m}`,
                    danger: m === 'hard'
                  })
                  if (!ok) return
                  await runOp(`Reset ${m} to ${short}`, () =>
                    call(api.git.reset({ repoRoot, commit: commit.hash, mode: m }))
                  )
                })()
              }}
            >
              {label}
            </button>
          ))}
        </>
      )
    } else if (sub === 'navigate') {
      body = (
        <>
          <button
            type="button"
            className="menu-item"
            role="menuitem"
            disabled={!parent0Loaded}
            onClick={() => {
              if (parent0) onSelectHash(parent0)
              onClose()
            }}
          >
            Go to first parent
          </button>
          <button
            type="button"
            className="menu-item"
            role="menuitem"
            disabled={!parent1Loaded}
            onClick={() => {
              if (parent1) onSelectHash(parent1)
              onClose()
            }}
          >
            Go to second parent
          </button>
          <button
            type="button"
            className="menu-item"
            role="menuitem"
            disabled={!head}
            onClick={() => {
              if (head) onSelectHash(head)
              onClose()
            }}
          >
            Go to HEAD
          </button>
        </>
      )
    } else if (sub === 'view') {
      body = (
        <>
          <button
            type="button"
            className="menu-item"
            role="menuitem"
            onClick={() => {
              onDone()
              onClose()
            }}
          >
            Refresh history
          </button>
          <button
            type="button"
            className="menu-item"
            role="menuitem"
            onClick={() => {
              void (async () => {
                try {
                  await call(api.git.openTerminal({ repoRoot }))
                } catch (e) {
                  notify(e instanceof IpcError ? e.message : String(e), true)
                }
                onClose()
              })()
            }}
          >
            Open terminal at root
          </button>
        </>
      )
    }
    if (!body) return null
    return createPortal(
      <div
        ref={subRef}
        className={`context-menu context-submenu git-history-submenu${subPlace.flipX ? ' flip' : ''}`}
        role="menu"
        style={{
          position: 'fixed',
          left: subPlace.fixedLeft,
          top: subPlace.fixedTop,
          maxHeight: subPlace.maxHeight ?? undefined,
          visibility: subPlace.ready ? 'visible' : 'hidden'
        }}
        onMouseEnter={() => setSub(sub)}
      >
        {body}
      </div>,
      document.body
    )
  }

  return createPortal(
    <>
      <div
        ref={menuRef}
        id="git-history-ctx"
        className="context-menu git-history-menu"
        style={{
          left: menuPlace.left,
          top: menuPlace.top,
          maxHeight: menuPlace.maxHeight,
          overflowY: 'auto',
          visibility: menuPlace.ready ? 'visible' : 'hidden'
        }}
        role="menu"
      >
      <div
        className="menu-sub-wrap"
        onMouseEnter={(e) => openSub('copy', e.currentTarget)}
        onMouseLeave={() => setSub((s) => (s === 'copy' ? null : s))}
      >
        <button type="button" className="menu-item" role="menuitem" disabled={busy}>
          Copy to clipboard
          <span className="menu-hint">›</span>
        </button>
      </div>

      <div className="menu-sep" />

      <button
        type="button"
        className="menu-item"
        role="menuitem"
        disabled={busy}
        onClick={() =>
          void confirmOp(
            'Merge into current branch',
            `Merge ${short} into the current branch?`,
            false,
            `Merged ${short}`,
            () => call(api.git.mergeCommit({ repoRoot, commit: commit.hash }))
          )
        }
      >
        Merge into current branch…
      </button>
      <button
        type="button"
        className="menu-item"
        role="menuitem"
        disabled={busy}
        onClick={() =>
          void confirmOp(
            'Rebase current branch',
            `Rebase the current branch onto ${short}? (non-interactive)`,
            true,
            `Rebased onto ${short}`,
            () => call(api.git.rebaseOnto({ repoRoot, commit: commit.hash }))
          )
        }
      >
        Rebase current branch on…
      </button>
      <div
        className="menu-sub-wrap"
        onMouseEnter={(e) => openSub('reset', e.currentTarget)}
        onMouseLeave={() => setSub((s) => (s === 'reset' ? null : s))}
      >
        <button type="button" className="menu-item" role="menuitem" disabled={busy}>
          Reset current branch to here…
          <span className="menu-hint">›</span>
        </button>
      </div>

      <div className="menu-sep" />

      <button
        type="button"
        className="menu-item"
        role="menuitem"
        disabled={busy}
        onClick={() => {
          onClose()
          onOpenBranchDialog()
        }}
      >
        Create new branch here…
      </button>
      <button
        type="button"
        className="menu-item"
        role="menuitem"
        disabled={busy}
        onClick={() => {
          onClose()
          onOpenTagDialog()
        }}
      >
        Create new tag here…
      </button>
      {tagsOnCommit.map((t) => (
        <button
          key={`del-tag-${t.name}`}
          type="button"
          className="menu-item"
          role="menuitem"
          disabled={busy}
          onClick={() => {
            onClose()
            onOpenDeleteTagDialog(t.name)
          }}
        >
          Delete tag {t.name}…
        </button>
      ))}

      <div className="menu-sep" />

      <button
        type="button"
        className="menu-item"
        role="menuitem"
        disabled={busy}
        onClick={() =>
          void confirmOp(
            'Checkout commit',
            `Check out ${short} in detached HEAD mode?`,
            false,
            `Checked out ${short}`,
            () => call(api.git.checkoutCommit({ repoRoot, commit: commit.hash }))
          )
        }
      >
        Checkout this commit…
      </button>
      <button
        type="button"
        className="menu-item"
        role="menuitem"
        disabled={busy}
        onClick={() =>
          void confirmOp(
            'Revert commit',
            `Create a revert commit for ${short}?`,
            false,
            `Reverted ${short}`,
            () => call(api.git.revert({ repoRoot, commit: commit.hash }))
          )
        }
      >
        Revert this commit…
      </button>
      <button
        type="button"
        className="menu-item"
        role="menuitem"
        disabled={busy}
        onClick={() =>
          void confirmOp(
            'Cherry-pick',
            `Cherry-pick ${short} onto the current branch?`,
            false,
            `Cherry-picked ${short}`,
            () => call(api.git.cherryPick({ repoRoot, commit: commit.hash }))
          )
        }
      >
        Cherry pick this commit…
      </button>

      <div className="menu-sep" />

      <div
        className="menu-sub-wrap"
        onMouseEnter={(e) => openSub('navigate', e.currentTarget)}
        onMouseLeave={() => setSub((s) => (s === 'navigate' ? null : s))}
      >
        <button type="button" className="menu-item" role="menuitem">
          Navigate
          <span className="menu-hint">›</span>
        </button>
      </div>
      <div
        className="menu-sub-wrap"
        onMouseEnter={(e) => openSub('view', e.currentTarget)}
        onMouseLeave={() => setSub((s) => (s === 'view' ? null : s))}
      >
        <button type="button" className="menu-item" role="menuitem" disabled={busy}>
          View
          <span className="menu-hint">›</span>
        </button>
      </div>
      </div>
      {subPanel()}
    </>,
    document.body
  )
}
