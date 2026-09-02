import { generatedScriptSchema, type GeneratedScript } from './schemas/ai'
import type { ScriptLanguage, ScriptRunMode } from './schemas/scripts'

/** Modify uses the dedicated instruction, or the Task text if that field is empty. */
export function resolveModifyInstruction(instruction: string, task: string): string {
  return instruction.trim() || task.trim()
}

export const SCRIPT_CLI_CONTRACT = `
CLI contract the script MUST implement (argv, not a shell string):
- Folder target: script --root "<folder>" [--recursive] [--dry-run] [--param value…]
- Selection target: script --input-list "<utf8 manifest file>" [--dry-run] [--param value…]
The manifest is UTF-8, one absolute path per line.
Honor --dry-run by printing what would change and exiting 0 without writing/deleting.
Do not prompt for GUI input. Write progress to stdout; errors to stderr.
`.trim()

/** Rules for AI-generated scripts that read/write user paths (CJK, spaces, #, etc.). */
export const SCRIPT_UNICODE_PATH_RULES = `
Unicode and international paths (filenames may include Chinese, emoji, spaces, #, !, …):
- --root and every line of --input-list are UTF-8 absolute paths. Read the manifest with encoding='utf-8' (Python), Get-Content -LiteralPath … -Encoding utf8 (PowerShell), or an equivalent — never the system default ANSI code page.
- Non-ASCII characters are part of the filename, never path separators. Example basename: krea2_v2範例_00031_.jpg — the 範例 characters belong in the name.
- Use pathlib.Path (Python) or -LiteralPath (PowerShell/cmd where applicable). Do not split manifest lines on backslash or guess path structure.
- Never build paths with unicode_escape, codecs.decode(..., 'unicode_escape'), json.loads on path text, or by embedding literal \\uXXXX escape sequences — those are not real on-disk names.
- When deriving an output path, preserve the source basename (Path.stem / suffix or [IO.Path]::GetFileName); only change the extension or parent directory the user asked for.
- Existence checks and overwrite guards must use the exact decoded path from argv/manifest. If stderr shows \\u7bc4\\u4f8b instead of real characters, the script is mishandling encoding — fix that.
- Python on Windows: prefer pathlib throughout; if printing paths, ensure stdout/stderr accept UTF-8 (e.g. reconfigure or PYTHONUTF8=1).
`.trim()

export const SCRIPT_CLI_CONTRACT_GLOBAL = `
CLI contract the script MUST implement (argv, not a shell string):
- Global target: the script is invoked with optional [--dry-run] [--param value…] only.
- Do NOT require --root, --recursive, or --input-list. Do not assume a current folder or a file selection.
Honor --dry-run by printing what would change and exiting 0 without writing/deleting.
Do not prompt for GUI input. Write progress to stdout; errors to stderr.
`.trim()

export function scriptCliContract(target: ScriptRunMode): string {
  return target === 'global' ? SCRIPT_CLI_CONTRACT_GLOBAL : SCRIPT_CLI_CONTRACT
}

export function buildScriptSystemPrompt(input: {
  os: string
  runtimes: string[]
  target: ScriptRunMode
  language: 'auto' | ScriptLanguage
  recursive: boolean
}): string {
  const recursiveNote =
    input.target === 'folder' && input.recursive
      ? ' (recursive flag will be passed when the user enables it)'
      : ''
  return [
    'You write local file-manager helper scripts. Output JSON only (no markdown) with keys:',
    'name, description, language, destructive, dryRunSupported, dependencies, source.',
    'name is the label in Script Manager and the context menu — a short Title Case phrase with spaces',
    '(e.g. "File space report"), not a snake_case or kebab-case identifier. Spaces and punctuation are fine.',
    'language must be one of: powershell, python, cmd, bash.',
    'dependencies is an array of pip/module names the user must install themselves — never install packages.',
    'AI never receives user files, paths, or folder listings. Do not ask for them. Do not embed sample paths from the user.',
    `Host OS: ${input.os}. Available runtimes: ${input.runtimes.join(', ') || 'unknown'}.`,
    input.target === 'global'
      ? 'Target mode: global. This script runs from the toolbar with no folder and no selection. Do not generate code that needs --root or --input-list.'
      : `Target mode: ${input.target}${recursiveNote}.`,
    input.language === 'auto'
      ? 'Pick the best language for this OS and the available runtimes.'
      : `Write the script in ${input.language}.`,
    scriptCliContract(input.target),
    SCRIPT_UNICODE_PATH_RULES,
    'Keep the script self-contained. Parse argv yourself. Treat unknown flags as errors.'
  ].join('\n')
}

