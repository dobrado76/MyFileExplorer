import { execFile } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { promisify } from 'node:util'
import type { InterpreterOverrides, RuntimeKind } from '@shared/scriptCli'
import { getSettings } from '../settings/store'

const execFileAsync = promisify(execFile)

export type DetectedRuntime = {
  kind: RuntimeKind
  command: string
  available: boolean
}

const CANDIDATES: { kind: RuntimeKind; names: string[] }[] = [
  { kind: 'powershell', names: process.platform === 'win32' ? ['powershell.exe', 'powershell'] : ['powershell'] },
  { kind: 'pwsh', names: process.platform === 'win32' ? ['pwsh.exe', 'pwsh'] : ['pwsh'] },
  { kind: 'python', names: process.platform === 'win32' ? ['python.exe', 'python'] : ['python3', 'python'] },
  { kind: 'py', names: process.platform === 'win32' ? ['py.exe', 'py'] : [] },
  { kind: 'cmd', names: process.platform === 'win32' ? ['cmd.exe'] : [] },
  { kind: 'bash', names: process.platform === 'win32' ? ['bash.exe', 'bash'] : ['bash'] }
]

function whichSync(name: string): string | null {
  if (!name) return null
  if (path.isAbsolute(name) && fs.existsSync(name)) return name
  const pathEnv = process.env.PATH ?? ''
  const dirs = pathEnv.split(path.delimiter).filter(Boolean)
  const exts =
    process.platform === 'win32'
      ? (process.env.PATHEXT ?? '.EXE;.CMD;.BAT;.COM').split(';').filter(Boolean)
      : ['']
  for (const dir of dirs) {
    if (process.platform === 'win32') {
      for (const ext of exts) {
        const candidate = path.join(dir, name.toLowerCase().endsWith(ext.toLowerCase()) ? name : name + ext)
        if (fs.existsSync(candidate)) return candidate
      }
    } else {
      const candidate = path.join(dir, name)
      try {
        fs.accessSync(candidate, fs.constants.X_OK)
        return candidate
      } catch {
        /* continue */
      }
    }
  }
  return null
}

export function resolveOnPath(name: string): string | null {
  return whichSync(name)
}

export function interpreterOverridesFromSettings(): InterpreterOverrides {
  const o = getSettings().scripts.interpreterOverrides
  return {
    powershell: o.powershell || undefined,
    pwsh: o.pwsh || undefined,
    python: o.python || undefined,
    cmd: o.cmd || undefined,
    bash: o.bash || undefined
  }
}

export function detectRuntimes(overrides?: InterpreterOverrides): DetectedRuntime[] {
  const ov = overrides ?? interpreterOverridesFromSettings()
  const out: DetectedRuntime[] = []
  for (const { kind, names } of CANDIDATES) {
    const forced = ov[kind === 'py' ? 'python' : kind]
    if (forced) {
      const resolved = path.isAbsolute(forced)
        ? fs.existsSync(forced)
          ? forced
          : null
        : resolveOnPath(forced)
      out.push({ kind, command: resolved ?? forced, available: !!resolved })
      continue
    }
    let found: string | null = null
    for (const name of names) {
      found = resolveOnPath(name)
      if (found) break
    }
    out.push({
      kind,
      command: found ?? names[0] ?? kind,
      available: !!found
    })
  }
  return out
}

export function availableRuntimeMap(
  detected: DetectedRuntime[] = detectRuntimes()
): Partial<Record<RuntimeKind, string>> {
  const map: Partial<Record<RuntimeKind, string>> = {}
  for (const r of detected) {
    if (r.available) map[r.kind] = r.command
  }
  return map
}

/** Best-effort version string for the generate UI (never sent to AI unless we choose to). */
export async function runtimeVersion(command: string, kind: RuntimeKind): Promise<string> {
  try {
    const args = kind === 'py' ? ['-3', '--version'] : ['--version']
    const { stdout, stderr } = await execFileAsync(command, args, {
      timeout: 4000,
      windowsHide: true
    })
    return `${stdout || stderr}`.trim().split(/\r?\n/)[0] ?? ''
  } catch {
    return ''
  }
}
