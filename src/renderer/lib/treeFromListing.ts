/** Dir children for the folder tree, matching the file list sort. */

export function dirChildrenFromListing(
  entries: Array<{ path: string; name: string; kind: string; isHidden?: boolean }>
): { dirs: string[]; childHidden: Record<string, boolean> } {
  const dirEntries = entries
    .filter((e) => e.kind === 'dir')
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }))
  const dirs = dirEntries.map((e) => e.path)
  const childHidden: Record<string, boolean> = {}
  for (const e of dirEntries) {
    if (e.isHidden) childHidden[e.path.toLowerCase()] = true
  }
  return { dirs, childHidden }
}

export function sameDirChildList(a: string[] | null, b: string[]): boolean {
  if (!a || a.length !== b.length) return false
  return a.every((p, i) => p.toLowerCase() === b[i]!.toLowerCase())
}
