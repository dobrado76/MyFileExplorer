/** Normalize settings list: no dots, lowercase, unique, stable order. */
export function normalizeHideNameExtensions(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  const out: string[] = []
  const seen = new Set<string>()
  for (const item of raw) {
    if (typeof item !== 'string') continue
    const ext = item.trim().replace(/^\.+/, '').toLowerCase()
    if (!ext || ext.includes('/') || ext.includes('\\') || ext.includes(' ')) continue
    if (seen.has(ext)) continue
    seen.add(ext)
    out.push(ext)
    if (out.length >= 64) break
  }
  return out
}

/**
 * Display name for listings: strip a trailing extension when it is in the hide list.
 * Does not hide the file — only the “.ext” suffix in the label.
 */
export function displayFileName(name: string, hideExts: readonly string[]): string {
  if (!name) return name
  const dot = name.lastIndexOf('.')
  if (dot <= 0) return name
  const ext = name.slice(dot + 1).toLowerCase()
  // Virtual Folder is a first-class type — always hide `.mfevirtual` in labels.
  if (ext !== 'mfevirtual' && (hideExts.length === 0 || !hideExts.includes(ext))) return name
  const stem = name.slice(0, dot)
  return stem.length > 0 ? stem : name
}
