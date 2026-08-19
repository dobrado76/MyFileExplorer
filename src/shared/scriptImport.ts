import { AppError } from './result'
import { looksDestructive } from './scriptDestructive'
import {
  defaultScriptDefinition,
  languageFromExtension,
  mfeScriptDocumentSchema,
  MFESCRIPT_FORMAT,
  type ScriptDefinition
} from './schemas/scripts'

export type ParsedScriptImport = {
  script: Omit<ScriptDefinition, 'id' | 'createdAt' | 'updatedAt'>
  source: string
}

function nameFromFile(fileName: string): string {
  const base = fileName.replace(/\\/g, '/').split('/').pop() ?? 'script'
  const noExt = base.replace(/\.(ps1|py|cmd|bat|sh|mfescript|json)$/i, '')
  return noExt.trim().slice(0, 120) || 'Imported script'
}

function fromEnvelope(text: string): ParsedScriptImport {
  let raw: unknown
  try {
    raw = JSON.parse(text) as unknown
  } catch {
    throw new AppError('validation', 'Not valid JSON')
  }
  const parsed = mfeScriptDocumentSchema.safeParse(raw)
  if (!parsed.success) {
    throw new AppError('validation', 'Not a MyFileExplorer script export')
  }
  const doc = parsed.data
  return {
    script: {
      ...defaultScriptDefinition(),
      ...doc.script,
      sourceKind: 'managed',
      externalPath: undefined
    },
    source: doc.source
  }
}

function fromRawSource(fileName: string, text: string): ParsedScriptImport {
  const language = languageFromExtension(fileName)
  if (!language) {
    throw new AppError(
      'validation',
      'Not a .mfescript or a supported script file (.ps1, .py, .cmd, .sh)'
    )
  }
  return {
    script: {
      ...defaultScriptDefinition(),
      name: nameFromFile(fileName),
      language,
      destructive: looksDestructive(text),
      dryRunSupported: /--dry-run/.test(text)
    },
    source: text
  }
}

/** `.mfescript` JSON, or raw `.ps1` / `.py` / `.cmd` / `.bat` / `.sh`. */
export function parseScriptImport(fileName: string, text: string): ParsedScriptImport {
  const trimmed = text.trim()
  const looksLikeEnvelope =
    trimmed.startsWith('{') && (trimmed.includes(MFESCRIPT_FORMAT) || /"source"\s*:/.test(trimmed))
  if (looksLikeEnvelope) {
    try {
      return fromEnvelope(text)
    } catch (e) {
      if (languageFromExtension(fileName)) return fromRawSource(fileName, text)
      if (e instanceof AppError) throw e
      throw new AppError(
        'validation',
        'Not a .mfescript or a supported script file (.ps1, .py, .cmd, .sh)'
      )
    }
  }
  if (languageFromExtension(fileName)) return fromRawSource(fileName, text)
  try {
    return fromEnvelope(text)
  } catch {
    throw new AppError(
      'validation',
      'Not a .mfescript or a supported script file (.ps1, .py, .cmd, .sh)'
    )
  }
}
