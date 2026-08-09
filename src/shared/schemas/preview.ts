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
  'shortcut',
  'archive',
  'missing'
])
export type PreviewKind = z.infer<typeof previewKindSchema>

export type PreviewFieldGroup = 'file' | 'image' | 'generation' | 'shortcut' | 'other'

export type PreviewField = {
  id: string
  label: string
  value: string
  group?: PreviewFieldGroup
  mono?: boolean
  /** When set, renderer syntax-highlights `value` (e.g. JSON blocks). */
  syntax?: 'json'
  copyable?: boolean
}

export type SpreadsheetSheet = {
  name: string
  rows: string[][]
}

/** Nested listing of entries inside a `.zip` (preview only — not a navigable folder). */
export type ArchiveTreeNode = {
  name: string
  /** Path inside the archive using `/` separators. */
  path: string
  kind: 'file' | 'dir'
  /** Uncompressed size in bytes when known. */
  size?: number
  children?: ArchiveTreeNode[]
}

export type PreviewModel = {
  path: string
  kind: PreviewKind
  /** Optional header subtitle (e.g. “SafeTensors · LoRA · 229 M”). */
  subtitle?: string
  mediaUrl?: string
  textSample?: string
  /** HTML fragment for Word / RTF (renderer sanitizes before inject). */
  htmlBody?: string
  sheets?: SpreadsheetSheet[]
  /** ZIP contents tree when `kind === 'archive'`. */
  archiveTree?: ArchiveTreeNode[]
  fields: PreviewField[]
  warnings?: string[]
}

export const previewRequestSchema = z.object({ path: z.string().min(1) })
export type PreviewRequest = z.infer<typeof previewRequestSchema>
