import { describe, expect, it } from 'vitest'
import {
  DEFAULT_VID_THUMB_FRAME_MS,
  VID_THUMB_CACHE_DIR,
  VID_THUMB_FRAME_COUNT,
  isVidThumbVideoExt,
  vidThumbFrameFileName
} from '../shared/vidThumbCache'

describe('vidThumbCache', () => {
  it('names frames after the full video basename', () => {
    expect(vidThumbFrameFileName('1_720x544.mp4', 1)).toBe('1_720x544.mp4.thumb_1.jpg')
    expect(vidThumbFrameFileName('1_720x544.mp4', 20)).toBe('1_720x544.mp4.thumb_20.jpg')
  })

  it('recognizes common video extensions', () => {
    expect(isVidThumbVideoExt('mp4')).toBe(true)
    expect(isVidThumbVideoExt('.MKV')).toBe(true)
    expect(isVidThumbVideoExt('divx')).toBe(true)
    expect(isVidThumbVideoExt('png')).toBe(false)
  })

  it('keeps the expected cache folder, frame count, and default delay', () => {
    expect(VID_THUMB_CACHE_DIR).toBe('!VIDTHUMB_CACHE')
    expect(VID_THUMB_FRAME_COUNT).toBe(20)
    expect(DEFAULT_VID_THUMB_FRAME_MS).toBe(300)
  })
})
