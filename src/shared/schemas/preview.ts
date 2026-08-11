import { z } from 'zod'

export const previewKindSchema = z.enum([
  'image',
  'text',
  'markdown',
  'html',
  'spreadsheet',
  'document',
  'rtf',
  'audio',
  'video',
  'pdf',
  'binary',
  'executable',
  'directory',
  'shortcut',
  'archive',
  'chm',
  'font',
  'missing'
])
export type PreviewKind = z.infer<typeof previewKindSchema>

export type PreviewFieldGroup =
  | 'file'
  | 'image'
  | 'generation'
  | 'shortcut'
  | 'executable'
  | 'audio'
  | 'video'
  | 'other'

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
  /**
   * Still-frame JPEG for videos Chromium can’t play inline (e.g. many `.mkv`).
   * Shown while remux prepares, or as fallback when remux/codecs fail.
   */
  posterUrl?: string
  /**
   * When true, renderer should call `preview.ensurePlayable` — main will remux
   * (ffmpeg) to a Chromium-playable MP4 under userData and return `mediaUrl`.
   */
  needsPlayable?: boolean
  /**
   * `!VIDTHUMB_CACHE` strip frame URLs (e.g. `.avi` — no in-pane player; animate + Open).
   */
  stripFrames?: string[]
  textSample?: string
  /** HTML fragment for Word / RTF (renderer sanitizes before inject). */
  htmlBody?: string
  sheets?: SpreadsheetSheet[]
  /** ZIP / Unity package contents tree when `kind === 'archive'`; CHM TOC when `kind === 'chm'`. */
  archiveTree?: ArchiveTreeNode[]
  /** Archive flavor — Extract All only for ZIP. */
  archiveFormat?:
    | 'zip'
    | 'unitypackage'
    | '7z'
    | 'rar'
    | 'tar'
    | 'targz'
    | 'apk'
    | 'msi'
    | 'iso'
    | 'img'
  fields: PreviewField[]
  warnings?: string[]
}

export const previewRequestSchema = z.object({
  path: z.string().min(1),
  /**
   * Optional ADS override for image version preview:
   * - omit → default tip (`VER_{count}` or `$DATA`)
   * - `null` → pristine `$DATA`
   * - `"VER_k"` → that version stream
   */
  ads: z.string().min(1).nullable().optional()
})
export type PreviewRequest = z.infer<typeof previewRequestSchema>

export const previewEnsurePlayableSchema = z.object({
  path: z.string().min(1),
  /** Drop cache and force H.264 transcode (recovery from audio-only remux). */
  force: z.boolean().optional()
})
export type PreviewEnsurePlayableRequest = z.infer<typeof previewEnsurePlayableSchema>

/** Load a topic HTML URL from a `.chm` after `preview:get`. */
export const previewChmTopicSchema = z.object({
  path: z.string().min(1),
  /** Topic path inside the CHM (`/` separators), from the TOC node. */
  topic: z.string().min(1)
})
export type PreviewChmTopicRequest = z.infer<typeof previewChmTopicSchema>
