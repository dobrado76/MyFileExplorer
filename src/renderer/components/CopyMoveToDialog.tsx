import { useCallback, useEffect, useState, type JSX, type ReactNode } from 'react'
import type { DriveInfo, DirEntry } from '@shared/schemas/fs'
import { useAppStore } from '../store/appStore'
import { api, call } from '../lib/ipc'
import { basename, samePath } from '../lib/paths'
import { ShellIcon } from './ShellIcon'

type Props = {
  op: 'copy' | 'move'
  paths: string[]
}

type TreeNode = {
  path: string
  name: string
  expanded: boolean
  loading: boolean
  children: TreeNode[] | null
}

function driveLabel(d: DriveInfo): string {
  const vol = d.volumeName?.trim()
  const letter = d.path.replace(/\\$/, '')
  return vol ? `${vol} (${letter})` : letter
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
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal modal-wide modal-copy-move-to" role="dialog" aria-label={title}>
        <div className="modal-title">{title}</div>
        <div className="modal-body modal-body-copy-move-to">{children}</div>
        <div className="modal-actions">{actions}</div>
      </div>
    </div>
  )
}

export function CopyMoveToDialog({ op, paths }: Props): JSX.Element {
  const closeDialog = useAppStore((s) => s.closeDialog)
  const performTransfer = useAppStore((s) => s.performTransfer)
  const navigate = useAppStore((s) => s.navigate)
  const drives = useAppStore((s) => s.drives)
  const notify = useAppStore((s) => s.notify)

  const [target, setTarget] = useState('')
  const [openAfter, setOpenAfter] = useState(false)
  const [busy, setBusy] = useState(false)
  const [roots, setRoots] = useState<TreeNode[]>([])

  useEffect(() => {
    setRoots(
      drives.map((d) => ({
        path: d.path,
        name: driveLabel(d),
        expanded: false,
        loading: false,
        children: null
      }))
    )
  }, [drives])

  const loadChildren = useCallback(async (nodePath: string): Promise<TreeNode[]> => {
    try {
      const res = await call(api.fs.list({ path: nodePath }))
      return res.entries
        .filter((e: DirEntry) => e.kind === 'dir')
        .map((e) => ({
          path: e.path,
          name: e.name,
          expanded: false,
          loading: false,
          children: null
        }))
    } catch {
      return []
    }
  }, [])

  const updateNode = useCallback((list: TreeNode[], path: string, patch: Partial<TreeNode>): TreeNode[] => {
    return list.map((n) => {
      if (samePath(n.path, path)) return { ...n, ...patch }
      if (n.children) return { ...n, children: updateNode(n.children, path, patch) }
      return n
    })
  }, [])

  const toggleExpand = async (node: TreeNode): Promise<void> => {
    if (node.expanded) {
      setRoots((r) => updateNode(r, node.path, { expanded: false }))
      return
    }
    if (node.children) {
      setRoots((r) => updateNode(r, node.path, { expanded: true }))
      return
    }
    setRoots((r) => updateNode(r, node.path, { loading: true, expanded: true }))
    const children = await loadChildren(node.path)
    setRoots((r) => updateNode(r, node.path, { loading: false, children, expanded: true }))
  }

  const pickNative = async (): Promise<void> => {
    const res = await call(api.app.pickFolder())
    if (res.path) setTarget(res.path)
  }

  const onOk = async (): Promise<void> => {
    const dest = target.trim()
    if (!dest) {
      notify('Choose a target folder', true)
      return
    }
    setBusy(true)
    try {
      closeDialog()
      const done = await performTransfer(op, paths, dest, false)
      if (done && openAfter) await navigate(dest)
    } finally {
      setBusy(false)
    }
  }

  const title = op === 'copy' ? 'Copy to' : 'Move to'
  const summary =
    paths.length === 1 ? basename(paths[0]!) : `${paths.length} items`

  const renderTree = (nodes: TreeNode[], depth: number): JSX.Element[] =>
    nodes.map((n) => (
      <div key={n.path} className="copy-move-tree-node">
        <div
          className={`copy-move-tree-row${samePath(n.path, target) ? ' selected' : ''}`}
          style={{ paddingLeft: 8 + depth * 14 }}
        >
          <button
            type="button"
            className="copy-move-tree-twist"
            aria-label={n.expanded ? 'Collapse' : 'Expand'}
            onClick={() => void toggleExpand(n)}
          >
            {n.loading ? '…' : n.expanded ? '▾' : '▸'}
          </button>
          <button
            type="button"
            className="copy-move-tree-label"
            onClick={() => setTarget(n.path)}
            onDoubleClick={() => void toggleExpand(n)}
          >
            <ShellIcon path={n.path} size={16} isDir />
            <span title={n.path}>{n.name}</span>
          </button>
        </div>
        {n.expanded && n.children ? renderTree(n.children, depth + 1) : null}
      </div>
    ))

  return (
    <ModalShell
      title={title}
      onClose={closeDialog}
      actions={
        <>
          <button type="button" className="btn" onClick={closeDialog} disabled={busy}>
            Cancel
          </button>
          <button
            type="button"
            className="btn primary"
            disabled={busy || !target.trim()}
            onClick={() => void onOk()}
          >
            OK
          </button>
        </>
      }
    >
      <p className="settings-help">
        {op === 'copy' ? 'Copy' : 'Move'} <strong>{summary}</strong> to:
      </p>
      <label className="settings-field">
        <span>Target folder</span>
        <div className="settings-inline">
          <input
            type="text"
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            spellCheck={false}
            placeholder="Select a folder below or Browse…"
          />
          <button type="button" className="btn" onClick={() => void pickNative()}>
            Browse…
          </button>
        </div>
      </label>
      <div className="copy-move-tree" role="tree">
        {roots.length === 0 ? (
          <div className="context-menu-empty">No drives available.</div>
        ) : (
          renderTree(roots, 0)
        )}
      </div>
      <label className="power-rename-check">
        <input
          type="checkbox"
          checked={openAfter}
          onChange={(e) => setOpenAfter(e.target.checked)}
        />
        Open target folder after {op === 'copy' ? 'copying' : 'moving'}
      </label>
    </ModalShell>
  )
}
