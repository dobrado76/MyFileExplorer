import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { AppError } from '@shared/result'
import type { DirEntry, ListResponse, StatResult } from '@shared/schemas/fs'
import {
  DRIVE_NO_ROOT_DIR,
  DRIVE_REMOTE,
  DRIVE_UNKNOWN,
  isNetworkHostUnc
} from '@shared/networkPaths'
import { normalizeAbsolute, protocolAllowlist } from '../security/paths'
import { pathIsHidden } from './winAttrs'
import { listDirectoryWin32 } from './listWin32'
import { rememberNetworkHost } from './networkRemembered'
import { getDriveTypeWin32 } from './drives'
import { dedupeDirEntries } from '@shared/dirEntries'
import {
  filterOutNestedVirtualFolderPeers,
  isVirtualFolderDocumentPath,
  presentVirtualFolderAsDirEntry
} from '@shared/virtualFolder'
import { parseVirtualFolderJson } from '@shared/schemas/virtualFolder'

function extOf(name: string): string {
  const e = path.extname(name)
  return e.startsWith('.') ? e.slice(1).toLowerCase() : e.toLowerCase()
}

// Linux exposes SMB/NFS mounts as ordinary POSIX paths, so drive letters and
// UNC parsing cannot identify them. These are the common network filesystem
// magic values returned by statfs(2); FUSE also covers GVFS/sshfs mounts.
const NETWORK_FS_MAGIC = new Set([
  0xff534d42, // CIFS
  0xfe534d42, // SMB2
  0x6969, // NFS
  0x564c, // NCP
  0x65735546, // FUSE
  0x01021997 // 9P
])

async function isNetworkPath(absPath: string): Promise<boolean> {
  if (isNetworkHostUnc(absPath)) return true
  if (absPath.toLowerCase().startsWith('mfe-remote://')) return true
  if (process.platform !== 'linux') return false
  // KDE/GNOME users can open SMB shares through GVFS, which is a FUSE mount.
  if (/\/run\/user\/\d+\/gvfs(?:\/|$)/i.test(absPath)) return true
  try {
    const fsInfo = await fsp.statfs(absPath)
    return NETWORK_FS_MAGIC.has(Number(fsInfo.type) >>> 0)
  } catch {
    return false
  }
}

export function requireAbsolute(p: string): string {
  const n = normalizeAbsolute(p)
  if (!n) throw new AppError('validation', `Not an absolute path: ${p}`)
  return n
}

async function listDirectoryNode(dir: string, includeHidden: boolean): Promise<DirEntry[]> {
  const dirents = await fsp.readdir(dir, { withFileTypes: true })
  const entries: DirEntry[] = []
  const CONCURRENCY = 64
  for (let i = 0; i < dirents.length; i += CONCURRENCY) {
    const batch = dirents.slice(i, i + CONCURRENCY)
    const settled = await Promise.allSettled(
      batch.map(async (d): Promise<DirEntry | null> => {
        // Use path.join so separators match the OS (avoids mixing '/' and '\\').
        const full = path.join(dir, d.name)
        // Windows: only FILE_ATTRIBUTE_HIDDEN (Explorer). Leading "." is not special.
        const isHidden = pathIsHidden(full)
        if (isHidden && !includeHidden) return null
        let kind: DirEntry['kind'] = d.isSymbolicLink()
          ? 'symlink'
          : d.isDirectory()
            ? 'dir'
            : 'file'
        let size = 0
        let mtimeMs = 0
        let birthtimeMs = 0
        try {
          const st = await fsp.stat(full)
          size = st.isDirectory() ? 0 : st.size
          mtimeMs = st.mtimeMs
          birthtimeMs = st.birthtimeMs
          if (kind === 'symlink') kind = st.isDirectory() ? 'dir' : 'file'
        } catch {
          // broken symlink or access denied: keep zeros, lstat kind
        }
        return presentVirtualFolderAsDirEntry({
          name: d.name,
          path: full,
          kind,
          size,
          mtimeMs,
          birthtimeMs,
          ext: kind === 'dir' ? '' : extOf(d.name),
          isHidden
        })
      })
    )
    for (const s of settled) {
      if (s.status === 'fulfilled' && s.value) entries.push(s.value)
    }
  }
  return entries
}

/** Explorer-style: bare `\\server` lists disk shares as folders. */
async function listUncHostAsShares(dir: string): Promise<DirEntry[]> {
  const { listNetworkShares } = await import('./network')
  const shares = await listNetworkShares(dir)
  rememberNetworkHost(dir)
  return shares.map((s) => ({
    name: s.name,
    path: s.unc,
    kind: 'dir' as const,
    size: 0,
    mtimeMs: 0,
    birthtimeMs: 0,
    ext: '',
    isHidden: false
  }))
}

