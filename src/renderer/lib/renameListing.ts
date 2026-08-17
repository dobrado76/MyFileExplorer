import type { DirEntry } from '@shared/schemas/fs'
import { isUnderPath, samePath } from './paths'

export function rewritePathAfterRename(p: string, from: string, to: string): string {
  if (samePath(p, from)) return to
  if (isUnderPath(p, from)) return to + p.slice(from.length)
  return p
}

function extFromFileName(name: string): string {
  const d = name.lastIndexOf('.')
  return d > 0 ? name.slice(d + 1).toLowerCase() : ''
}

export function patchDirEntriesForRename(
  entries: DirEntry[],
  from: string,
  to: string,
  newName: string
): DirEntry[] {
  let changed = false
  const next = entries.map((e) => {
    if (samePath(e.path, from)) {
      changed = true
      return {
        ...e,
        name: newName,
        path: to,
        ext: e.kind === 'dir' ? '' : extFromFileName(newName)
      }
    }
    if (isUnderPath(e.path, from)) {
      changed = true
      return { ...e, path: to + e.path.slice(from.length) }
    }
    return e
  })
  return changed ? next : entries
}
