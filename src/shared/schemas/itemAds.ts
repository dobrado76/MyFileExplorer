import { z } from 'zod'

export const ITEM_NOTE_STREAM = 'mfe_note'
export const ITEM_ICON_STREAM = 'mfe_icon'
export const ITEM_ICON_IMG_STREAM = 'mfe_icon_img'

export const itemNoteSchema = z.object({
  text: z.string().max(20_000).catch(''),
  status: z.string().max(80).optional(),
  checklist: z
    .array(
      z.object({
        text: z.string().max(200),
        done: z.boolean().catch(false)
      })
    )
    .max(40)
    .optional(),
  updatedAt: z.number().catch(0)
})
export type ItemNote = z.infer<typeof itemNoteSchema>

export const itemIconLucideSchema = z.object({
  kind: z.literal('lucide'),
  name: z.string().min(1).max(80),
  color: z
    .string()
    .regex(/^#[0-9A-Fa-f]{6}$/)
    .catch('#60a5fa')
})

export const itemIconShellSchema = z.object({
  kind: z.literal('shell'),
  color: z
    .string()
    .regex(/^#[0-9A-Fa-f]{6}$/)
    .catch('#60a5fa')
})

export const itemIconCustomSchema = z.object({
  kind: z.literal('custom'),
  sizePx: z.number().int().min(16).max(72).optional()
})

export const itemIconSchema = z.discriminatedUnion('kind', [
  itemIconLucideSchema,
  itemIconShellSchema,
  itemIconCustomSchema
])
export type ItemIcon = z.infer<typeof itemIconSchema>

export type ItemAdsRecord = {
  note: ItemNote | null
  icon: ItemIcon | null
  iconPngBase64: string | null
}

export function parseItemNote(raw: string): ItemNote | null {
  try {
    const parsed = itemNoteSchema.safeParse(JSON.parse(raw))
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

export function parseItemIcon(raw: string): ItemIcon | null {
  try {
    const parsed = itemIconSchema.safeParse(JSON.parse(raw))
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

export const itemAdsGetManySchema = z.object({
  paths: z.array(z.string().min(1)).max(250)
})

export const itemAdsSetNoteSchema = z.object({
  path: z.string().min(1),
  note: itemNoteSchema.nullable()
})

export const itemAdsSetIconSchema = z.object({
  path: z.string().min(1),
  icon: itemIconSchema.nullable(),
  imageBase64: z.string().optional()
})
