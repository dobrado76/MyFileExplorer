/**
 * Safetensors header parse (no weight load).
 * Format: u64le header length + UTF-8 JSON + tensor bytes.
 * @see https://huggingface.co/docs/safetensors
 */
import fsp from 'node:fs/promises'
import type { PreviewField } from '@shared/schemas/preview'

/** Reject absurd headers (typical even large models stay well under this). */
export const MAX_SAFETENSORS_HEADER_BYTES = 32 * 1024 * 1024

type TensorInfo = {
  dtype: string
  shape: number[]
  data_offsets: [number, number]
}

export type SafetensorsParseResult = {
  tensorCount: number
  parameterCount: number
  dtypes: Record<string, number>
  tensorNames: string[]
  metadata: Record<string, string>
  likelyKind: string | null
}

export type SafetensorsPreviewBuild = {
  subtitle: string
  fields: PreviewField[]
}

/** Flat string keys we surface as labeled rows (in order). */
const META_ROWS: { key: string; label: string }[] = [
  { key: 'modelspec.title', label: 'Title' },
  { key: 'ss_output_name', label: 'Output name' },
  { key: 'name', label: 'Name' },
  { key: 'modelspec.architecture', label: 'Architecture' },
  { key: 'modelspec.implementation', label: 'Implementation' },
  { key: 'ss_base_model_version', label: 'Base model' },
  { key: 'ss_sd_model_name', label: 'Base checkpoint' },
  { key: 'ss_sd_model_hash', label: 'Base checkpoint hash' },
  { key: 'ss_network_module', label: 'Network' },
  { key: 'ss_network_dim', label: 'Dim' },
  { key: 'ss_network_alpha', label: 'Alpha' },
  { key: 'ss_resolution', label: 'Resolution' },
  { key: 'ss_epoch', label: 'Epoch' },
  { key: 'ss_num_epochs', label: 'Epochs' },
  { key: 'ss_steps', label: 'Steps' },
  { key: 'ss_max_train_steps', label: 'Max steps' },
  { key: 'ss_learning_rate', label: 'Learning rate' },
  { key: 'ss_unet_lr', label: 'UNet LR' },
  { key: 'ss_text_encoder_lr', label: 'Text encoder LR' },
  { key: 'ss_optimizer', label: 'Optimizer' },
  { key: 'ss_lr_scheduler', label: 'LR scheduler' },
  { key: 'ss_seed', label: 'Seed' },
  { key: 'ss_num_train_images', label: 'Train images' },
  { key: 'ss_num_reg_images', label: 'Reg images' },
  { key: 'ss_mixed_precision', label: 'Mixed precision' },
  { key: 'ss_training_comment', label: 'Comment' },
  { key: 'sshs_model_hash', label: 'Model hash' },
  { key: 'sshs_legacy_hash', label: 'Legacy hash' },
  { key: 'modelspec.author', label: 'Author' },
  { key: 'modelspec.license', label: 'License' },
  { key: 'version', label: 'Version' }
]

/** Keys absorbed into summary / rows — never re-dumped as JSON. */
const ABSORB_KEYS = new Set([
  ...META_ROWS.map((r) => r.key),
  'format',
  'modelspec.sai_model_spec',
  'modelspec.date',
  'modelspec.tags',
  'modelspec.description',
  'modelspec.usage_hint',
  'ss_network_args',
  'ss_v2',
  'ss_v_parameterization',
  'ss_clip_skip',
  'ss_batch_size_per_device',
  'ss_gradient_checkpointing',
  'ss_caption_dropout_rate',
  'ss_cache_latents',
  'software',
  'training_info',
  'ss_tag_frequency',
  'ss_datasets',
  'ss_bucket_info'
])

const TRAINING_INFO_ROWS: { key: string; label: string }[] = [
  { key: 'step', label: 'Step' },
  { key: 'steps', label: 'Steps' },
  { key: 'total_steps', label: 'Total steps' },
  { key: 'epoch', label: 'Epoch' },
  { key: 'epochs', label: 'Epochs' },
  { key: 'learning_rate', label: 'Learning rate' },
  { key: 'lr', label: 'Learning rate' },
  { key: 'optimizer', label: 'Optimizer' },
  { key: 'noise_scheduler', label: 'Noise scheduler' },
  { key: 'scheduler', label: 'Scheduler' },
  { key: 'resolution', label: 'Resolution' },
  { key: 'batch_size', label: 'Batch size' },
  { key: 'dtype', label: 'Train dtype' },
  { key: 'base_model', label: 'Base model' },
  { key: 'model', label: 'Base model' },
  { key: 'network_dim', label: 'Dim' },
  { key: 'network_alpha', label: 'Alpha' },
  { key: 'rank', label: 'Rank' },
  { key: 'seed', label: 'Seed' }
]

