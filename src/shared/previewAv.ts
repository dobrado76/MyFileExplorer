/**
 * Docked preview pane vs detached preview window: only one Chromium
 * `<video>` / `<audio>` may bind a given `mfe-media` URL. Two players
 * starve range requests and can leave the pop-out blank for later files.
 */
export function allowDockedAvPlayer(opts: {
  mediaHold: boolean
  previewWindowOpen: boolean
}): boolean {
  return !opts.mediaHold && !opts.previewWindowOpen
}
