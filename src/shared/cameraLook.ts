import { z } from 'zod'

/**
 * Slideshow camera looks. Ids are the settings contract.
 * Fragment source lives in the renderer (`cameraLookShaders.ts`).
 * Off unless `enabled` is explicitly true (first install stays off).
 */
export const CAMERA_LOOKS = [
  {
    id: 'dslr-natural',
    name: 'DSLR natural',
    hint: 'Gentle highlight rolloff, fine grain, light vignette'
  },
  {
    id: 'fine-grain',
    name: 'Fine grain',
    hint: 'Luma grain only, almost the original photo'
  },
  {
    id: 'high-iso',
    name: 'High ISO',
    hint: 'Luma and chroma noise, slightly dull color'
  },
  {
    id: 'amateur-wb',
    name: 'Amateur white balance',
    hint: 'Warm or cool miss, exposure a bit off'
  },
  {
    id: 'temperature',
    name: 'Temperature',
    hint: 'Each slide rolls from coldest to warmest. -1 cold, 0 normal, 1 warm'
  },
  {
    id: 'point-and-shoot',
    name: 'Point-and-shoot',
    hint: 'Soft, lifted blacks, mild color fringing'
  },
  {
    id: 'disposable',
    name: 'Disposable camera',
    hint: 'Flash falloff, heavy grain, soft corners'
  },
  {
    id: 'direct-flash',
    name: 'Direct flash',
    hint: 'Hot center, dark edges, harsh contrast'
  },
  {
    id: 'eighties-print',
    name: '1980s print',
    hint: 'Faded contrast, yellow whites, magenta shadows'
  },
  {
    id: 'slide-film',
    name: 'Slide film',
    hint: 'Teal shadows, warm highlights, punchier contrast'
  },
  {
    id: 'polaroid',
    name: 'Instant print',
    hint: 'Warm fade, strong vignette, soft'
  },
  {
    id: 'faded-snapshot',
    name: 'Faded snapshot',
    hint: 'Lifted blacks, yellow-cyan cast, low contrast'
  },
  {
    id: 'candid-phone',
    name: 'Early phone camera',
    hint: 'Slight sharpen, chroma noise, cool cast'
  },
  {
    id: 'lens-fringe',
    name: 'Lens fringing',
    hint: 'Chromatic aberration toward the edges'
  },
  {
    id: 'dusty-lens',
    name: 'Dusty lens',
    hint: 'Haze, soft dust near the edges, warm cast'
  },
  {
    id: 'handshake',
    name: 'Handshake blur',
    hint: 'Short directional smear, like a slow shutter'
  },
  {
    id: 'available-light',
    name: 'Available light',
    hint: 'Underexposed, noisy, green-magenta cast'
  }
] as const

export type CameraLookId = (typeof CAMERA_LOOKS)[number]['id']

const CAMERA_LOOK_ID_SET = new Set<string>(CAMERA_LOOKS.map((look) => look.id))

export const CAMERA_LOOK_CUSTOM_ID = 'custom'

const CUSTOM_ID_RE = /^c_[a-z0-9]{4,24}$/
const MAX_CAMERA_LOOK_CUSTOMS = 24
const LEGACY_CUSTOM_ID = 'c_legacy'

export function isCustomCameraLookId(id: string): boolean {
  return CUSTOM_ID_RE.test(id)
}

export function newCameraLookCustomId(taken: readonly string[] = []): string {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789'
  for (let n = 0; n < 20; n++) {
    let id = 'c_'
    for (let i = 0; i < 8; i++) id += alphabet[Math.floor(Math.random() * alphabet.length)]!
    if (!taken.includes(id)) return id
  }
  return `c_${Date.now().toString(36)}`
}

export function isCatalogCameraLookId(id: string): boolean {
  return CAMERA_LOOK_ID_SET.has(id)
}

export const defaultCameraLookEnabledIds: string[] = CAMERA_LOOKS.map((look) => look.id)

