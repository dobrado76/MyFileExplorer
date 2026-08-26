/**
 * Identify processes locking a file/folder, and end a locker when the user asks.
 *
 * Primary: Windows Restart Manager (same family of APIs Explorer uses).
 * Fallback: Win32_Process scan for ExecutablePath / CommandLine referencing the path
 * (catches many “app has this folder open” cases RM misses on directories).
 *
 * There is no safe public Win32 API to close another process’s handles without its
 * cooperation — “unlock” means ask the user to End Task (or close the app themselves).
 */
import { execFile } from 'node:child_process'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'
import koffi from 'koffi'
import { AppError } from '@shared/result'
import type { LockingProcess } from '@shared/schemas/lockers'

const execFileAsync = promisify(execFile)

export type { LockingProcess }

const ERROR_MORE_DATA = 234
const MAX_SAMPLE_FILES = 400
const MAX_WALK_DEPTH = 6

/** Kernel / session hosts — never offer End Task on these. */
const PROTECTED_PROCESS_NAMES = new Set([
  'system',
  'smss',
  'csrss',
  'wininit',
  'services',
  'lsass',
  'winlogon',
  'svchost',
  'fontdrvhost',
  'dwm',
  'sihost',
  'taskhostw',
  'explorer' // ending Explorer is rarely what the user wants for a file lock
])

type RmApi = {
  RmStartSession: (pSessionHandle: [number], dwSessionFlags: number, strSessionKey: Buffer) => number
  RmRegisterResources: (
    dwSessionHandle: number,
    nFiles: number,
    rgsFilenames: string[],
    nApplications: number,
    rgApplications: null,
    nServices: number,
    rgsServiceNames: null
  ) => number
  RmGetList: (
    dwSessionHandle: number,
    pnProcInfoNeeded: [number],
    pnProcInfo: [number],
    rgAffectedApps: Buffer | null,
    lpdwRebootReasons: [number]
  ) => number
  RmEndSession: (dwSessionHandle: number) => number
  sizeofInfo: number
  decodeInfo: (buf: Buffer, index: number) => LockingProcess | null
}

let api: RmApi | null | undefined

function ensureApi(): RmApi | null {
  if (api !== undefined) return api
  if (process.platform !== 'win32') {
    api = null
    return null
  }

  const rstrtmgr = koffi.load('rstrtmgr.dll')

  const FILETIME = koffi.struct('MfeRmFILETIME', {
    dwLowDateTime: 'uint32',
    dwHighDateTime: 'uint32'
  })
  const RM_UNIQUE_PROCESS = koffi.struct('MfeRM_UNIQUE_PROCESS', {
    dwProcessId: 'uint32',
    ProcessStartTime: FILETIME
  })
  const RM_PROCESS_INFO = koffi.struct('MfeRM_PROCESS_INFO', {
    Process: RM_UNIQUE_PROCESS,
    strAppName: koffi.array('char16', 256),
    strServiceShortName: koffi.array('char16', 64),
    ApplicationType: 'int32',
    AppStatus: 'uint32',
    TSSessionId: 'uint32',
    bRestartable: 'int32'
  })
  const sizeofInfo = koffi.sizeof(RM_PROCESS_INFO)

  api = {
    RmStartSession: rstrtmgr.func(
      'uint32 __stdcall RmStartSession(_Out_ uint32 *pSessionHandle, uint32 dwSessionFlags, _Out_ void *strSessionKey)'
    ),
    RmRegisterResources: rstrtmgr.func(
      'uint32 __stdcall RmRegisterResources(uint32 dwSessionHandle, uint32 nFiles, str16 *rgsFilenames, uint32 nApplications, void *rgApplications, uint32 nServices, void *rgsServiceNames)'
    ),
    RmGetList: rstrtmgr.func(
      'uint32 __stdcall RmGetList(uint32 dwSessionHandle, _Out_ uint32 *pnProcInfoNeeded, _Inout_ uint32 *pnProcInfo, _Out_ void *rgAffectedApps, _Out_ uint32 *lpdwRebootReasons)'
    ),
    RmEndSession: rstrtmgr.func('uint32 __stdcall RmEndSession(uint32 dwSessionHandle)'),
    sizeofInfo,
    decodeInfo(buf, index) {
      try {
        const info = koffi.decode(buf, index * sizeofInfo, RM_PROCESS_INFO) as {
          Process: { dwProcessId: number }
          strAppName: string | number[]
        }
        const pid = info.Process.dwProcessId
        if (!pid) return null
        let name = ''
        if (typeof info.strAppName === 'string') {
          name = info.strAppName.replace(/\0+$/g, '').trim()
        } else if (Array.isArray(info.strAppName)) {
          name = decodeWz(info.strAppName)
        }
        return { pid, name: name || `PID ${pid}` }
      } catch {
        return null
      }
    }
  }
  return api
}

