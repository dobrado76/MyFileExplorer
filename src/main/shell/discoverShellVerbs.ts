/**
 * Scan static HKCR shell verbs (read-only). Never loads COM ContextMenuHandlers.
 */
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { DiscoveredShellVerb, DiscoverShellVerbsResponse } from '@shared/schemas/shellVerbs'
import {
  discoverVerbId,
  parseShellCommandLine
} from '@shared/shellVerbParse'

const execFileAsync = promisify(execFile)

type ShellRoot = {
  /** Path under HKCR, e.g. `*\shell` or `Directory\shell` */
  shellPath: string
  targetKind: DiscoveredShellVerb['targetKind']
  targetHint: string
  extensions: string[] | null
}

const STATIC_ROOTS: ShellRoot[] = [
  { shellPath: '*\\shell', targetKind: 'files', targetHint: '*', extensions: null },
  { shellPath: 'Directory\\shell', targetKind: 'folders', targetHint: 'Directory', extensions: null },
  {
    shellPath: 'Directory\\Background\\shell',
    targetKind: 'folders',
    targetHint: 'Directory\\Background',
    extensions: null
  },
  { shellPath: 'Folder\\shell', targetKind: 'folders', targetHint: 'Folder', extensions: null },
  { shellPath: 'Drive\\shell', targetKind: 'folders', targetHint: 'Drive', extensions: null }
]

/** Common associations worth scanning (ProgID / SystemFileAssociations). */
const EXTRA_FILE_HINTS: Array<{ shellPath: string; hint: string; extensions: string[] }> = [
  { shellPath: 'SystemFileAssociations\\.txt\\shell', hint: '.txt', extensions: ['txt'] },
  { shellPath: 'SystemFileAssociations\\.png\\shell', hint: '.png', extensions: ['png'] },
  { shellPath: 'SystemFileAssociations\\.jpg\\shell', hint: '.jpg', extensions: ['jpg', 'jpeg'] },
  { shellPath: 'SystemFileAssociations\\.jpeg\\shell', hint: '.jpeg', extensions: ['jpeg', 'jpg'] },
  { shellPath: 'SystemFileAssociations\\.pdf\\shell', hint: '.pdf', extensions: ['pdf'] },
  { shellPath: 'SystemFileAssociations\\.mp4\\shell', hint: '.mp4', extensions: ['mp4'] },
  { shellPath: 'SystemFileAssociations\\.mp3\\shell', hint: '.mp3', extensions: ['mp3'] },
  { shellPath: 'SystemFileAssociations\\.docx\\shell', hint: '.docx', extensions: ['docx'] },
  { shellPath: 'SystemFileAssociations\\.zip\\shell', hint: '.zip', extensions: ['zip'] },
  { shellPath: 'txtfile\\shell', hint: 'txtfile', extensions: ['txt'] },
  { shellPath: 'jpegfile\\shell', hint: 'jpegfile', extensions: ['jpg', 'jpeg'] },
  { shellPath: 'pngfile\\shell', hint: 'pngfile', extensions: ['png'] }
]

function expandHive(key: string): string {
  return key.replace(/^HKCR\\/i, 'HKEY_CLASSES_ROOT\\').replace(/^HKCU\\/i, 'HKEY_CURRENT_USER\\')
}

async function regQuery(key: string, args: string[] = []): Promise<string> {
  try {
    const { stdout } = await execFileAsync('reg.exe', ['query', key, ...args], {
      windowsHide: true,
      encoding: 'utf8',
      timeout: 8_000,
      maxBuffer: 4 * 1024 * 1024
    })
    return typeof stdout === 'string' ? stdout : ''
  } catch {
    return ''
  }
}

function parseRegValues(stdout: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const line of stdout.split(/\r?\n/)) {
    const m = /^\s*(\(Default\)|[^\s]+)\s+REG_\w+\s+(.*)$/i.exec(line)
    if (!m) continue
    const name = m[1] === '(Default)' ? '' : m[1]!
    out[name] = (m[2] ?? '').trim()
  }
  return out
}

function listSubkeyNames(stdout: string, parentKey: string): string[] {
  const parentNorm = expandHive(parentKey).replace(/\\+$/, '').toUpperCase()
  const names: string[] = []
  for (const line of stdout.split(/\r?\n/)) {
    const t = line.trim()
    if (!t.toUpperCase().startsWith('HKEY_')) continue
    const upper = t.toUpperCase()
    if (!upper.startsWith(parentNorm + '\\')) continue
    const rest = t.slice(expandHive(parentKey).length).replace(/^\\/, '')
    if (!rest || rest.includes('\\')) continue
    names.push(rest)
  }
  return names
}

function friendlyLabel(values: Record<string, string>, verbKey: string): string {
  const mui = values.MUIVerb || values.MuiVerb
  const def = values[''] || values['(Default)']
  const raw = (mui || def || verbKey).trim()
  // Keep @dll,-id as-is if we cannot resolve
  if (raw.startsWith('@')) {
    return def && !def.startsWith('@') ? def : verbKey
  }
  return raw || verbKey
}

function isSkippedVerb(verbKey: string, values: Record<string, string>): {
  skip: boolean
  advanced: boolean
} {
  const lower = verbKey.toLowerCase()
  if (lower === 'open' || lower === 'openas' || lower === 'opennewprocess') {
    // Default open is already covered by built-in "Open with default app"
    return { skip: true, advanced: false }
  }
  if (values.LegacyDisable != null && values.LegacyDisable !== '') {
    return { skip: true, advanced: false }
  }
  const advanced =
    values.Extended != null ||
    values.ProgrammaticAccessOnly != null ||
    lower === 'pintohome' ||
    lower === 'pintostartscreen'
  return { skip: false, advanced }
}

