import { z } from 'zod'

export const previewKindSchema = z.enum([
  'image',
  'text',
  'markdown',
  'spreadsheet',
  'document',
  'rtf',
  'audio',
  'video',
  'pdf',
  'binary',
  'directory',
  'missing'
])
export type PreviewKind = z.infer<typeof previewKindSchema>

export type PreviewFieldGroup = 'file' | 'image' | 'generation' | 'other'

export type PreviewField = {
  id: string
  label: string
  value: string
  group?: PreviewFieldGroup
  mono?: boolean
  copyable?: boolean
}

export type SpreadsheetSheet = {
  name: string
  rows: string[][]
}

export type PreviewModel = {
  path: string
  kind: PreviewKind
  mediaUrl?: string
  textSample?: string
  /** HTML fragment for Word / RTF (renderer sanitizes before inject). */
  htmlBody?: string
  sheets?: SpreadsheetSheet[]
  fields: PreviewField[]
  warnings?: string[]
}

export const previewRequestSchema = z.object({ path: z.string().min(1) })
export type PreviewRequest = z.infer<typeof previewRequestSchema>
