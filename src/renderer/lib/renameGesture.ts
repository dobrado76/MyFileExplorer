/** Pointer gesture for the inline rename field. */

export type RenameGesture = {
  /** Primary button went down inside the field and has not been released. */
  selecting: boolean
  /** Outside release of that press — blur must not commit. */
  ignoreBlur: boolean
  /** The click that follows an outside release must not hit the file list or tree. */
  swallowClick: boolean
}

export function idleRenameGesture(): RenameGesture {
  return { selecting: false, ignoreBlur: false, swallowClick: false }
}

/** Click-away commits. A press inside the field starts a text selection. */
export function onRenamePointerDown(
  gesture: RenameGesture,
  inside: boolean
): { gesture: RenameGesture; commit: boolean } {
  if (inside) return { gesture: { ...gesture, selecting: true }, commit: false }
  return { gesture, commit: !gesture.selecting }
}

/**
 * Releasing outside the box ends the selection drag, not the rename.
 * `restore` means put focus and the selected range back on the field.
 */
export function onRenamePointerUp(
  gesture: RenameGesture,
  inside: boolean
): { gesture: RenameGesture; restore: boolean } {
  if (!gesture.selecting) return { gesture, restore: false }
  if (inside) return { gesture: { ...gesture, selecting: false }, restore: false }
  return {
    gesture: { selecting: false, ignoreBlur: true, swallowClick: true },
    restore: true
  }
}

export function onRenameBlur(gesture: RenameGesture): { commit: boolean; refocus: boolean } {
  if (gesture.selecting || gesture.ignoreBlur) return { commit: false, refocus: true }
  return { commit: true, refocus: false }
}

export function onRenameClick(
  gesture: RenameGesture,
  inside: boolean
): { gesture: RenameGesture; swallow: boolean } {
  if (!gesture.swallowClick || inside) {
    return { gesture: { ...gesture, swallowClick: false }, swallow: false }
  }
  return { gesture: { ...gesture, swallowClick: false }, swallow: true }
}

export function clearRenameIgnoreBlur(gesture: RenameGesture): RenameGesture {
  return { ...gesture, ignoreBlur: false }
}