function decodeWz(words: number[]): string {
  let out = ''
  for (const w of words) {
    if (w === 0) break
    out += String.fromCharCode(w)
  }
  return out.trim()
}

async function samplePathsUnder(root: string): Promise<string[]> {
  const out: string[] = []
  const walk = async (dir: string, depth: number): Promise<void> => {
    if (out.length >= MAX_SAMPLE_FILES || depth > MAX_WALK_DEPTH) return
    let entries: import('node:fs').Dirent[]
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const ent of entries) {
      if (out.length >= MAX_SAMPLE_FILES) return
      const full = path.join(dir, ent.name)
      if (ent.isDirectory()) {
        await walk(full, depth + 1)
      } else if (ent.isFile() || ent.isSymbolicLink()) {
        out.push(full)
      }
    }
  }
  await walk(root, 0)
  return out
}

/** Collect RM resource paths for a file or folder (files only — RM rejects directories). */
export async function collectLockCheckPaths(targetPath: string): Promise<string[]> {
  try {
    const st = await fsp.stat(targetPath)
    if (st.isDirectory()) return samplePathsUnder(targetPath)
    return [targetPath]
  } catch {
    return [targetPath]
  }
}

function queryRestartManager(files: string[]): LockingProcess[] {
  const lib = ensureApi()
  if (!lib || files.length === 0) return []

  const sessionHandle: [number] = [0]
  const sessionKey = Buffer.alloc(33 * 2)
  const start = lib.RmStartSession(sessionHandle, 0, sessionKey)
  if (start !== 0) return []

  const handle = sessionHandle[0]!
  try {
    const reg = lib.RmRegisterResources(handle, files.length, files, 0, null, 0, null)
    if (reg !== 0) return []

    const needed: [number] = [0]
    const count: [number] = [0]
    const reasons: [number] = [0]
    let res = lib.RmGetList(handle, needed, count, null, reasons)
    if (res !== 0 && res !== ERROR_MORE_DATA) return []
    if (needed[0] === 0) return []

    const n = needed[0]!
    const buf = Buffer.alloc(lib.sizeofInfo * n)
    count[0] = n
    res = lib.RmGetList(handle, needed, count, buf, reasons)
    if (res !== 0) return []

    const got = count[0]!
    const byPid = new Map<number, LockingProcess>()
    for (let i = 0; i < got; i++) {
      const info = lib.decodeInfo(buf, i)
      if (!info || byPid.has(info.pid)) continue
      byPid.set(info.pid, info)
    }
    return [...byPid.values()]
  } finally {
    lib.RmEndSession(handle)
  }
}

/** Shell hosts that often appear as false lockers (cwd / our own scan cmdline). */
function isIgnorableLockerName(name: string): boolean {
  const n = name.toLowerCase().replace(/\.exe$/i, '')
  return (
    n === 'powershell' ||
    n === 'pwsh' ||
    n === 'conhost' ||
    n === 'cmd' ||
    n === 'windowsterminal' ||
    n === 'openconsole'
  )
}

function baseNameLower(name: string): string {
  return path.basename(name).toLowerCase().replace(/\.exe$/i, '')
}

