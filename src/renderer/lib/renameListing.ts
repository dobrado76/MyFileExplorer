import type { DirEntry } from '@shared/schemas/fs'
import { isUnderPath, samePath } from './paths'

/** True when a finished rename should keep selection / scroll on that item. */
export function renameShouldFollow(opts: {
  renamingPath: string | null
  focusedPath: string | null
  selected: string[]
  paths: string[]
}): boolean {
  const isOurs = (p: string | null | undefined): boolean =>
    !!p && opts.paths.some((x) => samePath(p, x))
  if (opts.renamingPath && !isOurs(opts.renamingPath)) return false
  if (opts.focusedPath && !isOurs(opts.focusedPath)) return false
  if (opts.selected.length > 0 && !opts.selected.some(isOurs)) return false
  return true
}

export function rewritePathAfterRename(p: string, from: string, to: string): string {
  if (samePath(p, from)) return to
  if (isUnderPath(p, from)) return to + p.slice(from.length)
  return p
}

function extFromFileName(name: string): string {
  const d = name.lastIndexOf('.')
  return d > 0 ? name.slice(d + 1).toLowerCase() : ''
}

/** True when `to` is already another row — rewriting `from` onto it aliases both items. */
export function renameDestOccupied(
  entries: readonly Pick<DirEntry, 'path'>[],
  from: string,
  to: string
): boolean {
  if (samePath(from, to)) return false
  return entries.some((e) => samePath(e.path, to) && !samePath(e.path, from))
}

export function patchDirEntriesForRename(
  entries: DirEntry[],
  from: string,
  to: string,
  newName: string
): DirEntry[] {
  // Never move two siblings onto one path (rename Test2 → existing Test).
  // Keep the source row's path; only show the typed name until the FS op finishes.
  const pathRewrite = !renameDestOccupied(entries, from, to)
  let changed = false
  const next = entries.map((e) => {
    if (samePath(e.path, from)) {
      changed = true
      return {
        ...e,
        name: newName,
        path: pathRewrite ? to : e.path,
        ext: e.kind === 'dir' ? '' : extFromFileName(newName)
      }
    }
    if (pathRewrite && isUnderPath(e.path, from)) {
      changed = true
      return { ...e, path: to + e.path.slice(from.length) }
    }
    return e
  })
  return changed ? next : entries
}
