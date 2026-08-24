import { z } from 'zod'

export const MAX_FILE_TEMPLATES = 40

export const fileTemplateSchema = z.object({
  id: z
    .string()
    .regex(/^[a-zA-Z0-9_-]{4,80}$/),
  /** Pretty name — menu label and default new-file stem (before the extension). */
  name: z.string().min(1).max(80),
  suggestedStem: z.string().min(1).max(80).catch('New file'),
  /** Original picked filename (display only). Missing catalogs fall back to `sourceFile`. */
  inputName: z.string().min(1).max(200).catch(''),
  /** Basename only, stored under userData/Templates (D2 / D57). */
  sourceFile: z
    .string()
    .min(1)
    .max(200)
    .refine((s) => !s.includes('/') && !s.includes('\\') && !s.includes('..'), {
      message: 'sourceFile must be a basename'
    })
})
export type FileTemplate = z.infer<typeof fileTemplateSchema>

export function sanitizeTemplateStem(name: string, fallback = 'New file'): string {
  const cleaned = name
    // eslint-disable-next-line no-control-regex -- strip Windows-forbidden + C0 controls
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
    .replace(/\.+$/g, '')
    .trim()
  return cleaned.length > 0 ? cleaned.slice(0, 80) : fallback
}

/** Original file shown in Manage Templates (the input), not the pretty name. */
export function templateInputLabel(t: Pick<FileTemplate, 'inputName' | 'sourceFile'>): string {
  const n = t.inputName.trim()
  return n.length > 0 ? n : t.sourceFile
}

/** Stem used when creating a file from this template (`name` + source extension). */
export function templateDefaultStem(t: Pick<FileTemplate, 'name' | 'suggestedStem'>): string {
  return sanitizeTemplateStem(t.name, t.suggestedStem)
}

function extOf(name: string): string {
  const i = name.lastIndexOf('.')
  return i > 0 ? name.slice(i) : ''
}

/** Extension taken from the input file (falls back to the stored copy). */
export function templateExt(t: Pick<FileTemplate, 'inputName' | 'sourceFile'>): string {
  return extOf(templateInputLabel(t)) || extOf(t.sourceFile)
}

/** Default created filename: pretty-name stem + input extension. */
export function templateCreatedName(
  t: Pick<FileTemplate, 'name' | 'suggestedStem' | 'inputName' | 'sourceFile'>
): string {
  return `${templateDefaultStem(t)}${templateExt(t)}`
}

/** Next unused pretty name (`Name`, then `Name (2)`, …). */
export function uniqueTemplatePrettyName(
  base: string,
  existing: Array<Pick<FileTemplate, 'name'>>
): string {
  const stem = sanitizeTemplateStem(base, 'Template')
  const taken = new Set(existing.map((t) => t.name.toLowerCase()))
  if (!taken.has(stem.toLowerCase())) return stem
  for (let n = 2; n < 200; n++) {
    const candidate = sanitizeTemplateStem(`${stem} (${n})`, stem)
    if (!taken.has(candidate.toLowerCase())) return candidate
  }
  return sanitizeTemplateStem(`${stem} copy`, stem)
}

export function sanitizeFileTemplates(raw: unknown): FileTemplate[] {
  if (!Array.isArray(raw)) return []
  const seen = new Set<string>()
  const out: FileTemplate[] = []
  for (const item of raw) {
    const parsed = fileTemplateSchema.safeParse(item)
    if (!parsed.success) continue
    if (seen.has(parsed.data.id)) continue
    seen.add(parsed.data.id)
    const inputName = parsed.data.inputName.trim() || parsed.data.sourceFile
    const suggestedStem = sanitizeTemplateStem(parsed.data.name, parsed.data.suggestedStem)
    out.push({ ...parsed.data, inputName, suggestedStem })
    if (out.length >= MAX_FILE_TEMPLATES) break
  }
  return out
}

export const templatesImportResultSchema = z.union([
  z.object({ cancelled: z.literal(true) }),
  z.object({
    cancelled: z.literal(false),
    template: fileTemplateSchema
  })
])

export const templatesInstantiateRequestSchema = z.object({
  id: z.string().min(1),
  destDir: z.string().min(1)
})

export const templatesDeleteRequestSchema = z.object({
  id: z.string().min(1)
})
