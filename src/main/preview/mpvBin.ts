/**
 * Resolve mpv.exe for opt-in Rich player (D33).
 * Order: MFE_MPV → beside installed exe → resources/mpv → tools/mpv (dev) → PATH.
 */
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { app } from 'electron'

function existsFile(p: string): boolean {
  try {
    return fs.statSync(p).isFile()
  } catch {
    return false
  }
}

function candidateDevRoots(): string[] {
  const roots = new Set<string>()
  try {
    roots.add(process.cwd())
  } catch {
    /* ignore */
  }
  try {
    roots.add(path.resolve(app.getAppPath(), '..', '..'))
  } catch {
    /* ignore */
  }
  try {
    roots.add(path.resolve(app.getAppPath(), '..'))
  } catch {
    /* ignore */
  }
  return [...roots]
}

function pathLookupMpv(): string | null {
  if (process.platform !== 'win32') {
    try {
      const out = execFileSync('which', ['mpv'], { encoding: 'utf8' }).trim()
      return out && existsFile(out) ? out : null
    } catch {
      return null
    }
  }
  try {
    const out = execFileSync('where.exe', ['mpv'], {
      encoding: 'utf8',
      windowsHide: true
    })
    const first = out
      .split(/\r?\n/)
      .map((l) => l.trim())
      .find((l) => l.toLowerCase().endsWith('mpv.exe') && existsFile(l))
    return first ?? null
  } catch {
    return null
  }
}

let cached: string | null | undefined

/** Absolute path to mpv, or null when unavailable. */
export function resolveMpvPath(): string | null {
  if (cached !== undefined) return cached

  const override = process.env['MFE_MPV']?.trim()
  if (override && existsFile(override)) {
    cached = path.resolve(override)
    return cached
  }

  const names = process.platform === 'win32' ? ['mpv.exe'] : ['mpv']
  const dirs: string[] = []

  try {
    dirs.push(path.dirname(process.execPath))
    dirs.push(path.join(path.dirname(process.execPath), 'mpv'))
  } catch {
    /* ignore */
  }

  try {
    dirs.push(path.join(process.resourcesPath, 'mpv'))
  } catch {
    /* ignore */
  }

  if (!app.isPackaged) {
    for (const root of candidateDevRoots()) {
      dirs.push(path.join(root, 'tools', 'mpv'))
    }
  }

  for (const dir of dirs) {
    for (const name of names) {
      const candidate = path.join(dir, name)
      if (existsFile(candidate)) {
        cached = candidate
        return cached
      }
    }
  }

  cached = pathLookupMpv()
  return cached
}

/** Drop cached resolve (tests / after fetch). */
export function clearMpvPathCache(): void {
  cached = undefined
}

export function mpvAvailable(): boolean {
  return resolveMpvPath() !== null
}

/** OSC always on while windowed in the docked pane; detached/Now Playing toggle via IPC. Auto in fullscreen. */
const OSC_WINDOWED_LUA = `-- MFE Rich player (D33)
local function apply(fs)
  mp.commandv('script-message', 'osc-visibility', fs and 'auto' or 'always', 'no-osd')
end
mp.observe_property('fullscreen', 'bool', function(_, fs)
  apply(fs == true)
end)
apply(false)
`

export function ensureMpvOscScript(): string {
  const dir = path.join(app.getPath('userData'), 'mpv')
  fs.mkdirSync(dir, { recursive: true })
  const file = path.join(dir, 'osc-windowed.lua')
  fs.writeFileSync(file, OSC_WINDOWED_LUA, 'utf8')
  return file
}
