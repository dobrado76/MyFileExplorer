/** How Name columns compare. `explorer` is Windows `StrCmpLogicalW`. */
export type NameSortMode = 'explorer' | 'literal'

export function nameSortModeOf(value: string | undefined): NameSortMode {
  return value === 'literal' ? 'literal' : 'explorer'
}

/**
 * Filename order matching Windows Explorer (`StrCmpLogicalW` / shlwapi).
 *
 * Digit runs compare as numbers (so `file2` before `file10`). When two runs
 * have the same value, more leading zeros sorts first (`002` before `02`
 * before `2`). Letter case is ignored for A–Z.
 */
export function compareFileNames(a: string, b: string): number {
  let i = 0
  let j = 0
  const na = a.length
  const nb = b.length

  while (i < na && j < nb) {
    const ca = a.charCodeAt(i)!
    const cb = b.charCodeAt(j)!
    const digA = ca >= 48 && ca <= 57
    const digB = cb >= 48 && cb <= 57

    if (digA && digB) {
      let za = 0
      let zb = 0
      while (i + za < na && a.charCodeAt(i + za) === 48) za++
      while (j + zb < nb && b.charCodeAt(j + zb) === 48) zb++

      let sa = 0
      let sb = 0
      while (i + za + sa < na) {
        const c = a.charCodeAt(i + za + sa)!
        if (c < 48 || c > 57) break
        sa++
      }
      while (j + zb + sb < nb) {
        const c = b.charCodeAt(j + zb + sb)!
        if (c < 48 || c > 57) break
        sb++
      }

      if (sa !== sb) return sa < sb ? -1 : 1
      for (let k = 0; k < sa; k++) {
        const d = a.charCodeAt(i + za + k)! - b.charCodeAt(j + zb + k)!
        if (d !== 0) return d < 0 ? -1 : 1
      }
      // Same value: longer zero-pad sorts first (Explorer).
      if (za !== zb) return za > zb ? -1 : 1
      i += za + sa
      j += zb + sb
      continue
    }

    const fa = ca >= 65 && ca <= 90 ? ca + 32 : ca
    const fb = cb >= 65 && cb <= 90 ? cb + 32 : cb
    if (fa !== fb) {
      if (fa > 127 || fb > 127) {
        const cmp = a[i]!.localeCompare(b[j]!, undefined, { sensitivity: 'accent' })
        if (cmp !== 0) return cmp < 0 ? -1 : 1
      } else {
        return fa < fb ? -1 : 1
      }
    }
    i++
    j++
  }

  if (i === na && j === nb) return 0
  return i === na ? -1 : 1
}

/**
 * Character-by-character order. Digits are characters (`0` before `s`, so
 * `v60` before `v6se`, and `file10` before `file2`). A–Z case is ignored.
 * A shorter string that is a prefix of the other sorts first.
 */
export function compareFileNamesLiteral(a: string, b: string): number {
  const na = a.length
  const nb = b.length
  const n = na < nb ? na : nb
  for (let i = 0; i < n; i++) {
    let ca = a.charCodeAt(i)!
    let cb = b.charCodeAt(i)!
    if (ca >= 65 && ca <= 90) ca += 32
    if (cb >= 65 && cb <= 90) cb += 32
    if (ca !== cb) return ca < cb ? -1 : 1
  }
  if (na === nb) return 0
  return na < nb ? -1 : 1
}

export function compareNames(a: string, b: string, mode: NameSortMode = 'explorer'): number {
  return mode === 'literal' ? compareFileNamesLiteral(a, b) : compareFileNames(a, b)
}
