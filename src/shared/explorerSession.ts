import {
  MAIN_SHELL_ID,
  type SessionState,
  type TabState
} from './schemas/session'

export function tabWindowId(tab: { windowId?: string | null }): string {
  return tab.windowId && tab.windowId.length > 0 ? tab.windowId : MAIN_SHELL_ID
}

/**
 * Main-shell `session:set` owns main tabs, chrome, and closed stacks.
 * Tabs that live on a float stay on disk unless this write includes their id
 * (they were merged back).
 */
export function mergeMainSessionWrite(prev: SessionState, incoming: SessionState): SessionState {
  const incomingIds = new Set(incoming.tabs.map((t) => t.id))
  const floatTabs = prev.tabs.filter(
    (t) => tabWindowId(t) !== MAIN_SHELL_ID && !incomingIds.has(t.id)
  )
  const mainTabs: TabState[] = incoming.tabs.map((t) => ({ ...t, windowId: MAIN_SHELL_ID }))
  const liveFloatIds = new Set(floatTabs.map((t) => tabWindowId(t)))
  return {
    ...incoming,
    tabs: [...mainTabs, ...floatTabs],
    explorerWindows: prev.explorerWindows.filter((w) => liveFloatIds.has(w.id)),
    closedWindows: incoming.closedWindows
  }
}

/** Float `saveTabs` replaces only that shell's tabs. */
export function mergeFloatTabs(
  prev: SessionState,
  shellId: string,
  tabs: TabState[],
  activeTabId: string | null
): SessionState {
  const keep = prev.tabs.filter((t) => tabWindowId(t) !== shellId)
  const mine = tabs.map((t) => ({ ...t, windowId: shellId }))
  return {
    ...prev,
    tabs: [...keep, ...mine],
    explorerWindows: prev.explorerWindows.map((w) =>
      w.id === shellId ? { ...w, activeTabId } : w
    )
  }
}
