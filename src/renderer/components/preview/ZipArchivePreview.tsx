import { useState, type JSX } from 'react'
import type { ArchiveTreeNode } from '@shared/schemas/preview'
import { FileIcon, FolderIcon } from '../../lib/icons'

function formatSize(n: number): string {
  if (n < 1024) return `${n} B`
  const units = ['KB', 'MB', 'GB']
  let v = n
  let u = -1
  do {
    v /= 1024
    u++
  } while (v >= 1024 && u < units.length - 1)
  return `${v.toFixed(v >= 100 ? 0 : 1)} ${units[u]}`
}

function TreeRow({
  node,
  depth,
  defaultOpen
}: {
  node: ArchiveTreeNode
  depth: number
  defaultOpen: boolean
}): JSX.Element {
  const isDir = node.kind === 'dir'
  const [open, setOpen] = useState(defaultOpen)
  const kids = node.children ?? []
  const hasKids = isDir && kids.length > 0

  return (
    <div className="preview-zip-node">
      <button
        type="button"
        className={`preview-zip-row${isDir ? ' is-dir' : ''}`}
        style={{ paddingLeft: 6 + depth * 14 }}
        onClick={() => {
          if (hasKids) setOpen((v) => !v)
        }}
        title={node.path}
      >
        <span className={`preview-zip-twist${hasKids ? '' : ' empty'}`} aria-hidden>
          {hasKids ? (open ? '▾' : '▸') : ''}
        </span>
        <span className="preview-zip-icon">
          {isDir ? <FolderIcon size={14} /> : <FileIcon size={14} />}
        </span>
        <span className="preview-zip-name">{node.name}</span>
        {!isDir && typeof node.size === 'number' ? (
          <span className="preview-zip-size">{formatSize(node.size)}</span>
        ) : null}
      </button>
      {hasKids && open
        ? kids.map((child) => (
            <TreeRow key={child.path} node={child} depth={depth + 1} defaultOpen={false} />
          ))
        : null}
    </div>
  )
}

type Props = {
  tree: ArchiveTreeNode[]
  onExtract: () => void
}

/** Nested contents listing for a selected `.zip` (preview only). */
export function ZipArchivePreview({ tree, onExtract }: Props): JSX.Element {
  return (
    <div className="preview-zip">
      <div className="preview-zip-toolbar">
        <span className="preview-zip-caption">Contents</span>
        <button type="button" className="btn" onClick={onExtract}>
          Extract All…
        </button>
      </div>
      {tree.length === 0 ? (
        <div className="preview-zip-empty">No contents to list</div>
      ) : (
        <div className="preview-zip-tree" role="tree" aria-label="ZIP contents">
          {tree.map((node) => (
            <TreeRow key={node.path} node={node} depth={0} defaultOpen />
          ))}
        </div>
      )}
    </div>
  )
}
