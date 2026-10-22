import type { A1111Parameters } from './a1111'

const LINK_TEXT = /^\[\s*['"]?(\d+)['"]?\s*,\s*(\d+)\s*\]$/

const PREFERRED_INPUTS = [
  'value',
  'Value',
  'number',
  'Number',
  'int',
  'float',
  'text',
  'sampler_name',
  'scheduler',
  'denoise',
  'denoise_strength',
  'steps',
  'cfg',
  'seed'
]

/** A1111 setting label → KSampler input names, when the comment stored a link. */
const SETTING_INPUTS: Record<string, readonly string[]> = {
  Steps: ['steps'],
  Sampler: ['sampler_name'],
  'Schedule type': ['scheduler'],
  'CFG scale': ['cfg'],
  'Denoising strength': ['denoise', 'denoise_strength'],
  Seed: ['seed', 'noise_seed']
}

const WIDGET_MODE = new Set(['fixed', 'increment', 'decrement', 'randomize'])

type PromptNode = { inputs?: Record<string, unknown> }
type WorkflowNode = { id?: unknown; widgets_values?: unknown }

/**
 * `['153', 0]` is how a ComfyUI saver prints a widget wired to another node
 * (node id, output slot) instead of the value that node holds.
 */
export function parseComfyLinkText(value: string): [string, number] | null {
  const match = LINK_TEXT.exec(value.trim())
  if (!match?.[1] || match[2] == null) return null
  return [match[1], Number(match[2])]
}

/**
 * Replace setting values that are Comfy node links with the source node's
 * value, using a prompt map and/or workflow JSON found beside the parameters text.
 * Unresolved links stay as written.
 */
export function resolveComfySettingLinks(
  parsed: A1111Parameters,
  candidates: readonly string[]
): A1111Parameters {
  const graphs = candidates.flatMap(comfyGraphsInText)
  if (graphs.length === 0) return parsed
  let changed = false
  const settings: Record<string, string> = { ...parsed.settings }
  for (const [key, value] of Object.entries(settings)) {
    const link = parseComfyLinkText(value)
    if (!link && !SETTING_INPUTS[key]) continue
    let resolved: string | null = null
    if (link) {
      for (const graph of graphs) {
        resolved = resolveComfyOutput(graph, link[0], link[1], 0)
        if (resolved) break
      }
    }
    if (!resolved) resolved = resolveSamplerSetting(graphs, key)
    if (!resolved) continue
    settings[key] = resolved
    changed = true
  }
  return changed ? { ...parsed, settings } : parsed
}

const GRAPH_NEEDLES = ['"class_type"', "'class_type'", '"widgets_values"', "'widgets_values'", '"classType"', '"widgetsValues"']

/**
 * The prompt map often starts with a long CLIP `text` input, so `class_type`
 * is far from the opening `{`. Take the outermost object that contains the hint,
 * including when it is wrapped in XMP, buried in another marker, or written as a Python dict.
 */
function comfyGraphsInText(text: string): unknown[] {
  const graphs: unknown[] = []
  const trimmed = text.trim().replace(/^\uFEFF/, '')
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) pushGraphs(graphs, trimmed)
  if (!text.includes('{')) return graphs
  for (const slice of objectsContainingHintKeys(text)) pushGraphs(graphs, slice)
  return graphs
}

function pushGraphs(graphs: unknown[], jsonText: string): void {
  const parsed = parseJsonish(jsonText)
  if (parsed !== undefined) collectGraphs(parsed, graphs, 0)
}

function parseJsonish(text: string): unknown {
  try {
    return JSON.parse(text) as unknown
  } catch {
    /* Python repr uses single quotes, True/False/None */
  }
  try {
    return JSON.parse(pythonLiteralToJson(text)) as unknown
  } catch {
    return undefined
  }
}

function pythonLiteralToJson(src: string): string {
  let out = ''
  let i = 0
  while (i < src.length) {
    const ch = src[i]!
    if (ch === '"' || ch === "'") {
      const quoted = readQuoted(src, i)
      if (!quoted) {
        out += ch
        i++
        continue
      }
      out += JSON.stringify(quoted.value)
      i = quoted.end
      continue
    }
    if (src.startsWith('None', i) && !isIdentChar(src[i + 4])) {
      out += 'null'
      i += 4
      continue
    }
    if (src.startsWith('True', i) && !isIdentChar(src[i + 4])) {
      out += 'true'
      i += 4
      continue
    }
    if (src.startsWith('False', i) && !isIdentChar(src[i + 5])) {
      out += 'false'
      i += 5
      continue
    }
    out += ch
    i++
  }
  return out
}

function isIdentChar(ch: string | undefined): boolean {
  return ch != null && /[A-Za-z0-9_]/.test(ch)
}

/** Outermost `{...}` objects whose keys include a Comfy graph hint. */
function objectsContainingHintKeys(text: string): string[] {
  const slices: string[] = []
  const seen = new Set<number>()
  for (const needle of GRAPH_NEEDLES) {
    let from = 0
    while (from < text.length) {
      const at = text.indexOf(needle, from)
      if (at < 0) break
      from = at + needle.length
      const slice = enclosingGraphSlice(text, at)
      if (!slice || seen.has(slice.start)) continue
      seen.add(slice.start)
      slices.push(slice.text)
    }
  }
  return slices
}

/**
 * Walk backward from a hint to the outermost `{` that parses as a Comfy graph.
 * Inner objects (a single node, an inputs map) are skipped. A `{` earlier in
 * the prompt text does not hide the graph.
 */
function enclosingGraphSlice(text: string, hintAt: number): { start: number; text: string } | null {
  let best: { start: number; text: string } | null = null
  let pos = hintAt
  let looked = 0
  let successes = 0
  const min = Math.max(0, hintAt - 3_000_000)
  while (looked < 400 && pos > min) {
    const objectStart = Math.max(text.lastIndexOf('{"', pos), text.lastIndexOf("{'", pos))
    if (objectStart < min) break
    looked++
    const end = matchJsonObjectEnd(text, objectStart)
    if (end > hintAt) {
      const slice = text.slice(objectStart, end)
      if (isComfyGraph(parseJsonish(slice))) {
        best = { start: objectStart, text: slice }
        successes++
        if (successes >= 6) break
      }
    }
    pos = objectStart - 1
  }
  return best
}

function matchJsonObjectEnd(text: string, start: number): number {
  if (text[start] !== '{') return -1
  const limit = Math.min(text.length, start + 6_000_000)
  let depth = 0
  let quote: string | null = null
  for (let i = start; i < limit; i++) {
    const ch = text[i]!
    if (quote) {
      if (ch === '\\') {
        i++
        continue
      }
      if (ch === quote) quote = null
      continue
    }
    if (ch === '"' || ch === "'") {
      quote = ch
      continue
    }
    if (ch === '{') depth++
    else if (ch === '}') {
      depth--
      if (depth === 0) return i + 1
    }
  }
  return -1
}

function readQuoted(text: string, start: number): { value: string; end: number } | null {
  const quote = text[start]
  if (quote !== '"' && quote !== "'") return null
  let value = ''
  let i = start + 1
  while (i < text.length) {
    const ch = text[i]!
    if (ch === '\\') {
      const next = text[i + 1]
      if (next == null) return null
      value += next
      i += 2
      continue
    }
    if (ch === quote) return { value, end: i + 1 }
    value += ch
    i++
  }
  return null
}

function collectGraphs(value: unknown, graphs: unknown[], depth: number): void {
  if (depth > 5) return
  const parsed = parseJsonString(value)
  if (isComfyGraph(parsed)) graphs.push(parsed)
  if (Array.isArray(parsed)) {
    for (const item of parsed) collectGraphs(item, graphs, depth + 1)
    return
  }
  const record = asRecord(parsed)
  if (!record) return
  for (const child of Object.values(record)) {
    if (child && typeof child === 'object') collectGraphs(child, graphs, depth + 1)
    else if (typeof child === 'string' && child.trim().startsWith('{')) {
      collectGraphs(child, graphs, depth + 1)
    }
  }
}

function parseJsonString(value: unknown): unknown {
  if (typeof value !== 'string') return value
  const trimmed = value.trim()
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return value
  try {
    return JSON.parse(trimmed) as unknown
  } catch {
    return value
  }
}

function isComfyGraph(value: unknown): boolean {
  const record = asRecord(value)
  if (!record) return false
  if (Array.isArray(record.nodes)) return true
  return Object.values(record).some((item) => {
    const node = asRecord(item)
    return node != null && typeof node.class_type === 'string'
  })
}

function resolveComfyOutput(
  graph: unknown,
  nodeId: string,
  slot: number,
  depth: number
): string | null {
  if (depth > 8) return null
  const record = asRecord(graph)
  if (!record) return null
  if (Array.isArray(record.nodes)) {
    return resolveWorkflowNode(record.nodes, nodeId, slot)
  }
  const node = asRecord(record[nodeId])
  if (!node) return null
  return resolvePromptNode(record, node, slot, depth)
}

function resolveWorkflowNode(nodes: unknown[], nodeId: string, slot: number): string | null {
  for (const item of nodes) {
    const node = asRecord(item) as WorkflowNode | null
    if (!node || String(node.id) !== nodeId) continue
    return widgetValue(node.widgets_values, slot)
  }
  return null
}

function widgetValue(widgets: unknown, slot: number): string | null {
  if (Array.isArray(widgets)) {
    const atSlot = widgets[slot]
    if (isUsefulPrimitive(atSlot)) return String(atSlot)
    const useful = widgets.filter(isUsefulPrimitive)
    if (useful.length === 1) return String(useful[0])
    if (isPrimitive(atSlot)) return String(atSlot)
    return null
  }
  const record = asRecord(widgets)
  if (!record) return null
  for (const name of PREFERRED_INPUTS) {
    if (isUsefulPrimitive(record[name])) return String(record[name])
  }
  const useful = Object.values(record).filter(isUsefulPrimitive)
  if (useful.length === 1) return String(useful[0])
  return null
}

function resolveSamplerSetting(graphs: unknown[], settingKey: string): string | null {
  const names = SETTING_INPUTS[settingKey]
  if (!names) return null
  for (const graph of graphs) {
    const record = asRecord(graph)
    if (!record) continue
    if (Array.isArray(record.nodes)) {
      for (const item of record.nodes) {
        const node = asRecord(item)
        if (!node || !/ksampler/i.test(String(node.type ?? ''))) continue
        const widgets = node.widgets_values
        const named = asRecord(widgets)
        if (named) {
          for (const name of names) {
            if (isPrimitive(named[name])) return String(named[name])
          }
        }
      }
      continue
    }
    for (const item of Object.values(record)) {
      const node = asRecord(item)
      if (!node || typeof node.class_type !== 'string' || !/ksampler/i.test(node.class_type)) continue
      const inputs = asRecord(node.inputs)
      if (!inputs) continue
      for (const name of names) {
        if (!(name in inputs)) continue
        const value = inputs[name]
        if (isPrimitive(value)) return String(value)
        const parts = linkParts(value)
        if (!parts) continue
        const followed = resolveComfyOutput(graph, parts[0], parts[1], 0)
        if (followed) return followed
      }
    }
  }
  return null
}

function resolvePromptNode(
  prompt: Record<string, unknown>,
  node: PromptNode,
  slot: number,
  depth: number
): string | null {
  const inputs = asRecord(node.inputs)
  if (!inputs) return null
  const entries = Object.entries(inputs)
  const literals = entries.filter((entry): entry is [string, string | number | boolean] =>
    isPrimitive(entry[1])
  )
  const links = entries.flatMap((entry) => {
    const parts = linkParts(entry[1])
    return parts ? [{ key: entry[0], parts }] : []
  })
  if (literals.length === 1 && links.length === 0) return String(literals[0][1])
  if (literals.length > 0) {
    for (const name of PREFERRED_INPUTS) {
      const hit = literals.find(([key]) => key === name)
      if (hit) return String(hit[1])
    }
    const picked = literals[Math.min(slot, literals.length - 1)]
    return picked ? String(picked[1]) : null
  }
  const follow = links.length === 1 ? links[0] : links[slot]
  if (!follow) return null
  return resolveComfyOutput(prompt, follow.parts[0], follow.parts[1], depth + 1)
}

function linkParts(value: unknown): [string, number] | null {
  if (!Array.isArray(value) || value.length < 2) return null
  const id = value[0]
  const slot = value[1]
  if ((typeof id !== 'string' && typeof id !== 'number') || typeof slot !== 'number') return null
  if (!Number.isInteger(slot) || slot < 0) return null
  return [String(id), slot]
}

function isPrimitive(value: unknown): value is string | number | boolean {
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
}

function isUsefulPrimitive(value: unknown): value is string | number | boolean {
  return isPrimitive(value) && !WIDGET_MODE.has(String(value))
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, unknown>
}
