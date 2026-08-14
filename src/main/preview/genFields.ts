import type { PreviewField } from '@shared/schemas/preview'
import { parseA1111Parameters, type A1111Parameters } from './a1111'
import {
  extractExifTextCandidates,
  extractJpegComComments,
  pickGenerationParametersText
} from './exifText'
import { extractPngTextChunks } from './pngText'

/** Known settings shown first (stable ids); remaining keys still appear afterward. */
const PREFERRED_SETTINGS: { key: string; id: string; label: string }[] = [
  { key: 'Steps', id: 'gen.steps', label: 'Steps' },
  { key: 'Sampler', id: 'gen.sampler', label: 'Sampler' },
  { key: 'Schedule type', id: 'gen.scheduleType', label: 'Schedule type' },
  { key: 'CFG scale', id: 'gen.cfg', label: 'CFG scale' },
  { key: 'Seed', id: 'gen.seed', label: 'Seed' },
  { key: 'Size', id: 'gen.size', label: 'Size' },
  { key: 'Model', id: 'gen.model', label: 'Model' },
  { key: 'Model hash', id: 'gen.modelHash', label: 'Model hash' },
  { key: 'VAE', id: 'gen.vae', label: 'VAE' },
  { key: 'Denoising strength', id: 'gen.denoising', label: 'Denoising strength' },
  { key: 'Clip skip', id: 'gen.clipSkip', label: 'Clip skip' },
  { key: 'Lora hashes', id: 'gen.loraHashes', label: 'LoRA hashes' }
]

function slugSettingKey(key: string): string {
  return key
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 48)
}

export function capGenText(value: string, warnings: string[], label: string, max = 120_000): string {
  if (value.length <= max) return value
  warnings.push(`${label} truncated for preview`)
  return value.slice(0, max) + '\n…'
}

/**
 * Collect A1111/Comfy parameter text candidates from PNG tEXt, JPEG COM, and EXIF
 * (UserComment / XPComment / ImageDescription — what Explorer shows as Comments).
 */
export function collectGenerationParameterCandidates(
  buf: Buffer,
  ext: string,
  exifBuf?: Buffer | null
): string[] {
  const candidates: string[] = []
  const push = (s: string | null | undefined): void => {
    const t = s?.trim()
    if (t && !candidates.includes(t)) candidates.push(t)
  }

  if (ext === 'png') {
    const chunks = extractPngTextChunks(buf)
    for (const c of chunks) {
      const k = c.keyword.toLowerCase()
      if (k === 'parameters' || k === 'comment') push(c.text)
    }
  }

  if (ext === 'jpg' || ext === 'jpeg' || ext === 'jfif') {
    for (const c of extractJpegComComments(buf)) push(c)
  }

  if (exifBuf && exifBuf.length > 0) {
    for (const c of extractExifTextCandidates(exifBuf)) push(c)
  }

  return candidates
}

export function resolveGenerationParametersText(
  buf: Buffer,
  ext: string,
  exifBuf?: Buffer | null
): string | null {
  const candidates = collectGenerationParameterCandidates(buf, ext, exifBuf)
  return pickGenerationParametersText(candidates, (s) => parseA1111Parameters(s) !== null)
}

/** Append decomposed Generation fields from a parsed A1111/Comfy parameters block. */
export function pushA1111GenerationFields(
  parsed: A1111Parameters,
  fields: PreviewField[],
  warnings: string[]
): void {
  if (parsed.prompt) {
    fields.push({
      id: 'gen.prompt',
      label: 'Prompt',
      value: capGenText(parsed.prompt, warnings, 'Prompt'),
      group: 'generation',
      mono: true,
      copyable: true
    })
  }
  if (parsed.negative) {
    fields.push({
      id: 'gen.negative',
      label: 'Negative prompt',
      value: capGenText(parsed.negative, warnings, 'Negative prompt'),
      group: 'generation',
      mono: true,
      copyable: true
    })
  }

  const s = parsed.settings
  const used = new Set<string>()
  for (const row of PREFERRED_SETTINGS) {
    const v = s[row.key]
    if (!v) continue
    used.add(row.key)
    fields.push({
      id: row.id,
      label: row.label,
      value: v,
      group: 'generation',
      copyable: true,
      mono: row.key === 'Lora hashes'
    })
  }
  for (const [key, value] of Object.entries(s)) {
    if (used.has(key) || !value) continue
    fields.push({
      id: `gen.setting.${slugSettingKey(key)}`,
      label: key,
      value,
      group: 'generation',
      copyable: true
    })
  }

  fields.push({
    id: 'gen.rawParameters',
    label: 'Raw parameters',
    value: capGenText(parsed.raw, warnings, 'Raw parameters'),
    group: 'generation',
    mono: true,
    copyable: true
  })
}
