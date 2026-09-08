/** Snapshot Chromium `<video>` playback for Now Playing ↔ docked handoff. */
export type DockedAvPlayback = {
  startAtSec: number
  /** True when the player was paused. */
  paused: boolean
}

function readVideo(selector: string, pause: boolean): DockedAvPlayback | null {
  const el = document.querySelector<HTMLVideoElement>(selector)
  if (!el || !Number.isFinite(el.currentTime) || el.currentTime < 0) return null
  const paused = el.paused
  if (pause) {
    try {
      el.pause()
    } catch {
      /* ignore */
    }
  }
  return { startAtSec: el.currentTime, paused }
}

/**
 * Read the live docked preview `<video>` position (if any).
 * Pauses the element so the handoff does not race ahead while Now Playing loads.
 */
export function captureDockedChromiumPlayback(): DockedAvPlayback | null {
  return readVideo('.preview-viz video.preview-video', true)
}

/** Read Now Playing `<video>` without pausing (dock may be rejected). */
export function peekNowPlayingChromiumPlayback(): DockedAvPlayback | null {
  return readVideo('.now-playing video.preview-video', false)
}
