import {
  canFollowUserMetadataLink,
  classifyUserMetadataLink,
  formatUserMetadataLinkPath
} from '@shared/userMetadataLink'
import { api, call, IpcError } from './ipc'
import { parentOf } from './paths'
import { useAppStore } from '../store/appStore'

/** Base directory for resolving relative link values on an item. */
export function linkBaseDirForItem(itemPath: string, isDirectory: boolean): string | null {
  if (isDirectory) return itemPath
  return parentOf(itemPath)
}

/** True when the link resolves to a file/folder path (not an http(s) URL). */
export function canRevealUserMetadataLink(raw: string, baseDir: string | null): boolean {
  if (!canFollowUserMetadataLink(raw, baseDir)) return false
  return classifyUserMetadataLink(raw, baseDir)?.kind === 'path'
}

/** Extract a filesystem path from an OS / Explorer drop (Electron File.path). */
export function pathFromDataTransfer(dt: DataTransfer): string | null {
  const file = dt.files?.[0] as (File & { path?: string }) | undefined
  if (file?.path && typeof file.path === 'string' && file.path.trim()) {
    return file.path.trim()
  }
  const uriList = dt.getData('text/uri-list')?.trim()
  if (uriList) {
    const first = uriList.split(/\r?\n/).find((l) => l && !l.startsWith('#'))
    if (first) {
      const classified = classifyUserMetadataLink(first)
      if (classified?.kind === 'path') return classified.path
      if (classified?.kind === 'url' && first.toLowerCase().startsWith('file:')) {
        const again = classifyUserMetadataLink(first)
        if (again?.kind === 'path') return again.path
      }
    }
  }
  const plain = dt.getData('text/plain')?.trim()
  if (plain && !/\s/.test(plain)) {
    const classified = classifyUserMetadataLink(plain)
    if (classified?.kind === 'path') return classified.path
  }
  return null
}

export async function pickUserMetadataLinkPath(
  baseDir: string | null,
  preferRelative: boolean
): Promise<string | null> {
  try {
    const res = await call(api.app.pickPath())
    if (!res.path) return null
    return formatUserMetadataLinkPath(res.path, baseDir, preferRelative)
  } catch (e) {
    useAppStore.getState().notify(e instanceof IpcError ? e.message : String(e), true)
    return null
  }
}

/**
 * Soft existence check for path links (not URLs).
 * `missing` = resolved path does not exist; still allow Open/Reveal attempts.
 */
export async function probeUserMetadataLinkPath(
  raw: string,
  baseDir: string | null
): Promise<'empty' | 'url' | 'ok' | 'missing' | 'unresolved'> {
  const t = raw.trim()
  if (!t) return 'empty'
  const target = classifyUserMetadataLink(t, baseDir)
  if (!target) return 'unresolved'
  if (target.kind === 'url') return 'url'
  if (!canFollowUserMetadataLink(t, baseDir)) return 'unresolved'
  try {
    const st = await call(api.fs.exists({ path: target.path }))
    return st.exists ? 'ok' : 'missing'
  } catch {
    return 'missing'
  }
}

/**
 * Follow a metadata link: http(s) → browser; folder → navigate; file → OS open.
 */
export async function followUserMetadataLink(
  raw: string,
  baseDir: string | null
): Promise<void> {
  const notify = useAppStore.getState().notify
  if (!canFollowUserMetadataLink(raw, baseDir)) {
    notify('Enter an http(s) URL or a file/folder path first', true)
    return
  }
  const target = classifyUserMetadataLink(raw, baseDir)
  if (!target) {
    notify('Could not resolve that link', true)
    return
  }
  try {
    if (target.kind === 'url') {
      await call(api.shell.openExternal({ url: target.url }))
      return
    }
    let isDir = false
    try {
      const st = await call(api.fs.stat({ path: target.path }))
      isDir = st.kind === 'dir'
    } catch {
      /* openPath / navigate will surface missing paths */
    }
    if (isDir) {
      await useAppStore.getState().navigate(target.path)
      return
    }
    await useAppStore.getState().openPath(target.path)
  } catch (e) {
    notify(e instanceof IpcError ? e.message : String(e), true)
  }
}

/** Navigate in-app to the linked file/folder (select file in its parent). */
export async function revealUserMetadataLink(
  raw: string,
  baseDir: string | null
): Promise<void> {
  const notify = useAppStore.getState().notify
  const target = classifyUserMetadataLink(raw, baseDir)
  if (!target || target.kind !== 'path') {
    notify('Reveal is only for file or folder paths', true)
    return
  }
  try {
    await useAppStore.getState().openFileLocation(target.path)
  } catch (e) {
    notify(e instanceof IpcError ? e.message : String(e), true)
  }
}

export async function copyUserMetadataLinkValue(raw: string): Promise<void> {
  const notify = useAppStore.getState().notify
  const t = raw.trim()
  if (!t) return
  try {
    await navigator.clipboard.writeText(t)
    notify('Link copied')
  } catch (e) {
    notify(e instanceof Error ? e.message : String(e), true)
  }
}