export function normalizeCameraLookEnabled(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [...defaultCameraLookEnabledIds]
  const out: string[] = []
  for (const id of raw) {
    if (typeof id !== 'string') continue
    const trimmed = id.trim()
    if (!trimmed || trimmed.length > 40) continue
    if (!isCustomCameraLookId(trimmed) && !CAMERA_LOOK_ID_SET.has(trimmed)) continue
    if (out.includes(trimmed)) continue
    out.push(trimmed)
    if (out.length >= 48) break
  }
  return out
}

export type CameraLookParam = {
  id: string
  label: string
  hint?: string
  min: number
  max: number
  step: number
  default: number
  integer?: boolean
  options?: { value: number; label: string }[]
}

/** Built-in looks use uniform slots uP0..uP5, in `CAMERA_LOOK_PARAMS` order. */
export const CAMERA_LOOK_PARAM_SLOTS = 6

/** Named uniforms a custom look can declare. Each one is a slider. */
export const CAMERA_LOOK_CUSTOM_CONTROL_MAX = 8

const p = (
  id: string,
  label: string,
  min: number,
  max: number,
  step: number,
  def: number,
  extra?: Pick<CameraLookParam, 'hint' | 'integer' | 'options'>
): CameraLookParam => ({ id, label, min, max, step, default: def, ...extra })

