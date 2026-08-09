import JSZip from 'jszip'
import yauzl from 'yauzl'
import type { ArchiveTreeNode } from '@shared/schemas/preview'

/** Cap tree nodes so the preview pane stays responsive. */
export const MAX_ZIP_TREE_NODES = 4000

type MutableNode = {
  name: string
  path: string
  kind: 'file' | 'dir'
  size?: number
  children?: Map<string, MutableNode>
}

export type ZipListEntry = {
  name: string
  isDir: boolean
  uncompressedSize?: number
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
 * Build a nested file tree from central-directory-style entries (no extract).
 */
export function buildArchiveTreeFromEntries(entries: ZipListEntry[]): {
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

  const sorted = [...entries].sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
  )

  for (const entry of sorted) {
    const normalized = entry.name.replace(/\\/g, '/').replace(/^\/+/, '')
    if (!normalized || normalized.includes('..')) continue

    const isDir = entry.isDir || normalized.endsWith('/')
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
        const n = entry.uncompressedSize
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

/** Test helper: build tree from an in-memory JSZip. */
export function buildArchiveTreeFromZip(zip: JSZip): {
  tree: ArchiveTreeNode[]
  truncated: boolean
  fileCount: number
  folderCount: number
} {
  const entries: ZipListEntry[] = Object.keys(zip.files).map((rawName) => {
    const entry = zip.files[rawName]!
    const any = entry as unknown as {
      _data?: { uncompressedSize?: number }
      uncompressedSize?: number
    }
    const uncompressedSize =
      typeof any.uncompressedSize === 'number'
        ? any.uncompressedSize
        : typeof any._data?.uncompressedSize === 'number'
          ? any._data.uncompressedSize
          : undefined
    return {
      name: rawName,
      isDir: entry.dir || rawName.endsWith('/'),
      uncompressedSize
    }
  })
  return buildArchiveTreeFromEntries(entries)
}

/** Read only the ZIP central directory (via yauzl) — archive byte size does not matter. */
function listZipCentralDirectory(filePath: string): Promise<ZipListEntry[]> {
  return new Promise((resolve, reject) => {
    yauzl.open(filePath, { lazyEntries: true, autoClose: true }, (err, zipfile) => {
      if (err || !zipfile) {
        reject(err ?? new Error('Could not open zip'))
        return
      }
      const entries: ZipListEntry[] = []
      let settled = false
      const finish = (): void => {
        if (settled) return
        settled = true
        resolve(entries)
      }
      zipfile.readEntry()
      zipfile.on('entry', (entry) => {
        if (settled) return
        const name = entry.fileName
        const isDir = /\/$/.test(name)
        entries.push({
          name,
          isDir,
          uncompressedSize: isDir ? undefined : entry.uncompressedSize
        })
        // Enough CD names for the node cap (+ path-segment headroom).
        if (entries.length >= MAX_ZIP_TREE_NODES + 64) {
          try {
            zipfile.close()
          } catch {
            // already closing
          }
          finish()
          return
        }
        zipfile.readEntry()
      })
      zipfile.on('end', () => finish())
      zipfile.on('error', (e) => {
        if (settled) return
        settled = true
        reject(e)
      })
    })
  })
}

export async function loadZipArchiveTree(filePath: string): Promise<{
  tree: ArchiveTreeNode[]
  truncated: boolean
  fileCount: number
  folderCount: number
}> {
  const entries = await listZipCentralDirectory(filePath)
  return buildArchiveTreeFromEntries(entries)
}
