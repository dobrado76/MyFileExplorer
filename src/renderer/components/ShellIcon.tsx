import { useEffect, useLayoutEffect, useState, type CSSProperties, type JSX } from 'react'
import { api } from '../lib/ipc'
import { FileIcon, FolderIcon, VirtualFolderIcon } from '../lib/icons'
import { withIconRequestSlot } from '../lib/iconRequestQueue'
import { useAppStore } from '../store/appStore'

const memoryCache = new Map<string, string>()
/** Same glyph for every file of an extension (matches main's extUrlCache). */
const extMemoryCache = new Map<string, string>()
const MAX_CACHE = 4000
/** Icons that are per-file on Windows (must not share by extension). */
const PER_FILE_EXTS = new Set([
  'exe',
  'lnk',
  'ico',
  'dll',
  'scr',
  'cpl',
  'msi',
  'appx',
  'msix',
  'msc'
])

type Props = {
  path: string
  /** Display size in CSS pixels (16 for list/tree, 32+ for grid). */
  size: number
  /** Hint for generic placeholder while loading. */
  isDir?: boolean
  className?: string
  /**
   * When this flips from true → false (rename dismissed without a listing
   * refresh), re-sync the glyph from the in-memory cache. A real rename
   * refreshes the listing and remounts rows; Escape / same-name commit does not.
   */
  renaming?: boolean
}

function extOf(filePath: string): string {
  const base = filePath.split(/[/\\]/).pop() ?? ''
  const d = base.lastIndexOf('.')
  return d > 0 ? base.slice(d + 1).toLowerCase() : ''
}

