/** Discovered Windows static shell verbs (registry scan → D41). */
import { z } from 'zod'
import { normalizeExtensions } from '../contextMenuCommands'

export const MAX_DISCOVERED_ENABLED = 60

export const discoveredShellVerbSchema = z.object({
  /** Stable id for checklist selection (hash of registry key + verb). */
  id: z.string().min(1),
  label: z.string().min(1),
  verbKey: z.string(),
  registryKey: z.string(),
  /** Where the verb applies. */
  targetKind: z.enum(['files', 'folders', 'both']),
  /** Short hint for UI: `*`, `Directory`, `.png`, … */
  targetHint: z.string(),
  commandPreview: z.string(),
  executable: z.string().nullable(),
  argsTemplate: z.string().nullable(),
  /** When set, import as extension match; else `all`. */
  extensions: z.array(z.string()).nullable(),
  supported: z.boolean(),
  unsupportedReason: z.string().optional(),
  /** Extended / ProgrammaticAccessOnly / LegacyDisable — shown but optional. */
  advanced: z.boolean().catch(false)
})

export type DiscoveredShellVerb = z.infer<typeof discoveredShellVerbSchema>

export const discoverShellVerbsResponseSchema = z.object({
  verbs: z.array(discoveredShellVerbSchema),
  scannedKeys: z.number().int().nonnegative(),
  platform: z.enum(['win32', 'other'])
})

export type DiscoverShellVerbsResponse = z.infer<typeof discoverShellVerbsResponseSchema>

/** Cached Discover scan + which verbs are enabled for the live menu (D41). */
export type ContextMenuDiscoveredSettings = {
  verbs: DiscoveredShellVerb[]
  scannedKeys: number
  enabledIds: string[]
}

export const defaultContextMenuDiscoveredSettings: ContextMenuDiscoveredSettings = {
  verbs: [],
  scannedKeys: 0,
  enabledIds: []
}

export function sanitizeDiscoveredSettings(raw: unknown): ContextMenuDiscoveredSettings {
  if (!raw || typeof raw !== 'object') return { ...defaultContextMenuDiscoveredSettings }
  const o = raw as { verbs?: unknown; scannedKeys?: unknown; enabledIds?: unknown }
  const verbs: DiscoveredShellVerb[] = []
  const seenVerb = new Set<string>()
  if (Array.isArray(o.verbs)) {
    for (const item of o.verbs) {
      const p = discoveredShellVerbSchema.safeParse(item)
      if (!p.success || seenVerb.has(p.data.id)) continue
      seenVerb.add(p.data.id)
      verbs.push(p.data)
    }
  }
  const scannedKeys =
    typeof o.scannedKeys === 'number' && Number.isFinite(o.scannedKeys) && o.scannedKeys >= 0
      ? Math.floor(o.scannedKeys)
      : 0
  const enabledIds: string[] = []
  const seenEn = new Set<string>()
  if (Array.isArray(o.enabledIds)) {
    for (const id of o.enabledIds) {
      if (typeof id !== 'string' || !id || seenEn.has(id) || !seenVerb.has(id)) continue
      const verb = verbs.find((v) => v.id === id)
      if (!verb?.supported) continue
      seenEn.add(id)
      enabledIds.push(id)
      if (enabledIds.length >= MAX_DISCOVERED_ENABLED) break
    }
  }
  return { verbs, scannedKeys, enabledIds }
}

function extensionOf(path: string): string {
  const base = path.replace(/[\\/]+$/, '')
  const name = base.includes('\\') ? base.slice(base.lastIndexOf('\\') + 1) : base
  const slash = name.includes('/') ? name.slice(name.lastIndexOf('/') + 1) : name
  const dot = slash.lastIndexOf('.')
  if (dot <= 0 || dot === slash.length - 1) return ''
  return slash.slice(dot + 1).toLowerCase()
}

/** Whether an enabled Discover verb should appear for this uniform selection. */
export function discoveredVerbMatches(
  verb: DiscoveredShellVerb,
  paths: string[],
  kind: 'file' | 'folder'
): boolean {
  if (!verb.supported || !verb.executable || !verb.argsTemplate || paths.length === 0) return false
  if (kind === 'file') {
    if (verb.targetKind === 'folders') return false
    if (verb.extensions && verb.extensions.length > 0) {
      const allowed = new Set(normalizeExtensions(verb.extensions))
      if (allowed.size === 0) return false
      return paths.every((p) => allowed.has(extensionOf(p)))
    }
    return true
  }
  if (verb.targetKind === 'files') return false
  return true
}

/** Merge a fresh scan with previously enabled ids (drop vanished / unsupported). */
export function mergeDiscoveredScan(
  prev: ContextMenuDiscoveredSettings,
  scan: { verbs: DiscoveredShellVerb[]; scannedKeys: number }
): ContextMenuDiscoveredSettings {
  const verbs = scan.verbs
  const ids = new Set(verbs.filter((v) => v.supported).map((v) => v.id))
  const enabledIds = prev.enabledIds.filter((id) => ids.has(id)).slice(0, MAX_DISCOVERED_ENABLED)
  return { verbs, scannedKeys: scan.scannedKeys, enabledIds }
}
