import { describe, expect, it } from 'vitest'
import {
  isAv1CodecName,
  isHevcCodecName,
  isHostileAudioCodecName,
  isVp9CodecName,
  previewVideoUnsupportedHint
} from '../shared/previewVideoCodecs'

describe('previewVideoCodecs', () => {
  it('detects HEVC / AV1 / VP9 / hostile audio names', () => {
    expect(isHevcCodecName('HEVC')).toBe(true)
    expect(isHevcCodecName('h265')).toBe(true)
    expect(isHevcCodecName('hvc1')).toBe(true)
    expect(isHevcCodecName('avc1')).toBe(false)
    expect(isAv1CodecName('av01')).toBe(true)
    expect(isVp9CodecName('vp9')).toBe(true)
    expect(isHostileAudioCodecName('ac3')).toBe(true)
    expect(isHostileAudioCodecName('E-AC-3')).toBe(true)
    expect(isHostileAudioCodecName('aac')).toBe(false)
  })

  it('hints HEVC when Chromium cannot play it', () => {
    const hint = previewVideoUnsupportedHint({
      videoCodec: 'hevc',
      hadMediaUrl: true
    })
    expect(hint.toLowerCase()).toContain('hevc')
  })
})
