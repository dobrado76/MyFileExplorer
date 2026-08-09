import { useEffect, useRef, useState, type JSX } from 'react'
import type { ArchiveTreeNode } from '@shared/schemas/preview'
import { api } from '../../lib/ipc'
import { FileIcon, FolderIcon } from '../../lib/icons'

function isOpenableTopic(path: string): boolean {
  if (!path || path.startsWith('__toc__/')) return false
  return !path.includes('..')
}

function TocRow({
  node,
  depth,
  selected,
  onSelect
}: {
  node: ArchiveTreeNode
  depth: number
  selected: string | null
  onSelect: (topicPath: string) => void
}): JSX.Element {
  const kids = node.children ?? []
  const hasKids = kids.length > 0
  const openable = isOpenableTopic(node.path)
  /** Collapsed on first paint — expand on click like the ZIP tree / Explorer. */
  const [open, setOpen] = useState(false)
  const active = selected !== null && selected.toLowerCase() === node.path.toLowerCase()

  return (
    <div className="preview-chm-node">
      <button
        type="button"
        className={`preview-chm-row${hasKids ? ' is-dir' : ''}${active ? ' is-active' : ''}${openable ? ' is-topic' : ''}`}
        style={{ paddingLeft: 6 + depth * 14 }}
        title={openable ? node.path : node.name}
        onClick={() => {
          if (hasKids) setOpen((v) => !v)
          if (openable) onSelect(node.path)
        }}
      >
        <span className={`preview-chm-twist${hasKids ? '' : ' empty'}`} aria-hidden>
          {hasKids ? (open ? '▾' : '▸') : ''}
        </span>
        <span className="preview-chm-icon">
          {hasKids ? <FolderIcon size={14} /> : <FileIcon size={14} />}
        </span>
        <span className="preview-chm-name">{node.name}</span>
      </button>
      {hasKids && open
        ? kids.map((child) => (
            <TocRow
              key={child.path + child.name}
              node={child}
              depth={depth + 1}
              selected={selected}
              onSelect={onSelect}
            />
          ))
        : null}
    </div>
  )
}

type Props = {
  chmPath: string
  tree: ArchiveTreeNode[]
  /** Initial topic media URL from preview:get. */
  initialMediaUrl?: string
}

/** TOC + sandboxed HTML Help topic viewer for `.chm` files. */
export function ChmPreview({ chmPath, tree, initialMediaUrl }: Props): JSX.Element {
  const [mediaUrl, setMediaUrl] = useState<string | null>(initialMediaUrl ?? null)
  const [selected, setSelected] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const gen = useRef(0)

  useEffect(() => {
    setMediaUrl(initialMediaUrl ?? null)
    setSelected(null)
    setError(null)
    setLoading(false)
    gen.current++
  }, [chmPath, initialMediaUrl])

  const openTopic = (topicPath: string): void => {
    const id = ++gen.current
    setSelected(topicPath)
    setLoading(true)
    setError(null)
    void api.preview.chmTopic({ path: chmPath, topic: topicPath }).then((res) => {
      if (id !== gen.current) return
      setLoading(false)
      if (!res.ok) {
        setError(res.error.message)
        return
      }
      setMediaUrl(res.value.mediaUrl)
    })
  }

  return (
    <div className="preview-chm">
      <div className="preview-chm-toc" role="tree" aria-label="Help contents">
        <div className="preview-chm-toc-caption">Contents</div>
        {tree.length === 0 ? (
          <div className="preview-chm-empty">No contents tree</div>
        ) : (
          <div className="preview-chm-tree">
            {tree.map((node) => (
              <TocRow
                key={node.path + node.name}
                node={node}
                depth={0}
                selected={selected}
                onSelect={openTopic}
              />
            ))}
          </div>
        )}
      </div>
      <div className="preview-chm-page">
        {error ? <div className="preview-chm-status preview-chm-error">{error}</div> : null}
        {loading ? <div className="preview-chm-status">Loading topic…</div> : null}
        {mediaUrl ? (
          <iframe
            className="preview-chm-frame"
            title="CHM topic"
            src={mediaUrl}
            // allow-same-origin: relative CSS/images; scripts still blocked without allow-scripts
            sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
          />
        ) : (
          <div className="preview-chm-empty">
            {tree.length > 0 ? 'Select a topic' : 'Open with the default help viewer for full content'}
          </div>
        )}
      </div>
    </div>
  )
}