function humanizeKey(key: string): string {
  const spaced = key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_.-]+/g, ' ')
    .trim()
  if (!spaced) return key
  return spaced.charAt(0).toUpperCase() + spaced.slice(1)
}

/** Per-tensor maps (quantization metadata, etc.) — never flatten into hundreds of rows. */
function isPerTensorMap(obj: Record<string, unknown>): boolean {
  const keys = Object.keys(obj)
  if (keys.length < 12) return false
  let objectValues = 0
  for (const v of Object.values(obj)) {
    if (v && typeof v === 'object' && !Array.isArray(v)) objectValues++
  }
  return objectValues / keys.length >= 0.6
}

function dominantValues(counts: Map<string, number>): string[] {
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([v]) => v)
}

/**
 * Collapse a per-tensor metadata map into a few summary rows
 * (e.g. scheme / block size / tensor count) instead of one row per tensor.
 */
export function summarizePerTensorMap(
  key: string,
  obj: Record<string, unknown>
): { label: string; value: string; id: string }[] {
  const entries = Object.entries(obj)
  const propCounts = new Map<string, Map<string, number>>()
  let objectEntries = 0
  const scalarTop = new Map<string, number>()

  for (const [, info] of entries) {
    if (info && typeof info === 'object' && !Array.isArray(info)) {
      objectEntries++
      for (const [pk, pv] of Object.entries(info as Record<string, unknown>)) {
        const s = asDisplayString(pv)
        if (s == null) continue
        let m = propCounts.get(pk)
        if (!m) {
          m = new Map()
          propCounts.set(pk, m)
        }
        m.set(s, (m.get(s) ?? 0) + 1)
      }
    } else {
      const s = asDisplayString(info)
      if (s != null) scalarTop.set(s, (scalarTop.get(s) ?? 0) + 1)
    }
  }

  const baseLabel = humanizeKey(key.replace(/_metadata$/i, ''))
  const out: { label: string; value: string; id: string }[] = []
  out.push({
    id: `st.bulk.${key}.count`,
    label: baseLabel,
    value: `${entries.length} tensors`
  })

  // Prefer well-known property names for a short “scheme” line
  const schemeKeys = ['scheme', 'quant_scheme', 'format', 'quant_type', 'type', 'mode']
  for (const sk of schemeKeys) {
    const counts = propCounts.get(sk)
    if (!counts || counts.size === 0) continue
    const dom = dominantValues(counts)
    out.push({
      id: `st.bulk.${key}.${sk}`,
      label: `${baseLabel} scheme`,
      value: dom.length === 1 ? dom[0]! : dom.slice(0, 3).join(' · ')
    })
    propCounts.delete(sk)
    break
  }

  for (const [pk, counts] of propCounts) {
    const dom = dominantValues(counts)
    if (dom.length === 0) continue
    // Skip high-cardinality noise (unique per tensor)
    if (counts.size > Math.max(4, entries.length * 0.25)) continue
    const label =
      /block|group|size|bits|dim/i.test(pk) ? humanizeKey(pk) : `${baseLabel} ${humanizeKey(pk)}`
    out.push({
      id: `st.bulk.${key}.${pk}`,
      label,
      value:
        dom.length === 1 && (counts.get(dom[0]!) ?? 0) >= objectEntries * 0.8
          ? dom[0]!
          : dom
              .slice(0, 3)
              .map((v) => `${v} (${counts.get(v)})`)
              .join(' · ')
    })
    if (out.length >= 6) break
  }

  if (objectEntries === 0 && scalarTop.size > 0) {
    const dom = dominantValues(scalarTop)
    out.push({
      id: `st.bulk.${key}.values`,
      label: `${baseLabel} values`,
      value: dom.slice(0, 4).join(' · ')
    })
  }

  return out
}

/**
 * Promote top-level scalars only. Nested objects:
 * - small → one JSON field (caller handles)
 * - per-tensor / large → summarized, not flattened
 */
