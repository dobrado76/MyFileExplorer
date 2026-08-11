import { z } from 'zod'

export const adsPathSchema = z.object({
  path: z.string().min(1)
})

export const adsNamedSchema = z.object({
  path: z.string().min(1),
  name: z.string().min(1).max(255)
})

export const adsWriteTextSchema = z.object({
  path: z.string().min(1),
  name: z.string().min(1).max(255),
  value: z.string(),
  /** When true, empty value writes an empty stream instead of deleting. */
  writeEmpty: z.boolean().optional()
})

export const adsWriteBytesSchema = z.object({
  path: z.string().min(1),
  name: z.string().min(1).max(255),
  /** Base64-encoded stream bytes. */
  dataBase64: z.string()
})

export const adsCopySchema = z.object({
  source: z.string().min(1),
  dest: z.string().min(1),
  ignoreNames: z.array(z.string()).optional()
})

export const adsInvalidateMetaSchema = z.object({
  paths: z.array(z.string().min(1)).min(1).max(50)
})

export const adsStreamInfoSchema = z.object({
  name: z.string(),
  size: z.number().nonnegative()
})
