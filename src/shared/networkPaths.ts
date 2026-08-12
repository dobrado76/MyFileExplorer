/** Network neighborhood helpers (UNC hosts/shares) — shared + unit-tested. */

export type DriveTypeKind = 'fixed' | 'removable' | 'remote' | 'cdrom' | 'ramdisk' | 'unknown'

/** Win32 GetDriveTypeW constants. */
export const DRIVE_UNKNOWN = 0
export const DRIVE_NO_ROOT_DIR = 1
export const DRIVE_REMOVABLE = 2
export const DRIVE_FIXED = 3
export const DRIVE_REMOTE = 4
export const DRIVE_CDROM = 5
export const DRIVE_RAMDISK = 6

export function driveTypeFromWin32(type: number): DriveTypeKind {
  switch (type) {
    case DRIVE_REMOVABLE:
      return 'removable'
    case DRIVE_FIXED:
      return 'fixed'
    case DRIVE_REMOTE:
      return 'remote'
    case DRIVE_CDROM:
      return 'cdrom'
    case DRIVE_RAMDISK:
      return 'ramdisk'
    default:
      return 'unknown'
  }
}

/** Strip trailing slashes; uppercase host for display keys. */
export function normalizeServerName(raw: string): string {
  let s = raw.trim().replace(/\//g, '\\')
  if (s.startsWith('\\\\')) s = s.slice(2)
  const slash = s.indexOf('\\')
  if (slash >= 0) s = s.slice(0, slash)
  return s.replace(/\.+$/, '').trim()
}

/** `\\HOST` form (trailing slash omitted). */
export function hostUnc(server: string): string {
  const name = normalizeServerName(server)
  if (!name) return ''
  return `\\\\${name}`
}

/** `\\HOST\Share` form. */
export function shareUnc(server: string, shareName: string): string {
  const host = normalizeServerName(server)
  const share = shareName.replace(/[\\/]+/g, '').trim()
  if (!host || !share) return ''
  return `\\\\${host}\\${share}`
}

/**
 * Explorer-style: hide admin / special shares that end with `$`
 * (IPC$, ADMIN$, C$, PRINT$, etc.).
 */
export function isHiddenNetworkShare(shareName: string): boolean {
  const n = shareName.trim()
  if (!n) return true
  return n.endsWith('$')
}

export type UncParts =
  | { kind: 'host'; server: string; unc: string }
  | { kind: 'share'; server: string; share: string; unc: string }
  | { kind: 'path'; server: string; share: string; rest: string; unc: string }
  | null

/** Parse a Windows UNC path into host / share / deeper path. */
export function parseUnc(input: string): UncParts {
  const n = input.trim().replace(/\//g, '\\')
  if (!n.startsWith('\\\\')) return null
  const body = n.slice(2).replace(/\\+$/, '')
  if (!body) return null
  const parts = body.split('\\').filter(Boolean)
  if (parts.length === 0) return null
  const server = parts[0]!
  if (parts.length === 1) {
    return { kind: 'host', server, unc: hostUnc(server) }
  }
  const share = parts[1]!
  if (parts.length === 2) {
    return { kind: 'share', server, share, unc: shareUnc(server, share) }
  }
  const rest = parts.slice(2).join('\\')
  return {
    kind: 'path',
    server,
    share,
    rest,
    unc: `\\\\${normalizeServerName(server)}\\${share}\\${rest}`
  }
}

/** True for dotted IPv4 host labels (not DNS names). */
export function isIpv4Literal(name: string): boolean {
  return /^\d{1,3}(?:\.\d{1,3}){3}$/.test(name.trim())
}

/**
 * Identity keys for matching the same PC (`NEWONYX`, `newonyx.lan` → `newonyx`).
 * IPv4 literals are returned as-is (lowercase).
 */
export function networkHostIdentityKeys(raw: string): string[] {
  const n = normalizeServerName(raw).toLowerCase()
  if (!n) return []
  if (isIpv4Literal(n)) return [n]
  const keys = new Set<string>([n])
  const short = n.split('.')[0]
  if (short) keys.add(short)
  return [...keys]
}

/** Drop hosts that are this machine (by NetBIOS / DNS short name). */
export function filterOutLocalNetworkHosts<T extends { name: string; unc?: string }>(
  hosts: readonly T[],
  localHostNames: readonly string[]
): T[] {
  const local = new Set(localHostNames.flatMap((n) => networkHostIdentityKeys(n)))
  if (local.size === 0) return [...hosts]
  return hosts.filter((h) => {
    const keys = networkHostIdentityKeys(h.name || h.unc || '')
    return !keys.some((k) => local.has(k))
  })
}

/**
 * Prefer a human hostname over an IP, and NetBIOS-style `NEWONYX` over `newonyx`.
 */
export function preferHostLabel(a: string, b: string): string {
  const an = normalizeServerName(a)
  const bn = normalizeServerName(b)
  if (!an) return bn
  if (!bn) return an
  if (isIpv4Literal(an) && !isIpv4Literal(bn)) return bn
  if (!isIpv4Literal(an) && isIpv4Literal(bn)) return an
  // Same key: prefer the label with more uppercase (shell NetBIOS names).
  if (an.toLowerCase() === bn.toLowerCase()) {
    const aUpper = [...an].filter((c) => c >= 'A' && c <= 'Z').length
    const bUpper = [...bn].filter((c) => c >= 'A' && c <= 'Z').length
    return bUpper > aUpper ? bn : an
  }
  return an
}

/**
 * Drop IPv4 entries that alias a hostname we already have (via reverse/forward map).
 * `ipv4ToHostname` keys and values should be normalized (no UNC prefix).
 */
export function collapseHostIpAliases(
  hosts: Array<{ name: string; unc: string }>,
  ipv4ToHostname: Map<string, string>
): Array<{ name: string; unc: string }> {
  const byKey = new Map<string, { name: string; unc: string }>()
  for (const h of hosts) {
    const name = normalizeServerName(h.name || h.unc)
    if (!name) continue
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,62}$/.test(name)) continue
    let canonical = name
    if (isIpv4Literal(name)) {
      const mapped = ipv4ToHostname.get(name.toLowerCase())
      if (mapped) canonical = normalizeServerName(mapped) || name
    }
    const key = canonical.toLowerCase()
    const prev = byKey.get(key)
    if (!prev) {
      byKey.set(key, { name: canonical, unc: hostUnc(canonical) })
      continue
    }
    const preferred = preferHostLabel(prev.name, canonical)
    byKey.set(key, { name: preferred, unc: hostUnc(preferred) })
  }
  // Second pass: remove any remaining IPv4 that maps to a hostname key present in the set.
  for (const [ip, host] of ipv4ToHostname) {
    const hostKey = normalizeServerName(host).toLowerCase()
    if (!hostKey || !byKey.has(hostKey)) continue
    byKey.delete(ip.toLowerCase())
  }
  return [...byKey.values()].sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
  )
}

/**
 * DNS reverse lookups often force lowercase. NetBIOS / Explorer labels are usually
 * uppercase (NEWONYX). If the name is a simple all-lowercase label, show it uppercased.
 */
export function displayHostLabel(name: string): string {
  const n = normalizeServerName(name)
  if (!n || isIpv4Literal(n)) return n
  if (/^[a-z0-9][a-z0-9-]{0,14}$/.test(n) && /[a-z]/.test(n)) return n.toUpperCase()
  return n
}

/** True when path is a bare `\\server` (no share). */
export function isNetworkHostUnc(path: string): boolean {
  return parseUnc(path)?.kind === 'host'
}

/** True when path is `\\server\share` with no deeper segments. */
export function isNetworkShareUnc(path: string): boolean {
  return parseUnc(path)?.kind === 'share'
}