function promoteShallowEntries(
  obj: Record<string, unknown>,
  fields: PreviewField[],
  seenLabels: Set<string>,
  idPrefix: string
): Record<string, unknown> {
  const rest: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(obj)) {
    const str = asDisplayString(v)
    if (str != null) {
      pushRow(fields, seenLabels, `${idPrefix}.${k}`, humanizeKey(k), str, 'generation', {
        mono: str.length > 80 || /hash|url|repo|uri/i.test(k)
      })
      continue
    }
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      const nested = v as Record<string, unknown>
      if (isPerTensorMap(nested) || Object.keys(nested).length > 16) {
        for (const row of summarizePerTensorMap(k, nested)) {
          pushRow(fields, seenLabels, row.id, row.label, row.value, 'generation')
        }
        continue
      }
      // Tiny nested object: flatten one level of scalars only
      if (Object.keys(nested).length <= 8) {
        let promoted = 0
        const nestedRest: Record<string, unknown> = {}
        for (const [nk, nv] of Object.entries(nested)) {
          const ns = asDisplayString(nv)
          if (ns != null) {
            pushRow(
              fields,
              seenLabels,
              `${idPrefix}.${k}.${nk}`,
              `${humanizeKey(k)} ${humanizeKey(nk)}`,
              ns,
              'generation',
              { mono: ns.length > 80 || /hash|url|repo|uri/i.test(nk) }
            )
            promoted++
          } else if (nv != null && nv !== '') {
            nestedRest[nk] = nv
          }
        }
        if (Object.keys(nestedRest).length > 0) rest[k] = nestedRest
        else if (promoted === 0) rest[k] = nested
        continue
      }
      rest[k] = nested
      continue
    }
    if (v != null && v !== '') rest[k] = v
  }
  return rest
}

export function formatParamCount(n: number): string {
  if (!Number.isFinite(n) || n < 0) return '0'
  if (n < 1000) return String(n)
  const units = ['', 'K', 'M', 'B', 'T']
  let v = n
  let u = 0
  while (v >= 1000 && u < units.length - 1) {
    v /= 1000
    u++
  }
  const digits = v >= 100 ? 0 : v >= 10 ? 1 : 2
  return `${v.toFixed(digits)} ${units[u]}`.trim()
}

export function inferSafetensorsKind(
  tensorNames: string[],
  metadata: Record<string, string>
): string | null {
  const joined = tensorNames.slice(0, 120).join('\n').toLowerCase()
  const mod = (metadata.ss_network_module ?? '').toLowerCase()
  // PEFT / ai-toolkit LoRA tensors often look like …lora_A.weight under diffusion_model.*
  if (
    mod.includes('lora') ||
    joined.includes('lora_a') ||
    joined.includes('lora_b') ||
    joined.includes('lora_down') ||
    joined.includes('lora_up') ||
    joined.includes('lora_unet') ||
    joined.includes('lora_te') ||
    /(^|[\n./_])lora([_./]|$)/i.test(joined)
  ) {
    return 'LoRA'
  }
  if (mod.includes('lokr') || joined.includes('lokr_')) return 'LoKr'
  if (mod.includes('locon') || joined.includes('locon_')) return 'LoCon'
  if (mod.includes('oft') || joined.includes('oft_')) return 'OFT'
  if (metadata['modelspec.architecture']) return metadata['modelspec.architecture']!
  if (joined.includes('model.diffusion_model') || /(^|\n)diffusion_model\./.test(joined)) {
    return 'Diffusion UNet'
  }
  if (joined.includes('conditioner.embedders') || joined.includes('text_encoders.')) {
    return 'Text encoder / conditioner'
  }
  if (joined.includes('first_stage_model') || joined.includes('autoencoder')) {
    return 'VAE / autoencoder'
  }
  if (metadata.quantization_metadata || metadata.quantization_config) return 'Quantized weights'
  if (metadata.format === 'pt' && tensorNames.length > 0) return 'PyTorch weights'
  return null
}

function productShape(shape: unknown): number | null {
  if (!Array.isArray(shape) || shape.length === 0) return 1
  let n = 1
  for (const d of shape) {
    if (typeof d !== 'number' || !Number.isFinite(d) || d < 0 || !Number.isInteger(d)) return null
    n *= d
  }
  return n
}

