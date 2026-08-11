import { z } from 'zod'
import {
  SLIDESHOW_DELAY_MS_DEFAULT,
  SLIDESHOW_DELAY_MS_MIN,
  SLIDESHOW_IMAGE_LIST_CAP
} from '../slideshow/constants'

export const slideshowOrderSchema = z.enum(['random', 'name', 'size', 'dimensions'])
export type SlideshowOrder = z.infer<typeof slideshowOrderSchema>

/** Persisted categorizer mapping row (imported into settings; file path is not the source of truth). */
export const categorizerMapRowSchema = z.object({
  name: z.string().catch(''),
  keyToken: z.string().min(1),
  path: z.string().catch('')
})
export type CategorizerMapRowPersisted = z.infer<typeof categorizerMapRowSchema>

export const slideshowSettingsSchema = z.object({
  delayMs: z
    .number()
    .int()
    .min(SLIDESHOW_DELAY_MS_MIN)
    .catch(SLIDESHOW_DELAY_MS_DEFAULT),
  order: slideshowOrderSchema.catch('name'),
  ascending: z.boolean().catch(true),
  loop: z.boolean().catch(true),
  drawCaption: z.boolean().catch(false),
  /**
   * Last Import/Export dialog path (hint only). The live map is `categorizerMap`
   * in settings — deleting the file must not clear mappings.
   */
  categorizerMapPath: z.string().catch(''),
  /** In-app categorizer map (source of truth). Import copies file → here. */
  categorizerMap: z.array(categorizerMapRowSchema).catch([]),
  /** Toolbar Cache toggle — persists across app sessions. */
  cacheActive: z.boolean().catch(false),
  /** Cached image paths when Cache is used — persists across app sessions. */
  imageListCache: z
    .array(z.string())
    .catch([])
    .transform((arr) =>
      arr.filter((p) => typeof p === 'string' && p.length > 0).slice(0, SLIDESHOW_IMAGE_LIST_CAP)
    ),
  /**
   * When set, unloadable / undecodable slideshow images are moved here
   * and removed from the image-list cache for review. Empty = still drop from
   * list/cache, but files are not moved until a folder is set.
   */
  invalidImagesDir: z.string().catch(''),
  /**
   * Root folder for compiled .dat indexes + `!!Lists/` composites.
   * Empty → hide second toolbar compiled-lists button.
   */
  compiledFileListsFolder: z.string().catch(''),
  /** Named source folders to compile (order = drag order in config UI). */
  compiledListEntries: z
    .array(
      z.object({
        name: z.string().min(1),
        folder: z.string().min(1)
      })
    )
    .catch([]),
  /** Last image index within the expanded compiled playlist (resume). */
  compiledPlaylistIndex: z.number().int().min(0).catch(0)
})
export type SlideshowSettings = z.infer<typeof slideshowSettingsSchema>

export const defaultSlideshowSettings: SlideshowSettings = {
  delayMs: SLIDESHOW_DELAY_MS_DEFAULT,
  order: 'name',
  ascending: true,
  loop: true,
  drawCaption: false,
  categorizerMapPath: '',
  categorizerMap: [],
  cacheActive: false,
  imageListCache: [],
  invalidImagesDir: '',
  compiledFileListsFolder: '',
  compiledListEntries: [],
  compiledPlaylistIndex: 0
}

export const slideshowListRequestSchema = z.object({
  roots: z.array(z.string().min(1)).min(1),
  order: slideshowOrderSchema,
  ascending: z.boolean()
})
export type SlideshowListRequest = z.infer<typeof slideshowListRequestSchema>

export const slideshowListResponseSchema = z.object({
  paths: z.array(z.string()),
  truncated: z.boolean().optional()
})
