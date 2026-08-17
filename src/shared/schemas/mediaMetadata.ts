import { z } from 'zod'

export const mediaMetadataSettingsSchema = z.object({
  /** Off by default — context menu / preview / covers stay hidden until enabled. */
  enabled: z.boolean().catch(false),
  tmdbApiKey: z.string().catch(''),
  omdbApiKey: z.string().catch(''),
  internetSource: z.enum(['tmdb', 'omdb']).catch('tmdb'),
  plexUrl: z.string().catch('http://127.0.0.1:32400'),
  plexToken: z.string().catch(''),
  plexDataDir: z.string().catch('')
})

export type MediaMetadataSettings = z.infer<typeof mediaMetadataSettingsSchema>

export const defaultMediaMetadataSettings: MediaMetadataSettings =
  mediaMetadataSettingsSchema.parse({})

export const mediaMetadataPathsSchema = z.object({
  paths: z.array(z.string().min(1)).min(1).max(200)
})

export const mediaMetadataPathSchema = z.object({
  path: z.string().min(1)
})