export const CAMERA_LOOK_PARAMS: Record<CameraLookId, readonly CameraLookParam[]> = {
  'dslr-natural': [
    p('rolloff', 'Highlight rolloff', 0, 0.5, 0.01, 0.18),
    p('vignette', 'Vignette', 0, 0.5, 0.01, 0.18),
    p('grain', 'Grain', 0, 0.08, 0.001, 0.026)
  ],
  'fine-grain': [
    p('amount', 'Grain', 0, 0.12, 0.001, 0.045),
    p('contrast', 'Contrast', 0.9, 1.2, 0.01, 1.04)
  ],
  'high-iso': [
    p('luma', 'Luma noise', 0, 0.2, 0.005, 0.09),
    p('chroma', 'Color noise', 0, 0.12, 0.005, 0.05),
    p('color', 'Color kept', 0.4, 1, 0.01, 0.82),
    p('exposure', 'Exposure', 0.7, 1.1, 0.01, 0.96)
  ],
  'amateur-wb': [
    p('cast', 'White-balance miss', 0, 1.5, 0.01, 1),
    p('swing', 'Exposure swing', 0, 0.4, 0.01, 0.16),
    p('grain', 'Grain', 0, 0.1, 0.001, 0.04)
  ],
  temperature: [
    p('coldest', 'Coldest', -1, 1, 0.01, -0.5, {
      hint: 'Lowest the roll can go. -1 is cold, 0 is normal, 1 is warm.'
    }),
    p('warmest', 'Warmest', -1, 1, 0.01, 0.5, {
      hint: 'Highest the roll can go. -1 is cold, 0 is normal, 1 is warm.'
    })
  ],
  'point-and-shoot': [
    p('sharp', 'Sharp amount', 0, 1, 0.01, 0.35, { hint: '0 is the soft frame, 1 is the original.' }),
    p('fringe', 'Color fringe', 0, 0.03, 0.001, 0.006),
    p('vignette', 'Corner darkness', 0.3, 1, 0.01, 0.62),
    p('grain', 'Grain', 0, 0.12, 0.001, 0.05),
    p('blur', 'Soft radius', 0, 4, 0.1, 1.6)
  ],
  disposable: [
    p('blur', 'Soft radius', 0, 5, 0.1, 2.2),
    p('flash', 'Flash reach', 0.2, 1.2, 0.01, 0.72),
    p('grain', 'Grain', 0, 0.2, 0.005, 0.11)
  ],
  'direct-flash': [
    p('reach', 'Flash reach', 0.3, 1.4, 0.01, 0.85),
    p('hot', 'Hot center', 0.8, 1.8, 0.01, 1.45),
    p('edge', 'Edge darkness', 0, 0.8, 0.01, 0.35),
    p('grain', 'Grain', 0, 0.12, 0.001, 0.06)
  ],
  'eighties-print': [
    p('contrast', 'Contrast', 0.5, 1.2, 0.01, 0.78),
    p('warmth', 'Warm fade', 0, 1.5, 0.01, 1),
    p('grain', 'Grain', 0, 0.12, 0.001, 0.065),
    p('vignette', 'Corner darkness', 0.4, 1, 0.01, 0.7)
  ],
  'slide-film': [
    p('contrast', 'Contrast', 0.8, 1.5, 0.01, 1.18),
    p('grade', 'Color grade', 0, 1.5, 0.01, 1),
    p('grain', 'Grain', 0, 0.08, 0.001, 0.035)
  ],
  polaroid: [
    p('sharp', 'Sharp amount', 0, 1, 0.01, 0.4),
    p('warmth', 'Warmth', 0, 1.5, 0.01, 1),
    p('vignette', 'Corner darkness', 0, 1, 0.01, 0.35),
    p('grain', 'Grain', 0, 0.1, 0.001, 0.05),
    p('blur', 'Soft radius', 0, 4, 0.1, 1.8)
  ],
  'faded-snapshot': [
    p('fade', 'Fade', 0, 1.5, 0.01, 1),
    p('grain', 'Grain', 0, 0.1, 0.001, 0.055)
  ],
  'candid-phone': [
    p('sharpen', 'Sharpen', 0, 1.2, 0.01, 0.55),
    p('noise', 'Noise', 0, 0.1, 0.001, 0.045),
    p('cool', 'Cool cast', 0, 1.5, 0.01, 1)
  ],
  'lens-fringe': [
    p('fringe', 'Fringe', 0, 0.04, 0.001, 0.012),
    p('vignette', 'Corner darkness', 0.4, 1, 0.01, 0.75),
    p('grain', 'Grain', 0, 0.06, 0.001, 0.02)
  ],
  'dusty-lens': [
    p('minCount', 'Min particles', 0, 32, 1, 1, { integer: true }),
    p('maxCount', 'Max particles', 0, 32, 1, 2, {
      integer: true,
      hint: 'Each slide rolls one count from min through max.'
    }),
    p('minSize', 'Min size', 8, 180, 1, 22, { integer: true, hint: 'Pixels across the soft spot.' }),
    p('maxSize', 'Max size', 8, 180, 1, 48, { integer: true }),
    p('strength', 'Visibility', 0, 1.4, 0.01, 0.55, {
      hint: 'How much each spot stands out from the photo. 0 hides them.'
    }),
    p('band', 'Edge band', 0.1, 0.45, 0.01, 0.25, {
      hint: 'Centers stay within this fraction of an edge. The spot can still fade inward.'
    })
  ],
  handshake: [
    p('length', 'Blur length', 0.4, 8, 0.1, 2.2, { hint: 'Pixels of smear. Lower is sharper.' }),
    p('sharp', 'Keep original', 0, 0.85, 0.01, 0.25),
    p('direction', 'Direction', 0, 2, 1, 0, {
      integer: true,
      options: [
        { value: 0, label: 'Random' },
        { value: 1, label: 'Horizontal' },
        { value: 2, label: 'Vertical' }
      ]
    })
  ],
  'available-light': [
    p('exposure', 'Exposure', 0.3, 1, 0.01, 0.65),
    p('noise', 'Noise', 0, 0.25, 0.005, 0.14),
    p('vignette', 'Corner darkness', 0, 1, 0.01, 0.4)
  ]
}

export type CameraLookCustomControl = {
  /** GLSL uniform name. The shader reads this identifier. */
  name: string
  min: number
  max: number
  /** Value restored by Reset. */
  default: number
}

const CONTROL_NAME_RE = /^[A-Za-z_][A-Za-z0-9_]{0,31}$/

