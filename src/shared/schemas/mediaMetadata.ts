import { z } from 'zod'

export const MEDIA_METADATA_COVER_HEIGHT_MIN = 56
export const MEDIA_METADATA_COVER_HEIGHT_MAX = 240
export const MEDIA_METADATA_COVER_HEIGHT_DEFAULT = 120

export const mediaMetadataSettingsSchema = z.object({
  /** Off by default — context menu / preview / covers stay hidden until enabled. */
  enabled: z.boolean().catch(false),
  /** Preview-pane poster height (width follows 2:3). */
  coverHeightPx: z
    .number()
    .min(MEDIA_METADATA_COVER_HEIGHT_MIN)
    .max(MEDIA_METADATA_COVER_HEIGHT_MAX)
    .catch(MEDIA_METADATA_COVER_HEIGHT_DEFAULT),
  tmdbApiKey: z.string().catch(''),
  omdbApiKey: z.string().catch(''),
  internetSource: z.enum(['tmdb', 'omdb']).catch('tmdb'),
  /**
   * Icon/thumbnail tiles: `SxxExx` + episode title (default) vs the filename.
   * Details / List always use the filename.
   */
  showEpisodeIconLabels: z.boolean().catch(true),
  /**
   * In a `media_metadata_container` folder, sort files and folders in one list
   * (ignore Settings → Behavior → Folders first).
   */
  mixFilesAndFolders: z.boolean().catch(true),
  plexUrl: z.string().catch('http://127.0.0.1:32400'),
  plexToken: z.string().catch(''),
  plexDataDir: z.string().catch('')
})

export type MediaMetadataSettings = z.infer<typeof mediaMetadataSettingsSchema>

export const defaultMediaMetadataSettings: MediaMetadataSettings =
  mediaMetadataSettingsSchema.parse({})

export const mediaMetadataPathsSchema = z.object({
  paths: z.array(z.string().min(1)).min(1).max(200),
  kindHints: z.record(z.string(), z.enum(['movie', 'show', 'episode'])).optional(),
  /** Internet download only — `tmdb:movie:123` / `tmdb:tv:456` / `omdb:tt…`. */
  pickHints: z.record(z.string(), z.string()).optional(),
  /** Edited search name after a miss (`Babylon 5 - A Call to Arms`). */
  nameHints: z.record(z.string(), z.string()).optional()
})

export const mediaMetadataPathSchema = z.object({
  path: z.string().min(1)
})

export const mediaMetadataSetCoverSchema = z.object({
  path: z.string().min(1),
  coverId: z.string().min(1)
})

export const mediaMetadataSetWatchedSchema = z.object({
  paths: z.array(z.string().min(1)).min(1).max(200),
  watched: z.boolean()
})
