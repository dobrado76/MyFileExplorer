/** Resolve which paths Ctrl+C / Ctrl+X / Delete should act on. */

function closestClass(target: EventTarget | null, selector: string): boolean {
  if (!target || typeof (target as Element).closest !== 'function') return false
  return !!(target as Element).closest(selector)
}

export function isFolderTreeEventTarget(target: EventTarget | null): boolean {
  return closestClass(target, '.tree, .pane-tree')
}

export function isFileListEventTarget(target: EventTarget | null): boolean {
  return closestClass(target, '.fileview, .pane-files')
}

/**
 * File-view selection by default. Only when the key event originated in the
 * folder tree do we copy/cut/delete the focused tree folder (Explorer-like).
 */
export function clipboardActionPaths(opts: {
  selected: string[]
  treeFocusPath: string | null
  currentFolder: string
  eventTarget: EventTarget | null
}): string[] {
  if (isFolderTreeEventTarget(opts.eventTarget) && !isFileListEventTarget(opts.eventTarget)) {
    const p = opts.treeFocusPath ?? opts.currentFolder
    return p ? [p] : []
  }
  return opts.selected
}
