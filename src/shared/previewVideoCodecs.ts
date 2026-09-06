/**
 * Chromium `<video>` codec probes for Preview (D33).
 * HEVC needs the OS decoder (Windows: HEVC Video Extensions); Electron does not ship a soft decode.
 */

const HEVC_NAME_RE = /\b(hevc|h\.?\s*265|hvc1|hev1|x265)\b/i
const AV1_NAME_RE = /\b(av1|av01)\b/i
const VP9_NAME_RE = /\b(vp9|vp09)\b/i
/** Common in Blu-ray rips — Chromium usually cannot decode these without proprietary ffmpeg. */
const HOSTILE_AUDIO_RE = /\b(ac-?3|e-?ac-?3|ac3|eac3|dts|truehd|mlp|pcm_bluray)\b/i

export function isHevcCodecName(raw: string | undefined | null): boolean {
  return Boolean(raw && HEVC_NAME_RE.test(raw))
}

export function isAv1CodecName(raw: string | undefined | null): boolean {
  return Boolean(raw && AV1_NAME_RE.test(raw))
}

export function isVp9CodecName(raw: string | undefined | null): boolean {
  return Boolean(raw && VP9_NAME_RE.test(raw))
}

export function isHostileAudioCodecName(raw: string | undefined | null): boolean {
  return Boolean(raw && HOSTILE_AUDIO_RE.test(raw))
}

/** Renderer-only: Media Foundation / VideoToolbox HEVC availability. */
export function chromiumReportsHevcSupport(): boolean {
  if (typeof document === 'undefined') return false
  const v = document.createElement('video')
  return Boolean(
    v.canPlayType('video/mp4; codecs="hvc1.1.6.L93.B0"') ||
      v.canPlayType('video/mp4; codecs="hev1.1.6.L93.B0"')
  )
}

export function chromiumReportsAv1Support(): boolean {
  if (typeof document === 'undefined') return false
  const v = document.createElement('video')
  return Boolean(
    v.canPlayType('video/mp4; codecs="av01.0.05M.08"') ||
      v.canPlayType('video/webm; codecs="av01.0.05M.08"')
  )
}

/**
 * Human hint when Preview cannot play — prefer actionable OS tips over generic text.
 */
export function previewVideoUnsupportedHint(opts: {
  videoCodec?: string | null
  audioCodec?: string | null
  hadMediaUrl: boolean
}): string {
  const { videoCodec, audioCodec, hadMediaUrl } = opts
  if (isHevcCodecName(videoCodec) && !chromiumReportsHevcSupport()) {
    const win =
      typeof navigator !== 'undefined' && /Windows/i.test(navigator.userAgent || '')
    return win
      ? 'HEVC (H.265) isn’t available to Chromium here. Install Microsoft’s HEVC Video Extensions.'
      : 'HEVC (H.265) isn’t available to the built-in player on this system.'
  }
  if (isHostileAudioCodecName(audioCodec)) {
    return `This file’s audio (${audioCodec}) isn’t supported in Preview.`
  }
  if (isAv1CodecName(videoCodec) && !chromiumReportsAv1Support()) {
    return 'AV1 isn’t available to the built-in player on this system.'
  }
  if (hadMediaUrl) {
    return 'This video can’t play in the built-in player (codec not supported).'
  }
  return 'This format isn’t played in Preview.'
}