/** Identifiers the wrapper or GLSL already owns. A slider cannot reuse them. */
const RESERVED_CONTROL_NAMES = new Set([
  'attribute', 'const', 'uniform', 'varying', 'break', 'continue', 'do', 'for', 'while', 'if', 'else',
  'in', 'out', 'inout', 'float', 'int', 'void', 'bool', 'true', 'false', 'lowp', 'mediump', 'highp',
  'precision', 'invariant', 'discard', 'return', 'mat2', 'mat3', 'mat4', 'vec2', 'vec3', 'vec4',
  'ivec2', 'ivec3', 'ivec4', 'bvec2', 'bvec3', 'bvec4', 'sampler2D', 'samplerCube', 'struct',
  'asm', 'class', 'union', 'enum', 'typedef', 'template', 'this', 'packed', 'goto', 'switch', 'default',
  'inline', 'noinline', 'volatile', 'public', 'static', 'extern', 'external', 'interface',
  'long', 'short', 'double', 'half', 'fixed', 'unsigned', 'superp', 'input', 'output',
  'sampler1D', 'sampler3D', 'sizeof', 'cast', 'namespace', 'using',
  'uTex', 'uTexel', 'uFit', 'uSeed', 'vUv', 'hash21', 'grain', 'tap', 'spin', 'luma', 'apply',
  'p', 'col', 'seed', 'texture2D', 'mix', 'clamp', 'min', 'max', 'step', 'smoothstep', 'sin', 'cos',
  'dot', 'fract', 'floor', 'ceil', 'abs', 'pow', 'sqrt', 'length', 'normalize', 'mod', 'sign'
])

const PRELUDE_UNIFORMS = new Set(['uP0', 'uP1', 'uP2', 'uP3', 'uP4', 'uP5'])

export function cameraLookControlNameError(name: string, taken: readonly string[] = []): string | null {
  const trimmed = name.trim()
  if (!trimmed) return 'Name the variable.'
  if (!CONTROL_NAME_RE.test(trimmed) || trimmed.startsWith('gl_')) {
    return 'Use a letter or underscore, then letters and numbers.'
  }
  if (RESERVED_CONTROL_NAMES.has(trimmed)) return 'That name is used by the shader itself.'
  if (taken.includes(trimmed)) return 'Another slider already has this name.'
  return null
}

export function isCameraLookControlName(name: string): boolean {
  return cameraLookControlNameError(name) === null
}

/** Uniforms to add on top of the built-in uP0–uP5 declarations. */
export function cameraLookExtraUniformNames(names: readonly string[]): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const name of names) {
    if (!isCameraLookControlName(name) || PRELUDE_UNIFORMS.has(name) || seen.has(name)) continue
    seen.add(name)
    out.push(name)
  }
  return out
}

export function defaultCameraLookCustomControl(): CameraLookCustomControl {
  return { name: 'amount', min: 0, max: 1, default: 1 }
}

export function nextCameraLookControlName(taken: readonly string[]): string {
  for (const name of ['amount', 'amount2', 'amount3', 'amount4', 'amount5', 'amount6', 'amount7', 'amount8']) {
    if (cameraLookControlNameError(name, taken) === null) return name
  }
  for (let i = 2; i < 40; i++) {
    const name = `v${i}`
    if (cameraLookControlNameError(name, taken) === null) return name
  }
  return 'value'
}

function snapControl(n: number): number {
  return Math.round(Math.max(-1_000_000, Math.min(1_000_000, n)) * 1000) / 1000
}

export function cameraLookControlParam(control: CameraLookCustomControl): CameraLookParam {
  const span = Math.abs(control.max - control.min)
  const step = span >= 40 ? 1 : span >= 8 ? 0.1 : 0.01
  const whole =
    step === 1 &&
    Number.isInteger(control.min) &&
    Number.isInteger(control.max) &&
    Number.isInteger(control.default)
  return {
    id: control.name,
    label: control.name,
    min: control.min,
    max: control.max,
    step: whole ? 1 : step === 1 ? 0.1 : step,
    default: control.default,
    ...(whole ? { integer: true } : {})
  }
}