export function isProtectedLocker(p: LockingProcess): boolean {
  if (p.pid <= 4 || p.pid === process.pid) return true
  return PROTECTED_PROCESS_NAMES.has(baseNameLower(p.name))
}

/**
 * Processes whose executable or command line references the path.
 * Helps when RM returns empty for directory locks.
 *
 * Important: the scan itself is a PowerShell process whose -Command contains the
 * path — that must not be reported as a locker (marker + name filter).
 */
async function findProcessesReferencingPath(targetPath: string): Promise<LockingProcess[]> {
  if (process.platform !== 'win32') return []
  const escaped = targetPath.replace(/'/g, "''")
  // Unique marker so this scan process never matches its own CommandLine.
  const script = `
# MFE_LOCK_SCAN
$ErrorActionPreference = 'SilentlyContinue'
$t = '${escaped}'.ToLowerInvariant().TrimEnd('\\')
$out = @()
Get-CimInstance Win32_Process | ForEach-Object {
  $exe = $_.ExecutablePath
  $cmd = $_.CommandLine
  $name = $_.Name
  $procId = $_.ProcessId
  if (-not $procId) { return }
  if ($cmd -and $cmd.Contains('MFE_LOCK_SCAN')) { return }
  $hit = $false
  if ($exe) {
    $el = $exe.ToLowerInvariant()
    if ($el -eq $t -or $el.StartsWith($t + '\\')) { $hit = $true }
  }
  if (-not $hit -and $cmd) {
    $cl = $cmd.ToLowerInvariant()
    if ($cl.Contains($t)) { $hit = $true }
  }
  if ($hit) {
    $label = if ($name) { $name } else { 'Process' }
    $row = [ordered]@{ pid = [int]$procId; name = [string]$label }
    if ($exe) { $row.exePath = [string]$exe }
    $out += [PSCustomObject]$row
  }
}
if ($out.Count -eq 0) { '' } else { $out | ConvertTo-Json -Compress }
`
  try {
    const { stdout } = await execFileAsync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
      { windowsHide: true, timeout: 8000, maxBuffer: 2 * 1024 * 1024 }
    )
    const text = stdout.trim()
    if (!text) return []
    const parsed = JSON.parse(text) as
      | { pid: number; name: string; exePath?: string }
      | { pid: number; name: string; exePath?: string }[]
    const rows = Array.isArray(parsed) ? parsed : [parsed]
    const self = process.pid
    return rows
      .filter(
        (r) =>
          r &&
          typeof r.pid === 'number' &&
          r.pid !== self &&
          !isIgnorableLockerName(r.name || '')
      )
      .map((r) => ({
        pid: r.pid,
        name: r.name || `PID ${r.pid}`,
        ...(typeof r.exePath === 'string' && r.exePath ? { exePath: r.exePath } : {})
      }))
  } catch {
    return []
  }
}

/** Fill missing exePath for RM-only hits (cheap second CIM query by PID). */
async function enrichExePaths(lockers: LockingProcess[]): Promise<LockingProcess[]> {
  const missing = lockers.filter((p) => !p.exePath).map((p) => p.pid)
  if (missing.length === 0 || process.platform !== 'win32') return lockers
  const idList = missing.join(',')
  const script = `
$ErrorActionPreference = 'SilentlyContinue'
$ids = @(${idList})
$out = @()
foreach ($id in $ids) {
  $p = Get-CimInstance Win32_Process -Filter "ProcessId=$id"
  if ($p -and $p.ExecutablePath) {
    $out += [PSCustomObject]@{ pid = [int]$id; exePath = [string]$p.ExecutablePath }
  }
}
if ($out.Count -eq 0) { '' } else { $out | ConvertTo-Json -Compress }
`
  try {
    const { stdout } = await execFileAsync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
      { windowsHide: true, timeout: 5000, maxBuffer: 512 * 1024 }
    )
    const text = stdout.trim()
    if (!text) return lockers
    const parsed = JSON.parse(text) as
      | { pid: number; exePath: string }
      | { pid: number; exePath: string }[]
    const rows = Array.isArray(parsed) ? parsed : [parsed]
    const byPid = new Map(rows.map((r) => [r.pid, r.exePath]))
    return lockers.map((p) => {
      const exe = byPid.get(p.pid)
      return exe && !p.exePath ? { ...p, exePath: exe } : p
    })
  } catch {
    return lockers
  }
}