/** Parse header JSON object into summary stats. */
export function summarizeSafetensorsHeader(header: Record<string, unknown>): SafetensorsParseResult {
  const metadata: Record<string, string> = {}
  const rawMeta = header.__metadata__
  if (rawMeta && typeof rawMeta === 'object' && !Array.isArray(rawMeta)) {
    for (const [k, v] of Object.entries(rawMeta as Record<string, unknown>)) {
      if (typeof v === 'string') metadata[k] = v
      else if (v != null) metadata[k] = String(v)
    }
  }

  const dtypes: Record<string, number> = {}
  const tensorNames: string[] = []
  let parameterCount = 0
  let tensorCount = 0

  for (const [name, info] of Object.entries(header)) {
    if (name === '__metadata__') continue
    if (!info || typeof info !== 'object' || Array.isArray(info)) continue
    const t = info as Partial<TensorInfo>
    if (typeof t.dtype !== 'string' || !Array.isArray(t.shape)) continue
    const params = productShape(t.shape)
    if (params === null) continue
    tensorCount++
    tensorNames.push(name)
    parameterCount += params
    dtypes[t.dtype] = (dtypes[t.dtype] ?? 0) + params
  }

  tensorNames.sort((a, b) => a.localeCompare(b))
  return {
    tensorCount,
    parameterCount,
    dtypes,
    tensorNames,
    metadata,
    likelyKind: inferSafetensorsKind(tensorNames, metadata)
  }
}

/**
 * Read only the safetensors JSON header from disk.
 * Returns null if the file is not a valid safetensors header.
 */
export async function readSafetensorsHeader(filePath: string): Promise<{
  header: Record<string, unknown>
  headerBytes: number
} | null> {
  const handle = await fsp.open(filePath, 'r')
  try {
    const size = (await handle.stat()).size
    if (size < 8) return null
    const lenBuf = Buffer.alloc(8)
    await handle.read(lenBuf, 0, 8, 0)
    const headerLenBig = lenBuf.readBigUInt64LE(0)
    if (headerLenBig <= 0n || headerLenBig > BigInt(MAX_SAFETENSORS_HEADER_BYTES)) return null
    const headerBytes = Number(headerLenBig)
    if (8 + headerBytes > size) return null
    const headerBuf = Buffer.alloc(headerBytes)
    await handle.read(headerBuf, 0, headerBytes, 8)
    if (headerBuf[0] !== 0x7b /* { */) return null
    const text = headerBuf.toString('utf8').trimEnd()
    const parsed: unknown = JSON.parse(text)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    return { header: parsed as Record<string, unknown>, headerBytes }
  } catch {
    return null
  } finally {
    await handle.close()
  }
}

/** Recursively parse JSON-encoded string values (common in ai-toolkit / Kohya). */
export function deepParseJsonValue(value: unknown, depth = 0): unknown {
  if (depth > 6) return value
  if (typeof value === 'string') {
    const t = value.trim()
    if (!(t.startsWith('{') || t.startsWith('['))) return value
    try {
      return deepParseJsonValue(JSON.parse(t), depth + 1)
    } catch {
      return value
    }
  }
  if (Array.isArray(value)) return value.map((v) => deepParseJsonValue(v, depth + 1))
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = deepParseJsonValue(v, depth + 1)
    }
    return out
  }
  return value
}

function asDisplayString(v: unknown): string | null {
  if (v == null) return null
  if (typeof v === 'string') {
    const t = v.trim()
    return t.length > 0 ? t : null
  }
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  return null
}

function prettyJson(value: unknown): string {
  return JSON.stringify(value, null, 2)
}

function cap(s: string, max: number, warnings: string[], label: string): string {
  if (s.length <= max) return s
  warnings.push(`${label} truncated for display`)
  return s.slice(0, max)
}

const DISPLAY_CAP = 48 * 1024
const TENSOR_NAME_SAMPLE = 6

function pushRow(
  fields: PreviewField[],
  seenLabels: Set<string>,
  id: string,
  label: string,
  value: string,
  group: PreviewField['group'],
  opts?: { mono?: boolean; syntax?: 'json'; copyable?: boolean }
): void {
  const key = label.toLowerCase()
  if (seenLabels.has(key)) return
  seenLabels.add(key)
  fields.push({
    id,
    label,
    value,
    group,
    mono: opts?.mono,
    syntax: opts?.syntax,
    copyable: opts?.copyable ?? true
  })
}

