import fsp from 'node:fs/promises'
import JSZip from 'jszip'
import type { ArchiveTreeNode } from '@shared/schemas/preview'

/** Skip loading huge archives into memory just for a listing preview. */
export const MAX_ZIP_PREVIEW_BYTES = 80 * 1024 * 1024
/** Cap tree nodes so the preview pane stays responsive. */
export const MAX_ZIP_TREE_NODES = 4000

type MutableNode = {
  name: string
  path: string
  kind: 'file' | 'dir'
  size?: number
  children?: Map<string, MutableNode>
}

function ensureChild(parent: MutableNode, name: string, kind: 'file' | 'dir'): MutableNode {
  if (!parent.children) parent.children = new Map()
  let child = parent.children.get(name)
  if (!child) {
    const childPath = parent.path ? `${parent.path}/${name}` : name
    child = { name, path: childPath, kind }
    parent.children.set(name, child)
  } else if (kind === 'dir') {
    child.kind = 'dir'
  }
  return child
}

function freezeNode(node: MutableNode): ArchiveTreeNode {
  const out: ArchiveTreeNode = {
    name: node.name,
    path: node.path,
    kind: node.kind
  }
  if (node.kind === 'file' && typeof node.size === 'number') out.size = node.size
  if (node.children && node.children.size > 0) {
    const kids = [...node.children.values()].map(freezeNode)
    kids.sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === 'dir' ? -1 : 1
      return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
    })
    out.children = kids
  }
  return out
}

/**
 * Build a nested file tree from zip central-directory entries (no extract).
 * Returns `{ tree, truncated, fileCount, folderCount }`.
 */
export function buildArchiveTreeFromZip(zip: JSZip): {
  tree: ArchiveTreeNode[]
  truncated: boolean
  fileCount: number
  folderCount: number
} {
  const root: MutableNode = { name: '', path: '', kind: 'dir', children: new Map() }
  let nodes = 0
  let truncated = false
  let fileCount = 0
  let folderCount = 0

  const names = Object.keys(zip.files).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }))

  for (const rawName of names) {
    const entry = zip.files[rawName]
    if (!entry) continue
    const normalized = rawName.replace(/\\/g, '/').replace(/^\/+/, '')
    if (!normalized || normalized.includes('..')) continue

    const isDir = entry.dir || normalized.endsWith('/')
    const parts = normalized.replace(/\/+$/, '').split('/').filter(Boolean)
    if (parts.length === 0) continue

    if (nodes >= MAX_ZIP_TREE_NODES) {
      truncated = true
      break
    }

    let cur = root
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i]!
      const last = i === parts.length - 1
      const kind: 'file' | 'dir' = last && !isDir ? 'file' : 'dir'
      if (nodes >= MAX_ZIP_TREE_NODES) {
        truncated = true
        break
      }
      const before = cur.children?.has(part) ?? false
      cur = ensureChild(cur, part, kind)
      if (!before) {
        nodes++
        if (kind === 'dir') folderCount++
        else fileCount++
      }
      if (last && kind === 'file') {
        const n = entryUncompressedSize(entry)
        if (typeof n === 'number' && n >= 0) cur.size = n
      }
    }
    if (truncated) break
  }

  const tree = root.children
    ? [...root.children.values()].map(freezeNode).sort((a, b) => {
        if (a.kind !== b.kind) return a.kind === 'dir' ? -1 : 1
        return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
      })
    : []

  return { tree, truncated, fileCount, folderCount }
}

function entryUncompressedSize(entry: JSZip.JSZipObject): number | undefined {
  const any = entry as unknown as {
    _data?: { uncompressedSize?: number }
    uncompressedSize?: number
  }
  if (typeof any.uncompressedSize === 'number') return any.uncompressedSize
  if (typeof any._data?.uncompressedSize === 'number') return any._data.uncompressedSize
  return undefined
}

export async function loadZipArchiveTree(filePath: string, fileSize: number): Promise<{
  tree: ArchiveTreeNode[]
  truncated: boolean
  fileCount: number
  folderCount: number
  skippedLarge: boolean
}> {
  if (fileSize > MAX_ZIP_PREVIEW_BYTES) {
    return { tree: [], truncated: false, fileCount: 0, folderCount: 0, skippedLarge: true }
  }
  const buf = await fsp.readFile(filePath)
  const zip = await JSZip.loadAsync(buf)
  const built = buildArchiveTreeFromZip(zip)
  return { ...built, skippedLarge: false }
}
