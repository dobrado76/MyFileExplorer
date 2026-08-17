/** Live file-list scroll per tab — updated on every scroll, not only the 150ms persist. */

const live = new Map<string, number>()

export function noteFileViewScroll(tabId: string, y: number): void {
  if (!tabId) return
  live.set(tabId, Math.max(0, y))
}

export function liveFileViewScroll(tabId: string): number | undefined {
  return live.get(tabId)
}

export function clearFileViewScroll(tabId: string): void {
  live.delete(tabId)
}
