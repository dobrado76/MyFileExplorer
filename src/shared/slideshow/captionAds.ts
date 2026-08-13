/** NTFS ADS name holding JSON caption posters. */
export const CAPTION_ADS_NAME = 'Caption'

export type CaptionEntry = {
  caption: string
  descriptor: string
  sentence: string
}

function asString(v: unknown): string {
  return typeof v === 'string' ? v.trim() : ''
}

/**
 * Parse Caption ADS JSON: an array of `{ Caption, Descriptor, Sentence }`.
 * Tolerates a single object, extra keys, and BOM.
 */
export function parseCaptionAds(raw: string): CaptionEntry[] {
  const text = raw.replace(/^\uFEFF/, '').trim()
  if (!text) return []
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    return []
  }
  const rows = Array.isArray(data) ? data : data && typeof data === 'object' ? [data] : []
  const out: CaptionEntry[] = []
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue
    const o = row as Record<string, unknown>
    const caption = asString(o.Caption ?? o.caption)
    const descriptor = asString(o.Descriptor ?? o.descriptor)
    const sentence = asString(o.Sentence ?? o.sentence)
    if (!caption && !descriptor && !sentence) continue
    out.push({ caption, descriptor, sentence })
  }
  return out
}

export function pickRandomCaption(entries: CaptionEntry[]): CaptionEntry | null {
  if (entries.length === 0) return null
  const i = Math.floor(Math.random() * entries.length)
  return entries[i] ?? null
}

/** Normalize raw Caption ADS bytes the same way parsing does. */
export function normalizeCaptionAdsStream(raw: string): string {
  return raw.replace(/^\uFEFF/, '').trim()
}

/** FNV-1a 32-bit. */
export function hashCaptionSeed(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

function accentCssFromSeed(seed: number): string {
  const hue = seed % 360
  const sat = 44 + (seed % 26)
  const light = 50 + ((seed >>> 9) % 16)
  // Comma form — canvas fillStyle/strokeStyle rejects space-separated hsl().
  return `hsl(${hue}, ${sat}%, ${light}%)`
}

/**
 * Stable poster accent from the full Caption ADS stream (before entry pick).
 * Same file stream → same color even when a random array entry is shown.
 */
export function captionAccentFromStream(streamText: string): string {
  return accentCssFromSeed(hashCaptionSeed(normalizeCaptionAdsStream(streamText)))
}

/** @deprecated Prefer captionAccentFromStream — kept for tests. */
export function captionFillCss(caption: string): string {
  return accentCssFromSeed(hashCaptionSeed(caption))
}
