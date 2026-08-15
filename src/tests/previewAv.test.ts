import { describe, expect, it } from 'vitest'
import { allowDockedAvPlayer } from '../shared/previewAv'

describe('allowDockedAvPlayer', () => {
  it('allows the docked player when the pop-out is closed', () => {
    expect(allowDockedAvPlayer({ mediaHold: false, previewWindowOpen: false })).toBe(true)
  })

  it('blocks the docked player while the pop-out is open', () => {
    expect(allowDockedAvPlayer({ mediaHold: false, previewWindowOpen: true })).toBe(false)
  })

  it('blocks the docked player during mediaHold (delete/rename)', () => {
    expect(allowDockedAvPlayer({ mediaHold: true, previewWindowOpen: false })).toBe(false)
    expect(allowDockedAvPlayer({ mediaHold: true, previewWindowOpen: true })).toBe(false)
  })
})
