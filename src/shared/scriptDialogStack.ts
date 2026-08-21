const SCRIPT_DIALOG_KINDS = new Set(['script-manager', 'script-run', 'script-generate'])

export function isScriptDialogKind(kind: string): boolean {
  return SCRIPT_DIALOG_KINDS.has(kind)
}

/** Stack Manager ↔ Generate ↔ Run so Close returns to the previous script window. */
export function shouldPushScriptDialog(currentKind: string | undefined, nextKind: string): boolean {
  return Boolean(
    currentKind &&
      isScriptDialogKind(currentKind) &&
      isScriptDialogKind(nextKind) &&
      currentKind !== nextKind
  )
}

/** Drive Properties → USN manager (Close returns to Properties). */
export function shouldPushDialog(currentKind: string | undefined, nextKind: string): boolean {
  if (shouldPushScriptDialog(currentKind, nextKind)) return true
  return currentKind === 'properties' && nextKind === 'usn-manager'
}

export function shouldPopStackedDialog(kind: string): boolean {
  return isScriptDialogKind(kind) || kind === 'usn-manager'
}
