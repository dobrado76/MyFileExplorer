/**
 * List `.7z` archive contents via bundled 7za (7zip-bin / 7zip-min).
 * Resolve 7za via require.resolve — importing path7za gets bundled and breaks in out/main.
 */
import { createRequire } from 'node:module'
import path from 'node:path'
import { config as configure7z, list as list7z } from '7zip-min'
import { buildArchiveTreeFromEntries, MAX_ZIP_TREE_NODES, type ZipListEntry } from './zipArchive'

const require = createRequire(__filename)

let configured = false

function resolve7zaPath(): string {
  const pkg = require.resolve('7zip-bin/package.json')
  const root = path.dirname(pkg)
  const name = process.platform === 'win32' ? '7za.exe' : '7za'
  let platformDir: string
  if (process.platform === 'darwin') platformDir = 'mac'
  else if (process.platform === 'win32') platformDir = 'win'
  else platformDir = 'linux'
  const bin = path.join(root, platformDir, process.arch, name)
  return bin.replace(/app\.asar(?!\.unpacked)/g, 'app.asar.unpacked')
}

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
