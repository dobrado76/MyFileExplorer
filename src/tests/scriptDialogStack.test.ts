import { describe, expect, it } from 'vitest'
import {
  isScriptDialogKind,
  shouldPopStackedDialog,
  shouldPushDialog,
  shouldPushScriptDialog
} from '../shared/scriptDialogStack'

describe('script dialog stack', () => {
  it('pushes Manager under Run and Generate', () => {
    expect(shouldPushScriptDialog('script-manager', 'script-run')).toBe(true)
    expect(shouldPushScriptDialog('script-manager', 'script-generate')).toBe(true)
    expect(shouldPushScriptDialog('script-generate', 'script-run')).toBe(true)
  })

  it('does not stack the same kind or unrelated dialogs', () => {
    expect(shouldPushScriptDialog('script-run', 'script-run')).toBe(false)
    expect(shouldPushScriptDialog('script-manager', 'settings')).toBe(false)
    expect(shouldPushScriptDialog(undefined, 'script-run')).toBe(false)
  })

  it('recognizes script dialog kinds', () => {
    expect(isScriptDialogKind('script-run')).toBe(true)
    expect(isScriptDialogKind('confirm')).toBe(false)
  })

  it('does not stack Properties (detached windows) with USN', () => {
    expect(shouldPushDialog('properties', 'usn-manager')).toBe(false)
    expect(shouldPopStackedDialog('usn-manager')).toBe(false)
    expect(shouldPopStackedDialog('script-run')).toBe(true)
  })
})
