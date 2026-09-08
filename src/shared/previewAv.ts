/**
 * Docked vs detached preview is exclusive (one preview surface).
 * Now Playing is a separate sticky player: docked AV may continue for other
 * files, but not for the same path, and not while the preview pop-out is open.
 */
export function allowDockedAvPlayer(opts: {
  mediaHold: boolean
  previewWindowOpen: boolean
  /** Absolute path currently in Now Playing, if any. */
  nowPlayingPath?: string | null
  /** Absolute path the docked preview is showing. */
  previewPath?: string | null
}): boolean {
  if (opts.mediaHold || opts.previewWindowOpen) return false
  if (opts.nowPlayingPath && opts.previewPath) {
    const a = opts.nowPlayingPath.replace(/\//g, '\\').toLowerCase()
    const b = opts.previewPath.replace(/\//g, '\\').toLowerCase()
    if (a === b) return false
  }
  return true
}

/** Rich Player (mpv) is global — only one session. Yield while Now Playing is open. */
export function allowDockedRichPlayer(opts: {
  mediaHold: boolean
  previewWindowOpen: boolean
  nowPlayingOpen: boolean
}): boolean {
  return !opts.mediaHold && !opts.previewWindowOpen && !opts.nowPlayingOpen
}
