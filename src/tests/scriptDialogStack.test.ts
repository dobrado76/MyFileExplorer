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

  it('stacks USN manager over Drive Properties', () => {
    expect(shouldPushDialog('properties', 'usn-manager')).toBe(true)
    expect(shouldPushDialog('usn-manager', 'properties')).toBe(false)
    expect(shouldPopStackedDialog('usn-manager')).toBe(true)
    expect(shouldPopStackedDialog('properties')).toBe(false)
  })
})
