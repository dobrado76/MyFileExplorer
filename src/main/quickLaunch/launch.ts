import { AppError } from '@shared/result'
import {
  isShortcutLaunchPath,
  splitLaunchArgs,
  type QuickLaunchItem
} from '@shared/schemas/quickLaunch'
import { getSettings } from '../settings/store'
import { execExternal, showItemInFolder } from '../shell'
import { shellExecuteOpen } from '../shell/openCommandLine'
import { expandWindowsEnvPath } from '../paths/expandEnv'
import { requireAbsolute, pathExists } from '../fs/list'

function itemById(id: string): QuickLaunchItem {
  const found = getSettings().quickLaunch.find((x) => x.id === id)
  if (!found) throw new AppError('not-found', 'That Quick launch item was removed')
  return found
}

export async function resolvedQuickLaunchPath(item: QuickLaunchItem): Promise<string> {
  const expanded = expandWindowsEnvPath(item.path.trim())
  let abs: string
  try {
    abs = requireAbsolute(expanded)
  } catch {
    throw new AppError(
      'validation',
      `Path must be absolute after expansion: ${expanded}`
    )
  }
  if (!(await pathExists(abs))) {
    throw new AppError('not-found', `Program not found: ${abs}`, 'Browse to it in Settings → Quick launch.')
  }
  return abs
}

export async function launchQuickLaunchItem(id: string): Promise<{ launched: true }> {
  const item = itemById(id)
  const abs = await resolvedQuickLaunchPath(item)
  if (isShortcutLaunchPath(abs)) {
    const params = item.args.trim() || null
    if (!shellExecuteOpen(abs, params)) {
      throw new AppError('io', `Could not open ${item.name}`)
    }
    return { launched: true }
  }
  return execExternal(item.path, splitLaunchArgs(item.args))
}

export async function revealQuickLaunchItem(id: string): Promise<{ shown: true }> {
  const item = itemById(id)
  const abs = await resolvedQuickLaunchPath(item)
  return showItemInFolder(abs)
}