/** Keeps a usable list. An explicit array may be empty; missing input is not handled here. */
export function sanitizeCameraLookControls(raw: unknown): CameraLookCustomControl[] {
  if (!Array.isArray(raw)) return []
  const out: CameraLookCustomControl[] = []
  const taken: string[] = []
  for (const item of raw) {
    if (out.length >= CAMERA_LOOK_CUSTOM_CONTROL_MAX) break
    if (!item || typeof item !== 'object') continue
    const rec = item as Record<string, unknown>
    const name = typeof rec.name === 'string' ? rec.name.trim() : ''
    if (cameraLookControlNameError(name, taken) !== null) continue
    let min = typeof rec.min === 'number' && Number.isFinite(rec.min) ? snapControl(rec.min) : 0
    let max = typeof rec.max === 'number' && Number.isFinite(rec.max) ? snapControl(rec.max) : 1
    if (min > max) {
      const swap = min
      min = max
      max = swap
    }
    const fallback = min <= 1 && max >= 1 ? 1 : min
    let def = typeof rec.default === 'number' && Number.isFinite(rec.default) ? snapControl(rec.default) : fallback
    def = Math.min(max, Math.max(min, def))
    taken.push(name)
    out.push({ name, min, max, default: def })
  }
  return out
}

function controlsFromFragment(fragment: string): CameraLookCustomControl[] {
  const found: CameraLookCustomControl[] = []
  const seen = new Set<string>()
  const re = /\buP([0-7])\b/g
  let match: RegExpExecArray | null
  while ((match = re.exec(fragment))) {
    const name = `uP${match[1]}`
    if (seen.has(name)) continue
    seen.add(name)
    found.push({ name, min: 0, max: 2, default: 0 })
  }
  found.sort((a, b) => a.name.localeCompare(b.name))
  if (found.length > 0) return found.slice(0, CAMERA_LOOK_CUSTOM_CONTROL_MAX)
  return [defaultCameraLookCustomControl()]
}

function readCustomControls(rec: Record<string, unknown>, fragment: string): CameraLookCustomControl[] {
  if (!Array.isArray(rec.controls)) return controlsFromFragment(fragment)
  return sanitizeCameraLookControls(rec.controls)
}

export function cameraLookParamsFor(
  id: string,
  customs?: readonly { id: string; controls?: readonly CameraLookCustomControl[] }[]
): readonly CameraLookParam[] {
  if (isCustomCameraLookId(id)) {
    const custom = customs?.find((item) => item.id === id)
    return (custom?.controls ?? []).map((control) => cameraLookControlParam(control))
  }
  if (!isCatalogCameraLookId(id)) return []
  return CAMERA_LOOK_PARAMS[id as CameraLookId]
}

export function clampCameraLookParam(def: CameraLookParam, value: number): number {
  const n = Math.min(def.max, Math.max(def.min, value))
  if (def.options && def.options.length > 0) {
    let best = def.options[0]!.value
    let bestDist = Math.abs(n - best)
    for (const opt of def.options) {
      const dist = Math.abs(n - opt.value)
      if (dist < bestDist) {
        best = opt.value
        bestDist = dist
      }
    }
    return best
  }
  if (def.integer) return Math.round(n)
  return Math.round(n * 1000) / 1000
}

export type CameraLookParamMap = Record<string, Record<string, number>>

function customParamValue(row: Record<string, unknown>, name: string): unknown {
  if (name in row) return row[name]
  const slot = /^uP([0-7])$/.exec(name)
  if (!slot) return undefined
  return row[`p${slot[1]}`]
}

