import { createRequire } from 'node:module'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import fsp from 'node:fs/promises'
import { BrowserWindow } from 'electron'
import type { DriveInfo } from '@shared/schemas/fs'
import { AppError } from '@shared/result'
import { displayHostLabel, driveTypeFromWin32, DRIVE_REMOTE } from '@shared/networkPaths'
import { driveSpaceIsSafe } from '@shared/driveSpace'
import { logMain } from '../logging'

const execFileAsync = promisify(execFile)

const require = createRequire(import.meta.url)

function loadKoffi(): typeof import('koffi').default {
  return require('koffi') as typeof import('koffi').default
}

/** NTFS / FAT volume label max length. */
export const VOLUME_NAME_MAX = 32

const DRIVE_UNKNOWN = 0
const DRIVE_NO_ROOT_DIR = 1
const DRIVE_REMOVABLE = 2
const DRIVE_FIXED = 3
const DRIVE_CDROM = 5
const DRIVE_RAMDISK = 6
const RESOURCETYPE_DISK = 1
/** Prompt for credentials when reconnect needs them. */
const CONNECT_INTERACTIVE = 0x00000008
const CONNECT_PROMPT = 0x00000010
/** WNetGetConnection: device not connected but persistent mapping exists. */
const ERROR_CONNECTION_UNAVAIL = 1201
/** WNetGetConnection: not a network drive. */
const ERROR_NOT_CONNECTED = 2250
const ERROR_MORE_DATA = 234
const ERROR_ALREADY_ASSIGNED = 85
const ERROR_DEVICE_ALREADY_REMEMBERED = 1202
const ERROR_ACCESS_DENIED = 5
const ERROR_LOGON_FAILURE = 1326
const ERROR_BAD_USERNAME = 2202
const ERROR_INVALID_PASSWORD = 86
const ERROR_NO_NETWORK = 1222
const ERROR_NO_NET_OR_BAD_PATH = 1203
/** Remove persistent mapping from the user profile (forget at next logon). */
const CONNECT_UPDATE_PROFILE = 0x00000001
const ERROR_OPEN_FILES = 2401
const ERROR_DEVICE_IN_USE = 2404

type VolumeApi = {
  GetLogicalDriveStringsW: (nBufferLength: number, lpBuffer: Buffer) => number
  GetDriveTypeW: (lpRootPathName: string) => number
  GetVolumeInformationW: (
    root: string,
    nameBuf: Buffer | null,
    nameSize: number,
    serial: null,
    maxComp: null,
    flags: null,
    fsBuf: Buffer | null,
    fsSize: number
  ) => number
  SetVolumeLabelW: (root: string, name: string) => number
  GetLastError: () => number
}

type NetResource = {
  dwScope: number
  dwType: number
  dwDisplayType: number
  dwUsage: number
  lpLocalName: string | null
  lpRemoteName: string | null
  lpComment: string | null
  lpProvider: string | null
}

type MprApi = {
  WNetGetConnectionW: (local: string, remote: Buffer, len: number[]) => number
  WNetAddConnection2W: (
    nr: NetResource,
    password: string | null,
    userName: string | null,
    flags: number
  ) => number
  WNetUseConnectionW: (
    hwnd: unknown,
    nr: NetResource,
    password: string | null,
    userName: string | null,
    flags: number,
    accessName: null,
    bufferSize: null,
    result: null
  ) => number
  /** Disconnect / forget persistent mapping for a letter. */
  WNetCancelConnection2W: (name: string, flags: number, force: number) => number
  /** Optional — missing on many Windows builds (not exported from mpr.dll). */
  WNetRestoreConnectionW: ((hwnd: unknown, device: string) => number) | null
}

let volumeApi: VolumeApi | null | undefined
let mprApi: MprApi | null | undefined
let registryMapsCache: { at: number; maps: Array<{ letter: string; remotePath: string }> } | null =
  null
const REGISTRY_MAPS_CACHE_MS = 30_000

