export type A1111Parameters = {
  prompt: string
  negative: string | null
  settings: Record<string, string>
  raw: string
}

/** A settings tail. ComfyUI writes a linked widget as `Steps: ['153', 0]` instead of `Steps: 8`. */
const SETTINGS_LINE = /^\s*Steps:\s*(?:\d|\[)/i
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

const SETTING_KEY = /^[A-Za-z][A-Za-z0-9 _./-]*$/

/**
 * Parse `Key: value, Key2: value2` pairs. Values may be quoted and contain
 * commas/colons inside quotes (e.g. Lora hashes:, TI hashes:). A ComfyUI
 * widget link `['153', 0]` is one value, including the comma inside the brackets.
 */
export function parseSettingsPairs(line: string): Record<string, string> {
  const out: Record<string, string> = {}
  const text = line.replace(/\r\n/g, '\n')
  let i = 0
  while (i < text.length) {
    while (i < text.length && (text[i] === ' ' || text[i] === '\n' || text[i] === ',')) i++
    if (i >= text.length) break
    const colon = text.indexOf(':', i)
    if (colon < 0) break
    const key = text.slice(i, colon).trim()
    if (!SETTING_KEY.test(key)) break
    i = colon + 1
    while (i < text.length && text[i] === ' ') i++
    const value = readSettingValue(text, i)
    out[key] = value.text
    i = value.end
  }
  return out
}

function readSettingValue(text: string, start: number): { text: string; end: number } {
  const ch = text[start]
  if (ch === '"') return readQuoted(text, start)
  if (ch === '[') return readBracketValue(text, start)
  let i = start
  while (i < text.length && text[i] !== ',') i++
  return { text: text.slice(start, i).trim(), end: i }
}

function readQuoted(text: string, start: number): { text: string; end: number } {
  let i = start + 1
  let out = ''
  while (i < text.length) {
    const ch = text[i]!
    if (ch === '\\' && i + 1 < text.length) {
      out += text[i + 1]
      i += 2
      continue
    }
    if (ch === '"') return { text: out, end: i + 1 }
    out += ch
    i++
  }
  return { text: out, end: text.length }
}

function readBracketValue(text: string, start: number): { text: string; end: number } {
  let depth = 0
  let i = start
  let quote: "'" | '"' | null = null
  while (i < text.length) {
    const ch = text[i]!
    if (quote) {
      if (ch === '\\') {
        i += 2
        continue
      }
      if (ch === quote) quote = null
      i++
      continue
    }
    if (ch === "'" || ch === '"') {
      quote = ch
      i++
      continue
    }
    if (ch === '[') depth++
    else if (ch === ']') {
      depth--
      if (depth === 0) return { text: text.slice(start, i + 1).trim(), end: i + 1 }
    }
    i++
  }
  return { text: text.slice(start).trim(), end: text.length }
}
