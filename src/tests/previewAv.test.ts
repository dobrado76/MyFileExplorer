import { describe, expect, it } from 'vitest'
import { allowDockedAvPlayer, allowDockedRichPlayer } from '../shared/previewAv'

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

  it('blocks docked AV for the same path as Now Playing', () => {
    expect(
      allowDockedAvPlayer({
        mediaHold: false,
        previewWindowOpen: false,
        nowPlayingPath: 'D:\\Videos\\a.mkv',
        previewPath: 'D:\\Videos\\a.mkv'
      })
    ).toBe(false)
  })

  it('allows docked AV for a different path while Now Playing is active', () => {
    expect(
      allowDockedAvPlayer({
        mediaHold: false,
        previewWindowOpen: false,
        nowPlayingPath: 'D:\\Videos\\a.mkv',
        previewPath: 'D:\\Videos\\b.mp4'
      })
    ).toBe(true)
  })
})

describe('allowDockedRichPlayer', () => {
  it('yields while Now Playing is open (one global mpv)', () => {
    expect(
      allowDockedRichPlayer({
        mediaHold: false,
        previewWindowOpen: false,
        nowPlayingOpen: true
      })
    ).toBe(false)
  })

  it('allows Rich Player when Now Playing is closed', () => {
    expect(
      allowDockedRichPlayer({
        mediaHold: false,
        previewWindowOpen: false,
        nowPlayingOpen: false
      })
    ).toBe(true)
  })
})
