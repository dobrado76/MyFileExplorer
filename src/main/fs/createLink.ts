import fsp from 'node:fs/promises'
import path from 'node:path'
import { AppError } from '@shared/result'
import type { CreateLinkRequest } from '@shared/schemas/createLink'
import { isRemoteLocation } from '@shared/remotePaths'
import { requireAbsolute, pathExists } from './list'
import { uniqueTargetName } from './ops'

function volumeKey(p: string): string {
  const n = p.replace(/\//g, '\\')
  const drive = /^([a-zA-Z]:)/.exec(n)
  if (drive) return drive[1]!.toLowerCase()
  if (n.startsWith('\\\\')) {
    const parts = n.slice(2).split('\\').filter(Boolean)
    if (parts.length >= 2) return `\\\\${parts[0]}\\${parts[1]}`.toLowerCase()
  }
  return n.toLowerCase()
}

export async function createLink(req: CreateLinkRequest): Promise<{ path: string }> {
  if (process.platform !== 'win32') {
    throw new AppError('not-allowed', 'Creating links is only available on Windows')
  }
  const source = requireAbsolute(req.source)
  const destDir = requireAbsolute(req.destDir)
  if (isRemoteLocation(source) || isRemoteLocation(destDir)) {
    throw new AppError('not-allowed', 'Cannot create a link on a remote location')
  }

  let st
  try {
    st = await fsp.lstat(source)
  } catch {
    throw new AppError('not-found', 'Source path does not exist')
  }
  const isDir = st.isDirectory()

  if (req.type === 'hard' && isDir) {
    throw new AppError('validation', 'Hard links can only be created for files')
  }
  if (req.type === 'junction' && !isDir) {
    throw new AppError('validation', 'Junctions can only be created for folders')
  }
  if (req.type === 'hard' && volumeKey(source) !== volumeKey(destDir)) {
    throw new AppError('validation', 'Hard links must be on the same volume as the source file')
  }

  const base = (req.name?.trim() || path.basename(source)).replace(/[<>:"/\\|?*]/g, '_')
  const destName = (await pathExists(path.join(destDir, base)))
    ? await uniqueTargetName(destDir, base)
    : base
  const dest = path.join(destDir, destName)

  try {
    if (req.type === 'hard') {
      await fsp.link(source, dest)
    } else if (req.type === 'junction') {
      await fsp.symlink(source, dest, 'junction')
    } else {
      await fsp.symlink(source, dest, isDir ? 'dir' : 'file')
    }
  } catch (e) {
    const err = e as NodeJS.ErrnoException
    if (err.code === 'EPERM' || err.code === 'EACCES') {
      throw new AppError(
        'not-allowed',
        req.type === 'symlink' && isDir
          ? 'Could not create the directory symbolic link. Turn on Windows Developer Mode, or try again as administrator.'
          : `Could not create the link (${err.code})`
      )
    }
    throw new AppError('io', err.message || 'Could not create the link')
  }
  return { path: dest }
}
