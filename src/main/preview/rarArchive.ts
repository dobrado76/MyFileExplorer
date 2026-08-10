/**
 * List `.rar` archive contents via node-unrar-js (WASM UnRAR).
 */
import { createExtractorFromFile } from 'node-unrar-js'
import { buildArchiveTreeFromEntries, MAX_ZIP_TREE_NODES, type ZipListEntry } from './zipArchive'

export async function loadRarArchiveTree(filePath: string): Promise<{
  tree: ReturnType<typeof buildArchiveTreeFromEntries>['tree']
  truncated: boolean
  fileCount: number
  folderCount: number
}> {
  const extractor = await createExtractorFromFile({ filepath: filePath })
  const list = extractor.getFileList()
  const entries: ZipListEntry[] = []
  for (const header of list.fileHeaders) {
    if (entries.length >= MAX_ZIP_TREE_NODES + 64) break
    const name = (header.name || '').replace(/\\/g, '/')
    if (!name || name.includes('..')) continue
    const isDir = Boolean(header.flags?.directory) || name.endsWith('/')
    entries.push({
      name,
      isDir,
      uncompressedSize:
        !isDir && typeof header.unpSize === 'number' && header.unpSize >= 0
          ? header.unpSize
          : undefined
    })
  }
  return buildArchiveTreeFromEntries(entries)
}
