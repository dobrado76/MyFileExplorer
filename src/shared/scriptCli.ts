import type { ScriptLanguage, ScriptParamType } from './schemas/scripts'

export type ScriptCliMode = 'folder' | 'selection'

export type ScriptCliOptions = {
  mode: ScriptCliMode
  root?: string
  manifestPath?: string
  recursive?: boolean
  dryRun?: boolean
  params?: Record<string, string | number | boolean>
}

/**
 * Stable argv after the interpreter invocation (script path is prepended by the runner).
 * Folder: `--root <folder> [--recursive] [--dry-run] [--param value…]`
 * Selection: `--input-list <manifest> [--dry-run] [--param value…]`
 */
export function buildScriptCliArgs(opts: ScriptCliOptions): string[] {
  const args: string[] = []
  if (opts.mode === 'folder') {
    if (!opts.root) throw new Error('Folder scripts require --root')
    args.push('--root', opts.root)
    if (opts.recursive) args.push('--recursive')
  } else {
    if (!opts.manifestPath) throw new Error('Selection scripts require --input-list')
    args.push('--input-list', opts.manifestPath)
  }
  if (opts.dryRun) args.push('--dry-run')
  if (opts.params) {
    for (const [key, value] of Object.entries(opts.params)) {
      if (!/^[A-Za-z][A-Za-z0-9_-]*$/.test(key)) continue
      if (typeof value === 'boolean') {
        if (value) args.push(`--${key}`)
        continue
      }
      args.push(`--${key}`, String(value))
    }
  }
  return args
}

/** UTF-8 manifest: one absolute path per line. Empty lines ignored by readers. */
export function formatInputManifest(paths: string[]): string {
  return paths.map((p) => p.replace(/\r?\n/g, '')).join('\n') + (paths.length > 0 ? '\n' : '')
}

export function parseInputManifest(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
}

export type RuntimeKind = 'powershell' | 'pwsh' | 'python' | 'py' | 'cmd' | 'bash'

export type InterpreterOverrides = {
  powershell?: string
  pwsh?: string
  python?: string
  cmd?: string
  bash?: string
}

export type SpawnPlan = {
  executable: string
  args: string[]
  runtime: RuntimeKind
}

/**
 * Build executable + argv (no `shell: true`). `cliArgs` already includes --root / --input-list.
 */
export function buildSpawnPlan(input: {
  language: ScriptLanguage
  scriptPath: string
  cliArgs: string[]
  available: Partial<Record<RuntimeKind, string>>
  overrides?: InterpreterOverrides
  preferredInterpreter?: string
}): SpawnPlan {
  const override =
    input.preferredInterpreter && input.preferredInterpreter !== 'auto'
      ? input.preferredInterpreter
      : undefined

  if (input.language === 'powershell') {
    const exe =
      override ||
      input.overrides?.powershell ||
      input.available.powershell ||
      input.overrides?.pwsh ||
      input.available.pwsh
    if (!exe) throw new Error('PowerShell was not found on PATH')
    const runtime: RuntimeKind = /pwsh/i.test(exe) ? 'pwsh' : 'powershell'
    return {
      executable: exe,
      args: ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', input.scriptPath, ...input.cliArgs],
      runtime
    }
  }

  if (input.language === 'python') {
    const exe = override || input.overrides?.python || input.available.python || input.available.py
    if (!exe) throw new Error('Python was not found on PATH')
    const runtime: RuntimeKind = /(?:^|[\\/])py(?:\.exe)?$/i.test(exe) ? 'py' : 'python'
    const prefix = runtime === 'py' ? ['-3'] : []
    return {
      executable: exe,
      args: [...prefix, input.scriptPath, ...input.cliArgs],
      runtime
    }
  }

  if (input.language === 'cmd') {
    const exe = override || input.overrides?.cmd || input.available.cmd || 'cmd.exe'
    return {
      executable: exe,
      args: ['/d', '/s', '/c', input.scriptPath, ...input.cliArgs],
      runtime: 'cmd'
    }
  }

  const exe = override || input.overrides?.bash || input.available.bash || 'bash'
  return {
    executable: exe,
    args: [input.scriptPath, ...input.cliArgs],
    runtime: 'bash'
  }
}

export function coerceParamValue(
  type: ScriptParamType,
  raw: string | number | boolean | undefined
): string | number | boolean | undefined {
  if (raw === undefined) return undefined
  if (type === 'bool') {
    if (typeof raw === 'boolean') return raw
    if (typeof raw === 'number') return raw !== 0
    const s = String(raw).trim().toLowerCase()
    return s === '1' || s === 'true' || s === 'yes' || s === 'on'
  }
  if (type === 'int') {
    const n = typeof raw === 'number' ? raw : Number.parseInt(String(raw), 10)
    if (!Number.isFinite(n)) throw new Error('Expected an integer')
    return Math.trunc(n)
  }
  if (type === 'float') {
    const n = typeof raw === 'number' ? raw : Number.parseFloat(String(raw))
    if (!Number.isFinite(n)) throw new Error('Expected a number')
    return n
  }
  return String(raw)
}

/** Suggested install line for a declared dependency (never auto-run). */
export function dependencyInstallCommand(language: ScriptLanguage, dep: string): string {
  const name = dep.trim()
  if (!name) return ''
  if (language === 'python') return `pip install ${name}`
  if (language === 'powershell') return `Install-Module -Name ${name}`
  return name
}