function mergeLockers(...lists: LockingProcess[][]): LockingProcess[] {
  const self = process.pid
  const byPid = new Map<number, LockingProcess>()
  for (const list of lists) {
    for (const p of list) {
      if (!p.pid || p.pid === self) continue
      if (isIgnorableLockerName(p.name)) continue
      const prev = byPid.get(p.pid)
      if (!prev) {
        byPid.set(p.pid, p)
        continue
      }
      byPid.set(p.pid, {
        pid: p.pid,
        name: p.name && p.name.length > prev.name.length ? p.name : prev.name,
        exePath: p.exePath ?? prev.exePath
      })
    }
  }
  return [...byPid.values()].sort((a, b) => a.name.localeCompare(b.name))
}

/** Best-effort list of processes locking / using `targetPath`. */
export async function findLockingProcesses(targetPath: string): Promise<LockingProcess[]> {
  if (process.platform !== 'win32') return []
  try {
    const files = await collectLockCheckPaths(targetPath)
    const byRm = new Map<number, LockingProcess>()
    const CHUNK = 48
    for (let i = 0; i < files.length; i += CHUNK) {
      const chunk = files.slice(i, i + CHUNK)
      for (const p of queryRestartManager(chunk)) byRm.set(p.pid, p)
      if (byRm.size > 0) break
    }

    let isDir = false
    try {
      isDir = (await fsp.stat(targetPath)).isDirectory()
    } catch {
      /* ignore */
    }
    const refs =
      isDir || byRm.size === 0 ? await findProcessesReferencingPath(targetPath) : []

    const merged = mergeLockers([...byRm.values()], refs)
    return enrichExePaths(merged)
  } catch {
    return []
  }
}

export function formatLockingProcesses(lockers: LockingProcess[]): string {
  if (lockers.length === 0) return ''
  return lockers.map((p) => (p.name ? `${p.name} (PID ${p.pid})` : `PID ${p.pid}`)).join('\n')
}

/**
 * End a process tree that is locking a file. Uses taskkill /T /F.
 * Refuses kernel / session hosts and this process.
 */
export async function endLockingProcess(pid: number): Promise<{ ended: true }> {
  if (process.platform !== 'win32') {
    throw new AppError('not-allowed', 'Ending processes is only supported on Windows.')
  }
  if (!Number.isInteger(pid) || pid <= 4 || pid === process.pid) {
    throw new AppError('not-allowed', 'That process cannot be ended from here.')
  }

  let name = `PID ${pid}`
  try {
    const { stdout } = await execFileAsync(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-Command',
        `$p = Get-Process -Id ${pid} -ErrorAction SilentlyContinue; if ($p) { $p.ProcessName }`
      ],
      { windowsHide: true, timeout: 4000 }
    )
    const n = stdout.trim()
    if (n) name = n
  } catch {
    /* proceed — taskkill will fail clearly if gone */
  }

  if (isProtectedLocker({ pid, name })) {
    throw new AppError(
      'not-allowed',
      `Cannot end ${name} (PID ${pid}) — it is a protected system process.`,
      'Close the program from its own window, or end it in Task Manager if you are sure.'
    )
  }

  try {
    await execFileAsync('taskkill', ['/PID', String(pid), '/T', '/F'], {
      windowsHide: true,
      timeout: 15_000
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    if (/not found|no running instance|not running/i.test(msg)) {
      return { ended: true }
    }
    throw new AppError(
      'io',
      `Could not end ${name} (PID ${pid}).`,
      'Try Task Manager, or close the program from its own window.'
    )
  }
  return { ended: true }
}
