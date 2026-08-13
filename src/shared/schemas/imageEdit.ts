import { z } from 'zod'

const cropFractionSchema = z.number().min(0).max(1)

export const cropSlideshowImageRequestSchema = z.object({
  path: z.string().min(1),
  crop: z.object({
    top: cropFractionSchema,
    right: cropFractionSchema,
    bottom: cropFractionSchema,
    left: cropFractionSchema
  })
})

export type CropSlideshowImageRequest = z.infer<typeof cropSlideshowImageRequestSchema>