export async function listDirectory(dirPath: string, includeHidden = true): Promise<ListResponse> {
  const dir = requireAbsolute(dirPath)

  if (dir.toLowerCase().startsWith('mfe-remote://')) {
    const { listRemoteDirectory } = await import('../remote/sessionPool')
    const result = await listRemoteDirectory(dir, includeHidden)
    return { path: result.path, entries: dedupeDirEntries(result.entries) }
  }

  const driveLetter = /^([a-zA-Z]):/i.exec(dir)

  // Mapped / missing letters: never call sync FindFirstFileW on main — it can
  // block the UI for 5–20s on a dead Z: (etc.). Offline → fail fast; live remote
  // → async libuv readdir (off main). Local fixed disks keep the Win32 fast path.
  if (driveLetter && process.platform === 'win32') {
    const dt = getDriveTypeWin32(`${driveLetter[1]}:\\`)
    if (dt <= DRIVE_NO_ROOT_DIR || dt === DRIVE_UNKNOWN) {
      // Explicit open / Offline Retry only reaches here (tree restore skips these letters).
      // Reconnect may block briefly — better than FindFirstFileW hanging with no recovery.
      const { restoreMappedNetworkDrive } = await import('./drives')
      restoreMappedNetworkDrive(`${driveLetter[1]}:\\`)
      const entries = await finalizeLocalListing(dir, await listDirectoryNode(dir, includeHidden))
      return { path: dir, entries }
    }
    if (dt === DRIVE_REMOTE) {
      // Async libuv listing — keeps Electron main free. Reconnect is Offline Retry /
      // explicit open (restoreMappedNetworkDrive), not every list.
      const entries = await finalizeLocalListing(dir, await listDirectoryNode(dir, includeHidden))
      return { path: dir, entries }
    }
  }

  let entries: DirEntry[] | null = null
  if (process.platform === 'win32' && isNetworkHostUnc(dir)) {
    entries = await listUncHostAsShares(dir)
  } else if (process.platform === 'win32') {
    try {
      entries = listDirectoryWin32(dir, includeHidden)
    } catch {
      entries = null
    }
  }
  if (!entries) entries = await listDirectoryNode(dir, includeHidden)
  entries = await finalizeLocalListing(dir, entries)
  return { path: dir, entries }
}

/** Dedupe, allowlist, and hide nested VF peers that are members of another VF in this folder. */
async function finalizeLocalListing(dir: string, raw: DirEntry[]): Promise<DirEntry[]> {
  let entries = dedupeDirEntries(raw)
  protocolAllowlist.allowDir(dir)
  const vfEntries = entries.filter((e) => isVirtualFolderDocumentPath(e.path))
  if (vfEntries.length < 2) return entries

  // Sync read is fine: only for the few .mfevirtual siblings in one folder.
  const cache = new Map<string, { entries: import('@shared/virtualFolder').VirtualFolderEntry[] } | null>()
  for (const vf of vfEntries) {
    try {
      const text = fs.readFileSync(vf.path, 'utf8')
      const parsed = parseVirtualFolderJson(text)
      cache.set(vf.path, parsed.ok ? { entries: parsed.document.entries } : null)
    } catch {
      cache.set(vf.path, null)
    }
  }
  return filterOutNestedVirtualFolderPeers(entries, (documentPath) => cache.get(documentPath) ?? null)
}

export async function statPath(p: string): Promise<StatResult> {
  const n = requireAbsolute(p)
  if (n.toLowerCase().startsWith('mfe-remote://')) {
    const { remoteStat } = await import('../remote/sessionPool')
    const st = await remoteStat(n)
    return {
      path: n,
      exists: st != null,
      kind: st?.kind === 'dir' ? 'dir' : st?.kind === 'file' ? 'file' : null,
      isNetwork: true,
      size: st?.size ?? 0,
      mtimeMs: st?.mtimeMs ?? 0,
      ctimeMs: st?.mtimeMs ?? 0,
      birthtimeMs: 0,
      isReadonly: true
    }
  }
  // Bare UNC hosts are virtual share lists on Windows only.
  if (process.platform === 'win32' && isNetworkHostUnc(n)) {
    return {
      path: n,
      exists: true,
      kind: 'dir',
      isNetwork: true,
      size: 0,
      mtimeMs: 0,
      ctimeMs: 0,
      birthtimeMs: 0,
      isReadonly: false
    }
  }
  try {
    const st = await fsp.stat(n)
    let isReadonly = false
    try {
      await fsp.access(n, fsp.constants.W_OK)
    } catch {
      isReadonly = true
    }
    return {
      path: n,
      exists: true,
      kind: st.isDirectory() ? 'dir' : st.isSymbolicLink() ? 'symlink' : 'file',
      isNetwork: await isNetworkPath(n),
      size: st.isDirectory() ? 0 : st.size,
      mtimeMs: st.mtimeMs,
      ctimeMs: st.ctimeMs,
      birthtimeMs: st.birthtimeMs,
      isReadonly
    }
  } catch (e) {
    if (e && typeof e === 'object' && 'code' in e && (e as { code: string }).code === 'ENOENT') {
      return {
        path: n,
        exists: false,
        kind: null,
        isNetwork: await isNetworkPath(path.dirname(n)),
        size: 0,
        mtimeMs: 0,
        ctimeMs: 0,
        birthtimeMs: 0,
        isReadonly: false
      }
    }
    throw e
  }
}

export async function pathExists(p: string): Promise<boolean> {
  try {
    const n = requireAbsolute(p)
    if (n.toLowerCase().startsWith('mfe-remote://')) {
      const { remoteStatKind } = await import('../remote/sessionPool')
      return (await remoteStatKind(n)) != null
    }
    if (isNetworkHostUnc(n)) return true
    await fsp.access(n)
    return true
  } catch {
    return false
  }
}
