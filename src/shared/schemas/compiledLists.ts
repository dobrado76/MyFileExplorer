import { z } from 'zod'

export const compiledListEntrySchema = z.object({
  name: z.string().min(1),
  folder: z.string().min(1)
})

export const updateCompiledListsRequestSchema = z.object({
  compiledRoot: z.string().min(1),
  entries: z.array(compiledListEntrySchema)
})

export const compiledRootSchema = z.object({
  compiledRoot: z.string().min(1)
})

export const listCompiledDatsRequestSchema = z.object({
  compiledRoot: z.string().min(1),
  entries: z.array(compiledListEntrySchema)
})

export const lastListLineSchema = z.object({
  datPath: z.string().min(1),
  count: z.number().int().min(0)
})

export const writeLastListRequestSchema = z.object({
  compiledRoot: z.string().min(1),
  lines: z.array(lastListLineSchema)
})

export const compositeFileSchema = z.object({
  path: z.string().min(1)
})

export const writeCompositeListRequestSchema = z.object({
  path: z.string().min(1),
  lines: z.array(lastListLineSchema)
})

export const expandCompositeRequestSchema = z.object({
  lines: z.array(lastListLineSchema)
})
