import type { ViewLayout } from './schemas/session'

/** Remap pane→tab assignments when the user changes 1 / 2 / 4 layout (D31). */
export function remapPanesOnLayoutChange(
  nextLayout: ViewLayout,
  prevSlots: (string | null)[],
  focusedIndex: number,
  allTabIds: string[]
): { paneTabIds: (string | null)[]; focusedPaneIndex: number } {
  const focusedTab =
    (prevSlots[focusedIndex] && allTabIds.includes(prevSlots[focusedIndex]!)
      ? prevSlots[focusedIndex]
      : null) ??
    prevSlots.find((id) => id != null && allTabIds.includes(id)) ??
    allTabIds[0] ??
    null

  // Prefer focused tab, then other previously assigned tabs (order preserved).
  const ordered: string[] = []
  if (focusedTab) ordered.push(focusedTab)
  for (const id of prevSlots) {
    if (id && id !== focusedTab && allTabIds.includes(id) && !ordered.includes(id)) {
      ordered.push(id)
    }
  }
  const seed: (string | null)[] = Array.from(
    { length: nextLayout },
    (_, i) => ordered[i] ?? null
  )
  const paneTabIds = fillPaneSlots(nextLayout, seed, allTabIds, focusedTab)
  const idx = focusedTab ? paneTabIds.indexOf(focusedTab) : 0
  return {
    paneTabIds,
    focusedPaneIndex: idx >= 0 ? idx : 0
  }
}

/** Fill null slots from tabs not already shown (tab-bar order). Does not clear intentional duplicates. */
export function fillPaneSlots(
  layout: ViewLayout,
  prev: (string | null)[],
  tabIds: string[],
  preferTabId: string | null
): (string | null)[] {
  const slots: (string | null)[] = Array.from({ length: layout }, (_, i) => {
    const id = prev[i]
    return id && tabIds.includes(id) ? id : null
  })
  // Prefer showing preferTabId if it is missing from every pane.
  if (preferTabId && tabIds.includes(preferTabId) && !slots.includes(preferTabId)) {
    const empty = slots.findIndex((s) => s == null)
    if (empty >= 0) slots[empty] = preferTabId
    else if (layout === 1) slots[0] = preferTabId
  }
  // Auto-fill remaining empties from tabs not yet visible in any pane (no auto-clone).
  const assigned = new Set(slots.filter((id): id is string => id != null))
  const unassigned = tabIds.filter((id) => !assigned.has(id))
  let u = 0
  for (let i = 0; i < slots.length && u < unassigned.length; i++) {
    if (slots[i] == null) slots[i] = unassigned[u++]!
  }
  return slots
}

export function clampPaneRatio(n: number): number {
  if (!Number.isFinite(n)) return 0.5
  return Math.min(0.85, Math.max(0.15, n))
}
