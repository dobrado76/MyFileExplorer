import path from 'node:path'
import { normalizeAbsolute } from './security/paths'

export type ExternalOpenRequest = {
  /** Absolute path to a file or folder. */
  path: string
  /**
   * reveal=true: open the containing folder (or the folder itself) and select
   * the path when it is a file — Explorer “Reveal in folder” semantics.
   * reveal=false: open the path as a folder tab (files open their parent).
   */
  reveal: boolean
}

const PROTOCOL = 'mfe:'

/** Strip Electron / packaging argv noise; keep user args and protocol URLs. */
export function userArgv(argv: string[] = process.argv): string[] {
  const out: string[] = []
  for (let i = 1; i < argv.length; i++) {
    const a = argv[i]!
    if (a === '.' || a === '--') continue
    // electron . / electron-vite inject the app path as an arg
    if (a.endsWith('electron.exe') || a.endsWith('electron')) continue
    if (a.endsWith('main') || a.endsWith('index.js') || a.includes('electron-vite')) continue
    if (a === '--allow-file-access-from-files') continue
    if (a.startsWith('--inspect') || a.startsWith('--remote-debugging')) continue
    out.push(a)
  }
  return out
}

function asAbsolute(raw: string): string | null {
  const trimmed = raw.trim().replace(/^"+|"+$/g, '')
  if (!trimmed) return null
  // Protocol URLs are handled separately
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed) && !/^[a-zA-Z]:[\\/]/.test(trimmed)) {
    return null
  }
  // Accept Windows drive (C:\) and UNC (\\server\share) forms as absolute
  if (/^[a-zA-Z]:[\\/]/.test(trimmed) || /^[a-zA-Z]:$/.test(trimmed) || trimmed.startsWith('\\') || trimmed.startsWith('//')) {
    return normalizeAbsolute(trimmed)
  }
  try {
    const resolved = path.isAbsolute(trimmed) ? trimmed : path.resolve(trimmed)
    return normalizeAbsolute(resolved)
  } catch {
    return null
  }
}

/** Parse `mfe://reveal?path=...` / `mfe://open?path=...` / `mfe:reveal?path=...`. */
export function parseProtocolUrl(url: string): ExternalOpenRequest | null {
  try {
    const u = new URL(url)
    if (u.protocol !== PROTOCOL) return null
    // host may be "reveal" / "open", or path "/reveal"
    const action = (u.hostname || u.pathname.replace(/^\//, '').split('/')[0] || '').toLowerCase()
    const rawPath = u.searchParams.get('path') ?? u.searchParams.get('p')
    if (!rawPath) return null
    const abs = asAbsolute(decodeURIComponent(rawPath))
    if (!abs) return null
    if (action === 'reveal' || action === 'show') return { path: abs, reveal: true }
    if (action === 'open' || action === '') return { path: abs, reveal: false }
    // mfe:///C:/foo style (path in pathname)
    return { path: abs, reveal: action !== 'open' }
  } catch {
    return null
  }
}

/**
 * Parse CLI argv for open/reveal intents.
 *
 * Supported:
 *   MyFileExplorer.exe "D:\folder"
 *   MyFileExplorer.exe --reveal "D:\folder\file.txt"
 *   MyFileExplorer.exe --open "D:\folder"
 *   MyFileExplorer.exe mfe://reveal?path=D%3A%5Cfolder%5Cfile.txt
 */
export function parseOpenArgs(argv: string[] = process.argv): ExternalOpenRequest[] {
  const args = userArgv(argv)
  const requests: ExternalOpenRequest[] = []

  for (let i = 0; i < args.length; i++) {
    const a = args[i]!
    if (a.startsWith('mfe:')) {
      const req = parseProtocolUrl(a)
      if (req) requests.push(req)
      continue
    }
    if (a === '--reveal' || a === '-r' || a === '--show') {
      const next = args[++i]
      const abs = next ? asAbsolute(next) : null
      if (abs) requests.push({ path: abs, reveal: true })
      continue
    }
    if (a === '--open' || a === '-o') {
      const next = args[++i]
      const abs = next ? asAbsolute(next) : null
      if (abs) requests.push({ path: abs, reveal: false })
      continue
    }
    if (a.startsWith('-')) continue
    const abs = asAbsolute(a)
    // Bare path defaults to reveal semantics (matches “Reveal in Explorer”).
    if (abs) requests.push({ path: abs, reveal: true })
  }

  return requests
}
