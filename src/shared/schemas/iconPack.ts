import { z } from 'zod'

/** Glyph libraries offered by the unified icon picker (tabs, items, Quick Launch, scripts). */
export const ICON_PACK_IDS = ['lucide', 'phosphor', 'tabler'] as const
export type IconPackId = (typeof ICON_PACK_IDS)[number]

export const ICON_PACK_LABELS: Record<IconPackId, string> = {
  lucide: 'Lucide',
  phosphor: 'Phosphor',
  tabler: 'Tabler'
}

/**
 * Optional pack field. Missing stays undefined (readers treat as lucide).
 * Invalid values become undefined so lookup falls back like an unknown lucide name.
 */
export const iconPackIdSchema = z.enum(ICON_PACK_IDS).optional().catch(undefined)

export function normalizeIconPack(pack: string | null | undefined): IconPackId {
  if (pack === 'phosphor' || pack === 'tabler' || pack === 'lucide') return pack
  return 'lucide'
}
