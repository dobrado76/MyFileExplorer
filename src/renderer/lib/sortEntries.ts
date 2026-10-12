import type { DirEntry } from '@shared/schemas/fs'
import type { SortSpec } from '@shared/schemas/session'
import { compareEpisodeSortTuples } from '@shared/mediaMetadata'
import { compareFileNames } from '@shared/fileNameCompare'
import { parentOf } from './paths'

const nameCollator = { compare: compareFileNames }

/** Optional S/E lookup for Name sort inside a media-library show/season folder. */
export type EpisodeSortLookup = (
  path: string
) => { season: number; episode: number } | null

/** Sorted entries for the current listing, honoring tab sort + folders-first. */
export function sortEntries(
  entries: DirEntry[],
  sort: SortSpec,
  foldersFirst: boolean,
  opts?: { episodeOrder?: EpisodeSortLookup }
): DirEntry[] {
  // Virtual Folder Manual sort: keep document / listing order as provided.
  if (sort.key === 'manual') return [...entries]
  const dir = sort.dir === 'asc' ? 1 : -1
  const episodeOrder = opts?.episodeOrder
  // Shared collator — localeCompare options-object per call is much slower on 10k+ rows.
  const sorted = [...entries].sort((a, b) => {
    if (foldersFirst) {
      const ad = a.kind === 'dir' ? 0 : 1
      const bd = b.kind === 'dir' ? 0 : 1
      if (ad !== bd) return ad - bd
    }
    let cmp = 0
    switch (sort.key) {
      case 'name': {
        // Show/season media folder: when both sides have stored S/E, air order beats
        // the rip filename (tiles already show SxxExx from metadata).
        if (episodeOrder) {
          const ao = episodeOrder(a.path)
          const bo = episodeOrder(b.path)
          if (ao && bo) {
            cmp = compareEpisodeSortTuples(ao, bo)
            if (cmp === 0) cmp = nameCollator.compare(a.name, b.name)
            break
          }
        }
        cmp = nameCollator.compare(a.name, b.name)
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
        cmp = nameCollator.compare(a.ext, b.ext) || nameCollator.compare(a.name, b.name)
        break
      case 'folder': {
        const ap = parentOf(a.path) ?? ''
        const bp = parentOf(b.path) ?? ''
        cmp = nameCollator.compare(ap, bp)
        break
      }
    }
    if (cmp === 0 && sort.key !== 'name') {
      cmp = nameCollator.compare(a.name, b.name)
    }
    return cmp * dir
  })
  return sorted
}
