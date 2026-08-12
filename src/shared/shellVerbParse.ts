/**
 * Parse Windows shell `command` strings into D41 executable + argsTemplate.
 * Pure helpers — unit-tested; used by registry discover.
 */

export type ParsedShellCommand = {
  executable: string
  argsTemplate: string
}

/** Split a command line into argv tokens (respects double quotes). */
export function tokenizeCommandLine(command: string): string[] {
  const out: string[] = []
  let cur = ''
  let inQuotes = false
  for (let i = 0; i < command.length; i++) {
    const ch = command[i]!
    if (ch === '"') {
      inQuotes = !inQuotes
      continue
    }
    if (!inQuotes && /\s/.test(ch)) {
      if (cur.length > 0) {
        out.push(cur)
        cur = ''
      }
      continue
    }
    cur += ch
  }
  if (cur.length > 0) out.push(cur)
  return out
}

function stripOuterQuotes(s: string): string {
  return s.replace(/^"+|"+$/g, '')
}

function looksLikeWindowsExe(token: string): boolean {
  return /\.(exe|bat|cmd|com)$/i.test(stripOuterQuotes(token))
}

/** Shell placeholders / switches — stop rejoining the exe path here. */
function looksLikeArgToken(token: string): boolean {
  const t = stripOuterQuotes(token)
  if (/^%\*$/i.test(t) || /^%[0-9]+$/i.test(t) || /^%[LVw]$/i.test(t)) return true
  if (/^--[\w.-]+/.test(t)) return true
  if (/^\/[A-Za-z]/.test(t) && !/^[a-zA-Z]:[\\/]/.test(t)) return true
  if (/^-[A-Za-z]/.test(t) && !/^[a-zA-Z]:[\\/]/.test(t)) return true
  return false
}

/**
 * First token(s) → executable. Unquoted paths with spaces
 * (`C:\Program Files\...\app.exe`) are rejoined until a `.exe`/`.bat`/… token.
 */
export function takeExecutableTokens(tokens: string[]): {
  executable: string
  rest: string[]
} | null {
  if (tokens.length === 0) return null
  let end = 0
  let exe = stripOuterQuotes(tokens[0]!)

  if (!looksLikeWindowsExe(exe)) {
    while (end + 1 < tokens.length) {
      const next = tokens[end + 1]!
      if (looksLikeArgToken(next)) break
      end += 1
      exe = `${exe} ${stripOuterQuotes(next)}`
      if (looksLikeWindowsExe(exe)) break
    }
  }

  return { executable: exe, rest: tokens.slice(end + 1) }
}

function mapArgToken(token: string): string {
  return token
    .replace(/%1/gi, '{path}')
    .replace(/%L/gi, '{path}')
    .replace(/%V/gi, '{dir}')
    .replace(/%W/gi, '{dir}')
    .replace(/%\*/g, '{paths}')
}

/**
 * Try to map a registry `command` value to an absolute-ish exe + D41 args template.
 * Returns null when the command cannot be launched via `shell:exec` safely.
 */
export function parseShellCommandLine(command: string): ParsedShellCommand | null {
  const trimmed = command.trim()
  if (!trimmed) return null
  if (/^ms-settings:/i.test(trimmed)) return null
  if (/^microsoft-/i.test(trimmed) && !/\.exe/i.test(trimmed)) return null

  const tokens = tokenizeCommandLine(trimmed)
  const split = takeExecutableTokens(tokens)
  if (!split) return null

  const exeBase = split.executable
  if (/^rundll32(\.exe)?$/i.test(exeBase.replace(/^.*[\\/]/, ''))) {
    return null
  }
  if (/DelegateExecute/i.test(trimmed) && tokens.length === 1) {
    return null
  }

  const args = split.rest.map(mapArgToken)
  // Drop leftover %n placeholders we don't map (often unused)
  const cleaned = args.filter((a) => !/^%\d+$/i.test(a))

  return {
    executable: exeBase,
    argsTemplate: cleaned.length > 0 ? cleaned.join(' ') : '{path}'
  }
}

/** Normalize exe for dedupe (lowercase, collapse slashes, strip quotes). */
export function normalizeExecutableKey(executable: string): string {
  return executable
    .trim()
    .replace(/^"+|"+$/g, '')
    .replace(/\//g, '\\')
    .toLowerCase()
}

export function sameCustomCommand(
  a: { executable: string; label: string },
  b: { executable: string; label: string }
): boolean {
  return (
    normalizeExecutableKey(a.executable) === normalizeExecutableKey(b.executable) &&
    a.label.trim().toLowerCase() === b.label.trim().toLowerCase()
  )
}

export function discoverVerbId(registryKey: string, verbKey: string): string {
  const raw = `${registryKey}\\${verbKey}`.toLowerCase()
  let h = 2166136261
  for (let i = 0; i < raw.length; i++) {
    h ^= raw.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return `sv-${(h >>> 0).toString(16)}`
}
