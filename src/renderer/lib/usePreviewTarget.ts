import { useMemo } from 'react'
import { resolvePreviewTargetPath } from '@shared/previewTarget'
import { isUnderPath } from '@shared/paths'
import { useAppStore } from '../store/appStore'
import { samePath } from './paths'
import { searchResultsToEntries } from './searchEntries'
import { recycleBinItemsToEntries } from './recycleBinEntries'

export function usePreviewTarget(): {
  previewPath: string | null
  selectedStamp: string | null
  versionOverrideAds: string | null | undefined
  selected: string[]
} {
  const selected = useAppStore((s) => s.tabs.find((t) => t.id === s.activeTabId)?.selected ?? [])
  const focusedPath = useAppStore((s) => s.focusedPath)
  const listingPath = useAppStore((s) => s.listing.path)
  const listingEntries = useAppStore((s) => s.listing.entries)
  const search = useAppStore((s) => s.search)
  const recycleBin = useAppStore((s) => s.recycleBin)
  const imageVersionPreview = useAppStore((s) => s.imageVersionPreview)
  /** Bumped on image edit / ADS / note saves — listing mtime often unchanged for NTFS tip ADS. */
  const columnMetaBump = useAppStore((s) => s.columnMetaBump)

  const entries = useMemo(
    () =>
      recycleBin.active
        ? recycleBinItemsToEntries(recycleBin.items)
        : search.active
          ? searchResultsToEntries(search.results)
          : listingEntries,
    [recycleBin.active, recycleBin.items, search.active, search.results, listingEntries]
  )

  const folderFallback =
    !search.active && !recycleBin.active && listingPath.trim() ? listingPath : null
  const previewPath = useMemo(
    () => resolvePreviewTargetPath(selected, focusedPath, folderFallback),
    [selected, focusedPath, folderFallback]
  )

  const selectedStamp = useMemo(() => {
    if (!previewPath) return null
    const e = entries.find((en) => samePath(en.path, previewPath))
    const base = e ? `${e.mtimeMs}:${e.size}` : ''
    const contentBump =
      columnMetaBump.path && isUnderPath(previewPath, columnMetaBump.path)
        ? `b${columnMetaBump.rev}`
        : ''
    if (!base && !contentBump) return null
    return contentBump ? `${base}:${contentBump}` : base
  }, [previewPath, entries, columnMetaBump.path, columnMetaBump.rev])

  const versionOverrideAds =
    imageVersionPreview && previewPath && samePath(previewPath, imageVersionPreview.path)
      ? imageVersionPreview.ads
      : undefined

  return { previewPath, selectedStamp, versionOverrideAds, selected }
}
