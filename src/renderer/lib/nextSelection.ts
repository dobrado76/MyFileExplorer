/**
 * After deleting items from a sorted view, pick the next path to select
 * (first survivor after the last removed item; else the previous survivor).
 */
export function nextSelectionAfterDelete(orderedPaths: string[], removed: string[]): string | null {
  if (orderedPaths.length === 0 || removed.length === 0) return null
  const gone = new Set(removed.map((p) => p.toLowerCase()))
  let lastRemovedIdx = -1
  for (let i = 0; i < orderedPaths.length; i++) {
    if (gone.has(orderedPaths[i]!.toLowerCase())) lastRemovedIdx = i
  }
  if (lastRemovedIdx < 0) return null
  for (let i = lastRemovedIdx + 1; i < orderedPaths.length; i++) {
    const p = orderedPaths[i]!
    if (!gone.has(p.toLowerCase())) return p
  }
  for (let i = lastRemovedIdx - 1; i >= 0; i--) {
    const p = orderedPaths[i]!
    if (!gone.has(p.toLowerCase())) return p
  }
  return null
}