async function readVerb(
  root: ShellRoot,
  verbKey: string
): Promise<DiscoveredShellVerb | null> {
  const verbKeyPath = `HKCR\\${root.shellPath}\\${verbKey}`
  const valuesOut = await regQuery(verbKeyPath)
  const values = parseRegValues(valuesOut)
  const { skip, advanced } = isSkippedVerb(verbKey, values)
  if (skip) return null

  const commandOut = await regQuery(`${verbKeyPath}\\command`)
  const commandValues = parseRegValues(commandOut)
  const command = (commandValues[''] || commandValues['(Default)'] || '').trim()
  const hasDelegate = Object.keys(values).some((k) => /DelegateExecute/i.test(k)) ||
    Object.keys(commandValues).some((k) => /DelegateExecute/i.test(k))

  const label = friendlyLabel(values, verbKey)
  const id = discoverVerbId(`HKCR\\${root.shellPath}`, verbKey)

  if (!command) {
    return {
      id,
      label,
      verbKey,
      registryKey: verbKeyPath,
      targetKind: root.targetKind,
      targetHint: root.targetHint,
      commandPreview: hasDelegate ? '(DelegateExecute)' : '',
      executable: null,
      argsTemplate: null,
      extensions: root.extensions,
      supported: false,
      unsupportedReason: hasDelegate
        ? 'COM / DelegateExecute only — cannot import'
        : 'No command string',
      advanced
    }
  }

  const parsed = parseShellCommandLine(command)
  if (!parsed) {
    return {
      id,
      label,
      verbKey,
      registryKey: verbKeyPath,
      targetKind: root.targetKind,
      targetHint: root.targetHint,
      commandPreview: command,
      executable: null,
      argsTemplate: null,
      extensions: root.extensions,
      supported: false,
      unsupportedReason: 'Unsupported command (rundll32 / protocol / opaque)',
      advanced
    }
  }

  return {
    id,
    label,
    verbKey,
    registryKey: verbKeyPath,
    targetKind: root.targetKind,
    targetHint: root.targetHint,
    commandPreview: command,
    executable: parsed.executable,
    argsTemplate: parsed.argsTemplate,
    extensions: root.extensions,
    supported: true,
    advanced
  }
}

async function scanShellRoot(root: ShellRoot): Promise<DiscoveredShellVerb[]> {
  const key = `HKCR\\${root.shellPath}`
  const listOut = await regQuery(key)
  if (!listOut) return []
  const verbs = listSubkeyNames(listOut, key)
  const out: DiscoveredShellVerb[] = []
  // Bound concurrency
  const chunk = 6
  for (let i = 0; i < verbs.length; i += chunk) {
    const batch = verbs.slice(i, i + chunk)
    const part = await Promise.all(batch.map((v) => readVerb(root, v)))
    for (const p of part) {
      if (p) out.push(p)
    }
  }
  return out
}

async function scanApplications(): Promise<DiscoveredShellVerb[]> {
  const key = 'HKCR\\Applications'
  const listOut = await regQuery(key)
  if (!listOut) return []
  const apps = listSubkeyNames(listOut, key).filter((n) => /\.exe$/i.test(n))
  const out: DiscoveredShellVerb[] = []
  const chunk = 5
  const limited = apps.slice(0, 80)
  for (let i = 0; i < limited.length; i += chunk) {
    const batch = limited.slice(i, i + chunk)
    await Promise.all(
      batch.map(async (app) => {
        const shellKey = `HKCR\\Applications\\${app}\\shell`
        const shells = listSubkeyNames(await regQuery(shellKey), shellKey)
        const openVerb = shells.find((s) => s.toLowerCase() === 'open') ?? shells[0]
        if (!openVerb) return
        const verb = await readVerb(
          {
            shellPath: `Applications\\${app}\\shell`,
            targetKind: 'files',
            targetHint: app,
            extensions: null
          },
          openVerb
        )
        if (!verb) return
        // Prefer app exe name as label when registry label is generic "Open"
        if (/^open$/i.test(verb.label)) {
          verb.label = app.replace(/\.exe$/i, '')
        }
        out.push(verb)
      })
    )
  }
  return out
}

function dedupeVerbs(verbs: DiscoveredShellVerb[]): DiscoveredShellVerb[] {
  const seen = new Set<string>()
  const out: DiscoveredShellVerb[] = []
  for (const v of verbs) {
    const key = v.supported
      ? `s:${v.executable?.toLowerCase()}|${v.label.toLowerCase()}|${v.targetHint}`
      : `u:${v.registryKey.toLowerCase()}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(v)
  }
  out.sort((a, b) => {
    if (a.supported !== b.supported) return a.supported ? -1 : 1
    return a.label.localeCompare(b.label, undefined, { sensitivity: 'base' })
  })
  return out
}

export async function discoverShellVerbs(): Promise<DiscoverShellVerbsResponse> {
  if (process.platform !== 'win32') {
    return { verbs: [], scannedKeys: 0, platform: 'other' }
  }

  const roots: ShellRoot[] = [
    ...STATIC_ROOTS,
    ...EXTRA_FILE_HINTS.map((h) => ({
      shellPath: h.shellPath,
      targetKind: 'files' as const,
      targetHint: h.hint,
      extensions: h.extensions
    }))
  ]

  const batches = await Promise.all([
    ...roots.map((r) => scanShellRoot(r)),
    scanApplications()
  ])
  const flat = batches.flat()
  const verbs = dedupeVerbs(flat)
  return {
    verbs,
    scannedKeys: roots.length + 1,
    platform: 'win32'
  }
}
