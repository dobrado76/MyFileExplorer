import { z } from 'zod'

export const pairCompareMethodSchema = z.enum([
  'size_mtime',
  'size',
  'hash_when_needed',
  'hash_all'
])
export type PairCompareMethod = z.infer<typeof pairCompareMethodSchema>

/** Statuses that can appear in the compare result filter (must match PairCompareStatus). */
export const pairFoldersVisibleStatusSchema = z.enum([
  'identical',
  'left_only',
  'right_only',
  'left_newer',
  'right_newer',
  'different',
  'type_conflict',
  'metadata_only',
  'inaccessible',
  'error'
])
export type PairFoldersVisibleStatus = z.infer<typeof pairFoldersVisibleStatusSchema>

const TOLERANCE_MIN_MS = 0
const TOLERANCE_MAX_MS = 60_000
const TOLERANCE_DEFAULT_MS = 2000

/** Default compare result filter — includes identical so a match is visible. */
export const DEFAULT_PAIR_COMPARE_VISIBLE_STATUSES: PairFoldersVisibleStatus[] = [
  'identical',
  'left_only',
  'right_only',
  'left_newer',
  'right_newer',
  'different',
  'type_conflict',
  'inaccessible',
  'error'
]

function clampToleranceMs(n: unknown): number {
  const v = typeof n === 'number' ? n : Number(n)
  if (!Number.isFinite(v)) return TOLERANCE_DEFAULT_MS
  return Math.min(TOLERANCE_MAX_MS, Math.max(TOLERANCE_MIN_MS, Math.round(v)))
}

function sanitizeVisibleStatuses(raw: unknown): PairFoldersVisibleStatus[] {
  if (!Array.isArray(raw)) return [...DEFAULT_PAIR_COMPARE_VISIBLE_STATUSES]
  const out: PairFoldersVisibleStatus[] = []
  const seen = new Set<string>()
  for (const item of raw) {
    const parsed = pairFoldersVisibleStatusSchema.safeParse(item)
    if (!parsed.success || seen.has(parsed.data)) continue
    seen.add(parsed.data)
    out.push(parsed.data)
  }
  return out.length > 0 ? out : [...DEFAULT_PAIR_COMPARE_VISIBLE_STATUSES]
}

/** Migrate pre-visibleStatuses prefs (empty array sentinel from settings merge). */
export function visibleStatusesFromLegacy(showIdenticalByDefault: boolean): PairFoldersVisibleStatus[] {
  if (showIdenticalByDefault) return [...DEFAULT_PAIR_COMPARE_VISIBLE_STATUSES]
  return DEFAULT_PAIR_COMPARE_VISIBLE_STATUSES.filter((s) => s !== 'identical')
}

/**
 * Must stay a ZodObject (not Effects/transform) so `settingsPatchSchema` can call `.partial()`.
 * Legacy `showIdenticalByDefault` → `visibleStatuses` migration lives in settings.ts preprocess.
 */
export const pairFoldersSettingsSchema = z.object({
  includeSubfolders: z.boolean().catch(true),
  followLinks: z.boolean().catch(false),
  compareMethod: pairCompareMethodSchema.catch('size_mtime'),
  modifiedToleranceMs: z.preprocess(
    clampToleranceMs,
    z.number().int().min(TOLERANCE_MIN_MS).max(TOLERANCE_MAX_MS)
  ),
  ignoreEmptyFolders: z.boolean().catch(false),
  /**
   * @deprecated Prefer `visibleStatuses`. Kept so older exports still parse;
   * when `visibleStatuses` is absent after migrate, identical follows this flag.
   */
  showIdenticalByDefault: z.boolean().catch(true),
  /** Last-used compare result filter (persists across sessions). */
  visibleStatuses: z.preprocess(sanitizeVisibleStatuses, z.array(pairFoldersVisibleStatusSchema))
})

/** @deprecated Alias — same ZodObject as `pairFoldersSettingsSchema`. */
export const pairFoldersSettingsObjectSchema = pairFoldersSettingsSchema

export type PairFoldersSettings = z.infer<typeof pairFoldersSettingsSchema>

export const defaultPairFoldersSettings: PairFoldersSettings = pairFoldersSettingsSchema.parse({
  includeSubfolders: true,
  followLinks: false,
  compareMethod: 'size_mtime',
  modifiedToleranceMs: TOLERANCE_DEFAULT_MS,
  ignoreEmptyFolders: false,
  showIdenticalByDefault: true,
  visibleStatuses: DEFAULT_PAIR_COMPARE_VISIBLE_STATUSES
})

/** Resolve filter list from settings (handles pre-visibleStatuses exports). */
export function pairFoldersVisibleStatuses(settings: PairFoldersSettings): PairFoldersVisibleStatus[] {
  if (Array.isArray(settings.visibleStatuses) && settings.visibleStatuses.length > 0) {
    return [...settings.visibleStatuses]
  }
  return visibleStatusesFromLegacy(settings.showIdenticalByDefault)
}
