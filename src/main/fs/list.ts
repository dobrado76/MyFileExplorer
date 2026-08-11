import fsp from 'node:fs/promises'
import path from 'node:path'
import { AppError } from '@shared/result'
import type { DirEntry, ListResponse, StatResult } from '@shared/schemas/fs'
import { normalizeAbsolute, protocolAllowlist } from '../security/paths'
import { pathIsHidden } from './winAttrs'
import { listDirectoryWin32 } from './listWin32'
import { dedupeDirEntries } from '@shared/dirEntries'

function extOf(name: string): string {
  const e = path.extname(name)
  return e.startsWith('.') ? e.slice(1).toLowerCase() : e.toLowerCase()
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
        return {
          name: d.name,
          path: full,
          kind,
          size,
          mtimeMs,
          birthtimeMs,
          ext: kind === 'dir' ? '' : extOf(d.name),
          isHidden
        }
      })
    )
    for (const s of settled) {
      if (s.status === 'fulfilled' && s.value) entries.push(s.value)
    }
  }
  return entries
}

export async function listDirectory(dirPath: string, includeHidden = true): Promise<ListResponse> {
  const dir = requireAbsolute(dirPath)
  let entries: DirEntry[] | null = null
  if (process.platform === 'win32') {
    try {
      entries = listDirectoryWin32(dir, includeHidden)
    } catch {
      entries = null
    }
  }
  if (!entries) entries = await listDirectoryNode(dir, includeHidden)
  entries = dedupeDirEntries(entries)
  // Successful listing approves this dir for the media protocol (icons/thumbs).
  protocolAllowlist.allowDir(dir)
  return { path: dir, entries }
}

export async function statPath(p: string): Promise<StatResult> {
  const n = requireAbsolute(p)
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
    await fsp.access(requireAbsolute(p))
    return true
  } catch {
    return false
  }
}