export function coerceScriptLanguage(raw: unknown): ScriptLanguage | undefined {
  const s = String(raw ?? '')
    .trim()
    .toLowerCase()
  if (s === 'python' || s === 'py') return 'python'
  if (s === 'powershell' || s === 'pwsh' || s === 'ps1') return 'powershell'
  if (s === 'cmd' || s === 'bat' || s === 'batch') return 'cmd'
  if (s === 'bash' || s === 'sh' || s === 'zsh') return 'bash'
  return undefined
}

function sourceFromUnknown(raw: unknown): string | undefined {
  if (typeof raw === 'string' && raw.trim()) return raw
  if (Array.isArray(raw) && raw.every((line) => typeof line === 'string')) {
    const joined = raw.join('\n').trim()
    return joined || undefined
  }
  return undefined
}

function fromEnvelope(obj: Record<string, unknown>): GeneratedScript | null {
  const source = sourceFromUnknown(obj.source)
  if (!source) return null
  const language = coerceScriptLanguage(obj.language) ?? guessLanguage(source)
  const name =
    typeof obj.name === 'string' && obj.name.trim()
      ? obj.name.trim().slice(0, 120)
      : 'Generated script'
  const description = typeof obj.description === 'string' ? obj.description.slice(0, 2000) : ''
  const dependencies = Array.isArray(obj.dependencies)
    ? obj.dependencies.filter((d): d is string => typeof d === 'string').slice(0, 40)
    : []
  return generatedScriptSchema.parse({
    name,
    description,
    language,
    destructive: Boolean(obj.destructive),
    dryRunSupported: Boolean(obj.dryRunSupported),
    dependencies,
    source
  })
}

function isScriptEnvelope(obj: Record<string, unknown>): boolean {
  return 'name' in obj || 'language' in obj || 'source' in obj || 'dryRunSupported' in obj
}

export function extractGeneratedScript(raw: string): GeneratedScript {
  const trimmed = raw.trim()
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const candidate = fenced?.[1]?.trim() ?? trimmed
  const start = candidate.indexOf('{')
  const end = candidate.lastIndexOf('}')
  let envelopeWithoutSource = false
  if (start >= 0 && end > start) {
    try {
      const parsed: unknown = JSON.parse(candidate.slice(start, end + 1))
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        const obj = parsed as Record<string, unknown>
        const fromJson = fromEnvelope(obj)
        if (fromJson) return fromJson
        if (isScriptEnvelope(obj)) envelopeWithoutSource = true
      }
    } catch {
      /* fall through to source-only */
    }
  }
  const looksLikeEnvelope = /"source"\s*:/.test(candidate) && candidate.trimStart().startsWith('{')
  const codeFence = trimmed.match(
    /```(powershell|python|py|pwsh|bash|cmd|bat|json)?\s*([\s\S]*?)```/i
  )
  const fenceLang = (codeFence?.[1] ?? '').toLowerCase()
  if (fenceLang === 'json' || envelopeWithoutSource || (looksLikeEnvelope && !codeFence)) {
    throw new Error(
      'AI returned script metadata JSON that could not be decoded. Try Ask AI to fix again.'
    )
  }
  const source = (codeFence?.[2] ?? trimmed).trim()
  const language = coerceScriptLanguage(fenceLang) ?? guessLanguage(source)
  return generatedScriptSchema.parse({
    name: 'Generated script',
    description: '',
    language,
    destructive: false,
    dryRunSupported: /--dry-run/.test(source),
    dependencies: [],
    source
  })
}

export function guessLanguage(source: string): ScriptLanguage {
  if (/^\s*#/.test(source) && /\$[A-Za-z]|param\s*\(/i.test(source)) return 'powershell'
  if (/^\s*@echo/i.test(source) || /^\s*rem\s/i.test(source)) return 'cmd'
  if (/^\s*#!/.test(source) && /bash|sh/.test(source)) return 'bash'
  if (/\bimport\s+\w+|\bdef\s+\w+\(/.test(source)) return 'python'
  if (/\$PSVersionTable|Get-ChildItem|param\s*\(/i.test(source)) return 'powershell'
  return 'powershell'
}
