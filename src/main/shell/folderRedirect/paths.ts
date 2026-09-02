import fs from 'node:fs'
import path from 'node:path'
import { app } from 'electron'

export function shellRedirectDir(): string {
  const dir = path.join(app.getPath('userData'), 'shell-redirect')
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

export function shellRedirectStatePath(): string {
  return path.join(shellRedirectDir(), 'state.json')
}

export function shellRedirectBackupManifestPath(): string {
  return path.join(shellRedirectDir(), 'backup.json')
}

export function shellRedirectInvocationsPath(): string {
  return path.join(shellRedirectDir(), 'invocations.jsonl')
}

/** Absolute path to MyFileExplorer / Electron for the launcher to spawn (dev-friendly). */
export function shellRedirectTargetExePath(): string {
  return path.join(shellRedirectDir(), 'target-exe.txt')
}

export function shellRedirectRegFragmentPath(subtree: string): string {
  const safe = subtree.replace(/\\/g, '-')
  return path.join(shellRedirectDir(), `${safe}.reg`)
}

function candidateDevLauncherPaths(): string[] {
  const roots = new Set<string>()
  try {
    roots.add(process.cwd())
  } catch {
    /* ignore */
  }
  try {
    // electron-vite: app.getAppPath() → …/out/main or project root
    roots.add(path.resolve(app.getAppPath(), '..', '..'))
    roots.add(path.resolve(app.getAppPath(), '..'))
    roots.add(app.getAppPath())
  } catch {
    /* ignore */
  }
  const out: string[] = []
  for (const root of roots) {
    out.push(path.join(root, 'tools', 'MfeShellLauncher', 'publish', 'MfeShellLauncher.exe'))
  }
  return out
}

/**
 * Resolve MfeShellLauncher.exe: env override, beside the running exe (install),
 * then repo `tools/MfeShellLauncher/publish` when running unpackaged (`npm run dev`).
 */
export function resolveLauncherPath(): string {
  const override = process.env['MFE_SHELL_LAUNCHER']?.trim()
  if (override) return path.resolve(override)

  const besideExe = path.join(path.dirname(process.execPath), 'MfeShellLauncher.exe')
  if (fs.existsSync(besideExe)) return besideExe

  if (!app.isPackaged) {
    for (const candidate of candidateDevLauncherPaths()) {
      if (fs.existsSync(candidate)) return candidate
    }
  }

  return besideExe
}

export function resolveMfeExePath(): string {
  return process.execPath
}

/**
 * Persist how the launcher should start MFE.
 * Line 1 = executable. Further lines = argv prefix before --open/--reveal
 * (needed for `npm run dev`: electron.exe + app entry path).
 */
export function writeShellRedirectTargetExe(exePath: string = resolveMfeExePath()): void {
  const lines = [exePath.trim()]
  // Unpackaged Electron: argv is [electron.exe, <app path>, …userflags]
  // Prefer a concrete entry file (out/main/…) over bare project `.` when both appear.
  if (!app.isPackaged || process.defaultApp) {
    const candidates: string[] = []
    for (let i = 1; i < Math.min(process.argv.length, 6); i++) {
      const a = process.argv[i]?.trim()
      if (!a || a.startsWith('-')) continue
      try {
        const resolved = path.resolve(a)
        if (fs.existsSync(resolved)) candidates.push(resolved)
      } catch {
        /* ignore */
      }
    }
    const preferred =
      candidates.find((c) => /\.(js|mjs|cjs)$/i.test(c)) ??
      candidates.find((c) => {
        try {
          return fs.statSync(c).isFile()
        } catch {
          return false
        }
      }) ??
      candidates[0]
    if (preferred) lines.push(preferred)
  }
  fs.writeFileSync(shellRedirectTargetExePath(), lines.join('\n') + '\n', 'utf8')
}
