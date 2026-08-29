import { useMemo, useState, type JSX } from 'react'
import type { GitPathStatus } from '@shared/schemas/git'
import { gitStatusLabel, primaryGitState } from '@shared/schemas/git'
import { useAppStore } from '../../store/appStore'
import { api, call, IpcError } from '../../lib/ipc'
import { gitMarkerLetter, gitRootKey } from '../../lib/gitUi'
import { basename, joinPath, parentOf } from '../../lib/paths'
import { ModalShell, gitCmdOk } from './GitDialogs'

type ChangeTreeNode = {
  id: string
  name: string
  dir: boolean
  row?: GitPathStatus
  children: ChangeTreeNode[]
}

function buildChangeTree(paths: GitPathStatus[]): ChangeTreeNode {
  const root: ChangeTreeNode = { id: '', name: '', dir: true, children: [] }
  const dirMap = new Map<string, ChangeTreeNode>([['', root]])

  function ensureDir(relDir: string): ChangeTreeNode {
    const existing = dirMap.get(relDir)
    if (existing) return existing
    const slash = relDir.lastIndexOf('/')
    const parentRel = slash >= 0 ? relDir.slice(0, slash) : ''
    const name = slash >= 0 ? relDir.slice(slash + 1) : relDir
    const parent = ensureDir(parentRel)
    const node: ChangeTreeNode = { id: relDir, name, dir: true, children: [] }
    parent.children.push(node)
    dirMap.set(relDir, node)
    return node
  }

  const sorted = [...paths].sort((a, b) =>
    a.relativePath.replace(/\\/g, '/').localeCompare(b.relativePath.replace(/\\/g, '/'))
  )
  for (const row of sorted) {
    const rel = row.relativePath.replace(/\\/g, '/')
    const slash = rel.lastIndexOf('/')
    const dir = slash >= 0 ? rel.slice(0, slash) : ''
    const name = slash >= 0 ? rel.slice(slash + 1) : rel
    ensureDir(dir).children.push({ id: rel, name, dir: false, row, children: [] })
  }

  function sortNode(n: ChangeTreeNode): void {
    n.children.sort((a, b) => {
      if (a.dir !== b.dir) return a.dir ? -1 : 1
      return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
    })
    for (const c of n.children) sortNode(c)
  }
  sortNode(root)
  return root
}

function filterTree(node: ChangeTreeNode, q: string): ChangeTreeNode | null {
  if (!q) return node
  if (!node.dir) {
    const hay = `${node.id} ${node.row ? gitStatusLabel(node.row) : ''}`.toLowerCase()
    return hay.includes(q) ? node : null
  }
  const kids = node.children
    .map((c) => filterTree(c, q))
    .filter((c): c is ChangeTreeNode => c != null)
  if (kids.length === 0) {
    if (node.name.toLowerCase().includes(q)) return { ...node, children: node.children }
    return null
  }
  return { ...node, children: kids }
}

function canShowDiff(row: GitPathStatus): boolean {
  // External diff needs a HEAD blob; pure untracked/added-only paths have none.
  if (row.workingTree === 'untracked') return false
  if (row.staged === 'added' && (row.workingTree == null || row.workingTree === 'clean')) return false
  return true
}

