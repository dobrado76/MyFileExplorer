import { z } from 'zod'

export const MAX_QUICK_LAUNCH = 24

export const quickLaunchIconKindSchema = z.enum(['shell', 'custom'])

export const quickLaunchItemSchema = z.object({
  id: z
    .string()
    .regex(/^[a-zA-Z0-9_-]{4,80}$/),
  name: z.string().min(1).max(80),
  /** Absolute path or `%ENV%\…` to an .exe / .lnk / .bat / .cmd / .msc. */
  path: z.string().min(1).max(500),
  /** Optional extra arguments (quoted tokens). */
  args: z.string().max(500).catch(''),
  iconKind: quickLaunchIconKindSchema.catch('shell'),
  /** Basename id under userData/quick-launch when iconKind is custom. */
  iconId: z
    .string()
    .regex(/^[a-zA-Z0-9_-]{4,80}$/)
    .optional()
})

export type QuickLaunchItem = z.infer<typeof quickLaunchItemSchema>

export function newQuickLaunchId(): string {
  return `ql_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

export function newQuickLaunchIconId(): string {
  return `qli_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

export function quickLaunchNameFromPath(filePath: string): string {
  const base = filePath.replace(/[/\\]+$/, '').split(/[/\\]/).pop() ?? ''
  const noExt = base.replace(/\.(exe|lnk|bat|cmd|msc|com|url)$/i, '')
  return noExt.trim().slice(0, 80) || 'App'
}

export function isQuickLaunchPath(filePath: string): boolean {
  return /\.(exe|lnk|bat|cmd|msc|com|url)$/i.test(filePath.trim())
}

export function isShortcutLaunchPath(filePath: string): boolean {
  return /\.(lnk|url)$/i.test(filePath.trim())
}

/** Split a user arguments field into argv (quotes strip; no shell metacharacters). */
export function splitLaunchArgs(raw: string): string[] {
  const s = raw.trim()
  if (!s) return []
  const out: string[] = []
  let cur = ''
  let quote: '"' | "'" | null = null
  for (const ch of s) {
    if (quote) {
      if (ch === quote) quote = null
      else cur += ch
      continue
    }
    if (ch === '"' || ch === "'") {
      quote = ch
      continue
    }
    if (/\s/.test(ch)) {
      if (cur) {
        out.push(cur)
        cur = ''
      }
      continue
    }
    cur += ch
  }
  if (cur) out.push(cur)
  return out.slice(0, 32)
}

export function sanitizeQuickLaunch(raw: unknown): QuickLaunchItem[] {
  if (!Array.isArray(raw)) return []
  const seen = new Set<string>()
  const out: QuickLaunchItem[] = []
  for (const item of raw) {
    const parsed = quickLaunchItemSchema.safeParse(item)
    if (!parsed.success) continue
    if (seen.has(parsed.data.id)) continue
    seen.add(parsed.data.id)
    const next = parsed.data
    if (next.iconKind === 'custom' && !next.iconId) {
      out.push({ ...next, iconKind: 'shell', iconId: undefined })
    } else {
      out.push(next)
    }
    if (out.length >= MAX_QUICK_LAUNCH) break
  }
  return out
}

/** Append dropped / picked program paths. Skips non-programs and duplicate paths. */
export function mergeQuickLaunchPaths(
  cur: QuickLaunchItem[],
  paths: string[]
): { next: QuickLaunchItem[]; added: number } {
  const taken = new Set(cur.map((x) => x.path.trim().toLowerCase()))
  const next = [...cur]
  let added = 0
  for (const p of paths) {
    if (!isQuickLaunchPath(p)) continue
    if (next.length >= MAX_QUICK_LAUNCH) break
    const key = p.trim().toLowerCase()
    if (!key || taken.has(key)) continue
    taken.add(key)
    next.push({
      id: newQuickLaunchId(),
      name: quickLaunchNameFromPath(p),
      path: p,
      args: '',
      iconKind: 'shell'
    })
    added += 1
  }
  return { next, added }
}

export const quickLaunchIdSchema = z.object({
  id: z.string().min(1).max(80)
})
