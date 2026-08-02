export type A1111Parameters = {
  prompt: string
  negative: string | null
  settings: Record<string, string>
  raw: string
}

const SETTINGS_LINE = /^\s*Steps:\s*\d+/i
const NEGATIVE_MARKER = /^Negative prompt:\s?/im

/**
 * Parse an A1111 / Forge "parameters" text block:
 *
 *   {prompt}
 *   Negative prompt: {negative}
 *   Steps: 20, Sampler: Euler a, CFG scale: 7, Seed: 123, Size: 512x768, ...
 *
 * Returns null when the text does not look like A1111 parameters at all.
 */
export function parseA1111Parameters(raw: string): A1111Parameters | null {
  if (!raw || raw.trim().length === 0) return null
  const text = raw.replace(/\r\n/g, '\n').trim()
  const lines = text.split('\n')

  let settingsLineIdx = -1
  for (let i = lines.length - 1; i >= 0; i--) {
    if (SETTINGS_LINE.test(lines[i]!)) {
      settingsLineIdx = i
      break
    }
  }

  const negativeMatch = NEGATIVE_MARKER.exec(text)
  if (settingsLineIdx === -1 && !negativeMatch) return null

  const settingsText = settingsLineIdx >= 0 ? lines.slice(settingsLineIdx).join('\n') : ''
  const beforeSettings = settingsLineIdx >= 0 ? lines.slice(0, settingsLineIdx).join('\n') : text

  let prompt = beforeSettings
  let negative: string | null = null
  const negIdx = beforeSettings.search(NEGATIVE_MARKER)
  if (negIdx >= 0) {
    prompt = beforeSettings.slice(0, negIdx)
    negative = beforeSettings.slice(negIdx).replace(NEGATIVE_MARKER, '').trim()
  }

  return {
    prompt: prompt.trim(),
    negative,
    settings: parseSettingsPairs(settingsText),
    raw: text
  }
}

/**
 * Parse `Key: value, Key2: value2` pairs. Values may be quoted and contain
 * commas/colons inside quotes (e.g. Lora hashes:, TI hashes:).
 */
export function parseSettingsPairs(line: string): Record<string, string> {
  const out: Record<string, string> = {}
  if (!line.trim()) return out
  const re = /\s*([A-Za-z][A-Za-z0-9 _./-]*?):\s*("(?:[^"\\]|\\.)*"|[^,]*)(?:,|$)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(line)) !== null) {
    const key = m[1]!.trim()
    let value = m[2]!.trim()
    if (value.startsWith('"') && value.endsWith('"') && value.length >= 2) {
      value = value.slice(1, -1).replace(/\\(.)/g, '$1')
    }
    if (key) out[key] = value
    if (re.lastIndex === m.index) re.lastIndex++
  }
  return out
}
