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

/** Stack Manager ↔ Generate ↔ Run so Close returns to the previous script window. */
export function shouldPushDialog(currentKind: string | undefined, nextKind: string): boolean {
  return shouldPushScriptDialog(currentKind, nextKind)
}

export function shouldPopStackedDialog(kind: string): boolean {
  return isScriptDialogKind(kind)
}
