import type { DirEntry } from '@shared/schemas/fs'
import type { SortSpec } from '@shared/schemas/session'
import { compareEpisodeSortTuples } from '@shared/mediaMetadata'
import { compareNames, type NameSortMode } from '@shared/fileNameCompare'
import { parentOf } from './paths'

/** Optional S/E lookup for Name sort inside a media-library show/season folder. */
export type EpisodeSortLookup = (
  path: string
) => { season: number; episode: number } | null

/** Sorted entries for the current listing, honoring tab sort + folders-first. */
export function sortEntries(
  entries: DirEntry[],
  sort: SortSpec,
  foldersFirst: boolean,
  opts?: { episodeOrder?: EpisodeSortLookup; nameSort?: NameSortMode }
): DirEntry[] {
  const episodeOrder = opts?.episodeOrder
  // Virtual Folder Manual sort: keep document order. A real folder on Manual
  // still air-sorts when the caller passes episode order (thumbnail media library).
  if (sort.key === 'manual' && !episodeOrder) return [...entries]
  const dir = sort.dir === 'asc' ? 1 : -1
  const nameSort = opts?.nameSort === 'literal' ? 'literal' : 'explorer'
  const compare = (a: string, b: string): number => compareNames(a, b, nameSort)
  const sorted = [...entries].sort((a, b) => {
    if (foldersFirst) {
      const ad = a.kind === 'dir' ? 0 : 1
      const bd = b.kind === 'dir' ? 0 : 1
      if (ad !== bd) return ad - bd
    }
    let cmp = 0
    switch (sort.key) {
      case 'manual':
      case 'name': {
        // Show/season media folder: when both sides have stored S/E, air order beats
        // the rip filename (tiles already show SxxExx from metadata).
        if (episodeOrder) {
          const ao = episodeOrder(a.path)
          const bo = episodeOrder(b.path)
          if (ao && bo) {
            cmp = compareEpisodeSortTuples(ao, bo)
            if (cmp === 0) cmp = compare(a.name, b.name)
            break
          }
        }
        cmp = compare(a.name, b.name)
        break
      }
      case 'mtime':
        cmp = a.mtimeMs - b.mtimeMs
        break
      case 'ctime':
        cmp = a.birthtimeMs - b.birthtimeMs
        break
      case 'size':
        cmp = a.size - b.size
        break
      case 'type':
      case 'ext':
        cmp = compare(a.ext, b.ext) || compare(a.name, b.name)
        break
      case 'folder': {
        const ap = parentOf(a.path) ?? ''
        const bp = parentOf(b.path) ?? ''
        cmp = compare(ap, bp)
        break
      }
    }
    if (cmp === 0 && sort.key !== 'name') {
      cmp = compare(a.name, b.name)
    }
    return cmp * dir
  })
  return sorted
}