export function normalizeCameraLookParams(
  raw: unknown,
  customs: readonly { id: string; controls?: readonly CameraLookCustomControl[] }[] = []
): CameraLookParamMap {
  if (!raw || typeof raw !== 'object') return {}
  const out: CameraLookParamMap = {}
  for (const [lookId, row] of Object.entries(raw as Record<string, unknown>)) {
    const defs = cameraLookParamsFor(lookId, customs)
    if (defs.length === 0 || !row || typeof row !== 'object') continue
    const record = row as Record<string, unknown>
    const custom = isCustomCameraLookId(lookId)
    const next: Record<string, number> = {}
    for (const def of defs) {
      const value = custom ? customParamValue(record, def.id) : record[def.id]
      if (typeof value !== 'number' || !Number.isFinite(value)) continue
      const snapped = clampCameraLookParam(def, value)
      if (Math.abs(snapped - def.default) > 1e-6) next[def.id] = snapped
    }
    if (Object.keys(next).length > 0) out[lookId] = next
  }
  return out
}

export function cameraLookParamNumber(
  lookId: string,
  stored: CameraLookParamMap | undefined,
  paramId: string,
  customs?: readonly { id: string; controls?: readonly CameraLookCustomControl[] }[]
): number {
  const def = cameraLookParamsFor(lookId, customs).find((item) => item.id === paramId)
  if (!def) return 0
  const raw = stored?.[lookId]?.[paramId]
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return def.default
  return clampCameraLookParam(def, raw)
}

/**
 * Uniform values for this look, in control order.
 * Built-ins are six slots (uP0–uP5). Customs are one value per slider.
 */
export function cameraLookParamValues(
  lookId: string,
  stored: CameraLookParamMap | undefined,
  customs?: readonly { id: string; controls?: readonly CameraLookCustomControl[] }[]
): number[] {
  if (isCustomCameraLookId(lookId)) {
    return cameraLookParamsFor(lookId, customs).map((def) =>
      cameraLookParamNumber(lookId, stored, def.id, customs)
    )
  }
  const out = [0, 0, 0, 0, 0, 0]
  cameraLookParamsFor(lookId).forEach((def, index) => {
    if (index < CAMERA_LOOK_PARAM_SLOTS) out[index] = cameraLookParamNumber(lookId, stored, def.id)
  })
  return out
}

export type CameraLookCustom = {
  id: string
  name: string
  fragment: string
  controls: CameraLookCustomControl[]
}

function sanitizeCustoms(raw: unknown): CameraLookCustom[] {
  if (!Array.isArray(raw)) return []
  const out: CameraLookCustom[] = []
  const seen = new Set<string>()
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const rec = item as Record<string, unknown>
    const id = typeof rec.id === 'string' ? rec.id.trim() : ''
    if (!isCustomCameraLookId(id) || seen.has(id)) continue
    seen.add(id)
    const nameRaw = typeof rec.name === 'string' ? rec.name.trim().slice(0, 48) : ''
    const fragment = typeof rec.fragment === 'string' ? rec.fragment.slice(0, 8000) : ''
    out.push({
      id,
      name: nameRaw || 'Custom',
      fragment,
      controls: readCustomControls(rec, fragment)
    })
    if (out.length >= MAX_CAMERA_LOOK_CUSTOMS) break
  }
  return out
}

/** Turns the old single `custom` slot into the customs list and drops unknown ids. */
export function migrateCameraLookSettings(raw: unknown): Record<string, unknown> {
  const o =
    raw && typeof raw === 'object' && !Array.isArray(raw)
      ? { ...(raw as Record<string, unknown>) }
      : {}
  let customs = sanitizeCustoms(o.customs)
  const legacyFrag = typeof o.customFragment === 'string' ? o.customFragment.slice(0, 8000) : ''
  if (customs.length === 0 && legacyFrag.trim()) {
    customs = [
      {
        id: LEGACY_CUSTOM_ID,
        name: 'Custom',
        fragment: legacyFrag,
        controls: controlsFromFragment(legacyFrag)
      }
    ]
  }
  const known = new Set(customs.map((item) => item.id))
  let enabled: string[]
  if (!Array.isArray(o.enabledIds)) {
    enabled = [...defaultCameraLookEnabledIds]
  } else {
    enabled = []
    for (const id of o.enabledIds) {
      if (typeof id !== 'string') continue
      const trimmed = id.trim()
      const next = trimmed === CAMERA_LOOK_CUSTOM_ID && known.has(LEGACY_CUSTOM_ID) ? LEGACY_CUSTOM_ID : trimmed
      if (!isCatalogCameraLookId(next) && !known.has(next)) continue
      if (enabled.includes(next)) continue
      enabled.push(next)
      if (enabled.length >= 48) break
    }
  }
  o.customs = customs
  o.enabledIds = enabled
  o.customFragment = ''
  o.params = normalizeCameraLookParams(o.params, customs)
  o.enabled = o.enabled === true
  o.pathFilter = typeof o.pathFilter === 'string' ? o.pathFilter.trim().slice(0, 400) : ''
  return o
}

