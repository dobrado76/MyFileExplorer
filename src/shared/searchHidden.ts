import { VID_THUMB_CACHE_DIR } from './vidThumbCache'

export const SEARCH_FILE_ATTRIBUTE_HIDDEN = 0x2

export function attrsAreHidden(attrs: number | null | undefined): boolean {
  return attrs != null && (attrs & SEARCH_FILE_ATTRIBUTE_HIDDEN) !== 0
}

export function normalizeSearchPathKey(filePath: string): string {
  return filePath.replace(/\//g, '\\').replace(/\\+$/, '').toLowerCase()
}

/** True when the path is the video-strip cache folder or a file inside it. */
export function pathHasVidThumbCacheDir(filePath: string): boolean {
  const key = normalizeSearchPathKey(filePath)
  const needle = `\\${VID_THUMB_CACHE_DIR.toLowerCase()}`
  return key.endsWith(needle) || key.includes(`${needle}\\`)
}

export function pathIsUnderHiddenDir(filePath: string, hiddenDirs: ReadonlySet<string>): boolean {
  if (hiddenDirs.size === 0) return false
  let cur = normalizeSearchPathKey(filePath)
  while (cur) {
    if (hiddenDirs.has(cur)) return true
    const i = cur.lastIndexOf('\\')
    if (i <= 0) break
    cur = cur.slice(0, i)
  }
  return false
}

/** Hidden attribute, `!VIDTHUMB_CACHE`, or a descendant of a hidden folder. */
export function isHiddenSearchHit(opts: {
  path: string
  attrs?: number | null
  hiddenDirs?: ReadonlySet<string>
}): boolean {
  if (attrsAreHidden(opts.attrs)) return true
  if (pathHasVidThumbCacheDir(opts.path)) return true
  if (opts.hiddenDirs && pathIsUnderHiddenDir(opts.path, opts.hiddenDirs)) return true
  return false
}
