/**
 * Image-list `.dat` cache: UTF-8, one absolute path per line.
 * Blank lines and `#` comments skipped.
 */
export function parseImageListDat(text: string): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const key = line.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(line)
  }
  return out
}

export function serializeImageListDat(paths: string[]): string {
  return paths.join('\n') + (paths.length > 0 ? '\n' : '')
}

/** Merge paths into existing list (dedupe, preserve order: existing then new). */
export function mergeImageList(existing: string[], added: string[]): string[] {
  const seen = new Set(existing.map((p) => p.toLowerCase()))
  const out = [...existing]
  for (const p of added) {
    const key = p.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(p)
  }
  return out
}
