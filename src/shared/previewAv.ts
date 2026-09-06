/**
 * Docked vs detached preview is exclusive (one surface). This guard still
 * blocks a docked `<video>` / `<audio>` if the pop-out is open so two
 * Chromium players cannot share one `mfe-media` URL.
 */
export function allowDockedAvPlayer(opts: {
  mediaHold: boolean
  previewWindowOpen: boolean
}): boolean {
  return !opts.mediaHold && !opts.previewWindowOpen
}
