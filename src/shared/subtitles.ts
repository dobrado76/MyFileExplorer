const SUBS_DIR_RE = /^(subs|subtitles|subtitle|sub)$/i
const SUB_EXT_RE = /\.(srt|ass|ssa|vtt|sub)$/i
const ENGLISH_RE = /(?:^|[._\s-])(?:en|eng|english)(?:[._\s-]|$)/i

export function isSubsFolderName(name: string): boolean {
  return SUBS_DIR_RE.test(name.trim())
}

export function isSubtitleFileName(name: string): boolean {
  return SUB_EXT_RE.test(name)
}

export function subtitleExt(name: string): string {
  const m = SUB_EXT_RE.exec(name)
  return m ? m[0].toLowerCase() : '.srt'
}

export function isEnglishSubtitleName(name: string): boolean {
  if (!isSubtitleFileName(name)) return false
  const base = name.replace(SUB_EXT_RE, '')
  return ENGLISH_RE.test(base)
}

export function videoStem(fileName: string): string {
  return fileName.replace(/\.[^.]+$/, '')
}

/** Episode folder under Subs whose name matches the video stem (case-insensitive). */
export function matchSubsEpisodeFolder(videoFileName: string, folderNames: string[]): string | null {
  const stem = videoStem(videoFileName).toLowerCase()
  if (!stem) return null
  return folderNames.find((n) => n.toLowerCase() === stem) ?? null
}

function sortSubtitleNames(names: string[]): string[] {
  return [...names].sort((a, b) => {
    const ae = subtitleExt(a) === '.srt' ? 0 : 1
    const be = subtitleExt(b) === '.srt' ? 0 : 1
    if (ae !== be) return ae - be
    return a.localeCompare(b, undefined, { sensitivity: 'base' })
  })
}

/**
 * First English subtitle, preferring `.srt`.
 * `names` are file names in one episode folder (or a flat Subs dir).
 * If nothing is tagged English, the only subtitle (or the only `.srt`) is used.
 */
export function pickEnglishSubtitle(names: string[]): string | null {
  const subs = names.filter((n) => isSubtitleFileName(n))
  const english = sortSubtitleNames(subs.filter((n) => isEnglishSubtitleName(n)))
  if (english[0]) return english[0]
  if (subs.length === 1) return subs[0] ?? null
  const srts = sortSubtitleNames(subs.filter((n) => subtitleExt(n) === '.srt'))
  return srts.length === 1 ? (srts[0] ?? null) : null
}
