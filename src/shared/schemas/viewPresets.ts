import { z } from 'zod'
import { sortSchema, viewModeSchema } from './session'

export const MAX_VIEW_PRESETS = 30

/** Imported lazily-shaped columns from settings sanitize — keep widths loose. */
const presetColumnSchema = z.object({
  id: z.string().min(1),
  width: z.number().catch(100)
})

export const viewPresetSchema = z.object({
  id: z
    .string()
    .regex(/^[a-zA-Z0-9_-]{4,80}$/),
  name: z.string().min(1).max(80),
  viewMode: viewModeSchema.catch('largeIcons'),
  sort: sortSchema.catch({ key: 'name', dir: 'asc' }),
  detailsColumns: z.array(presetColumnSchema).min(1),
  detailsNameWidth: z.number().int().min(120).max(1600).catch(320),
  iconSizePx: z.number().min(12).max(40).optional(),
  foldersFirst: z.boolean().optional()
})
export type ViewPreset = z.infer<typeof viewPresetSchema>

export function sanitizeViewPresets(raw: unknown): ViewPreset[] {
  if (!Array.isArray(raw)) return []
  const seen = new Set<string>()
  const out: ViewPreset[] = []
  for (const item of raw) {
    const parsed = viewPresetSchema.safeParse(item)
    if (!parsed.success) continue
    if (seen.has(parsed.data.id)) continue
    seen.add(parsed.data.id)
    out.push(parsed.data)
    if (out.length >= MAX_VIEW_PRESETS) break
  }
  return out
}