export const cameraLookSettingsSchema = z.preprocess(
  migrateCameraLookSettings,
  z.object({
  /** Master switch. Off skips every look and leaves the effect list alone. */
  enabled: z.boolean(),
  /** 0 = never, 100 = every image. Each image rolls independently. */
  frequencyPct: z.preprocess((value) => {
    const n = typeof value === 'number' ? value : Number(value)
    if (!Number.isFinite(n)) return 0
    return Math.max(0, Math.min(100, Math.round(n)))
  }, z.number().int().min(0).max(100)),
  enabledIds: z.preprocess(normalizeCameraLookEnabled, z.array(z.string())),
  /** Optional `vec3 apply(vec2 p, vec3 col, float seed)` body kept for older saves. */
  customFragment: z.preprocess((value) => {
    if (typeof value !== 'string') return ''
    return value.slice(0, 8000)
  }, z.string()),
  /** Named custom shaders. Empty fragment stays out of the slideshow roll. */
  customs: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      fragment: z.string(),
      controls: z.array(
        z.object({
          name: z.string(),
          min: z.number(),
          max: z.number(),
          default: z.number()
        })
      )
    })
  ),
  /** Per-look overrides. Missing keys use that slider's default. */
  params: z.record(z.string(), z.record(z.string(), z.number())),
  /**
   * Slideshow path must contain this text. Empty applies to every photo.
   * `AI` matches those letters anywhere. `\AI\` matches a folder named AI.
   */
  pathFilter: z.string()
  })
)

export type CameraLookSettings = z.infer<typeof cameraLookSettingsSchema>

export const defaultCameraLookSettings: CameraLookSettings = {
  enabled: false,
  frequencyPct: 0,
  enabledIds: [...defaultCameraLookEnabledIds],
  customFragment: '',
  customs: [],
  params: {},
  pathFilter: ''
}

/**
 * Whether a slideshow file should receive a camera look.
 * Empty filter matches every path. Matching is case-insensitive, and `/` counts as `\`,
 * so `\AI\` and `/AI/` both require a folder named AI somewhere on the path.
 */
export function cameraLookPathMatches(filter: string, filePath: string): boolean {
  const needle = filter.trim()
  if (!needle) return true
  const norm = (value: string): string => value.replace(/\//g, '\\').toLowerCase()
  return norm(filePath).includes(norm(needle))
}

export function cameraLookCustomFragment(settings: CameraLookSettings, id: string): string {
  return (settings.customs ?? []).find((item) => item.id === id)?.fragment ?? ''
}

/** Uniform names for a custom look, in slider order. Catalog looks return []. */
export function cameraLookUniformNames(settings: CameraLookSettings, id: string): string[] {
  if (!isCustomCameraLookId(id)) return []
  return (settings.customs ?? []).find((item) => item.id === id)?.controls.map((control) => control.name) ?? []
}

/** Replaces one custom's sliders and reclamps stored values. `retarget` keeps a value across a rename. */
export function replaceCameraLookControls(
  settings: CameraLookSettings,
  id: string,
  controls: readonly CameraLookCustomControl[],
  retarget?: { from: string; to: string }
): CameraLookSettings {
  const normalized = sanitizeCameraLookControls(controls)
  const customs = (settings.customs ?? []).map((item) =>
    item.id === id ? { ...item, controls: normalized } : item
  )
  const current = { ...(settings.params?.[id] ?? {}) }
  if (retarget && retarget.from !== retarget.to) {
    const carried = current[retarget.from]
    if (typeof carried === 'number' && current[retarget.to] == null) current[retarget.to] = carried
    delete current[retarget.from]
  }
  const params = normalizeCameraLookParams({ ...settings.params, [id]: current }, customs)
  return { ...settings, customs, params }
}

/** Enabled ids that can actually run. A custom with no `apply` stays out of the pool. */
export function cameraLookRollPool(settings: CameraLookSettings): string[] {
  return settings.enabledIds.filter((id) => {
    if (isCatalogCameraLookId(id)) return true
    if (!isCustomCameraLookId(id)) return false
    return cameraLookCustomFragment(settings, id).includes('vec3 apply')
  })
}

function mix32(n: number): number {
  let h = (Math.trunc(n) + 0x9e3779b9) >>> 0
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d)
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b)
  return (h ^ (h >>> 16)) >>> 0
}

