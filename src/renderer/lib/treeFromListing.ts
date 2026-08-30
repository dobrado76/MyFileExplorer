/** Dir children for the folder tree, matching the file list sort. */

import { isVirtualFolderDocumentPath, isVirtualFolderGroupPath } from '@shared/virtualFolder'

export function dirChildrenFromListing(
  entries: Array<{ path: string; name: string; kind: string; isHidden?: boolean; ext?: string }>
): {
  dirs: string[]
  childHidden: Record<string, boolean>
  childLabels: Record<string, string>
} {
  const dirEntries = entries
    .filter(
      (e) =>
        e.kind === 'dir' ||
        e.ext?.toLowerCase() === 'mfevirtual' ||
        isVirtualFolderDocumentPath(e.path) ||
        isVirtualFolderGroupPath(e.path)
    )
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }))
  const dirs = dirEntries.map((e) => e.path)
  const childHidden: Record<string, boolean> = {}
  const childLabels: Record<string, string> = {}
  for (const e of dirEntries) {
    if (e.isHidden) childHidden[e.path.toLowerCase()] = true
    childLabels[e.path.toLowerCase()] = e.name
  }
  return { dirs, childHidden, childLabels }
}

export function sameDirChildList(a: string[] | null, b: string[]): boolean {
  if (!a || a.length !== b.length) return false
  return a.every((p, i) => p.toLowerCase() === b[i]!.toLowerCase())
}