function ensureVolumeApi(): VolumeApi | null {
  if (volumeApi !== undefined) return volumeApi
  if (process.platform !== 'win32') {
    volumeApi = null
    return null
  }
  const koffi = loadKoffi()
  const kernel32 = koffi.load('kernel32.dll')
  volumeApi = {
    GetLogicalDriveStringsW: kernel32.func(
      'uint32 __stdcall GetLogicalDriveStringsW(uint32 nBufferLength, void *lpBuffer)'
    ),
    GetDriveTypeW: kernel32.func('uint32 __stdcall GetDriveTypeW(str16 lpRootPathName)'),
    GetVolumeInformationW: kernel32.func(
      'int32 __stdcall GetVolumeInformationW(str16 lpRootPathName, void *lpVolumeNameBuffer, uint32 nVolumeNameSize, void *lpVolumeSerialNumber, void *lpMaximumComponentLength, void *lpFileSystemFlags, void *lpFileSystemNameBuffer, uint32 nFileSystemNameSize)'
    ),
    SetVolumeLabelW: kernel32.func(
      'int32 __stdcall SetVolumeLabelW(str16 lpRootPathName, str16 lpVolumeName)'
    ),
    GetLastError: kernel32.func('uint32 __stdcall GetLastError()')
  }
  return volumeApi
}

function ensureMprApi(): MprApi | null {
  if (mprApi !== undefined) return mprApi
  if (process.platform !== 'win32') {
    mprApi = null
    return null
  }
  try {
    const koffi = loadKoffi()
    const mpr = koffi.load('mpr.dll')
    // Struct must be registered before funcs that take it by pointer.
    koffi.struct('MfeNETRESOURCEW', {
      dwScope: 'uint32',
      dwType: 'uint32',
      dwDisplayType: 'uint32',
      dwUsage: 'uint32',
      lpLocalName: 'str16',
      lpRemoteName: 'str16',
      lpComment: 'str16',
      lpProvider: 'str16'
    })
    const api: MprApi = {
      WNetGetConnectionW: mpr.func(
        'uint32 __stdcall WNetGetConnectionW(str16 lpLocalName, _Out_ void *lpRemoteName, _Inout_ uint32 *lpnLength)'
      ),
      // Explorer reconnect for disconnected mapped letters (WNetRestoreConnectionW is often absent).
      WNetAddConnection2W: mpr.func(
        'uint32 __stdcall WNetAddConnection2W(_Inout_ MfeNETRESOURCEW *lpNetResource, str16 lpPassword, str16 lpUserName, uint32 dwFlags)'
      ),
      WNetUseConnectionW: mpr.func(
        'uint32 __stdcall WNetUseConnectionW(void *hwndOwner, _Inout_ MfeNETRESOURCEW *lpNetResource, str16 lpPassword, str16 lpUserId, uint32 dwFlags, void *lpAccessName, void *lpBufferSize, void *lpResult)'
      ),
      WNetCancelConnection2W: mpr.func(
        'uint32 __stdcall WNetCancelConnection2W(str16 lpName, uint32 dwFlags, int32 fForce)'
      ),
      WNetRestoreConnectionW: null
    }
    try {
      api.WNetRestoreConnectionW = mpr.func(
        'uint32 __stdcall WNetRestoreConnectionW(void *hwndOwner, str16 lpDevice)'
      )
    } catch {
      /* optional — not exported on current Windows */
    }
    mprApi = api
  } catch (e) {
    logMain('warn', `drives: mpr.dll load failed: ${e instanceof Error ? e.message : String(e)}`)
    mprApi = null
  }
  return mprApi
}

function hwndFromWindow(win: BrowserWindow | null): unknown {
  if (!win || win.isDestroyed()) return null
  try {
    const buf = win.getNativeWindowHandle()
    if (buf.length >= 8) return buf.readBigUInt64LE(0)
    if (buf.length >= 4) return buf.readUInt32LE(0)
  } catch {
    /* ignore */
  }
  return null
}

function ownerHwnd(): unknown {
  const focused = BrowserWindow.getFocusedWindow()
  if (focused) return hwndFromWindow(focused)
  const all = BrowserWindow.getAllWindows().filter((w) => !w.isDestroyed())
  return hwndFromWindow(all[0] ?? null)
}

