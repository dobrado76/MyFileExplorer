/**
 * List `.7z` archive contents via bundled 7za (7zip-bin / 7zip-min).
 */
import { config as configure7z, list as list7z } from '7zip-min'
import { resolve7zaPath } from '../fs/sevenZipBin'
import { buildArchiveTreeFromEntries, MAX_ZIP_TREE_NODES, type ZipListEntry } from './zipArchive'

let configured = false

function ensure7zaPath(): void {
  if (configured) return
  configure7z({ binaryPath: resolve7zaPath() })
  configured = true
}

export async function loadSevenZipArchiveTree(filePath: string): Promise<{
  tree: ReturnType<typeof buildArchiveTreeFromEntries>['tree']
  truncated: boolean
  fileCount: number
  folderCount: number
}> {
  ensure7zaPath()
  const items = await list7z(filePath)
  const entries: ZipListEntry[] = []
  for (const item of items) {
    if (entries.length >= MAX_ZIP_TREE_NODES + 64) break
    const name = (item.name || '').replace(/\\/g, '/')
    if (!name || name.includes('..')) continue
    const attr = (item.attr || '').toUpperCase()
    const isDir = attr.includes('D') || name.endsWith('/')
    const sizeNum = item.size !== undefined ? Number.parseInt(item.size, 10) : Number.NaN
    entries.push({
      name,
      isDir,
      uncompressedSize: !isDir && Number.isFinite(sizeNum) && sizeNum >= 0 ? sizeNum : undefined
    })
  }
  return buildArchiveTreeFromEntries(entries)
}
