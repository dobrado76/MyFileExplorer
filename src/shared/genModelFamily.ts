/**
 * Classify A1111/Forge "Model" (checkpoint) names into base-model families
 * for filtering AI image libraries (Krea / SDXL-Pony-Illustrious vs SD1.5, …).
 */

export const GEN_MODEL_FAMILIES = ['krea', 'sdxl', 'sd15', 'flux', 'sd3', 'other'] as const
export type GenModelFamily = (typeof GEN_MODEL_FAMILIES)[number]

export const GEN_MODEL_FAMILY_LABELS: Record<GenModelFamily, string> = {
  krea: 'Krea',
  sdxl: 'SDXL family (Pony / Illustrious / SDXL)',
  sd15: 'SD 1.5',
  flux: 'Flux',
  sd3: 'SD 3',
  other: 'Other / unknown checkpoint'
}

/** Default allowlist: Krea + SDXL family (excludes SD 1.5 / Flux / SD3). */
export const DEFAULT_GEN_FAMILY_FILTER: GenModelFamily[] = ['krea', 'sdxl']

/**
 * Infer family from a checkpoint / Model string (and optional Size like 512x768).
 * Order matters: more specific tokens before generic XL / SD matches.
 */
export function classifyGenModelFamily(
  model: string | null | undefined,
  opts?: { size?: string | null }
): GenModelFamily | null {
  if (!model || !model.trim()) return null
  const m = model.toLowerCase().replace(/\.safetensors$/i, '').replace(/\.ckpt$/i, '')

  if (m.includes('krea')) return 'krea'

  if (m.includes('flux')) return 'flux'

  if (/sd[\s._-]?3\b/.test(m) || /stable[\s._-]?diffusion[\s._-]?3/.test(m)) {
    return 'sd3'
  }

  // SDXL family: explicit SDXL, Pony, Illustrious, NoobAI, common *XL* checkpoints
  if (
    m.includes('sdxl') ||
    m.includes('pony') ||
    m.includes('illustrious') ||
    m.includes('noobai') ||
    m.includes('animagine') ||
    /juggernaut[\s._-]?xl/.test(m) ||
    /realvis[\s._-]?xl/.test(m) ||
    /dreamshaper[\s._-]?xl/.test(m) ||
    /epicrealism[\s._-]?xl/.test(m) ||
    /[\s._-]xl([\s._-]|$|v\d)/.test(m) ||
    /xl[\s._-]?(base|refiner)/.test(m) ||
    /v\d+xl\b/.test(m) ||
    /xl$/.test(m)
  ) {
    return 'sdxl'
  }

  // Classic SD 1.5 naming
  if (
    /sd[\s._-]?1\.?5\b/.test(m) ||
    /v1[\s._-]?5\b/.test(m) ||
    m.includes('sd15') ||
    /stable[\s._-]?diffusion[\s._-]?v?1/.test(m) ||
    (/dreamshaper/.test(m) && !/dreamshaper[\s._-]?xl/.test(m)) ||
    (/realistic[\s._-]?vision/.test(m) && !/xl/.test(m)) ||
    m.includes('deliberate') ||
    /anything[\s._-]?v3/.test(m) ||
    m.includes('counterfeit') ||
    m.includes('chilloutmix')
  ) {
    return 'sd15'
  }

  // Size hint when the name is ambiguous (512-class → 1.5, 1024-class → SDXL)
  const size = opts?.size?.toLowerCase() ?? ''
  const dim = /^(\d+)\s*[x×]\s*(\d+)/i.exec(size)
  if (dim) {
    const w = Number(dim[1])
    const h = Number(dim[2])
    const max = Math.max(w, h)
    if (max >= 960) return 'sdxl'
    if (max > 0 && max <= 768) return 'sd15'
  }

  return 'other'
}

/** True when a file with this model should stay visible under the allowlist. */
export function genModelFamilyAllowed(
  model: string | null | undefined,
  allowed: readonly GenModelFamily[],
  opts?: { size?: string | null }
): boolean {
  if (allowed.length === 0) return true
  const family = classifyGenModelFamily(model, opts)
  // No Model metadata → keep (photos, non-A1111 images)
  if (family === null) return true
  return allowed.includes(family)
}
