import { useAppStore } from '../store/appStore'
import { samePath } from './paths'

/**
 * Per-item selection/focus for virtualized file views.
 * Subscribes at the cell level so changing selection does not re-render the
 * whole FileView (and every visible thumb) when folder size is large.
 */
export function useItemHighlight(
  tabId: string,
  path: string,
  isActiveTab: boolean
): { isSel: boolean; isFocus: boolean } {
  const isSel = useAppStore((s) => {
    const sel = s.tabs.find((t) => t.id === tabId)?.selected
    if (!sel || sel.length === 0) return false
    if (sel.length === 1) return samePath(sel[0]!, path)
    // Multi-select: Set would be nicer but sel is usually small vs listing.
    for (let i = 0; i < sel.length; i++) {
      if (samePath(sel[i]!, path)) return true
    }
    return false
  })
  const isFocus = useAppStore((s) => {
    if (isActiveTab) {
      return s.focusedPath != null && samePath(s.focusedPath, path)
    }
    const sel = s.tabs.find((t) => t.id === tabId)?.selected
    const last = sel?.[sel.length - 1]
    return last != null && samePath(last, path)
  })
  return { isSel, isFocus }
}
