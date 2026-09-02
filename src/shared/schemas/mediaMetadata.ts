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
   * In a `media_metadata_container` folder, icon/thumbnail views sort files and
   * folders in one list (ignore Settings → Behavior → Folders first). List and
   * Details still follow that Folders first checkbox. Off by default.
   */
  mixFilesAndFolders: z.boolean().catch(false),
  plexUrl: z.string().catch('http://127.0.0.1:32400'),
  plexToken: z.string().catch(''),
  plexDataDir: z.string().catch(''),
  /**
   * Last Watched / Genre toolbar filters per media-library folder
   * (`media_metadata_container` path). Cap enforced in helpers.
   */
  libraryFilters: z
    .array(
      z.object({
        path: z.string().min(1),
        watched: z.enum(['all', 'watched', 'unwatched']).catch('all'),
        genre: z.string().max(200).nullable().catch(null)
      })
    )
    .max(200)
    .catch([])
})

export type MediaMetadataSettings = z.infer<typeof mediaMetadataSettingsSchema>

export const defaultMediaMetadataSettings: MediaMetadataSettings =
  mediaMetadataSettingsSchema.parse({})

export const mediaMetadataPathsSchema = z.object({
  paths: z.array(z.string().min(1)).min(1).max(200),
  kindHints: z.record(z.string(), z.enum(['movie', 'show', 'episode'])).optional(),
  /** Internet download only — `tmdb:movie:123` / `tmdb:tv:456` / `omdb:tt…`. */
  pickHints: z.record(z.string(), z.string()).optional(),
  /** Search as typed by the user — sent to Plex/TMDB/OMDb without scene-tag stripping. */
  nameHints: z.record(z.string(), z.string()).optional()
})

export const mediaMetadataPathSchema = z.object({
  path: z.string().min(1)
})

export const mediaMetadataLoadCustomCoverSchema = z.object({
  path: z.string().min(1),
  imagePath: z.string().min(1)
})

export const mediaMetadataSetCoverSchema = z.object({
  path: z.string().min(1),
  coverId: z.string().min(1),
  /** Picker JPEG — used when the main-process cover session is gone (reload / remount). */
  previewBase64: z.string().min(1).max(2_000_000).optional()
})

export const mediaMetadataSetWatchedSchema = z.object({
  paths: z.array(z.string().min(1)).min(1).max(200),
  watched: z.boolean()
})

const optionalStringList = z
  .array(z.string().max(200))
  .max(80)
  .nullable()
  .optional()

/** Editable fields for `mediaMetadata:save` (null clears an optional field). */
export const mediaMetadataEditFieldsSchema = z.object({
  title: z.string().min(1).max(500),
  year: z.number().int().min(1870).max(2100).nullable().optional(),
  originalLanguage: z.string().max(80).nullable().optional(),
  country: optionalStringList,
  genres: optionalStringList,
  directors: optionalStringList,
  actors: optionalStringList,
  synopsis: z.string().max(20_000).nullable().optional(),
  watched: z.boolean().optional(),
  season: z.number().int().min(0).max(999).nullable().optional(),
  episode: z.number().int().min(0).max(9999).nullable().optional(),
  showTitle: z.string().max(500).nullable().optional()
})

export const mediaMetadataSaveSchema = z.object({
  path: z.string().min(1),
  fields: mediaMetadataEditFieldsSchema
})

export type MediaMetadataSaveRequest = z.infer<typeof mediaMetadataSaveSchema>