function primaryDtype(dtypes: Record<string, number>): string | null {
  let best: string | null = null
  let bestN = -1
  for (const [dt, n] of Object.entries(dtypes)) {
    if (n > bestN) {
      best = dt
      bestN = n
    }
  }
  return best
}

/** Build subtitle + tidy preview fields (no redundant JSON dumps). */
export function safetensorsFieldsFromSummary(
  summary: SafetensorsParseResult,
  warnings: string[]
): SafetensorsPreviewBuild {
  const fields: PreviewField[] = []
  const seenLabels = new Set<string>()
  const expanded: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(summary.metadata)) {
    expanded[k] = deepParseJsonValue(v)
  }

  const dtype = primaryDtype(summary.dtypes)
  const subtitleParts = [
    'SafeTensors',
    summary.likelyKind,
    formatParamCount(summary.parameterCount),
    dtype,
    summary.tensorCount > 0 ? `${summary.tensorCount} tensors` : null
  ].filter((p): p is string => !!p && p.length > 0)
  const subtitle = subtitleParts.join(' · ')

  // --- Weights (compact) ---
  pushRow(
    fields,
    seenLabels,
    'st.params',
    'Parameters',
    `${formatParamCount(summary.parameterCount)} (${summary.parameterCount.toLocaleString()})`,
    'other'
  )
  pushRow(fields, seenLabels, 'st.tensors', 'Tensors', String(summary.tensorCount), 'other')
  if (dtype) {
    const dtypeParts = Object.entries(summary.dtypes)
      .sort((a, b) => b[1] - a[1])
      .map(([dt, n]) => (dt === dtype && Object.keys(summary.dtypes).length === 1 ? dt : `${dt} ${formatParamCount(n)}`))
    pushRow(fields, seenLabels, 'st.dtypes', 'Dtype', dtypeParts.join(' · '), 'other')
  }
  if (summary.tensorNames.length > 0) {
    const sample = summary.tensorNames.slice(0, TENSOR_NAME_SAMPLE)
    const more =
      summary.tensorNames.length > TENSOR_NAME_SAMPLE
        ? `\n… +${summary.tensorNames.length - TENSOR_NAME_SAMPLE} more`
        : ''
    fields.push({
      id: 'st.tensorNames',
      label: 'Sample tensors',
      value: sample.join('\n') + more,
      group: 'other',
      mono: true,
      copyable: true
    })
  }

  // --- Identity / training rows ---
  const software = expanded.software
  if (software && typeof software === 'object' && !Array.isArray(software)) {
    const sw = software as Record<string, unknown>
    const swName = asDisplayString(sw.name) ?? asDisplayString(sw.title)
    if (swName) pushRow(fields, seenLabels, 'st.software', 'Software', swName, 'generation')
    const swVer = asDisplayString(sw.version)
    if (swVer) pushRow(fields, seenLabels, 'st.softwareVer', 'Software version', swVer, 'generation')
    const swRepo =
      asDisplayString(sw.repo) ?? asDisplayString(sw.url) ?? asDisplayString(sw.homepage)
    if (swRepo) pushRow(fields, seenLabels, 'st.softwareRepo', 'Repo', swRepo, 'generation', { mono: true })
  } else {
    const swStr = asDisplayString(software)
    if (swStr) pushRow(fields, seenLabels, 'st.software', 'Software', swStr, 'generation')
  }

  // Prefer a single display name (avoid Output name + Name duplicates)
  const displayName =
    asDisplayString(expanded['modelspec.title']) ??
    asDisplayString(expanded.ss_output_name) ??
    asDisplayString(expanded.name)
  if (displayName) {
    pushRow(fields, seenLabels, 'st.name', 'Name', displayName, 'generation')
  }

  for (const { key, label } of META_ROWS) {
    if (key === 'modelspec.title' || key === 'ss_output_name' || key === 'name') continue
    if (key === 'version' && seenLabels.has('software version')) continue
    const raw = expanded[key]
    const str = asDisplayString(raw)
    if (!str) continue
    // Skip format: pt — already in subtitle as SafeTensors
    if (key === 'format') continue
    pushRow(fields, seenLabels, `st.meta.${key}`, label, str, 'generation', {
      mono: str.length > 80 || key.includes('hash')
    })
  }

  const trainingInfo = expanded.training_info
  if (trainingInfo && typeof trainingInfo === 'object' && !Array.isArray(trainingInfo)) {
    const ti = trainingInfo as Record<string, unknown>
    const usedTi = new Set<string>()
    for (const { key, label } of TRAINING_INFO_ROWS) {
      const str = asDisplayString(ti[key])
      if (!str) continue
      usedTi.add(key)
      pushRow(fields, seenLabels, `st.train.${key}`, label, str, 'generation')
    }
    const restTi: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(ti)) {
      if (usedTi.has(k)) continue
      restTi[k] = v
    }
    const stillTi = promoteShallowEntries(restTi, fields, seenLabels, 'st.train')
    if (Object.keys(stillTi).length > 0) {
      fields.push({
        id: 'st.trainingInfo',
        label: 'Training details',
        value: cap(prettyJson(stillTi), DISPLAY_CAP, warnings, 'Training details'),
        group: 'generation',
        mono: true,
        syntax: 'json',
        copyable: true
      })
    }
  } else if (typeof trainingInfo === 'string' && trainingInfo.trim()) {
    fields.push({
      id: 'st.trainingInfo',
      label: 'Training details',
      value: cap(trainingInfo, DISPLAY_CAP, warnings, 'Training details'),
      group: 'generation',
      mono: true,
      copyable: true
    })
  }

  for (const special of [
    { key: 'ss_tag_frequency', label: 'Tag frequency' },
    { key: 'ss_datasets', label: 'Datasets' },
    { key: 'ss_bucket_info', label: 'Bucket info' },
    { key: 'modelspec.description', label: 'Description' },
    { key: 'modelspec.usage_hint', label: 'Usage hint' }
  ] as const) {
    const val = expanded[special.key]
    if (val == null || val === '') continue
    if (typeof val === 'string') {
      const pretty = (() => {
        const t = val.trim()
        if (!(t.startsWith('{') || t.startsWith('['))) return null
        try {
          return prettyJson(JSON.parse(t))
        } catch {
          return null
        }
      })()
      fields.push({
        id: `st.meta.${special.key}`,
        label: special.label,
        value: cap(pretty ?? val, DISPLAY_CAP, warnings, special.label),
        group: 'generation',
        mono: true,
        syntax: pretty ? 'json' : undefined,
        copyable: true
      })
    } else {
      fields.push({
        id: `st.meta.${special.key}`,
        label: special.label,
        value: cap(prettyJson(val), DISPLAY_CAP, warnings, special.label),
        group: 'generation',
        mono: true,
        syntax: 'json',
        copyable: true
      })
    }
  }

  // Leftover metadata — scalars / small objects as rows; per-tensor maps summarized
  const leftover: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(expanded)) {
    if (ABSORB_KEYS.has(k)) continue
    leftover[k] = v
  }
  if (software && typeof software === 'object' && !Array.isArray(software)) {
    const sw = { ...(software as Record<string, unknown>) }
    delete sw.name
    delete sw.title
    delete sw.version
    delete sw.repo
    delete sw.url
    delete sw.homepage
    if (Object.keys(sw).length > 0) leftover.software = sw
  }

  const stillLeft = promoteShallowEntries(leftover, fields, seenLabels, 'st.more')
  // Cap leftover JSON — huge configs stay copyable but don't dominate the pane
  if (Object.keys(stillLeft).length > 0) {
    const json = prettyJson(stillLeft)
    fields.push({
      id: 'st.meta.more',
      label: 'More metadata',
      value: cap(json, Math.min(DISPLAY_CAP, 12 * 1024), warnings, 'More metadata'),
      group: 'generation',
      mono: true,
      syntax: 'json',
      copyable: true
    })
  }

  return { subtitle, fields }
}

export async function buildSafetensorsPreviewFields(
  filePath: string,
  warnings: string[]
): Promise<SafetensorsPreviewBuild | null> {
  const read = await readSafetensorsHeader(filePath)
  if (!read) {
    warnings.push('Could not parse SafeTensors header')
    return null
  }
  const summary = summarizeSafetensorsHeader(read.header)
  if (summary.tensorCount === 0 && Object.keys(summary.metadata).length === 0) {
    warnings.push('SafeTensors header has no tensors')
    return null
  }
  return safetensorsFieldsFromSummary(summary, warnings)
}
