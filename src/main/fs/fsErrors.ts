import { AppError, type ErrCode } from '@shared/result'
import { findLockingProcesses, formatLockingProcesses } from './lockers'

function nodeErrno(e: unknown): string | null {
  if (e && typeof e === 'object' && 'code' in e && typeof (e as { code: unknown }).code === 'string') {
    return (e as { code: string }).code
  }
  return null
}

function isLockish(code: string | null): boolean {
  return code === 'EPERM' || code === 'EBUSY' || code === 'EACCES' || code === 'ENOTEMPTY'
}

function headlineFor(
  action: 'rename' | 'move' | 'delete' | 'copy',
  isDir: boolean
): string {
  const item = isDir ? 'folder' : 'file'
  if (action === 'rename') {
    return `The action can't be completed because the ${item} or a file in it is open in another program.`
  }
  if (action === 'delete') {
    return `The action can't be completed because the ${item} is open in another program.`
  }
  if (action === 'copy') {
    return `The action can't be completed because the ${item} is in use by another program.`
  }
  return `The action can't be completed because the ${item} is in use by another program.`
}

/**
 * Turn a failed rename/move/delete/copy into an Explorer-grade AppError, including
 * Restart Manager lockers when Windows can identify them.
 */
export async function appErrorFromFsFailure(
  e: unknown,
  opts: {
    action: 'rename' | 'move' | 'delete' | 'copy'
    path: string
    isDir?: boolean
  }
): Promise<AppError> {
  if (e instanceof AppError && (e.code === 'cancelled' || e.code === 'validation')) {
    return e
  }

  const code = nodeErrno(e)
  const raw = e instanceof Error ? e.message : String(e)
  const isDir = opts.isDir ?? false
  const item = isDir ? 'folder' : 'file'

  if (code === 'EEXIST' || (e instanceof AppError && e.code === 'conflict')) {
    if (e instanceof AppError) return e
    return new AppError('conflict', `A file with that name already exists.`, 'Choose a different name.')
  }

  if (code === 'ENOENT' || (e instanceof AppError && e.code === 'not-found')) {
    if (e instanceof AppError) return e
    return new AppError('not-found', `The ${item} no longer exists.`, 'Refresh and try again.')
  }

  // Always ask Restart Manager for mutating ops — shell/trash errors rarely set EPERM.
  const lockers = await findLockingProcesses(opts.path)
  const lockerBlock = formatLockingProcesses(lockers)
  const looksLocked =
    lockers.length > 0 ||
    isLockish(code) ||
    /in use|sharing|access is denied|cannot|recycle|open in/i.test(raw)

  if (looksLocked || opts.action === 'delete' || opts.action === 'move' || opts.action === 'rename') {
    const headline = headlineFor(opts.action, isDir)
    const base =
      e instanceof AppError && !isLockish(code) && lockers.length === 0
        ? e.message
        : headline
    const message = lockerBlock ? `${base}\n\nOpen in:\n${lockerBlock}` : base
    return new AppError(
      'busy',
      message,
      lockerBlock
        ? 'Close the listed program(s), then try again.'
        : e instanceof AppError && e.remediation
          ? e.remediation
          : 'If nothing obvious is open, check File Explorer windows, terminals with that folder as the current directory, or preview panes.'
    )
  }

  if (e instanceof AppError) return e

  let errCode: ErrCode = 'io'
  return new AppError(errCode, raw || `Could not ${opts.action} the ${item}.`)
}
