import { z } from 'zod'

export const MAX_QUICK_ACCESS_GROUPS = 30

export const quickAccessGroupSchema = z.object({
  kind: z.literal('group'),
  id: z
    .string()
    .regex(/^[a-zA-Z0-9_-]{4,80}$/),
  name: z.string().min(1).max(80),
  color: z
    .string()
    .regex(/^#[0-9A-Fa-f]{6}$/)
    .optional(),
  collapsed: z.boolean().catch(false),
  items: z.array(z.string().min(1)).catch([])
})
export type QuickAccessGroup = z.infer<typeof quickAccessGroupSchema>

export const quickAccessItemSchema = z.union([z.string().min(1), quickAccessGroupSchema])
export type QuickAccessItem = z.infer<typeof quickAccessItemSchema>

export function isQuickAccessGroup(item: QuickAccessItem): item is QuickAccessGroup {
  return typeof item === 'object' && item !== null && item.kind === 'group'
}

export function sanitizeQuickAccess(raw: unknown): QuickAccessItem[] {
  if (!Array.isArray(raw)) return []
  const out: QuickAccessItem[] = []
  let groups = 0
  for (const item of raw) {
    if (typeof item === 'string') {
      const t = item.trim()
      if (t) out.push(t)
      continue
    }
    const parsed = quickAccessGroupSchema.safeParse(item)
    if (!parsed.success) continue
    if (groups >= MAX_QUICK_ACCESS_GROUPS) continue
    groups += 1
    out.push(parsed.data)
  }
  return out
}

export function flattenQuickAccessTokens(list: QuickAccessItem[]): string[] {
  const out: string[] = []
  for (const item of list) {
    if (typeof item === 'string') out.push(item)
    else out.push(...item.items)
  }
  return out
}

export function removeQuickAccessToken(list: QuickAccessItem[], token: string): QuickAccessItem[] {
  const key = token.toLowerCase()
  return list
    .map((item) => {
      if (typeof item === 'string') return item.toLowerCase() === key ? null : item
      return {
        ...item,
        items: item.items.filter((t) => t.toLowerCase() !== key)
      }
    })
    .filter((item): item is QuickAccessItem => item != null)
}

export function tokenExistsInQuickAccess(list: QuickAccessItem[], token: string): boolean {
  const key = token.toLowerCase()
  return flattenQuickAccessTokens(list).some((t) => t.toLowerCase() === key)
}

/** Default name for Settings → Quick access → Add group… (Electron has no window.prompt). */
export function nextQuickAccessGroupName(list: readonly QuickAccessItem[]): string {
  const used = new Set(
    list.filter(isQuickAccessGroup).map((g) => g.name.trim().toLowerCase()).filter(Boolean)
  )
  if (!used.has('group')) return 'Group'
  let n = 2
  while (used.has(`group ${n}`)) n += 1
  return `Group ${n}`
}