/**
 * 0..1 stream fixed by a slideshow list index. The same index always yields the same
 * sequence, so stepping back to that slide repeats the look for the session.
 */
export function cameraLookIndexRng(index: number): () => number {
  let a = mix32(index) || 1
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Grain / cast seed for the shader. Stable for a list index, separate from the look pick. */
export function cameraLookSeedForIndex(index: number): number {
  return (mix32(index + 0x10000) % 10000) + 1
}

/** Same `hash21` the shaders use. `salt` must match the GLSL constant. */
function hash21f(seed: number, salt: number): number {
  const f = Math.fround
  const fract = (n: number): number => {
    const v = f(n)
    return f(v - f(Math.floor(v)))
  }
  const x = f(seed)
  const y = f(salt)
  let px = fract(f(x * f(0.1031)))
  let py = fract(f(y * f(0.1031)))
  let pz = fract(f(x * f(0.1031)))
  const dot = f(
    f(f(px * f(py + f(33.33))) + f(py * f(pz + f(33.33)))) + f(pz * f(px + f(33.33)))
  )
  px = f(px + dot)
  py = f(py + dot)
  pz = f(pz + dot)
  return fract(f(f(px + py) * pz))
}

/** Same hash the dusty-lens shader uses for its particle count (`hash21`, salt 18). */
function dustCountHash(seed: number): number {
  return hash21f(seed, 18)
}

/** Inclusive particle count for one slide. The same seed always rolls the same count. */
export function cameraLookDustCount(seed: number, minCount: number, maxCount: number): number {
  const lo = Math.min(minCount, maxCount)
  const hi = Math.max(minCount, maxCount)
  const span = Math.floor(hi - lo + 0.001)
  const n = lo + Math.floor(dustCountHash(seed) * (span + 0.999))
  return Math.min(hi, Math.max(lo, n))
}

/** Temperature for one slide. -1 cold, 0 normal, 1 warm. Same seed, same roll. */
export function cameraLookTemperature(seed: number, coldest: number, warmest: number): number {
  const f = Math.fround
  const lo = f(Math.min(coldest, warmest))
  const hi = f(Math.max(coldest, warmest))
  const h = hash21f(seed, 21)
  return f(f(lo * f(1 - h)) + f(hi * h))
}

/**
 * Pick one enabled look, or null when this image stays untouched.
 * `frequencyPct` is the chance any look runs; the look itself is uniform.
 * Pass `cameraLookIndexRng(listIndex)` during slideshow so the choice is repeatable.
 */
export function rollCameraLook(
  enabledIds: readonly string[],
  frequencyPct: number,
  rng: () => number = Math.random
): string | null {
  const ids = normalizeCameraLookEnabled(enabledIds)
  if (ids.length === 0) return null
  const pct = Math.max(0, Math.min(100, Math.round(frequencyPct)))
  if (pct <= 0) return null
  if (pct < 100 && rng() * 100 >= pct) return null
  const i = Math.min(ids.length - 1, Math.floor(rng() * ids.length))
  return ids[i] ?? null
}
