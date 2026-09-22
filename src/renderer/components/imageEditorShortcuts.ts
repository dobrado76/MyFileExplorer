/** Keys handled by the in-app image editor. */
export type ImageEditorShortcut =
  | 'save'
  | 'crop'
  | 'rotate'
  | 'flip-x'
  | 'flip-y'
  | 'remove'
  | 'resize'
  | 'annotate'
  | 'filters'
  | 'finetune'

type ShortcutEvent = {
  key: string
  repeat?: boolean
  ctrlKey?: boolean
  metaKey?: boolean
  altKey?: boolean
  shiftKey?: boolean
}

/**
 * E saves and quits. Ctrl/Cmd-S is the usual save.
 * Shift-F is Flip Y; a bare F is Flip X.
 */
export function imageEditorShortcut(e: ShortcutEvent): ImageEditorShortcut | null {
  if (e.repeat || e.altKey) return null
  const key = e.key.toLowerCase()
  const ctrl = Boolean(e.ctrlKey || e.metaKey)
  if (ctrl) {
    if (key === 's' && !e.shiftKey) return 'save'
    return null
  }
  if (key === 'f') return e.shiftKey ? 'flip-y' : 'flip-x'
  if (e.shiftKey) return null
  switch (key) {
    case 'e':
      return 'save'
    case 'c':
      return 'crop'
    case 'r':
      return 'rotate'
    case 'o':
      return 'remove'
    case 'z':
      return 'resize'
    case 'a':
      return 'annotate'
    case 't':
      return 'filters'
    case 'u':
      return 'finetune'
    default:
      return null
  }
}

/**
 * In-place Save writes a new version only after a real edit.
 * Undo back to the loaded image is not an edit. A baked crop/remove is,
 * even though the remounted editor has an empty undo stack.
 */
export function imageEditShouldWrite(opts: { hasUndo: boolean; bakedFromDisk: boolean }): boolean {
  return opts.hasUndo || opts.bakedFromDisk
}

/** True when letter shortcuts should not steal focus from form controls. */
export function isImageEditorTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  const tag = target.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true
  if (target.isContentEditable) return true
  return Boolean(target.closest('[contenteditable="true"]'))
}