/** Dropbox / OneDrive / mapped letters — rich icon loads async after a placeholder. */
function pathNeedsDeferredRichIcon(
  filePath: string,
  isDir: boolean | undefined,
  drives: { path: string; driveType?: string; offline?: boolean }[]
): boolean {
  if (isDir !== true) return false
  const n = filePath.replace(/\//g, '\\')
  if (n.startsWith('\\\\')) return true
  if (/(?:^|\\)(Dropbox|OneDrive|Google Drive|iCloud Drive)(?:\\|$)/i.test(n)) return true
  const m = /^([a-zA-Z]:)/i.exec(n)
  if (!m) return false
  const root = `${m[1]!.toUpperCase()}\\`
  const d = drives.find((x) => x.path.toUpperCase() === root)
  return d?.driveType === 'remote' || d?.offline === true
}

/** Drop in-memory glyphs for a path and tell mounted ShellIcons to re-fetch. */
export function invalidateShellIconPath(filePath: string): void {
  const lower = filePath.toLowerCase()
  for (const k of [...memoryCache.keys()]) {
    if (k.startsWith(`${lower}|`)) memoryCache.delete(k)
  }
  window.dispatchEvent(
    new CustomEvent('mfe-shell-icon-invalidate', { detail: { path: lower } })
  )
}

function cachedUrl(key: string, extKey: string | null): string | null {
  const hit = memoryCache.get(key)
  if (hit !== undefined) return hit
  if (!extKey) return null
  return extMemoryCache.get(extKey) ?? null
}

/**
 * Native Windows shell icon for a path (SHGetFileInfo via main).
 * Falls back to a simple SVG while loading or if the shell icon fails.
 *
 * Dropbox / mapped-drive folders: show a type icon immediately, then upgrade to
 * the rich shell glyph when the off-thread worker finishes (does not freeze UI).
 */
export function ShellIcon({ path, size, isDir, className, renaming }: Props): JSX.Element {
  const drives = useAppStore((s) => s.drives)
  const deferred = pathNeedsDeferredRichIcon(path, isDir, drives)
  const px = size <= 20 ? 16 : 32
  // Include kind in the key so a poisoned file glyph can't stick on a folder path.
  const key = `${path.toLowerCase()}|${px}|${isDir ? 'd' : 'f'}`
  const ext = extOf(path)
  const isVirtualFolder = ext === 'mfevirtual'
  // isDir hint still used for shell fetch / placeholders; virtual folders always use in-app glyph.
  const extKey =
    !isVirtualFolder && isDir !== true && ext && !PER_FILE_EXTS.has(ext) ? `${ext}|${px}` : null
  const [url, setUrl] = useState<string | null>(() =>
    isVirtualFolder ? null : cachedUrl(key, extKey)
  )
  const [failed, setFailed] = useState(false)

  const restoreFromCache = (): boolean => {
    if (isVirtualFolder) return true
    const hit = cachedUrl(key, extKey)
    if (!hit) return false
    if (extKey && !memoryCache.get(key)) {
      memoryCache.set(key, hit)
    }
    setUrl(hit)
    setFailed(false)
    return true
  }

  const applyUrl = (next: string): void => {
    if (memoryCache.size > MAX_CACHE) memoryCache.clear()
    memoryCache.set(key, next)
    if (extKey && isDir !== true) extMemoryCache.set(extKey, next)
    setUrl(next)
    setFailed(false)
  }

  // Cancel / same-name commit: no listing refresh — pull the glyph back from cache.
  useLayoutEffect(() => {
    if (isVirtualFolder || renaming) return
    restoreFromCache()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only when rename ends
  }, [renaming, key, isVirtualFolder])

  useEffect(() => {
    if (isVirtualFolder) return
    let alive = true
    if (restoreFromCache()) return

    setFailed(false)
    const perFile = isDir === true || PER_FILE_EXTS.has(ext)

    const request = async (): Promise<void> => {
      if (!alive) return
      // Deferred paths: placeholder first (fast), then rich upgrade off-thread.
      const first = await api.icons.get({
        path,
        size,
        isDir: isDir === true,
        fast: deferred === true
      })
      if (!alive) return
      if (first.ok && first.value.url) {
        applyUrl(first.value.url)
      } else if (!cachedUrl(key, extKey)) {
        setFailed(true)
      }

      if (!alive) return
      if (deferred && first.ok && first.value.pendingRich) {
        const rich = await api.icons.get({
          path,
          size,
          isDir: isDir === true,
          fast: false
        })
        if (!alive) return
        if (rich.ok && rich.value.url) applyUrl(rich.value.url)
      }
    }

    void (perFile && !deferred ? withIconRequestSlot(request) : request())
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, path, size, extKey, isDir, ext, deferred, isVirtualFolder])

  useEffect(() => {
    if (isVirtualFolder) return
    const onInvalidate = (ev: Event): void => {
      const detail = (ev as CustomEvent<{ path?: string }>).detail
      const target = detail?.path
      if (!target || path.toLowerCase() !== target) return
      memoryCache.delete(key)
      setUrl(null)
      setFailed(false)
      void (async () => {
        const res = await api.icons.get({
          path,
          size,
          isDir: isDir === true,
          fast: deferred === true
        })
        if (res.ok && res.value.url) {
          memoryCache.set(key, res.value.url)
          setUrl(res.value.url)
          if (deferred && res.value.pendingRich) {
            const rich = await api.icons.get({
              path,
              size,
              isDir: isDir === true,
              fast: false
            })
            if (rich.ok && rich.value.url) {
              memoryCache.set(key, rich.value.url)
              setUrl(rich.value.url)
            }
          }
        } else {
          setFailed(true)
        }
      })()
    }
    window.addEventListener('mfe-shell-icon-invalidate', onInvalidate)
    return () => window.removeEventListener('mfe-shell-icon-invalidate', onInvalidate)
  }, [key, path, size, isDir, deferred, isVirtualFolder])

  const cls = `shell-icon${className ? ` ${className}` : ''}`
  const box: CSSProperties = {
    width: size,
    height: size,
    flexShrink: 0,
    display: 'block'
  }

  if (isVirtualFolder) {
    return <VirtualFolderIcon size={size} className={cls} style={box} />
  }

  if (url && !failed) {
    return (
      <img
        className={cls}
        src={url}
        width={size}
        height={size}
        style={box}
        alt=""
        draggable={false}
        onError={() => {
          memoryCache.delete(key)
          if (extKey) extMemoryCache.delete(extKey)
          setUrl(null)
          setFailed(true)
        }}
      />
    )
  }

  const Placeholder = isDir ? FolderIcon : FileIcon
  return <Placeholder size={size} className={cls} style={box} />
}
