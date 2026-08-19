const NAME_MAX = 120

function foldName(name: string): string {
  return name.trim().toLowerCase()
}

/** Strip a trailing Explorer-style ` (2)` so the next free slot is `(3)`, not `(2) (2)`. */
export function scriptNameStem(name: string): string {
  const trimmed = name.trim()
  const m = trimmed.match(/^(.*) \((\d+)\)$/)
  return (m?.[1] || trimmed).trim() || 'Untitled script'
}

/**
 * Explorer-style unique label: `Name`, then `Name (2)`, `Name (3)`, …
 * Case-insensitive. Does not send anything to AI — call this on save / apply.
 */
export function uniqueScriptName(name: string, taken: readonly string[], maxLen = NAME_MAX): string {
  const used = new Set(taken.map(foldName).filter(Boolean))
  const raw = name.trim() || 'Untitled script'
  if (!used.has(foldName(raw))) return raw.slice(0, maxLen)

  const stem = scriptNameStem(raw).slice(0, Math.max(1, maxLen - 8))
  for (let i = 2; i < 10_000; i++) {
    const candidate = `${stem} (${i})`
    if (!used.has(foldName(candidate))) return candidate.slice(0, maxLen)
  }
  return `${stem} (${Date.now()})`.slice(0, maxLen)
}
