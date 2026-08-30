import { useEffect, useLayoutEffect, useState, type CSSProperties, type JSX, type ReactNode } from 'react'
import { api } from '../lib/ipc'
import { FileIcon, FolderIcon } from '../lib/icons'
import { withIconRequestSlot } from '../lib/iconRequestQueue'
import { useAppStore } from '../store/appStore'
import {
  isVirtualFolderDocumentPath,
  isVirtualFolderGroupPath,
  parseVirtualFolderGroupPath,
  virtualFolderDocumentDir
} from '@shared/virtualFolder'

/** Tint only opaque shell-icon pixels (transparent areas stay clear). */
export function ShellTint({ color, children }: { color: string; children: ReactNode }): JSX.Element {
  const id = `mfe-shell-tint-${color.replace(/[^0-9a-fA-F]/g, '').toLowerCase()}`
  return (
    <span className="item-shell-tint">
      <svg className="item-shell-tint-defs" width="0" height="0" aria-hidden>
        <filter id={id} x="0" y="0" width="1" height="1" colorInterpolationFilters="sRGB">
          <feColorMatrix
            in="SourceGraphic"
            type="saturate"
            values="0"
            result="gray"
          />
          <feFlood floodColor={color} result="flood" />
          <feBlend in="flood" in2="gray" mode="color" result="tinted" />
          <feComposite in="tinted" in2="SourceAlpha" operator="in" />
        </filter>
      </svg>
      <span className="item-shell-tint-gfx" style={{ filter: `url(#${id})` }}>
        {children}
      </span>
    </span>
  )
}

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

/**
 * ShellTint flood for Virtual Folders — same Windows folder glyph as a normal
 * folder, but a clearly paler / whiter yellow so they stay distinct.
 */
export const VIRTUAL_FOLDER_SHELL_TINT = '#fff6d0'

type Props = {
  path: string
  size: number
  isDir?: boolean
  className?: string
  /** While renaming, keep showing the last known glyph (don't refetch / clear). */
  renaming?: boolean
}

function cachedUrl(key: string, extKey: string | null): string | null {
  return memoryCache.get(key) ?? (extKey ? extMemoryCache.get(extKey) ?? null : null)
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
  const letter = /^([a-zA-Z]):/.exec(n)?.[1]?.toUpperCase()
  if (!letter) return false
  const drive = drives.find((d) => d.path.replace(/[\\/]+$/, '').toUpperCase().startsWith(`${letter}:`))
  return drive?.driveType === 'remote' || !!drive?.offline
}

function isVirtualFolderPath(filePath: string, ext: string): boolean {
  return (
    ext === 'mfevirtual' ||
    isVirtualFolderDocumentPath(filePath) ||
    isVirtualFolderGroupPath(filePath)
  )
}

/**
 * Real folder used only to fetch the Windows shell folder glyph for Virtual Folders.
 * Prefer the document's parent directory so we get a normal folder shell icon.
 */
function virtualFolderShellProbe(filePath: string): string {
  const group = parseVirtualFolderGroupPath(filePath)
  const doc = group?.documentPath ?? (isVirtualFolderDocumentPath(filePath) ? filePath : null)
  if (doc) {
    const dir = virtualFolderDocumentDir(doc)
    if (dir) return dir
  }
  return filePath
}

/**
 * Shell (Explorer) icon for a path. Cached in memory by path+size.
 *
 * Dropbox / mapped-drive folders: show a type icon immediately, then upgrade to
 * the rich shell glyph when the off-thread worker finishes (does not freeze UI).
 *
 * Virtual Folders (`.mfevirtual` + embedded groups): same shell folder glyph as a
 * normal folder, tinted to a whiter yellow (`VIRTUAL_FOLDER_SHELL_TINT`).
 */
export function ShellIcon({ path, size, isDir, className, renaming }: Props): JSX.Element {
  const drives = useAppStore((s) => s.drives)
  const ext = extOf(path)
  const isVirtualFolder = isVirtualFolderPath(path, ext)
  const iconPath = isVirtualFolder ? virtualFolderShellProbe(path) : path
  const iconIsDir = isVirtualFolder ? true : isDir
  const deferred = pathNeedsDeferredRichIcon(iconPath, iconIsDir, drives)
  const px = size <= 20 ? 16 : 32
  // Include kind in the key so a poisoned file glyph can't stick on a folder path.
  const key = `${iconPath.toLowerCase()}|${px}|${iconIsDir ? 'd' : 'f'}`
  const extKey =
    !isVirtualFolder && iconIsDir !== true && ext && !PER_FILE_EXTS.has(ext)
      ? `${ext}|${px}`
      : null
  const [url, setUrl] = useState<string | null>(() => cachedUrl(key, extKey))
  const [failed, setFailed] = useState(false)

  const restoreFromCache = (): boolean => {
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
    if (extKey && iconIsDir !== true) extMemoryCache.set(extKey, next)
    setUrl(next)
    setFailed(false)
  }

  // Cancel / same-name commit: no listing refresh — pull the glyph back from cache.
  useLayoutEffect(() => {
    if (renaming) return
    restoreFromCache()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only when rename ends
  }, [renaming, key])

  useEffect(() => {
    let alive = true
    if (restoreFromCache()) return

    setFailed(false)
    const perFile = iconIsDir === true || PER_FILE_EXTS.has(ext)

    const request = async (): Promise<void> => {
      if (!alive) return
      // Deferred paths: placeholder first (fast), then rich upgrade off-thread.
      const first = await api.icons.get({
        path: iconPath,
        size,
        isDir: iconIsDir === true,
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
          path: iconPath,
          size,
          isDir: iconIsDir === true,
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
  }, [key, iconPath, size, extKey, iconIsDir, ext, deferred])

  useEffect(() => {
    const onInvalidate = (ev: Event): void => {
      const detail = (ev as CustomEvent<{ path?: string }>).detail
      const target = detail?.path
      if (!target) return
      if (iconPath.toLowerCase() !== target.toLowerCase() && path.toLowerCase() !== target.toLowerCase()) {
        return
      }
      memoryCache.delete(key)
      void (async () => {
        const first = await api.icons.get({
          path: iconPath,
          size,
          isDir: iconIsDir === true,
          fast: false
        })
        if (first.ok && first.value.url) {
          memoryCache.set(key, first.value.url)
          setUrl(first.value.url)
          setFailed(false)
        } else {
          setFailed(true)
        }
      })()
    }
    window.addEventListener('mfe-shell-icon-invalidate', onInvalidate)
    return () => window.removeEventListener('mfe-shell-icon-invalidate', onInvalidate)
  }, [key, path, iconPath, size, iconIsDir])

  const cls = `shell-icon${className ? ` ${className}` : ''}`
  const box: CSSProperties = {
    width: size,
    height: size,
    flexShrink: 0,
    display: 'block'
  }

  const Placeholder = iconIsDir ? FolderIcon : FileIcon
  const glyph =
    url && !failed ? (
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
          setFailed(true)
        }}
      />
    ) : (
      <Placeholder size={size} className={cls} style={box} />
    )

  if (isVirtualFolder) {
    return <ShellTint color={VIRTUAL_FOLDER_SHELL_TINT}>{glyph}</ShellTint>
  }
  return glyph
}