function formatRemoteShareLabel(remotePath: string): string {
  const parts = remotePath.replace(/^\\\\/, '').split('\\').filter(Boolean)
  if (parts.length === 0) return remotePath.replace(/^\\\\/, '')
  const host = displayHostLabel(parts[0]!)
  return [host, ...parts.slice(1)].join('\\')
}

function wnetReconnectOk(status: number): boolean {
  return (
    status === 0 || status === ERROR_ALREADY_ASSIGNED || status === ERROR_DEVICE_ALREADY_REMEMBERED
  )
}

function needsInteractiveReconnect(status: number): boolean {
  return (
    status === ERROR_ACCESS_DENIED ||
    status === ERROR_LOGON_FAILURE ||
    status === ERROR_BAD_USERNAME ||
    status === ERROR_INVALID_PASSWORD
  )
}

function normalizeDriveRoot(rootPath: string): string {
  const n = rootPath.replace(/\//g, '\\')
  const m = /^([a-zA-Z]:)\\?$/.exec(n)
  if (!m) return rootPath.endsWith('\\') ? rootPath : `${rootPath}\\`
  return `${m[1]!.toUpperCase()}\\`
}

function driveLetterOf(rootPath: string): string | null {
  const m = /^([a-zA-Z]):/.exec(rootPath.replace(/\//g, '\\'))
  return m ? m[1]!.toUpperCase() : null
}

/** Placeholders that must not appear next to the drive letter in the tree. */
export function isHiddenVolumeName(name: string): boolean {
  const t = name.trim()
  return !t || /^no name$/i.test(t) || /^new volume$/i.test(t)
}

/** Volume label from GetVolumeInformationW, or '' when unnamed / placeholder. */
export function readVolumeName(rootPath: string): string {
  const api = ensureVolumeApi()
  if (!api) return ''
  const root = normalizeDriveRoot(rootPath)
  const nameBuf = Buffer.alloc(261 * 2)
  const ok = api.GetVolumeInformationW(root, nameBuf, 261, null, null, null, null, 0)
  if (!ok) return ''
  const raw = nameBuf.toString('utf16le').replace(/\0.*$/s, '').trim()
  if (isHiddenVolumeName(raw)) return ''
  return raw
}

/** File system name for a drive root (`NTFS`, `FAT32`, …), or null when unknown. */
export function readFileSystemName(rootPath: string): string | null {
  const api = ensureVolumeApi()
  if (!api) return null
  const root = normalizeDriveRoot(rootPath)
  const fsBuf = Buffer.alloc(64 * 2)
  const ok = api.GetVolumeInformationW(root, null, 0, null, null, null, fsBuf, 64)
  if (!ok) return null
  const raw = fsBuf.toString('utf16le').replace(/\0.*$/s, '').trim()
  return raw || null
}

const ntfsPathCache = new Map<string, boolean>()

/**
 * True when `absPath` is on an NTFS volume (ADS-capable). Non-win32 / unknown → false.
 * Cached per drive root for bulk copy/move.
 */
export function pathIsNtfs(absPath: string): boolean {
  if (process.platform !== 'win32') return false
  const m = /^([a-zA-Z]:)/.exec(absPath.replace(/\//g, '\\'))
  if (!m) return false
  const root = `${m[1]!.toUpperCase()}\\`
  const cached = ntfsPathCache.get(root)
  if (cached !== undefined) return cached
  const fsName = readFileSystemName(root)
  const ok = (fsName ?? '').toUpperCase() === 'NTFS'
  ntfsPathCache.set(root, ok)
  return ok
}

function driveLabel(letter: string, volumeName: string, remotePath?: string, offline?: boolean): string {
  if (volumeName) return `${letter}: \u2014 ${volumeName}`
  if (remotePath) {
    const share = formatRemoteShareLabel(remotePath)
    return offline ? `${letter}: \u2014 ${share} (Disconnected)` : `${letter}: \u2014 ${share}`
  }
  return offline ? `${letter}: (Disconnected)` : `${letter}:`
}

/** Currently mounted roots from GetLogicalDriveStringsW (e.g. `C:\`). */
function logicalDriveRoots(api: VolumeApi): string[] {
  let chars = 128
  for (let attempt = 0; attempt < 3; attempt++) {
    const buf = Buffer.alloc(chars * 2)
    const needed = api.GetLogicalDriveStringsW(chars, buf)
    if (needed === 0) return []
    if (needed > chars) {
      chars = needed
      continue
    }
    const text = buf.toString('utf16le', 0, needed * 2)
    return text
      .split('\0')
      .map((s) => s.trim())
      .filter((s) => /^[a-zA-Z]:\\?$/.test(s))
      .map((s) => (s.endsWith('\\') ? s.toUpperCase() : `${s.toUpperCase()}\\`))
  }
  return []
}

function decodeWNetRemote(buf: Buffer): string {
  return buf.toString('utf16le').replace(/\0.*$/s, '').trim()
}

/**
 * Probe whether `Z:` (etc.) is a mapped network letter.
 * Works for connected and disconnected persistent mappings.
 */
export function getMappedNetworkConnection(
  localName: string
): { remotePath: string; unavailable: boolean } | null {
  const api = ensureMprApi()
  if (!api) return null
  const local = localName.replace(/\\+$/, '')
  let chars = 256
  for (let attempt = 0; attempt < 3; attempt++) {
    const buf = Buffer.alloc(chars * 2)
    const len = [chars]
    const status = api.WNetGetConnectionW(local, buf, len)
    if (status === 0) {
      const remotePath = decodeWNetRemote(buf)
      return remotePath ? { remotePath, unavailable: false } : null
    }
    if (status === ERROR_MORE_DATA) {
      chars = Math.max(chars * 2, len[0] ?? chars * 2)
      continue
    }
    if (status === ERROR_CONNECTION_UNAVAIL) {
      const remotePath = decodeWNetRemote(buf)
      return { remotePath, unavailable: true }
    }
    if (status === ERROR_NOT_CONNECTED) return null
    return null
  }
  return null
}

/**
 * Persistent “Reconnect at sign-in” maps from HKCU\Network (may be absent from
 * GetLogicalDriveStrings while disconnected). Async so drive polls do not freeze main.
 */
async function rememberedMapsFromRegistry(): Promise<
  Array<{ letter: string; remotePath: string }>
> {
  if (process.platform !== 'win32') return []
  const now = Date.now()
  if (registryMapsCache && now - registryMapsCache.at < REGISTRY_MAPS_CACHE_MS) {
    return registryMapsCache.maps
  }
  try {
    const list = await execFileAsync('reg.exe', ['query', 'HKCU\\Network'], {
      windowsHide: true,
      encoding: 'utf8',
      timeout: 3_000
    })
    const stdout = typeof list.stdout === 'string' ? list.stdout : ''
    if (!stdout) {
      registryMapsCache = { at: now, maps: [] }
      return []
    }
    const out: Array<{ letter: string; remotePath: string }> = []
    const keyRe = /^HKEY_CURRENT_USER\\Network\\([A-Za-z])\s*$/gim
    let m: RegExpExecArray | null
    const letters: string[] = []
    while ((m = keyRe.exec(stdout)) !== null) {
      letters.push(m[1]!.toUpperCase())
    }
    await Promise.all(
      letters.map(async (letter) => {
        try {
          const detail = await execFileAsync(
            'reg.exe',
            ['query', `HKCU\\Network\\${letter}`, '/v', 'RemotePath'],
            { windowsHide: true, encoding: 'utf8', timeout: 3_000 }
          )
          const text = typeof detail.stdout === 'string' ? detail.stdout : ''
          const rm = /RemotePath\s+REG_SZ\s+(.+)$/im.exec(text)
          const remotePath = rm?.[1]?.trim().replace(/\//g, '\\') ?? ''
          if (remotePath.startsWith('\\\\')) out.push({ letter, remotePath })
        } catch {
          /* skip letter */
        }
      })
    )
    out.sort((a, b) => a.letter.localeCompare(b.letter))
    registryMapsCache = { at: now, maps: out }
    return out
  } catch {
    registryMapsCache = { at: now, maps: [] }
    return []
  }
}

function resolveMappedRemote(letter: string): string | null {
  const local = `${letter}:`
  const live = getMappedNetworkConnection(local)
  if (live?.remotePath) return live.remotePath
  // Sync path for reconnect: use cache only (avoid spawnSync on the hot path).
  return registryMapsCache?.maps.find((m) => m.letter === letter)?.remotePath ?? null
}

/**
 * Reconnect a mapped letter the way Explorer does when you click a disconnected drive.
 * Uses WNetAddConnection2W (WNetRestoreConnectionW is often missing from mpr.dll).
 * Soft-fail — caller still attempts the IO. Returns true when the letter looks connected.
 */
export function restoreMappedNetworkDrive(rootPath: string): boolean {
  const api = ensureMprApi()
  if (!api) return false
  const letter = driveLetterOf(rootPath)
  if (!letter) return false
  const local = `${letter}:`
  const root = `${letter}:\\`

  try {
    const vol = ensureVolumeApi()
    if (vol) {
      const type = vol.GetDriveTypeW(root)
      // Fixed / removable / CD — not a reconnect candidate.
      if (type > DRIVE_NO_ROOT_DIR && type !== DRIVE_REMOTE) return false
      if (type === DRIVE_REMOTE) {
        const live = getMappedNetworkConnection(local)
        if (live && !live.unavailable) return true
      }
    }

    const live = getMappedNetworkConnection(local)
    if (live && !live.unavailable) return true

    const remote = live?.remotePath || resolveMappedRemote(letter)
    if (!remote) {
      // Last resort when RemotePath unknown but Restore exists.
      if (api.WNetRestoreConnectionW) {
        const st = api.WNetRestoreConnectionW(null, local)
        return wnetReconnectOk(st)
      }
      return false
    }

    const nr: NetResource = {
      dwScope: 0,
      dwType: RESOURCETYPE_DISK,
      dwDisplayType: 0,
      dwUsage: 0,
      lpLocalName: local,
      lpRemoteName: remote,
      lpComment: null,
      lpProvider: null
    }

    let status = api.WNetAddConnection2W(nr, null, null, 0)
    if (wnetReconnectOk(status)) {
      registryMapsCache = null
      return true
    }

    // Credentials required — same interactive prompt Explorer shows.
    if (needsInteractiveReconnect(status)) {
      status = api.WNetUseConnectionW(
        ownerHwnd(),
        nr,
        null,
        null,
        CONNECT_INTERACTIVE | CONNECT_PROMPT,
        null,
        null,
        null
      )
      if (wnetReconnectOk(status)) {
        registryMapsCache = null
        return true
      }
    }

    if (status !== ERROR_NO_NETWORK && status !== ERROR_NO_NET_OR_BAD_PATH) {
      logMain(
        'warn',
        `drives: reconnect ${local} → ${remote} failed (WNet status ${status})`
      )
    }
    return false
  } catch (e) {
    logMain(
      'warn',
      `drives: reconnect ${local} threw: ${e instanceof Error ? e.message : String(e)}`
    )
    return false
  }
}

/**
 * Disconnect a mapped letter and forget the persistent “Reconnect at sign-in” mapping
 * (`WNetCancelConnection2W` + `CONNECT_UPDATE_PROFILE`). Works for connected and
 * disconnected remembered letters. Pass `force` when open files block the cancel.
 */
export async function disconnectMappedNetworkDrive(
  rootPath: string,
  opts?: { force?: boolean }
): Promise<{ disconnected: true; letter: string; remotePath?: string }> {
  const api = ensureMprApi()
  if (!api) throw new AppError('io', 'Disconnect network drive is only available on Windows')
  const letter = driveLetterOf(rootPath)
  if (!letter) throw new AppError('validation', 'Not a drive letter')
  const local = `${letter}:`
  const maps = await rememberedMapsFromRegistry()
  const remotePath =
    getMappedNetworkConnection(local)?.remotePath ||
    maps.find((m) => m.letter === letter)?.remotePath ||
    undefined
  const isMapped =
    !!remotePath || !!getMappedNetworkConnection(local) || maps.some((m) => m.letter === letter)
  if (!isMapped) {
    throw new AppError('validation', `${local} is not a mapped network drive`)
  }

  const force = opts?.force === true ? 1 : 0
  const status = api.WNetCancelConnection2W(local, CONNECT_UPDATE_PROFILE, force)
  registryMapsCache = null

  if (status === 0) {
    return { disconnected: true, letter, ...(remotePath ? { remotePath } : {}) }
  }
  // Already gone from WNet but may still be in HKCU\Network — treat as success after profile update attempt.
  if (status === ERROR_NOT_CONNECTED) {
    return { disconnected: true, letter, ...(remotePath ? { remotePath } : {}) }
  }
  if (status === ERROR_OPEN_FILES || status === ERROR_DEVICE_IN_USE) {
    throw new AppError(
      'busy',
      `${local} is in use — close open files, or disconnect forcefully`,
      'Retry with force to disconnect anyway.'
    )
  }
  throw new AppError('io', `Could not disconnect ${local} (WNet status ${status})`)
}

function buildDriveInfo(
  root: string,
  type: number,
  mapped: { remotePath: string; unavailable: boolean } | null
): DriveInfo | null {
  const letter = root[0]!.toUpperCase()
  // Skip unknown / no-root unless it's a mapped network letter (disconnected).
  if (type <= DRIVE_NO_ROOT_DIR) {
    if (!mapped) return null
    const volumeName = ''
    const remotePath = mapped.remotePath || undefined
    return {
      path: root,
      label: driveLabel(letter, volumeName, remotePath, true),
      volumeName,
      driveType: 'remote',
      offline: true,
      ...(remotePath ? { remotePath } : {})
    }
  }
  // Never call GetVolumeInformationW on network / unknown letters — it can block
  // the Electron main thread for many seconds on a disconnected map (Z:).
  const safeVolume =
    type === DRIVE_FIXED || type === DRIVE_REMOVABLE || type === DRIVE_CDROM || type === DRIVE_RAMDISK
  const volumeName = safeVolume ? readVolumeName(root) : ''
  const driveType = driveTypeFromWin32(type)
  const offline =
    (driveType === 'remote' && !!mapped?.unavailable) ||
    (driveType === 'remote' && type <= DRIVE_NO_ROOT_DIR)
  const remotePath =
    driveType === 'remote' || mapped?.remotePath
      ? mapped?.remotePath || undefined
      : undefined
  const effectiveType = remotePath && driveType === 'unknown' ? 'remote' : driveType
  return {
    path: root,
    label: driveLabel(letter, volumeName, remotePath, offline),
    volumeName,
    driveType: effectiveType,
    ...(offline ? { offline: true } : {}),
    ...(remotePath ? { remotePath } : {})
  }
}

/** Fast Win32 GetDriveTypeW — does not touch the network. */
export function getDriveTypeWin32(rootPath: string): number {
  const api = ensureVolumeApi()
  if (!api) return DRIVE_UNKNOWN
  return api.GetDriveTypeW(normalizeDriveRoot(rootPath))
}

/**
 * Live volumes for the tree, plus disconnected mapped network letters (Explorer parity).
 * Ejected removable media still disappear (no registry / WNet mapping).
 *
 * Important: does **not** call WNetGetConnectionW / GetVolumeInformationW on network
 * letters — those APIs block main for 5–20s on dead maps and freeze the UI (icons,
 * tree, everything). RemotePath + Disconnected come from HKCU\Network + GetDriveType.
 */
export async function listDrives(): Promise<DriveInfo[]> {
  if (process.platform !== 'win32') {
    const root: DriveInfo = { path: '/', label: '/', volumeName: '' }
    const list = [root]
    await attachDriveSpace(list)
    return list
  }
  const api = ensureVolumeApi()
  if (!api) return []

  const maps = await rememberedMapsFromRegistry()
  const mapByLetter = new Map(maps.map((m) => [m.letter, m.remotePath] as const))
  const byLetter = new Map<string, DriveInfo>()

  for (const root of logicalDriveRoots(api)) {
    const type = api.GetDriveTypeW(root)
    const letter = root[0]!.toUpperCase()
    const remotePath = mapByLetter.get(letter)
    // Prefer registry RemotePath — never sync WNet on this path.
    const mapped =
      remotePath || type === DRIVE_REMOTE || type <= DRIVE_NO_ROOT_DIR || type === DRIVE_UNKNOWN
        ? {
            remotePath: remotePath ?? '',
            unavailable: type <= DRIVE_NO_ROOT_DIR || type === DRIVE_UNKNOWN
          }
        : null
    // Connected SMB still reports DRIVE_REMOTE; treat as online unless no-root/unknown.
    if (mapped && type === DRIVE_REMOTE && remotePath) {
      mapped.unavailable = false
    }
    const info = buildDriveInfo(root, type, mapped)
    if (info) byLetter.set(letter, info)
  }

  // Persistent maps missing from GetLogicalDriveStrings while disconnected.
  for (const { letter, remotePath } of maps) {
    if (byLetter.has(letter)) {
      const existing = byLetter.get(letter)!
      if (!existing.remotePath && remotePath) {
        byLetter.set(letter, {
          ...existing,
          remotePath,
          driveType: existing.driveType === 'unknown' ? 'remote' : existing.driveType,
          label: driveLabel(letter, existing.volumeName, remotePath, existing.offline)
        })
      }
      continue
    }
    const root = `${letter}:\\`
    const type = api.GetDriveTypeW(root)
    const info = buildDriveInfo(root, type <= DRIVE_NO_ROOT_DIR ? DRIVE_NO_ROOT_DIR : type, {
      remotePath,
      unavailable: true
    })
    if (info) byLetter.set(letter, info)
  }

  const out = [...byLetter.values()]
  out.sort((a, b) => a.path.localeCompare(b.path, undefined, { sensitivity: 'base' }))
  await attachDriveSpace(out)
  return out
}

async function readDriveSpaceBytes(
  root: string
): Promise<{ totalBytes: number; freeBytes: number } | null> {
  try {
    const s = await fsp.statfs(root)
    const totalBytes = Number(s.blocks) * Number(s.bsize)
    const freeBytes = Number(s.bavail) * Number(s.bsize)
    if (!(totalBytes > 0) || !Number.isFinite(totalBytes)) return null
    return {
      totalBytes,
      freeBytes: Math.min(Math.max(0, Number.isFinite(freeBytes) ? freeBytes : 0), totalBytes)
    }
  } catch {
    return null
  }
}

/** Local letters only — `statfs` on a dead mapped Z: can block for many seconds. */
async function attachDriveSpace(drives: DriveInfo[]): Promise<void> {
  await Promise.all(
    drives.map(async (d, i) => {
      if (!driveSpaceIsSafe(d)) return
      const sp = await readDriveSpaceBytes(d.path)
      if (sp) drives[i] = { ...d, ...sp }
    })
  )
}

/** Set or clear (empty string) the Windows volume label for a drive root. */
export function setVolumeLabel(rootPath: string, name: string): { path: string; volumeName: string } {
  const api = ensureVolumeApi()
  if (!api) throw new AppError('io', 'Volume labels are only supported on Windows')
  const root = normalizeDriveRoot(rootPath)
  if (!/^[A-Z]:\\$/i.test(root)) {
    throw new AppError('validation', 'Not a drive root')
  }
  const trimmed = name.trim()
  if (trimmed.length > VOLUME_NAME_MAX) {
    throw new AppError('validation', `Volume name must be at most ${VOLUME_NAME_MAX} characters`)
  }
  if (/[<>:"/\\|?*]/.test(trimmed)) {
    throw new AppError('validation', 'Volume name contains invalid characters')
  }
  // Empty field → clear; if clear fails, fall back to the "New Volume" placeholder
  // (never shown in the tree — see isHiddenVolumeName).
  const clearing = isHiddenVolumeName(trimmed)
  const toSet = clearing ? '' : trimmed
  let ok = api.SetVolumeLabelW(root, toSet)
  if (!ok && clearing) {
    ok = api.SetVolumeLabelW(root, 'New Volume')
  }
  if (!ok) {
    const err = api.GetLastError()
    throw new AppError(
      'io',
      err === 5
        ? 'Access denied — try running as administrator or check the volume is writable'
        : `Could not set volume name (error ${err})`
    )
  }
  const volumeName = readVolumeName(root)
  return { path: root, volumeName }
}