function absForRow(repoRoot: string, row: GitPathStatus): string {
  const rel = (row.originalPath || row.relativePath).replace(/\//g, '\\')
  return joinPath(repoRoot, rel)
}

export function GitChangesDialog({
  repoRoot,
  onClose,
  onDone
}: {
  repoRoot: string
  onClose(): void
  onDone(): void
}): JSX.Element {
  const notify = useAppStore((s) => s.notify)
  const askConfirm = useAppStore((s) => s.askConfirm)
  const navigate = useAppStore((s) => s.navigate)
  const setSelection = useAppStore((s) => s.setSelection)
  const applySettingsPatch = useAppStore((s) => s.applySettingsPatch)
  const showIgnored = useAppStore((s) => s.settings.git?.showIgnored === true)
  const status = useAppStore((s) => s.gitByRoot[gitRootKey(repoRoot)] ?? null)

  const [filter, setFilter] = useState('')
  const [selected, setSelected] = useState<string | null>(null)
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  const [busy, setBusy] = useState(false)

  const paths = status?.paths
  const visiblePaths = useMemo(() => {
    const list = paths ?? []
    if (showIgnored) return list
    return list.filter(
      (p: GitPathStatus) => p.workingTree !== 'ignored' && p.staged !== 'ignored'
    )
  }, [paths, showIgnored])

  const tree = useMemo(() => {
    const built = buildChangeTree(visiblePaths)
    const q = filter.trim().toLowerCase()
    return q ? (filterTree(built, q) ?? { ...built, children: [] }) : built
  }, [visiblePaths, filter])

  const selectedRow = selected
    ? (visiblePaths.find(
        (p: GitPathStatus) => p.relativePath.replace(/\\/g, '/') === selected
      ) ?? null)
    : null

  async function refresh(): Promise<void> {
    try {
      const res = await call(api.git.refresh({ repoRoot }))
      useAppStore.getState().mergeGitStatus(res.status)
      onDone()
    } catch (e) {
      notify(e instanceof IpcError ? e.message : String(e), true)
    }
  }

  async function setShowIgnored(next: boolean): Promise<void> {
    await applySettingsPatch({ git: { showIgnored: next } })
    setBusy(true)
    try {
      await refresh()
    } finally {
      setBusy(false)
    }
  }

  async function runPaths(
    label: string,
    fn: (abs: string[]) => Promise<{ success: boolean; stderr: string; stdout: string }>,
    rows: GitPathStatus[]
  ): Promise<void> {
    if (busy || rows.length < 1) return
    setBusy(true)
    try {
      const abs = rows.map((r) => absForRow(repoRoot, r))
      const res = await fn(abs)
      const err = gitCmdOk(res)
      if (err) {
        notify(err, true)
        await refresh()
        return
      }
      notify(label)
      await refresh()
    } catch (e) {
      notify(e instanceof IpcError ? e.message : String(e), true)
      await refresh()
    } finally {
      setBusy(false)
    }
  }

  async function showDiff(row: GitPathStatus): Promise<void> {
    if (!canShowDiff(row)) {
      notify('No HEAD version to compare (untracked or newly added).', true)
      return
    }
    try {
      const res = await call(api.git.showDiff({ repoRoot, path: absForRow(repoRoot, row) }))
      if (!res.launched) notify(res.message || 'Diff tool not configured', true)
    } catch (e) {
      notify(e instanceof IpcError ? e.message : String(e), true)
    }
  }

  async function reveal(row: GitPathStatus): Promise<void> {
    const abs = absForRow(repoRoot, row)
    const parent = parentOf(abs) ?? repoRoot
    onClose()
    await navigate(parent)
    setSelection([abs], abs, abs)
  }

  function toggleDir(id: string): void {
    setCollapsed((prev) => ({ ...prev, [id]: !prev[id] }))
  }

  function renderNode(node: ChangeTreeNode, depth: number): JSX.Element[] {
    if (node.id === '' && node.dir) {
      return node.children.flatMap((c) => renderNode(c, 0))
    }
    if (node.dir) {
      const isCollapsed = collapsed[node.id] === true
      const out: JSX.Element[] = [
        <button
          key={`dir-${node.id}`}
          type="button"
          className="git-changes-row dir"
          style={{ paddingLeft: 8 + depth * 14 }}
          onClick={() => toggleDir(node.id)}
        >
          <span className="git-changes-twist" aria-hidden>
            {isCollapsed ? '▸' : '▾'}
          </span>
          <span className="git-changes-name">{node.name}</span>
        </button>
      ]
      if (!isCollapsed) {
        for (const c of node.children) out.push(...renderNode(c, depth + 1))
      }
      return out
    }
    const row = node.row!
    const state = primaryGitState(row)
    const letter = gitMarkerLetter(state)
    const isSel = selected === node.id
    return [
      <button
        key={`file-${node.id}`}
        type="button"
        className={isSel ? 'git-changes-row file selected' : 'git-changes-row file'}
        style={{ paddingLeft: 8 + depth * 14 }}
        title={gitStatusLabel(row)}
        onClick={() => setSelected(node.id)}
        onDoubleClick={() => void showDiff(row)}
      >
        <span className={`git-changes-letter state-${state}`} aria-hidden>
          {letter}
        </span>
        <span className="git-changes-name">{node.name}</span>
        <span className="git-changes-status dim">{gitStatusLabel(row)}</span>
      </button>
    ]
  }

  const titleCount = visiblePaths.length

  return (
    <ModalShell
      title={`Changes (${titleCount})`}
      onClose={onClose}
      modalClassName="modal-wide modal-git-changes"
      bodyClassName="modal-body-git-changes"
      actions={
        <>
          <button type="button" className="btn" onClick={onClose} disabled={busy}>
            Close
          </button>
          <button
            type="button"
            className="btn"
            disabled={busy || !selectedRow}
            title="Navigate to file"
            onClick={() => {
              if (selectedRow) void reveal(selectedRow)
            }}
          >
            Reveal
          </button>
          <button
            type="button"
            className="btn"
            disabled={
              busy ||
              !selectedRow ||
              !(
                selectedRow.conflicted ||
                (selectedRow.workingTree != null && selectedRow.workingTree !== 'clean')
              )
            }
            onClick={() => {
              if (selectedRow)
                void runPaths('Staged', (paths) => call(api.git.stage({ repoRoot, paths })), [
                  selectedRow
                ])
            }}
          >
            Stage
          </button>
          <button
            type="button"
            className="btn"
            disabled={
              busy || !selectedRow || !(selectedRow.staged != null && selectedRow.staged !== 'clean')
            }
            onClick={() => {
              if (selectedRow)
                void runPaths('Unstaged', (paths) => call(api.git.unstage({ repoRoot, paths })), [
                  selectedRow
                ])
            }}
          >
            Unstage
          </button>
          <button
            type="button"
            className="btn"
            disabled={busy || !selectedRow}
            onClick={() => {
              if (!selectedRow) return
              void (async () => {
                const ok = await askConfirm({
                  title: 'Discard changes?',
                  message: `Discard uncommitted changes to “${basename(selectedRow.relativePath)}”? This cannot be undone.`,
                  confirmLabel: 'Discard',
                  danger: true
                })
                if (!ok) return
                await runPaths(
                  'Discarded',
                  (paths) => call(api.git.discard({ repoRoot, paths })),
                  [selectedRow]
                )
              })()
            }}
          >
            Discard…
          </button>
          <button
            type="button"
            className="btn primary"
            disabled={busy || !selectedRow || !canShowDiff(selectedRow)}
            title="Compare with HEAD in your configured diff tool"
            onClick={() => {
              if (selectedRow) void showDiff(selectedRow)
            }}
          >
            Show changes
          </button>
        </>
      }
    >
      <p className="dim" style={{ marginTop: 0 }}>
        Working tree under {repoRoot}
        {status ? ` · ${status.stagedCount} staged · ${status.untrackedCount} untracked` : ''}
      </p>
      <div className="git-changes-toolbar">
        <label className="git-changes-filter">
          <input
            type="search"
            value={filter}
            placeholder="Filter files…"
            aria-label="Filter changed files"
            autoFocus
            onChange={(e) => setFilter(e.target.value)}
          />
        </label>
        <label className="settings-toggle git-changes-ignored-toggle" htmlFor="git-changes-show-ignored">
          <span className="settings-toggle-text">
            <span className="settings-toggle-label">Show ignored</span>
          </span>
          <input
            id="git-changes-show-ignored"
            type="checkbox"
            checked={showIgnored}
            disabled={busy}
            onChange={(e) => void setShowIgnored(e.target.checked)}
          />
        </label>
      </div>
      <div className="git-changes-tree" role="tree" aria-label="Changed files">
        {visiblePaths.length < 1 ? (
          <p className="dim" style={{ padding: 8, margin: 0 }}>
            {showIgnored ? 'No changes.' : 'No changes (ignored files hidden).'}
          </p>
        ) : (
          renderNode(tree, 0)
        )}
      </div>
      <p className="dim" style={{ marginBottom: 0, fontSize: '0.88em' }}>
        Double-click a file (or Show changes) to open your Settings → Git diff tool. Configure the tool
        if Compare does nothing.
      </p>
    </ModalShell>
  )
}
