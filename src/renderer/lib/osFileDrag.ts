import { api } from './ipc'

/**
 * Start an OS file drag from a HTML5 dragstart handler.
 * Must call `event.preventDefault()` first — otherwise Chromium keeps a web-only
 * drag with no CF_HDROP and external drops (Photoshop, mail, chat) do nothing.
 *
 * Note: on Windows, startDrag takes over the gesture, so in-app HTML5 drop
 * targets will not receive this drag. Internal moves still work via right-drag
 * and cut/paste; left-drag is for exporting to other apps (and same-window
 * drops are best-effort if the platform delivers them).
 */
export function startOsFileDragFromDragStart(paths: string[]): void {
  if (paths.length === 0) return
  try {
    api.shell.startDrag({ paths })
  } catch {
    /* ignore */
  }
}
