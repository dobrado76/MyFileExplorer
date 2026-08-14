import { useMemo } from 'react'
import { resolvePreviewTargetPath } from '@shared/previewTarget'
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
  const listingEntries = useAppStore((s) => s.listing.entries)
  const search = useAppStore((s) => s.search)
  const recycleBin = useAppStore((s) => s.recycleBin)
  const imageVersionPreview = useAppStore((s) => s.imageVersionPreview)

  const entries = useMemo(
    () =>
      recycleBin.active
        ? recycleBinItemsToEntries(recycleBin.items)
        : search.active
          ? searchResultsToEntries(search.results)
          : listingEntries,
    [recycleBin.active, recycleBin.items, search.active, search.results, listingEntries]
  )

  const previewPath = useMemo(
    () => resolvePreviewTargetPath(selected, focusedPath),
    [selected, focusedPath]
  )

  const selectedStamp = useMemo(() => {
    if (!previewPath) return null
    const e = entries.find((en) => samePath(en.path, previewPath))
    return e ? `${e.mtimeMs}:${e.size}` : null
  }, [previewPath, entries])

  const versionOverrideAds =
    imageVersionPreview && previewPath && samePath(previewPath, imageVersionPreview.path)
      ? imageVersionPreview.ads
      : undefined

  return { previewPath, selectedStamp, versionOverrideAds, selected }
}
