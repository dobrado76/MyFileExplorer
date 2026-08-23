import { z } from 'zod'

export const compiledListEntrySchema = z.object({
  name: z.string().min(1),
  folder: z.string().min(1)
})

export const updateCompiledListsRequestSchema = z.object({
  compiledRoot: z.string().min(1),
  entries: z.array(compiledListEntrySchema)
})

export const validateCompiledListsRequestSchema = z.object({
  compiledRoot: z.string().min(1)
})

export const compiledListValidationIssueSchema = z.object({
  kind: z.enum(['missing-folder', 'missing-list']),
  listPath: z.string().min(1),
  listLabel: z.string().min(1),
  refPath: z.string().optional(),
  message: z.string().min(1)
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
  lines: z.array(lastListLineSchema),
  order: z.enum(['random', 'name', 'size', 'dimensions']).optional(),
  ascending: z.boolean().optional()
})

export const applyCompiledLinesRequestSchema = z.object({
  lines: z.array(lastListLineSchema),
  order: z.enum(['random', 'name', 'size', 'dimensions']),
  ascending: z.boolean(),
  preferPath: z.string().nullable().optional(),
  preferIndex: z.number().int().min(0).optional(),
  rev: z.number().int().optional().nullable(),
  /** When true, slideshow returns to autoplay (Compiled lists Play). */
  resumePlaying: z.boolean().optional()
})

export const slideshowRelayKeySchema = z.object({
  key: z.string().min(1),
  code: z.string().min(1),
  ctrlKey: z.boolean(),
  altKey: z.boolean(),
  shiftKey: z.boolean(),
  metaKey: z.boolean(),
  /** Omit / `down` = treat as keydown. `up` only updates crop modifiers. */
  phase: z.enum(['down', 'up']).optional()
})

export const slideshowRelayPointerSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('wheel'),
    deltaX: z.number(),
    deltaY: z.number(),
    ctrlKey: z.boolean(),
    metaKey: z.boolean()
  }),
  z.object({ kind: z.literal('click') }),
  z.object({ kind: z.literal('contextmenu') })
])

export const slideshowSetListsTypingSchema = z.object({
  typing: z.boolean()
})

export const compiledPathAtRequestSchema = z.object({
  index: z.number().int().min(0)
})
