import { createElement, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type JSX, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { findExactFolderView } from '@shared/folderViews'
import {
  findExactMetadataBinding,
  resolveMetadataSet,
  metadataScopePath
} from '@shared/userMetadataBindings'
import { buildCommandMenuRows, commandMatches, type CommandMenuSubRow } from '@shared/contextMenuCommands'
import {
  applyBuiltinLayoutToMenu,
  collapseMenuSeparators,
  isContextMenuBuiltinEnabled,
  type ContextMenuBuiltinId
} from '@shared/contextMenuBuiltins'
import { discoveredVerbMatches } from '@shared/schemas/shellVerbs'
import type { WindowsToolId } from '@shared/schemas/windowsTools'
import { FilePlus2 } from 'lucide-react'
import { useAppStore, dropOperation } from '../store/appStore'
import { samePath, basename, parentOf, joinPath } from '../lib/paths'
import { pathKey } from '@shared/paths'
import {
  isVirtualFolderDocumentPath,
  isVirtualFolderGroupPath,
  parseVirtualFolderGroupPath,
  virtualFolderDocumentDir,
  virtualFolderOpenCwdPath
} from '@shared/virtualFolder'
import { isVolumeRootPath } from '../lib/rightDrag'
import { isMediaMetadataVideoName } from '@shared/mediaMetadata'
import { isImageExt, isVideoExt } from '../lib/icons'
import { isEditableImagePath } from '@shared/imageEdit'
import { parseUnc } from '@shared/networkPaths'
import { isDeleteMapRow } from '@shared/slideshow/categorizerMap'
import { buildQuickAccess, materializeQuickAccessTokens } from '../lib/quickAccess'
import { api, call, IpcError } from '../lib/ipc'
import { lookupGitForPath } from '../lib/gitUi'
import { useGitFileHistory } from '../lib/gitFileHistory'
import type { ClipboardPasteFormat, ClipboardPeek } from '@shared/schemas/clipboardPaste'
import { NEW_FILE_TYPES } from '../lib/newItemTypes'
import { slideshowCurrentPath } from '../lib/slideshowTypes'
import { ShellIcon } from './ShellIcon'
import { buildScriptsMenuItems, isRemoteLocation } from '../lib/scriptsMenu'
import { itemAdsAvailable } from '../lib/itemAdsUi'
import type { ScriptDefinition } from '@shared/schemas/scripts'
import type { ScriptMenuContext } from '@shared/scriptMatch'

/** File extension including leading dot (e.g. `.ffs_gui`), or null. */
function fileExtension(filePath: string): string | null {
  const name = basename(filePath)
  const dot = name.lastIndexOf('.')
  if (dot <= 0 || dot === name.length - 1) return null
  return name.slice(dot)
}

type MenuActionEv = { shiftKey?: boolean; ctrlKey?: boolean }

function menuMods(e: Pick<MouseEvent | KeyboardEvent, 'shiftKey' | 'ctrlKey'>): MenuActionEv {
  return { shiftKey: e.shiftKey, ctrlKey: e.ctrlKey }
}

type SubEntry = {
  label: string
  action?(ev?: MenuActionEv): void
  /** Nested custom-command submenu (Settings label `Parent \ Child`). */
  items?: SubEntry[]
  sep?: boolean
  title?: string
  /** Leading icon (same pattern as toolbar + New). */
  icon?: ReactNode
}

type MenuItem =
  | { type: 'sep' }
  | {
      type: 'item'
      label: string
      hint?: string
      danger?: boolean
      disabled?: boolean
      builtin?: ContextMenuBuiltinId
      /** Enabled Discover verb id (ordered via builtinLayout). */
      discoveredId?: string
      action(ev?: MenuActionEv): void
    }
  | {
      type: 'submenu'
      label: string
      disabled?: boolean
      builtin?: ContextMenuBuiltinId
      items: SubEntry[]
    }

function pasteSpecialItems(
  destDir: string,
  peek: ClipboardPeek | null,
  close: () => void,
  s: ReturnType<typeof useAppStore.getState>
): SubEntry[] {
  if (!peek || peek.kind === 'empty' || peek.kind === 'files') return []
  const paste = (format: ClipboardPasteFormat, name?: string): void => {
    close()
    void s.pasteClipboardAs(destDir, format, name)
  }
  if (peek.kind === 'image') {
    return [
      { label: 'PNG image', action: () => paste('png') },
      { label: 'JPEG image', action: () => paste('jpeg') },
      { label: 'WebP image', action: () => paste('webp') }
    ]
  }
  if (peek.kind === 'url') {
    return [
      { label: 'Internet shortcut (.url)', action: () => paste('url') },
      { label: 'Save URL as text', action: () => paste('txt') }
    ]
  }
  if (peek.kind === 'html') {
    return [
      { label: 'HTML file', action: () => paste('html') },
      { label: 'Plain text', action: () => paste('txt') }
    ]
  }
  return [
    { label: 'Text file', action: () => paste('txt') },
    {
      label: 'Text file (choose name)…',
      action: () => {
        close()
        s.openDialog({ kind: 'paste-name', destDir, format: 'txt' })
      }
    }
  ]
}

function pasteSpecialMenu(
  destDir: string,
  peek: ClipboardPeek | null,
  close: () => void,
  s: ReturnType<typeof useAppStore.getState>
): MenuItem | null {
  const items = pasteSpecialItems(destDir, peek, close, s)
  if (items.length === 0) return null
  return { type: 'submenu', label: 'Paste Special', builtin: 'paste-special', items }
}

function scriptsSubmenu(
  close: () => void,
  s: ReturnType<typeof useAppStore.getState>,
  ctx: ScriptMenuContext
): MenuItem | null {
  if (!s.settings.scripts?.enabled) return null
  if (isRemoteLocation(ctx.folderPath) || ctx.selectedPaths.some((p) => isRemoteLocation(p))) {
    return null
  }
  // Virtual Folder: scripts receive resolved target paths only (exclude missing).
  let scriptPaths = ctx.selectedPaths
  let scriptRoot = ctx.folderPath
  const pf = s.listing.virtualFolder
  if (pf && ctx.folderPath && samePath(s.listing.path, ctx.folderPath)) {
    scriptPaths = ctx.selectedPaths
      .map((p) => {
        const id = pf.entryIdByPathKey[pathKey(p)]
        const m = id ? pf.byEntryId[id] : null
        return m?.state === 'resolved' && m.resolvedPath ? m.resolvedPath : null
      })
      .filter((p): p is string => !!p)
    scriptRoot = virtualFolderDocumentDir(ctx.folderPath) || parentOf(ctx.folderPath) || ctx.folderPath
  }
  const scriptCtx = { ...ctx, selectedPaths: scriptPaths, folderPath: scriptRoot }
  const items = buildScriptsMenuItems({
    scripts: s.scriptLibrary,
    ctx: scriptCtx,
    aiEnabled: s.settings.ai.enabled,
    onRun(script: ScriptDefinition) {
      close()
      const selectionMode =
        Array.isArray(script.scopes) &&
        script.scopes.includes('selection') &&
        scriptPaths.length > 0
      s.openDialog({
        kind: 'script-run',
        scriptId: script.id,
        name: script.name,
        mode: selectionMode ? 'selection' : 'folder',
        root: scriptRoot ?? undefined,
        paths: scriptPaths,
        recursive: script.recursive
      })
    },
    onManage() {
      close()
      s.openDialog({ kind: 'script-manager' })
    },
    onGenerate() {
      close()
      s.openDialog({
        kind: 'script-generate',
        mode: scriptPaths.length > 0 ? 'selection' : 'folder',
        folderPath: scriptRoot ?? undefined
      })
    }
  })
  return {
    type: 'submenu',
    label: 'Scripts',
    builtin: 'scripts',
    items: items.map((row) =>
      row.items
        ? { label: row.label, items: row.items.map((c) => ({ label: c.label, action: c.action })) }
        : { label: row.label, action: row.action, sep: row.label === '—' }
    )
  }
}

/** Assign / No metadata / Remove explicit assignment for a folder path. */
function metadataSetFolderMenu(
  folderPath: string,
  close: () => void,
  s: ReturnType<typeof useAppStore.getState>
): MenuItem[] {
  if (s.settings.userMetadata?.enabled !== true) return []
  if (s.platform !== 'win32') return []
  if (isRemoteLocation(folderPath) || isVirtualFolderDocumentPath(folderPath)) return []
  const um = s.settings.userMetadata ?? { enabled: false, sets: [], bindings: [] }
  const hasExact = !!findExactMetadataBinding(folderPath, um.bindings)
  const setPicks = (recursive: boolean): SubEntry[] => {
    if (um.sets.length === 0) {
      return [
        {
          label: 'No sets defined…',
          action: () => {
            close()
            s.openDialog({ kind: 'settings', section: 'metadata' })
          }
        }
      ]
    }
    return um.sets.map((set) => ({
      label: set.name,
      action: () => {
        close()
        void s.assignMetadataBinding(folderPath, set.id, recursive)
      }
    }))
  }
  return [
    {
      type: 'submenu',
      label: 'Metadata set…',
      builtin: 'metadata-set',
      items: [
        {
          label: 'Assign set',
          items: [
            { label: 'This folder only', items: setPicks(false) },
            { label: 'This folder and subfolders', items: setPicks(true) }
          ]
        },
        {
          label: 'No metadata',
          items: [
            {
              label: 'This folder only',
              action: () => {
                close()
                void s.assignMetadataBinding(folderPath, null, false)
              }
            },
            {
              label: 'This folder and subfolders',
              action: () => {
                close()
                void s.assignMetadataBinding(folderPath, null, true)
              }
            }
          ]
        },
        ...(hasExact
          ? [
              {
                label: 'Remove explicit assignment',
                action: () => {
                  close()
                  void s.removeMetadataAssignment(folderPath)
                }
              } satisfies SubEntry
            ]
          : [])
      ]
    }
  ]
}

/** True when every path resolves to the same non-null metadata set (edit values). */
function selectionSharesMetadataSet(
  paths: string[],
  entries: { path: string; kind: string }[] | undefined,
  s: ReturnType<typeof useAppStore.getState>
): boolean {
  const um = s.settings.userMetadata ?? { enabled: false, sets: [], bindings: [] }
  if (um.sets.length === 0 || paths.length === 0) return false
  let setId: string | null | undefined
  for (const p of paths) {
    const e = entries?.find((en) => samePath(en.path, p))
    const isDir = e?.kind === 'dir' || e?.kind === 'directory'
    const scope = metadataScopePath(p, !!isDir)
    const set = resolveMetadataSet(scope, um)
    if (!set) return false
    if (setId === undefined) setId = set.id
    else if (setId !== set.id) return false
  }
  return setId != null
}

function mediaMetadataMenu(
  paths: string[],
  close: () => void,
  s: ReturnType<typeof useAppStore.getState>,
  opts?: { treatAsFolders?: boolean; entries?: { path: string; kind: string }[] }
): MenuItem[] {
  if (!s.settings.mediaMetadata.enabled) return []
  const local = paths.filter((p) => p && !p.toLowerCase().startsWith('mfe-remote://'))
  const targets = local.filter((p) => {
    if (opts?.treatAsFolders) return true
    const e = opts?.entries?.find((en) => samePath(en.path, p))
    if (e?.kind === 'dir') return true
    return isMediaMetadataVideoName(basename(p))
  })
  if (targets.length === 0) return []
  return [
    {
      type: 'submenu',
      label: 'Media Metadata',
      items: [
        {
          label: 'Extract from Plex Media Server',
          title:
            'Only items that do not already have metadata and a cover. A library folder writes each show/movie cover, then every video inside.',
          action: () => {
            close()
            void s.mediaMetadataExtractPlex(targets)
          }
        },
        {
          label: 'Download from Internet',
          title:
            'Only items that do not already have metadata and a cover. A library folder writes each show/movie cover, then every video inside.',
          action: () => {
            close()
            void s.mediaMetadataDownload(targets)
          }
        },
        {
          label: 'Update',
          title: 'Refresh existing from their source; missing items are extracted from Plex. Folders include every video inside.',
          action: () => {
            close()
            void s.mediaMetadataRefresh(targets)
          }
        },
        {
          label: 'Clear',
          title: 'Folders include every video inside',
          action: () => {
            close()
            void s.mediaMetadataClear(targets)
          }
        },
        {
          label: 'Consolidate subtitles',
          title:
            'Copy the first English subtitle next to each video and send Subs folders to the Recycle Bin',
          action: () => {
            close()
            void s.mediaMetadataConsolidateSubtitles(targets)
          }
        },
        ...(targets.length === 1
          ? [
              {
                label: 'Change cover…',
                title: 'Pick from Plex and TMDB posters for this title',
                action: () => {
                  close()
                  s.openDialog({ kind: 'change-cover', path: targets[0]! })
                }
              }
            ]
          : []),
        (() => {
          const known = targets
            .map((p) => s.mediaLibrary.items[p.toLowerCase()])
            .filter((x): x is { watched: boolean; genres: string[] } => x != null)
          const allWatched = known.length > 0 && known.every((x) => x.watched)
          const nextWatched = !allWatched
          return {
            label: nextWatched ? 'Mark as Watched' : 'Mark as Unwatched',
            title: 'Requires stored media metadata on the selection',
            action: () => {
              close()
              void s.mediaMetadataSetWatched(targets, nextWatched)
            }
          }
        })()
      ]
    }
  ]
}

function mapCommandSubRows(rows: CommandMenuSubRow[]): SubEntry[] {
  return rows.map((r) =>
    r.items?.length
      ? { label: r.label, items: mapCommandSubRows(r.items) }
      : { label: r.label, action: r.action ?? (() => {}) }
  )
}

function SubMenuFlyout({ entries, depth = 0 }: { entries: SubEntry[]; depth?: number }): JSX.Element {
  const [openNested, setOpenNested] = useState<number | null>(null)
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const clearClose = (): void => {
    if (closeTimer.current) {
      clearTimeout(closeTimer.current)
      closeTimer.current = null
    }
  }

  const scheduleClose = (): void => {
    clearClose()
    closeTimer.current = setTimeout(() => setOpenNested(null), 280)
  }

  useEffect(() => () => clearClose(), [])

  return (
    <>
      {entries.map((sub, j) => {
        if (sub.sep) return <div key={j} className="menu-sep" />
        if (sub.items?.length) {
          const open = openNested === j
          return (
            <div
              key={j}
              className="menu-sub-wrap"
              onMouseEnter={() => {
                clearClose()
                setOpenNested(j)
              }}
              onMouseLeave={scheduleClose}
            >
              <button type="button" className={`menu-item has-sub${open ? ' focused' : ''}`} role="menuitem">
                <span className="menu-item-label">{sub.label}</span>
                <span className="menu-hint">▸</span>
              </button>
              {open && (
                <div
                  className={`context-menu context-submenu context-submenu-nested depth-${depth + 1}`}
                  role="menu"
                  onMouseEnter={clearClose}
                  onMouseLeave={scheduleClose}
                >
                  <SubMenuFlyout entries={sub.items} depth={depth + 1} />
                </div>
              )}
            </div>
          )
        }
        return (
          <button
            key={j}
            type="button"
            className="menu-item"
            onClick={(e) => sub.action?.(menuMods(e))}
            role="menuitem"
            title={sub.title}
            onMouseEnter={() => setOpenNested(null)}
          >
            {sub.icon}
            <span className="menu-item-label">{sub.label}</span>
          </button>
        )
      })}
    </>
  )
}

function filterHiddenBuiltins(
  items: MenuItem[],
  hidden: readonly string[] | undefined,
  layout?: readonly (
    | { type: 'item'; id: string }
    | { type: 'discovered'; id: string }
    | { type: 'sep'; id: string }
  )[]
): MenuItem[] {
  const filtered = items.filter((it) => {
    if (it.type === 'sep') return true
    if (!it.builtin) return true
    return isContextMenuBuiltinEnabled(hidden, it.builtin)
  })
  const collapsed = collapseMenuSeparators(filtered)
  if (!layout?.length) return collapsed
  return applyBuiltinLayoutToMenu(collapsed, layout)
}

function openCommandLineMenuItem(
  folderPath: string,
  close: () => void,
  s: ReturnType<typeof useAppStore.getState>,
  shiftHeld: boolean
): MenuItem {
  return {
    type: 'item',
    label: shiftHeld
      ? 'Open Command Line here as administrator'
      : 'Open Command Line here',
    hint: shiftHeld ? 'UAC' : 'Shift = Admin',
    builtin: 'open-command-line',
    action: (ev) => {
      close()
      void s.openCommandLineHere(folderPath, { elevated: !!(ev?.shiftKey || shiftHeld) })
    }
  }
}

function newSubmenu(
  parent: string,
  close: () => void,
  s: ReturnType<typeof useAppStore.getState>
): MenuItem {
  const groupRef = parseVirtualFolderGroupPath(parent)
  const inVirtualFolder = isVirtualFolderDocumentPath(parent) || !!groupRef
  const createDir = groupRef
    ? virtualFolderDocumentDir(groupRef.documentPath) || groupRef.documentPath
    : inVirtualFolder
      ? virtualFolderDocumentDir(parent) || parent
      : parent
  const folderProbe = joinPath(createDir, '__mfe_new_folder')
  const fileProbe = (ext: string): string => joinPath(parent, `__mfe_new${ext}`)
  if (inVirtualFolder) {
    return {
      type: 'submenu',
      label: 'Add',
      builtin: 'add',
      items: [
        {
          label: 'Virtual Folder',
          icon: <ShellIcon path={folderProbe} size={16} isDir />,
          action: () => {
            close()
            if (groupRef) {
              void s.createVirtualFolder(groupRef.documentPath, {
                parentGroupId: groupRef.groupId
              })
            } else {
              void s.createVirtualFolder(parent)
            }
          }
        }
      ]
    }
  }
  return {
    type: 'submenu',
    label: 'Add',
    builtin: 'add',
    items: [
      {
        label: 'Folder',
        icon: <ShellIcon path={folderProbe} size={16} isDir />,
        action: () => {
          close()
          void s.createFolder(parent)
        }
      },
      {
        label: 'Virtual Folder',
        icon: <ShellIcon path={folderProbe} size={16} isDir />,
        action: () => {
          close()
          void s.createVirtualFolder(parent)
        }
      },
      { label: '', sep: true, action: () => undefined },
      ...NEW_FILE_TYPES.map((t) => ({
        label: t.label,
        icon: <ShellIcon path={fileProbe(t.ext)} size={16} isDir={false} />,
        action: () => {
          close()
          void s.createTypedFile(parent, t.stem, t.ext)
        }
      })),
      { label: '', sep: true, action: () => undefined },
      {
        label: 'From Template',
        items: [
          ...s.settings.templates.map((t) => ({
            label: t.name,
            action: () => {
              close()
              void s.createFromTemplate(t.id, parent)
            }
          })),
          ...(s.settings.templates.length > 0
            ? [{ label: '', sep: true, action: () => undefined }]
            : []),
          {
            label: 'Manage Templates…',
            action: () => {
              close()
              s.openDialog({ kind: 'manage-templates' })
            }
          }
        ]
      },
      ...(s.settings.git?.enabled
        ? [
            {
              label: 'GitHub Repository',
              action: () => {
                close()
                s.openDialog({ kind: 'clone-git-repo', parent })
              }
            }
          ]
        : []),
      { label: '', sep: true, action: () => undefined },
      {
        label: 'Other…',
        icon: createElement(FilePlus2, {
          size: 16,
          strokeWidth: 2,
          'aria-hidden': true,
          className: 'new-item-menu-glyph'
        }),
        action: () => {
          close()
          s.openDialog({ kind: 'new-file', parent })
        }
      }
    ]
  }
}

export function ContextMenu(): JSX.Element | null {
  const menu = useAppStore((s) => s.contextMenu)
  const closeContextMenu = useAppStore((s) => s.closeContextMenu)
  // Git discovery can complete after the menu has opened. Subscribe so the
  // menu is rebuilt when the selected path's repository is added to the cache.
  const gitByRoot = useAppStore((s) => s.gitByRoot)
  const store = useAppStore

  const ref = useRef<HTMLDivElement>(null)
  const subRef = useRef<HTMLDivElement>(null)
  const closeSubTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [pos, setPos] = useState<{ x: number; y: number; maxHeight: number } | null>(null)
  const [focusIdx, setFocusIdx] = useState(-1)
  const [openSub, setOpenSub] = useState<number | null>(null)
  const openSubRef = useRef<number | null>(null)
  const [subFocusIdx, setSubFocusIdx] = useState(-1)
  /** Async Version Control state for a single editable image (omit submenu until ready). */
  const [imageVer, setImageVer] = useState<{ path: string; count: number } | null>(null)
  const [clipPeek, setClipPeek] = useState<ClipboardPeek | null>(null)
  /** Live Shift key — Explorer-style “as administrator” label on Open Command Line. */
  const [shiftHeld, setShiftHeld] = useState(false)
  /** Submenu placement (fixed flyout portaled to body). */
  const [subPlace, setSubPlace] = useState<{
    flipX: boolean
    fixedTop: number
    fixedLeft: number
    maxHeight: number | null
    ready: boolean
  }>({ flipX: false, fixedTop: 0, fixedLeft: 0, maxHeight: null, ready: false })
  const subWrapRefs = useRef<Map<number, HTMLDivElement>>(new Map())

  useEffect(() => {
    if (!menu) {
      setShiftHeld(false)
      return
    }
    const sync = (e: KeyboardEvent): void => {
      setShiftHeld(e.shiftKey)
    }
    const onBlur = (): void => setShiftHeld(false)
    window.addEventListener('keydown', sync, true)
    window.addEventListener('keyup', sync, true)
    window.addEventListener('blur', onBlur)
    return () => {
      window.removeEventListener('keydown', sync, true)
      window.removeEventListener('keyup', sync, true)
      window.removeEventListener('blur', onBlur)
    }
  }, [menu])

  const clearCloseSubTimer = useCallback((): void => {
    if (closeSubTimerRef.current == null) return
    clearTimeout(closeSubTimerRef.current)
    closeSubTimerRef.current = null
  }, [])

  /**
   * Open/close nested menu. Closing from mouse hover uses a short delay so the
   * pointer can cross the parent→submenu gap (or a diagonally shifted panel)
   * without the flyout vanishing.
   *
   * When re-entering the same still-open submenu (e.g. canceling a delayed close),
   * do not reset `subPlace.ready` — that would hide the flyout while `openSub`
   * stays unchanged, so the clamp layout effect never runs again.
   */
  const showSub = useCallback(
    (i: number | null, opts?: { delayMs?: number }): void => {
      clearCloseSubTimer()
      if (i === null) {
        const delay = opts?.delayMs ?? 0
        if (delay > 0) {
          closeSubTimerRef.current = setTimeout(() => {
            closeSubTimerRef.current = null
            openSubRef.current = null
            setOpenSub(null)
            setSubFocusIdx(-1)
            setSubPlace({ flipX: false, fixedTop: 0, fixedLeft: 0, maxHeight: null, ready: false })
          }, delay)
          return
        }
        openSubRef.current = null
        setOpenSub(null)
        setSubFocusIdx(-1)
        setSubPlace({ flipX: false, fixedTop: 0, fixedLeft: 0, maxHeight: null, ready: false })
        return
      }
      if (openSubRef.current === i) return
      openSubRef.current = i
      setOpenSub(i)
      setSubFocusIdx(-1)
      setSubPlace({ flipX: false, fixedTop: 0, fixedLeft: 0, maxHeight: null, ready: false })
    },
    [clearCloseSubTimer]
  )

  useEffect(() => () => clearCloseSubTimer(), [clearCloseSubTimer])

  useEffect(() => {
    if (!menu || menu.dropTransfer || menu.slideshow) {
      setImageVer(null)
      return
    }
    const single = menu.paths.length === 1 ? menu.paths[0]! : null
    if (!single || !isEditableImagePath(single)) {
      setImageVer(null)
      return
    }
    let cancelled = false
    void (async () => {
      try {
        const res = await api.fs.imageEditState({ path: single })
        if (cancelled) return
        if (res.ok && res.value.versionCount >= 1) {
          setImageVer({ path: single, count: res.value.versionCount })
        } else {
          setImageVer(null)
        }
      } catch {
        if (!cancelled) setImageVer(null)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [menu])

  useEffect(() => {
    if (!menu || menu.dropTransfer || menu.slideshow) {
      setClipPeek(null)
      return
    }
    let cancelled = false
    void (async () => {
      try {
        const peek = await call(api.shell.clipboardPeek())
        if (!cancelled) setClipPeek(peek)
      } catch {
        if (!cancelled) setClipPeek({ kind: 'empty' })
      }
    })()
    return () => {
      cancelled = true
    }
  }, [menu])

  useEffect(() => {
    if (!menu || menu.dropTransfer || menu.slideshow || menu.paths.length === 0) return
    const s = store.getState()
    if (s.settings.git?.enabled !== true) return
    const paths = menu.paths.filter((p) => p && !isRemoteLocation(p))
    if (paths.length === 0) return

    // The active pane may be the parent of a project. Discover the actual
    // context-menu targets as well, so a child repository gets its Git menu
    // without requiring the user to navigate into it first.
    void Promise.all(paths.map((p) => s.refreshGitForPath(p)))
  }, [menu, store])

  const items = useMemo<MenuItem[]>(() => {
    if (!menu) return []
    const s = store.getState()
    const { paths } = menu
    const close = closeContextMenu

    // Explorer-style right-drag drop menu — Copy / Move / Create shortcuts / Cancel.
    if (menu.dropTransfer) {
      const dest = menu.dropTransfer.destDir
      const src = paths[0]
      const defaultOp = src
        ? dropOperation(src, dest, false, false)
        : ('move' as const)
      return [
        {
          type: 'item',
          label: 'Copy here',
          hint: defaultOp === 'copy' ? 'default · Ctrl plan' : 'Ctrl plan',
          action: (ev) => {
            close()
            void s.performTransfer('copy', paths, dest, false, !!ev?.ctrlKey)
          }
        },
        {
          type: 'item',
          label: 'Move here',
          hint: defaultOp === 'move' ? 'default · Ctrl plan' : 'Ctrl plan',
          action: (ev) => {
            close()
            void s.performTransfer('move', paths, dest, false, !!ev?.ctrlKey)
          }
        },
        {
          type: 'item',
          label: 'Create shortcuts here',
          action: () => {
            close()
            void s.createShortcutsHere(paths, dest)
          }
        },
        { type: 'sep' },
        {
          type: 'item',
          label: 'Cancel',
          action: () => close()
        }
      ]
    }

    // Tree section headers: Drives / Network / Recycle Bin.
    if (menu.treeSection) {
      if (menu.treeSection === 'recycle-bin') {
        return [
          {
            type: 'item',
            label: s.recycleBin.active ? 'Close Recycle Bin' : 'Open Recycle Bin',
            action: () => {
              close()
              if (s.recycleBin.active) s.closeRecycleBinView()
              else void s.openRecycleBinView()
            }
          },
          {
            type: 'item',
            label: 'Empty Recycle Bin',
            danger: true,
            disabled: s.recycleBin.active && !s.recycleBin.loading && s.recycleBin.items.length === 0,
            action: () => {
              close()
              s.emptyRecycleBinView()
            }
          }
        ]
      }
      const openWindowsTool = (id: WindowsToolId): (() => void) => {
        return () => {
          close()
          void call(api.shell.openWindowsTool({ id })).catch((e) =>
            s.notify(e instanceof Error ? e.message : String(e), true)
          )
        }
      }
      const out: MenuItem[] = []
      if (menu.treeSection === 'drives') {
        out.push(
          {
            type: 'item',
            label: 'Computer Manager',
            builtin: 'computer-manager',
            action: openWindowsTool('computer-manager')
          },
          {
            type: 'item',
            label: 'Device Manager',
            builtin: 'device-manager',
            action: openWindowsTool('device-manager')
          },
          {
            type: 'item',
            label: 'Control Panel',
            builtin: 'control-panel',
            action: openWindowsTool('control-panel')
          },
          { type: 'sep' },
          {
            type: 'item',
            label: s.recycleBin.active ? 'Close Recycle Bin' : 'Open Recycle Bin',
            action: () => {
              close()
              if (s.recycleBin.active) s.closeRecycleBinView()
              else void s.openRecycleBinView()
            }
          },
          {
            type: 'item',
            label: 'Empty Recycle Bin',
            danger: true,
            disabled: s.recycleBin.active && !s.recycleBin.loading && s.recycleBin.items.length === 0,
            action: () => {
              close()
              s.emptyRecycleBinView()
            }
          },
          { type: 'sep' }
        )
      }
      out.push(
        {
          type: 'item',
          label: 'Map network drive…',
          builtin: 'map-network-drive',
          action: () => {
            close()
            void s.openMapNetworkDrive()
          }
        },
        {
          type: 'item',
          label: 'Disconnect network drive…',
          builtin: 'disconnect-network-drive',
          action: () => {
            close()
            void s.openDisconnectNetworkDrive()
          }
        }
      )
      if (menu.treeSection === 'network') {
        out.push(
          { type: 'sep' },
          {
            type: 'item',
            label: 'Refresh',
            builtin: 'network-refresh',
            action: () => {
              close()
              void s.startNetworkDiscovery()
            }
          }
        )
      }
      if (menu.treeSection === 'drives') {
        out.push(
          { type: 'sep' },
          {
            type: 'item',
            label: 'Properties',
            builtin: 'properties',
            action: openWindowsTool('this-pc-properties')
          }
        )
      }
      return filterHiddenBuiltins(
        out,
        s.settings.contextMenu.hiddenBuiltins,
        s.settings.contextMenu.builtinLayout
      )
    }

    // Space usage map / Largest / Recent — focused file actions (path may be outside current listing).
    if (menu.spaceUsage) {
      const single = paths[0]
      if (!single) return []
      const out: MenuItem[] = [
        {
          type: 'item',
          label: 'Reveal',
          builtin: 'open-file-path',
          action: () => {
            close()
            void s.openFileLocation(single)
          }
        },
        {
          type: 'item',
          label: 'Open',
          builtin: 'open',
          action: () => {
            close()
            void (async () => {
              try {
                const st = await call(api.fs.stat({ path: single }))
                if (!st.exists) {
                  s.notify('Item not found', true)
                  return
                }
                if (st.kind === 'dir') {
                  await s.navigate(single)
                  return
                }
                const name = basename(single)
                const extDot = fileExtension(single)
                const ext = extDot ? extDot.slice(1).toLowerCase() : ''
                await s.openEntry({
                  name,
                  path: single,
                  kind: st.kind === 'symlink' ? 'symlink' : 'file',
                  size: st.size,
                  mtimeMs: st.mtimeMs,
                  birthtimeMs: st.birthtimeMs,
                  ext,
                  isHidden: name.startsWith('.')
                })
              } catch (e) {
                s.notify(e instanceof IpcError ? e.message : String(e), true)
              }
            })()
          }
        },
        {
          type: 'item',
          label: 'Open in new tab',
          builtin: 'open-in-new-tab',
          action: () => {
            close()
            void (async () => {
              try {
                const st = await call(api.fs.stat({ path: single }))
                if (!st.exists) {
                  s.notify('Item not found', true)
                  return
                }
                if (st.kind === 'dir') {
                  await s.newTab(single)
                  return
                }
                await s.openFileInNewTab(single)
              } catch (e) {
                s.notify(e instanceof IpcError ? e.message : String(e), true)
              }
            })()
          }
        },
        { type: 'sep' },
        {
          type: 'item',
          label: 'Cut',
          hint: 'Ctrl+X',
          builtin: 'cut',
          action: () => {
            close()
            s.cutSelection([single])
          }
        },
        {
          type: 'item',
          label: 'Copy',
          hint: 'Ctrl+C',
          builtin: 'copy',
          action: () => {
            close()
            s.copySelection([single])
          }
        },
        { type: 'sep' },
        {
          type: 'item',
          label: 'Delete',
          hint: 'Del · Ctrl+Del plan',
          builtin: 'delete',
          action: (ev) => {
            close()
            void s.deleteSelection(false, [single], !!ev?.ctrlKey)
          }
        },
        {
          type: 'item',
          label: 'Delete permanently',
          hint: 'Shift+Del · Ctrl plan',
          danger: true,
          builtin: 'delete-permanently',
          action: (ev) => {
            close()
            void s.deleteSelection(true, [single], !!ev?.ctrlKey)
          }
        },
        { type: 'sep' },
        {
          type: 'item',
          label: 'Copy path',
          builtin: 'copy-path',
          action: () => {
            close()
            void s.copyPathsToClipboard([single], false)
          }
        },
        {
          type: 'item',
          label: 'Properties',
          builtin: 'properties',
          action: () => {
            close()
            void s.openPropertiesWindows([single])
          }
        }
      ]
      return filterHiddenBuiltins(
        out,
        s.settings.contextMenu.hiddenBuiltins,
        s.settings.contextMenu.builtinLayout
      )
    }

    // Slideshow player — categorize / delete / undo / edit / reveal / exit.
    if (menu.slideshow) {
      const cur =
        paths[0] ??
        (s.slideshow.active ? slideshowCurrentPath(s.slideshow.active) : null)
      const map = s.slideshow.categorizerMap
      const folderRows = map.filter((r) => !isDeleteMapRow(r))
      const deleteRow = map.find(isDeleteMapRow) ?? {
        name: 'Delete',
        keyToken: 'Delete',
        path: ''
      }
      const actionCount = s.slideshow.active?.actions.length ?? 0
      const out: MenuItem[] = []

      if (folderRows.length > 0) {
        out.push({
          type: 'submenu',
          label: 'Categorize',
          disabled: !cur || s.slideshow.active?.status === 'building',
          items: folderRows.map((row) => ({
            label: row.name || basename(row.path) || row.keyToken,
            action: () => {
              close()
              if (s.slideshow.active?.status === 'playing') s.slideshowInterrupt()
              s.slideshowMapAction(row)
            }
          }))
        })
      } else {
        out.push({
          type: 'item',
          label: 'Categorize',
          disabled: true,
          hint: 'no map',
          action: () => close()
        })
      }

      out.push(
        {
          type: 'item',
          label: 'Delete',
          danger: true,
          disabled: !cur || s.slideshow.active?.status === 'building',
          action: () => {
            close()
            if (s.slideshow.active?.status === 'playing') s.slideshowInterrupt()
            s.slideshowMapAction(deleteRow)
          }
        },
        {
          type: 'item',
          label: 'Undo',
          disabled: actionCount === 0,
          hint: actionCount > 0 ? String(actionCount) : undefined,
          action: () => {
            close()
            s.slideshowUndoAction()
          }
        },
        { type: 'sep' },
        {
          type: 'item',
          label: 'Edit image…',
          disabled: !cur || !isEditableImagePath(cur),
          action: () => {
            close()
            if (!cur) return
            if (s.slideshow.active?.status === 'playing') s.slideshowInterrupt()
            void (async () => {
              const res = await api.preview.get({ path: cur })
              if (res.ok && res.value.mediaUrl) {
                s.openImageEditor(cur, res.value.mediaUrl)
              } else {
                s.notify(res.ok ? 'No image preview available' : res.error.message, true)
              }
            })()
          }
        },
        {
          type: 'item',
          label: 'Reveal in Explorer',
          disabled: !cur,
          action: () => {
            close()
            if (!cur) return
            void (async () => {
              await s.stopSlideshow()
              const folder = parentOf(cur)
              if (!folder) {
                s.notify('Could not resolve folder', true)
                return
              }
              await s.newTab(folder)
              s.setSelection([cur], cur, cur)
              s.requestFileListScrollTo(cur)
              s.notify(`Revealed ${basename(cur)}`)
            })()
          }
        },
        { type: 'sep' },
        {
          type: 'item',
          label: 'Exit slideshow',
          action: () => {
            close()
            void s.stopSlideshow()
          }
        }
      )
      return out
    }

    // In-app Recycle Bin — Restore / permanent delete only.
    if (s.recycleBin.active) {
      const binItems: MenuItem[] = []
      if (paths.length === 0) {
        binItems.push(
          {
            type: 'item',
            label: 'Empty Recycle Bin',
            danger: true,
            disabled: s.recycleBin.items.length === 0,
            action: () => {
              close()
              s.emptyRecycleBinView()
            }
          },
          {
            type: 'item',
            label: 'Refresh',
            action: () => {
              close()
              void s.refreshRecycleBinView()
            }
          },
          { type: 'sep' },
          {
            type: 'item',
            label: 'Close Recycle Bin',
            action: () => {
              close()
              s.closeRecycleBinView()
            }
          }
        )
        return binItems
      }
      binItems.push(
        {
          type: 'item',
          label: paths.length > 1 ? `Restore ${paths.length} items` : 'Restore',
          hint: 'Enter',
          action: () => {
            close()
            void s.restoreFromRecycleBinView(paths)
          }
        },
        {
          type: 'item',
          label: 'Delete permanently',
          hint: 'Del',
          danger: true,
          action: () => {
            close()
            s.deleteFromRecycleBinView(paths)
          }
        },
        { type: 'sep' },
        {
          type: 'item',
          label: 'Copy original path',
          action: () => {
            close()
            void s.copyPathsToClipboard(paths, false)
          }
        },
        {
          type: 'item',
          label: 'Empty Recycle Bin',
          danger: true,
          disabled: s.recycleBin.items.length === 0,
          action: () => {
            close()
            s.emptyRecycleBinView()
          }
        }
      )
      return binItems
    }

    const entries = s.listing.entries
    const isBackground = paths.length === 0
    const single = paths.length === 1 ? paths[0]! : null
    const singleEntry = single ? entries.find((e) => samePath(e.path, single)) : null
    const isDir = menu.inTree || singleEntry?.kind === 'dir'
    const indexRoots = s.indexRoots
    const isIndexedRoot = single ? indexRoots.some((r) => samePath(r.path, single)) : false
    const result: MenuItem[] = []

    if (isBackground) {
      const tab = s.activeTab()
      const folderPath = tab.path
      const bgVfDoc = isVirtualFolderDocumentPath(folderPath)
      const customizePath = bgVfDoc
        ? virtualFolderOpenCwdPath(folderPath, tab.virtualFolderGroupStack.at(-1))
        : folderPath
      const hasExact = !!findExactFolderView(customizePath, s.settings.folderViews)
      const undoLabel = s.undoLabel()
      const redoLabel = s.redoLabel()
      if (undoLabel || redoLabel) {
        if (undoLabel) {
          result.push({
            type: 'item',
            label: undoLabel,
            hint: 'Ctrl+Z',
            builtin: 'undo',
            action: () => {
              close()
              void s.undo()
            }
          })
        }
        if (redoLabel) {
          result.push({
            type: 'item',
            label: redoLabel,
            hint: 'Ctrl+Y',
            builtin: 'redo',
            action: () => {
              close()
              void s.redo()
            }
          })
        }
        result.push({ type: 'sep' })
      }
      result.push(
        newSubmenu(folderPath, close, s),
        { type: 'sep' },
        {
          type: 'item',
          label: 'Paste',
          hint: 'Ctrl+V · Ctrl plan',
          builtin: 'paste',
          action: (ev) => {
            close()
            void s.pasteInto(folderPath, ev?.ctrlKey ? { planMode: true } : undefined)
          }
        },
        ...((): MenuItem[] => {
          if (bgVfDoc) return []
          const special = pasteSpecialMenu(folderPath, clipPeek, close, s)
          return special ? [special] : []
        })(),
        { type: 'sep' },
        {
          type: 'submenu',
          label: 'Customize this folder',
          builtin: 'customize-folder',
          items: [
            {
              label: 'This folder only',
              action: () => {
                close()
                void s.customizeFolderView(customizePath, false)
              }
            },
            {
              label: 'This folder and subfolders',
              action: () => {
                close()
                void s.customizeFolderView(customizePath, true)
              }
            }
          ]
        },
        ...(hasExact
          ? [
              {
                type: 'item' as const,
                label: 'Remove folder customization',
                builtin: 'remove-folder-customization' as const,
                action: () => {
                  close()
                  void s.removeFolderCustomization(customizePath)
                }
              }
            ]
          : []),
        ...metadataSetFolderMenu(customizePath, close, s),
        { type: 'sep' },
        {
          type: 'item',
          label: 'Copy path',
          builtin: 'copy-path',
          action: () => {
            close()
            void s.copyPathsToClipboard([folderPath], false)
          }
        },
        {
          type: 'item',
          label: 'Show in system Explorer',
          builtin: 'show-in-system-explorer',
          action: () => {
            close()
            void s.showInExplorer(folderPath)
          }
        },
        ...(bgVfDoc || parseUnc(folderPath)?.kind === 'host'
          ? []
          : [openCommandLineMenuItem(folderPath, close, s, shiftHeld)]),
        ...(bgVfDoc
          ? []
          : ([
              {
                type: 'submenu' as const,
                label: 'Video previews',
                builtin: 'video-previews' as const,
                items: [
                  {
                    label: 'Generate missing',
                    action: () => {
                      close()
                      void s.generateVideoThumbs([folderPath], 'missing')
                    }
                  },
                  {
                    label: 'Generate missing (all subfolders)',
                    action: () => {
                      close()
                      void s.generateVideoThumbs([folderPath], 'missing', { recursive: true })
                    }
                  },
                  {
                    label: 'Regenerate all',
                    action: () => {
                      close()
                      void s.generateVideoThumbs([folderPath], 'all')
                    }
                  }
                ]
              },
              ...mediaMetadataMenu([folderPath], close, s, { treatAsFolders: true })
            ] as MenuItem[])),
        ...(itemAdsAvailable(s.platform, folderPath, s.recycleBin.active)
          ? [
              {
                type: 'item' as const,
                label: 'Note…',
                builtin: 'item-note' as const,
                action: () => {
                  close()
                  s.openDialog({ kind: 'item-note', path: folderPath })
                }
              },
              ...(s.settings.userMetadata?.enabled === true
                ? [
                    {
                      type: 'item' as const,
                      label: 'Metadata…',
                      builtin: 'user-metadata' as const,
                      disabled: !selectionSharesMetadataSet(
                        [folderPath],
                        [{ path: folderPath, kind: 'dir' }],
                        s
                      ),
                      action: () => {
                        close()
                        s.openDialog({ kind: 'user-metadata', paths: [folderPath] })
                      }
                    }
                  ]
                : []),
              {
                type: 'item' as const,
                label: 'Set icon…',
                builtin: 'item-icon' as const,
                action: () => {
                  close()
                  s.openDialog({ kind: 'item-icon', path: folderPath })
                }
              }
            ]
          : []),
        {
          type: 'item',
          label: 'Alternate streams…',
          builtin: 'alternate-streams',
          action: () => {
            close()
            s.openDialog({ kind: 'ads-manager', path: folderPath })
          }
        },
        ...(bgVfDoc
          ? []
          : [
              {
                type: 'item' as const,
                label: 'Calculate Statistics',
                hint: shiftHeld ? 'Skip tagged' : 'Shift = skip tagged',
                builtin: 'calculate-folder-statistics' as const,
                disabled: folderPath.toLowerCase().startsWith('mfe-remote://'),
                action: (ev?: MenuActionEv) => {
                  close()
                  void s.calculateFolderStatistics(folderPath, { skipTagged: !!ev?.shiftKey })
                }
              }
            ]),
        {
          type: 'item',
          label: 'Properties',
          builtin: 'properties',
          action: () => {
            close()
            void s.openPropertiesWindows([folderPath])
          }
        }
      )
      const bgScripts = scriptsSubmenu(close, s, {
        folderPath,
        selectedPaths: [],
        selectionKind: 'empty'
      })
      if (bgScripts) result.push(bgScripts)
      return filterHiddenBuiltins(
        result,
        s.settings.contextMenu.hiddenBuiltins,
        s.settings.contextMenu.builtinLayout
      )
    }

    result.push({
      type: 'item',
      label: 'Open',
      hint: 'Enter',
      builtin: 'open',
      action: () => {
        close()
        if (single) {
          if (isDir) {
            const entry = entries.find((e) => samePath(e.path, single))
            if (entry) void s.openEntry(entry)
            else void s.navigate(single)
          } else {
            const entry = entries.find((e) => samePath(e.path, single))
            if (entry) void s.openEntry(entry)
            else void s.openPath(single)
          }
        } else {
          const imagePaths = paths.filter((p) => {
            const entry = entries.find((e) => samePath(e.path, p))
            return entry?.kind === 'file' && isImageExt(entry.ext)
          })
          if (imagePaths.length === paths.length && imagePaths[0]) {
            s.openImageViewer(imagePaths[0], imagePaths)
            return
          }
          for (const p of paths) {
            const entry = entries.find((e) => samePath(e.path, p))
            if (entry) void s.openEntry(entry)
            else if (!entries.some((e) => samePath(e.path, p) && e.kind === 'dir')) {
              void s.openPath(p)
            }
          }
        }
      }
    })

    // Embedded Virtual Folder groups are JSON nodes — not real directories.
    // Offer only navigation / membership / nest-VF actions (no Explore, ZIP, index, ADS, …).
    if (paths.length > 0 && paths.every((p) => isVirtualFolderGroupPath(p))) {
      const vfReadOnly = s.listing.virtualFolder?.readOnly === true
      if (single) {
        result.push(
          {
            type: 'item',
            label: 'Open in new tab',
            builtin: 'open-in-new-tab',
            action: () => {
              close()
              void s.newTab(single)
            }
          },
          {
            type: 'item',
            label: 'Open as root in new tab',
            builtin: 'open-as-root-in-new-tab',
            action: () => {
              close()
              void s.newTab(single, single)
            }
          },
          { type: 'sep' },
          newSubmenu(single, close, s)
        )
      }
      result.push(
        { type: 'sep' },
        {
          type: 'item',
          label: 'Cut',
          hint: 'Ctrl+X',
          builtin: 'cut',
          action: () => {
            close()
            s.cutSelection(menu.inTree && single ? [single] : paths)
          }
        },
        {
          type: 'item',
          label: 'Copy',
          hint: 'Ctrl+C',
          builtin: 'copy',
          action: () => {
            close()
            s.copySelection(menu.inTree && single ? [single] : paths)
          }
        }
      )
      if (single) {
        result.push({
          type: 'item',
          label: 'Paste into folder',
          hint: 'Ctrl+V · Ctrl plan',
          builtin: 'paste-into-folder',
          action: (ev) => {
            close()
            void s.pasteInto(single, { planMode: !!ev?.ctrlKey })
          }
        })
      }
      result.push(
        { type: 'sep' },
        {
          type: 'item',
          label: 'Copy name',
          builtin: 'copy-name',
          action: () => {
            close()
            void s.copyPathsToClipboard(paths, true)
          }
        },
        {
          type: 'item',
          label: 'Rename',
          hint: 'F2',
          disabled: paths.length !== 1,
          builtin: 'rename',
          action: () => {
            close()
            if (single) s.startRename(single, menu.inTree ? 'tree' : 'files')
          }
        }
      )
      if (single) {
        const hasExact = !!findExactFolderView(single, s.settings.folderViews)
        result.push(
          { type: 'sep' },
          {
            type: 'submenu',
            label: 'Customize this folder',
            builtin: 'customize-folder',
            items: [
              {
                label: 'This folder only',
                action: () => {
                  close()
                  void s.customizeFolderView(single, false)
                }
              },
              {
                label: 'This folder and subfolders',
                action: () => {
                  close()
                  void s.customizeFolderView(single, true)
                }
              }
            ]
          },
          ...(hasExact
            ? [
                {
                  type: 'item' as const,
                  label: 'Remove folder customization',
                  builtin: 'remove-folder-customization' as const,
                  action: () => {
                    close()
                    void s.removeFolderCustomization(single)
                  }
                }
              ]
            : []),
          ...metadataSetFolderMenu(single, close, s)
        )
      }
      result.push(
        { type: 'sep' },
        {
          type: 'item',
          label: 'Remove from Virtual Folder',
          hint: 'Del',
          builtin: 'delete',
          disabled: vfReadOnly,
          action: () => {
            close()
            const byDoc = new Map<string, string[]>()
            for (const p of paths) {
              const ref = parseVirtualFolderGroupPath(p)
              if (!ref) continue
              const list = byDoc.get(ref.documentPath) ?? []
              list.push(ref.groupId)
              byDoc.set(ref.documentPath, list)
            }
            for (const [documentPath, entryIds] of byDoc) {
              void s.removeFromVirtualFolder(entryIds, documentPath)
            }
          }
        }
      )
      return filterHiddenBuiltins(
        result,
        s.settings.contextMenu.hiddenBuiltins,
        s.settings.contextMenu.builtinLayout
      )
    }

    if (!isDir && single) {
      result.push({
        type: 'item',
        label: 'Open with default app',
        builtin: 'open-with-default',
        action: () => {
          close()
          void s.openPath(single)
        }
      })
    }

    // User-defined customs + enabled Discover verbs (Settings → Context menu).
    {
      let selKind: 'file' | 'folder' | null = null
      if (menu.inTree && paths.length >= 1) {
        selKind = 'folder'
      } else if (paths.length >= 1) {
        let sawFile = false
        let sawDir = false
        let unknown = false
        for (const p of paths) {
          const e = entries.find((x) => samePath(x.path, p))
          if (e?.kind === 'dir') sawDir = true
          else if (e?.kind === 'file') sawFile = true
          else unknown = true
        }
        if (!unknown && sawFile && !sawDir) selKind = 'file'
        else if (!unknown && sawDir && !sawFile) selKind = 'folder'
      }
      if (selKind) {
        const cmds =
          selKind === 'file' ? s.settings.contextMenu.files : s.settings.contextMenu.folders
        const matched = cmds.filter((c) => commandMatches(c, paths, selKind))
        if (matched.length > 0) {
          result.push({ type: 'sep' })
          const built = buildCommandMenuRows(matched, (cmd) => {
            close()
            void s.runContextMenuCommand(cmd.id, paths)
          })
          for (const row of built) {
            if (row.type === 'item') {
              result.push({ type: 'item', label: row.label, action: () => row.action() })
            } else {
              result.push({
                type: 'submenu',
                label: row.label,
                items: mapCommandSubRows(row.items)
              })
            }
          }
        }
        const disc = s.settings.contextMenu.discovered
        const enabled = new Set(disc?.enabledIds ?? [])
        if (disc?.verbs?.length && enabled.size > 0) {
          for (const id of disc.enabledIds) {
            if (!enabled.has(id)) continue
            const verb = disc.verbs.find((v) => v.id === id)
            if (!verb || !discoveredVerbMatches(verb, paths, selKind)) continue
            result.push({
              type: 'item',
              label: verb.label,
              discoveredId: verb.id,
              action: () => {
                close()
                void s.runDiscoveredContextMenuVerb(verb.id, paths)
              }
            })
          }
        }
      }
    }

    if (s.search.active && single) {
      result.push(
        {
          type: 'item',
          label: 'Open File Path',
          builtin: 'open-file-path',
          action: () => {
            close()
            void s.openFileLocation(single)
          }
        },
        {
          type: 'item',
          label: 'Open File in new tab',
          builtin: 'open-file-in-new-tab',
          action: () => {
            close()
            void s.openFileInNewTab(single)
          }
        }
      )
    }
    if (!isDir && single) {
      if (isEditableImagePath(single)) {
        result.push({
          type: 'item',
          label: 'Edit image…',
          hint: 'Ctrl+E',
          builtin: 'edit-image',
          action: () => {
            close()
            void (async () => {
              const res = await api.preview.get({ path: single })
              if (res.ok && res.value.mediaUrl) {
                s.openImageEditor(single, res.value.mediaUrl)
              } else {
                s.notify(res.ok ? 'No image preview available' : res.error.message, true)
              }
            })()
          }
        })
        if (imageVer && samePath(imageVer.path, single) && imageVer.count >= 1) {
          const n = imageVer.count
          const verItems: SubEntry[] = [
            {
              label: 'Commit changes',
              title:
                'Make the current tip edit the new file body and discard all version history. Other alternate streams (e.g. Zone.Identifier) are kept.',
              action: () => {
                close()
                void s.commitImageVersion(single)
              }
            },
            {
              label: 'Revert to original',
              title:
                'Delete all in-app edit versions and show the pristine original again. Other alternate streams are kept.',
              action: () => {
                close()
                void s.revertImageOriginal(single)
              }
            },
            { label: '', sep: true, action: () => undefined },
            {
              label: 'Original',
              title:
                'Preview the pristine original (what Explorer and other apps open). Does not change the file.',
              action: () => {
                close()
                s.setImageVersionPreview({ path: single, ads: null })
              }
            }
          ]
          for (let k = 1; k <= n; k++) {
            const ver = k
            const tip = ver === n
            verItems.push({
              label: `Version ${ver}${tip ? ' (current)' : ''}`,
              title: tip
                ? `Preview Version ${ver} — the latest in-app edit (what MFE shows by default). Drop it from the preview banner if you no longer need it.`
                : `Preview Version ${ver}. Drop it from the preview banner to remove that edit; newer versions are renumbered.`,
              action: () => {
                close()
                s.setImageVersionPreview({ path: single, ads: `VER_${ver}` })
              }
            })
          }
          result.push({
            type: 'submenu',
            label: 'Version Control',
            builtin: 'version-control',
            items: verItems
          })
        }
      }
      if (isVideoExt(singleEntry?.ext ?? fileExtension(single)?.slice(1) ?? '')) {
        result.push({
          type: 'item',
          label: 'Generate video preview',
          builtin: 'generate-video-preview',
          action: () => {
            close()
            void s.generateVideoThumbs([single], 'all')
          }
        })
      }
    }
    // Multi-select of videos only
    if (!isDir && paths.length > 1) {
      const allVideos = paths.every((p) => {
        const e = entries.find((en) => samePath(en.path, p))
        const ext = e?.ext ?? fileExtension(p)?.slice(1) ?? ''
        return isVideoExt(ext)
      })
      if (allVideos) {
        result.push({
          type: 'item',
          label: 'Generate video previews',
          builtin: 'generate-video-preview',
          action: () => {
            close()
            void s.generateVideoThumbs(paths, 'all')
          }
        })
      }
    }
    if (isDir && single) {
      const unc = parseUnc(single)
      const isNetHost = unc?.kind === 'host'
      const isNetShare = unc?.kind === 'share'
      const isVfDocument = isVirtualFolderDocumentPath(single)
      result.push({
        type: 'item',
        label: 'Open in new tab',
        builtin: 'open-in-new-tab',
        action: () => {
          close()
          void s.newTab(single)
        }
      })
      if (!isNetHost) {
        result.push({
          type: 'item',
          label: 'Open as root in new tab',
          builtin: 'open-as-root-in-new-tab',
          action: () => {
            close()
            void s.newTab(single, single)
          }
        })
      }
      if (isNetHost || isNetShare) {
        result.push(
          { type: 'sep' },
          {
            type: 'item',
            label: 'Map network drive…',
            builtin: 'map-network-drive',
            action: () => {
              close()
              void s.openMapNetworkDrive()
            }
          }
        )
        if (isNetHost && unc) {
          result.push({
            type: 'item',
            label: 'Refresh shares',
            builtin: 'network-refresh',
            action: () => {
              close()
              void s.loadNetworkShares(unc.server, { force: true })
            }
          })
        }
      }
      if (!isNetHost) {
        result.push({ type: 'sep' }, newSubmenu(single, close, s))
        const qa = buildQuickAccess(
          s.knownFolders,
          materializeQuickAccessTokens(
            s.settings.quickAccess,
            s.settings.quickAccessPins,
            s.settings.quickAccessHiddenDefaults
          )
        )
        const pinned = qa.some((e) => samePath(e.path, single))
        result.push(
          pinned
            ? {
                type: 'item',
                label: 'Unpin from Quick access',
                builtin: 'pin-quick-access',
                action: () => {
                  close()
                  void s.unpinQuickAccess(single)
                }
              }
            : {
                type: 'item',
                label: 'Pin to Quick access',
                builtin: 'pin-quick-access',
                action: () => {
                  close()
                  void s.pinQuickAccess(single)
                }
              }
        )
        {
          const hasExact = !!findExactFolderView(single, s.settings.folderViews)
          result.push(
            {
              type: 'submenu',
              label: 'Customize this folder',
              builtin: 'customize-folder',
              items: [
                {
                  label: 'This folder only',
                  action: () => {
                    close()
                    void s.customizeFolderView(single, false)
                  }
                },
                {
                  label: 'This folder and subfolders',
                  action: () => {
                    close()
                    void s.customizeFolderView(single, true)
                  }
                }
              ]
            },
            ...(hasExact
              ? [
                  {
                    type: 'item' as const,
                    label: 'Remove folder customization',
                    builtin: 'remove-folder-customization' as const,
                    action: () => {
                      close()
                      void s.removeFolderCustomization(single)
                    }
                  }
                ]
              : []),
            ...metadataSetFolderMenu(single, close, s)
          )
          if (!isVfDocument) {
            result.push({
              type: 'submenu',
              label: 'Video previews',
              builtin: 'video-previews',
              items: [
                {
                  label: 'Generate missing',
                  action: () => {
                    close()
                    void s.generateVideoThumbs([single], 'missing')
                  }
                },
                {
                  label: 'Generate missing (all subfolders)',
                  action: () => {
                    close()
                    void s.generateVideoThumbs([single], 'missing', { recursive: true })
                  }
                },
                {
                  label: 'Regenerate all',
                  action: () => {
                    close()
                    void s.generateVideoThumbs([single], 'all')
                  }
                }
              ]
            })
          }
        }
      }
    }
    {
      const undoLabel = s.undoLabel()
      const redoLabel = s.redoLabel()
      if (undoLabel || redoLabel) {
        result.push({ type: 'sep' })
        if (undoLabel) {
          result.push({
            type: 'item',
            label: undoLabel,
            hint: 'Ctrl+Z',
            builtin: 'undo',
            action: () => {
              close()
              void s.undo()
            }
          })
        }
        if (redoLabel) {
          result.push({
            type: 'item',
            label: redoLabel,
            hint: 'Ctrl+Y',
            builtin: 'redo',
            action: () => {
              close()
              void s.redo()
            }
          })
        }
      }
    }
    result.push(
      { type: 'sep' },
      {
        type: 'item',
        label: 'Cut',
        hint: 'Ctrl+X',
        disabled: paths.length === 0,
        builtin: 'cut',
        action: () => {
          close()
          s.cutSelection(menu.inTree && single ? [single] : paths.length > 0 ? paths : undefined)
        }
      },
      {
        type: 'item',
        label: 'Copy',
        hint: 'Ctrl+C',
        disabled: paths.length === 0,
        builtin: 'copy',
        action: () => {
          close()
          s.copySelection(menu.inTree && single ? [single] : paths.length > 0 ? paths : undefined)
        }
      }
    )
    if (isDir && single) {
      result.push({
        type: 'item',
        label: 'Paste into folder',
        hint: 'Ctrl+V · Ctrl plan',
        builtin: 'paste-into-folder',
        action: (ev) => {
          close()
          void s.pasteInto(single, { planMode: !!ev?.ctrlKey })
        }
      })
      if (!isVirtualFolderDocumentPath(single)) {
        const special = pasteSpecialMenu(single, clipPeek, close, s)
        if (special) result.push(special)
      }
    }
    if (
      s.platform === 'win32' &&
      s.settings.virtualFolderOsProjectionEnabled &&
      single &&
      isVirtualFolderDocumentPath(single)
    ) {
      const projected = pathKey(single) in s.projectedVirtualFolders
      result.push(
        projected
          ? {
              type: 'item',
              label: 'Unproject',
              action: () => {
                close()
                void s.unprojectVirtualFolder(single)
              }
            }
          : {
              type: 'item',
              label: 'Project to Windows',
              action: () => {
                close()
                void s.projectVirtualFolder(single)
              }
            }
      )
    }
    {
      const toolPaths = menu.inTree && single ? [single] : paths
      const fileToolsItems: SubEntry[] = [
        {
          label: 'Copy To…',
          action: () => {
            close()
            if (toolPaths.length < 1) return
            s.openDialog({ kind: 'copy-move-to', op: 'copy', paths: [...toolPaths] })
          }
        },
        {
          label: 'Move To…',
          action: () => {
            close()
            if (toolPaths.length < 1) return
            s.openDialog({ kind: 'copy-move-to', op: 'move', paths: [...toolPaths] })
          }
        }
      ]
      if (isDir && single && !isVirtualFolderDocumentPath(single)) {
        fileToolsItems.push({
          label: 'Change Icon…',
          action: () => {
            close()
            void s.changeFolderIcon(single)
          }
        })
      }
      if (single) {
        fileToolsItems.push({
          label: 'Create link…',
          action: () => {
            close()
            s.openDialog({ kind: 'create-link', source: single })
          }
        })
      }
      result.push({
        type: 'submenu',
        label: 'File Tools',
        disabled: toolPaths.length < 1,
        builtin: 'file-tools',
        items: fileToolsItems
      })
    }
    const scriptsItem = scriptsSubmenu(close, s, {
      folderPath: s.activeTab().path,
      selectedPaths: paths,
      selectionKind:
        paths.length === 0
          ? 'empty'
          : paths.every((p) => {
              const e = entries.find((en) => samePath(en.path, p))
              return e?.kind === 'dir' || menu.inTree
            })
            ? 'folder'
            : paths.every((p) => {
                const e = entries.find((en) => samePath(en.path, p))
                return e && e.kind !== 'dir'
              })
              ? 'file'
              : 'mixed'
    })
    if (scriptsItem) result.push(scriptsItem)
    result.push(
      { type: 'sep' },
      {
        type: 'item',
        label: 'Rename',
        hint: 'F2',
        disabled: paths.length !== 1,
        builtin: 'rename',
        action: () => {
          close()
          if (single) s.startRename(single, menu.inTree ? 'tree' : 'files')
        }
      },
      {
        type: 'item',
        label: 'Power Rename…',
        disabled: paths.length < 1,
        builtin: 'power-rename',
        action: () => {
          close()
          s.openDialog({ kind: 'power-rename', paths: [...paths] })
        }
      },
      ...(paths.length > 0 && paths.every((p) => isVolumeRootPath(p))
        ? []
        : s.listing.virtualFolder && !menu.inTree
          ? [
              ...((): MenuItem[] => {
                const pf = s.listing.virtualFolder!
                const owning = s.owningFolderView()
                const sort = owning?.sort ?? s.activeTab().sort
                const manual = sort.key === 'manual'
                const rows: MenuItem[] = []
                if (manual && !pf.readOnly && paths.length > 0) {
                  rows.push(
                    {
                      type: 'item',
                      label: 'Move Up',
                      action: () => {
                        close()
                        void s.moveVirtualFolderSelection(-1)
                      }
                    },
                    {
                      type: 'item',
                      label: 'Move Down',
                      action: () => {
                        close()
                        void s.moveVirtualFolderSelection(1)
                      }
                    },
                    { type: 'sep' }
                  )
                }
                if (!manual) {
                  rows.push({
                    type: 'item',
                    label: 'Sort → Manual order',
                    action: () => {
                      close()
                      s.setSort({ key: 'manual', dir: 'asc' })
                    }
                  })
                }
                rows.push({
                  type: 'item',
                  label: 'Remove from Virtual Folder',
                  hint: 'Del',
                  builtin: 'delete',
                  disabled: pf.readOnly,
                  action: () => {
                    close()
                    const ids = paths
                      .map((p) => pf.entryIdByPathKey[pathKey(p)])
                      .filter((id): id is string => !!id)
                    void s.removeFromVirtualFolder(ids)
                  }
                })
                if (single) {
                  rows.push(
                    {
                      type: 'item',
                      label: 'Locate Target…',
                      disabled: pf.readOnly,
                      action: () => {
                        close()
                        void (async () => {
                          const cur = useAppStore.getState().listing.virtualFolder
                          if (!cur || !single) return
                          const entryId = cur.entryIdByPathKey[pathKey(single)]
                          if (!entryId) return
                          try {
                            const picked = await call(
                              api.slideshow.pickOpenFile({
                                title: 'Locate Target',
                                filters: [{ name: 'All files', extensions: ['*'] }]
                              })
                            )
                            if (!picked.path) return
                            await useAppStore.getState().relinkVirtualFolderEntry(entryId, picked.path)
                          } catch (e) {
                            useAppStore
                              .getState()
                              .notify(e instanceof IpcError ? e.message : String(e), true)
                          }
                        })()
                      }
                    },
                    {
                      type: 'item',
                      label: 'Reveal in Real Folder',
                      action: () => {
                        close()
                        void s.openFileLocation(single)
                      }
                    }
                  )
                }
                rows.push({
                  type: 'item',
                  label: 'Delete from Disk…',
                  hint: 'Shift+Del',
                  danger: true,
                  builtin: 'delete-permanently',
                  action: (ev?: MenuActionEv) => {
                    close()
                    void s.deleteSelection(true, paths, !!ev?.ctrlKey)
                  }
                })
                return rows
              })()
            ]
          : [
            {
              type: 'item' as const,
              label: 'Delete',
              hint: 'Del · Ctrl+Del plan',
              builtin: 'delete' as const,
              action: (ev?: MenuActionEv) => {
                close()
                // Del → Recycle Bin (never permanent).
                void s.deleteSelection(
                  false,
                  menu.inTree && single ? [single] : paths.length > 0 ? paths : undefined,
                  !!ev?.ctrlKey
                )
              }
            },
            {
              type: 'item' as const,
              label: 'Delete permanently',
              hint: 'Shift+Del · Ctrl plan',
              danger: true,
              builtin: 'delete-permanently' as const,
              action: (ev?: MenuActionEv) => {
                close()
                void s.deleteSelection(
                  true,
                  menu.inTree && single ? [single] : paths.length > 0 ? paths : undefined,
                  !!ev?.ctrlKey
                )
              }
            }
          ]),
      ...(paths.length > 0 &&
      !paths.some((p) => isVirtualFolderDocumentPath(p) || isVirtualFolderGroupPath(p))
        ? [
            {
              type: 'item' as const,
              label: 'Compress to ZIP file',
              builtin: 'compress-zip' as const,
              action: () => {
                close()
                void s.compressToZip(
                  menu.inTree && single ? [single] : paths
                )
              }
            }
          ]
        : []),
      ...(paths.length > 0 &&
      paths.every((p) => (fileExtension(p) ?? '').toLowerCase() === '.zip')
        ? [
            {
              type: 'item' as const,
              label: 'Extract All…',
              builtin: 'extract-zip' as const,
              action: () => {
                close()
                void s.extractZip(menu.inTree && single ? [single] : paths)
              }
            }
          ]
        : []),
      { type: 'sep' },
      {
        type: 'item',
        label: 'Copy path',
        builtin: 'copy-path',
        action: () => {
          close()
          void s.copyPathsToClipboard(paths, false)
        }
      },
      {
        type: 'item',
        label: 'Copy name',
        builtin: 'copy-name',
        action: () => {
          close()
          void s.copyPathsToClipboard(paths, true)
        }
      },
      {
        type: 'item',
        label: 'Show in system Explorer',
        builtin: 'show-in-system-explorer',
        action: () => {
          close()
          if (single) void s.showInExplorer(single)
        }
      },
      ...(isDir &&
      single &&
      parseUnc(single)?.kind !== 'host' &&
      !isVirtualFolderDocumentPath(single)
        ? [openCommandLineMenuItem(single, close, s, shiftHeld)]
        : []),
      { type: 'sep' },
      {
        type: 'submenu',
        label: 'Hide from view',
        builtin: 'hide-from-view',
        items: single
          ? (() => {
              const name = basename(single)
              const ext = !isDir ? fileExtension(single) : null
              const items: SubEntry[] = []
              if (ext) {
                items.push({
                  label: `All *.${ext.slice(1)} files`,
                  action: () => {
                    close()
                    void s.addViewFilterPatterns([`*.${ext.slice(1)}`])
                  }
                })
              }
              items.push(
                {
                  label: `All instances (*\\${name})`,
                  action: () => {
                    close()
                    void s.addViewFilterPatterns([`*\\${name}`])
                  }
                },
                {
                  label: `Only this instance (this ${isDir ? 'folder' : 'file'})`,
                  action: () => {
                    close()
                    void s.addViewFilterPatterns([single])
                  }
                }
              )
              return items
            })()
          : (() => {
              const items: SubEntry[] = []
              const exts = [
                ...new Set(
                  paths
                    .filter((p) => {
                      const e = entries.find((en) => samePath(en.path, p))
                      return !e || e.kind !== 'dir'
                    })
                    .map((p) => fileExtension(p))
                    .filter((x): x is string => !!x)
                    .map((x) => x.toLowerCase())
                )
              ]
              for (const ext of exts.slice(0, 5)) {
                items.push({
                  label: `All *.${ext.slice(1)} files`,
                  action: () => {
                    close()
                    void s.addViewFilterPatterns([`*.${ext.slice(1)}`])
                  }
                })
              }
              items.push(
                {
                  label: `All instances (${paths.length} names)`,
                  action: () => {
                    close()
                    const names = [...new Set(paths.map((p) => basename(p).toLowerCase()))]
                    void s.addViewFilterPatterns(names.map((n) => `*\\${n}`))
                  }
                },
                {
                  label: `Only these instances (${paths.length} items)`,
                  action: () => {
                    close()
                    void s.addViewFilterPatterns([...paths])
                  }
                }
              )
              return items
            })()
      }
    )
    if (isDir && single && !isVirtualFolderDocumentPath(single)) {
      result.push({ type: 'sep' })
      const isDriveRoot = /^[a-zA-Z]:\\?$/i.test(single.replace(/[\\/]+$/, ''))
      const uncKind = parseUnc(single)?.kind
      if (isDriveRoot) {
        const drive = s.drives.find(
          (d) => d.path.replace(/[\\/]+$/, '').toLowerCase() === single.replace(/[\\/]+$/, '').toLowerCase()
        )
        if (drive?.driveType === 'remote') {
          const letter = single.replace(/[\\/]+$/, '').toUpperCase().slice(0, 2)
          result.push({
            type: 'item',
            label: drive.offline
              ? `Disconnect ${letter} (forget mapping)…`
              : `Disconnect ${letter}…`,
            hint: drive.offline ? 'Removes persistent map' : undefined,
            builtin: 'disconnect-network-drive',
            action: () => {
              close()
              void s.disconnectMappedDrive(single)
            }
          })
        }
      }
      if (uncKind === 'host') {
        /* bare \\server — no search index */
      } else if (isIndexedRoot) {
        result.push({
          type: 'item',
          label: 'Remove from search index',
          builtin: 'search-index',
          action: () => {
            close()
            void s.removeIndexRootAction(single)
          }
        })
      } else if (isDriveRoot) {
        result.push({
          type: 'item',
          label: 'Index this drive',
          builtin: 'search-index',
          action: () => {
            close()
            void s.addVolumeRootAction(single)
          }
        })
      } else {
        result.push({
          type: 'item',
          label: 'Add folder to search index',
          builtin: 'search-index',
          action: () => {
            close()
            void s.addIndexRootAction(single)
          }
        })
      }
    }
    result.push(
      { type: 'sep' },
      ...mediaMetadataMenu(
        (paths.length > 0 ? paths : single ? [single] : []).filter(
          (p) => !isVirtualFolderDocumentPath(p) && !isVirtualFolderGroupPath(p)
        ),
        close,
        s,
        {
          treatAsFolders: menu.inTree || (isDir && (paths.length <= 1)),
          entries
        }
      ),
      ...(single && itemAdsAvailable(s.platform, single, s.recycleBin.active)
        ? [
            {
              type: 'item' as const,
              label: 'Note…',
              builtin: 'item-note' as const,
              action: () => {
                close()
                s.openDialog({ kind: 'item-note', path: single })
              }
            },
            ...(s.settings.userMetadata?.enabled === true
              ? [
                  {
                    type: 'item' as const,
                    label: 'Metadata…',
                    builtin: 'user-metadata' as const,
                    disabled: !selectionSharesMetadataSet(
                      paths.length > 0 &&
                        paths.every((p) => itemAdsAvailable(s.platform, p, s.recycleBin.active))
                        ? paths
                        : [single],
                      entries,
                      s
                    ),
                    action: () => {
                      close()
                      const sel =
                        paths.length > 0 &&
                        paths.every((p) => itemAdsAvailable(s.platform, p, s.recycleBin.active))
                          ? paths
                          : [single]
                      s.openDialog({ kind: 'user-metadata', paths: sel })
                    }
                  }
                ]
              : []),
            {
              type: 'item' as const,
              label: 'Set icon…',
              builtin: 'item-icon' as const,
              action: () => {
                close()
                s.openDialog({ kind: 'item-icon', path: single })
              }
            }
          ]
        : []),
      {
        type: 'item',
        label: 'Alternate streams…',
        disabled: paths.length !== 1,
        builtin: 'alternate-streams',
        action: () => {
          close()
          if (single) s.openDialog({ kind: 'ads-manager', path: single })
        }
      },
      ...(isDir && single && !isVirtualFolderDocumentPath(single)
        ? [
            {
              type: 'item' as const,
              label: 'Calculate Statistics',
              hint: shiftHeld ? 'Skip tagged' : 'Shift = skip tagged',
              builtin: 'calculate-folder-statistics' as const,
              disabled: single.toLowerCase().startsWith('mfe-remote://'),
              action: (ev?: MenuActionEv) => {
                close()
                void s.calculateFolderStatistics(single, { skipTagged: !!ev?.shiftKey })
              }
            }
          ]
        : []),
      ...(() => {
        if (!s.settings.git?.enabled || paths.length < 1) return [] as MenuItem[]
        if (paths.some((p) => isRemoteLocation(p))) return [] as MenuItem[]
        const lookups = paths.map((p) => lookupGitForPath(gitByRoot, p))
        if (lookups.some((l) => !l)) return [] as MenuItem[]
        const rootPath = lookups[0]!.rootPath
        if (!lookups.every((l) => l && samePath(l.rootPath, rootPath))) return [] as MenuItem[]
        const targetPaths = [...paths]
        const refreshAfter = async (): Promise<void> => {
          try {
            const res = await call(api.git.refresh({ repoRoot: rootPath }))
            s.mergeGitStatus(res.status)
          } catch {
            void s.refreshGitForPath(rootPath)
          }
        }
        const runGit = async (
          okMsg: string,
          fn: () => Promise<{ success: boolean; stderr: string; stdout: string }>
        ): Promise<void> => {
          try {
            const res = await fn()
            if (!res.success) {
              s.notify((res.stderr || res.stdout || 'Git command failed').trim().slice(0, 400), true)
              return
            }
            s.notify(okMsg)
            await refreshAfter()
            s.setSelection(targetPaths)
          } catch (e) {
            s.notify(e instanceof IpcError ? e.message : String(e), true)
          }
        }
        const gitItems: SubEntry[] = [
          {
            label: 'Stage',
            action: () => {
              close()
              void runGit('Staged', () =>
                call(api.git.stage({ repoRoot: rootPath, paths: targetPaths }))
              )
            }
          },
          {
            label: 'Unstage',
            action: () => {
              close()
              void runGit('Unstaged', () =>
                call(api.git.unstage({ repoRoot: rootPath, paths: targetPaths }))
              )
            }
          },
          {
            label: 'Discard…',
            action: () => {
              close()
              void (async () => {
                const ok = await s.askConfirm({
                  title: 'Discard changes?',
                  message:
                    targetPaths.length === 1
                      ? `Discard uncommitted changes to “${basename(targetPaths[0]!)}”? This cannot be undone.`
                      : `Discard uncommitted changes to ${targetPaths.length} items? This cannot be undone.`,
                  confirmLabel: 'Discard',
                  danger: true
                })
                if (!ok) return
                await runGit('Discarded', () =>
                  call(api.git.discard({ repoRoot: rootPath, paths: targetPaths }))
                )
              })()
            }
          },
          {
            label: 'Gitignore',
            action: () => {
              close()
              void (async () => {
                try {
                  const res = await call(
                    api.git.ignore({ repoRoot: rootPath, paths: targetPaths })
                  )
                  if (res.patternsAdded.length > 0) {
                    const n = res.patternsAdded.length
                    const extra =
                      res.removedFromIndex.length > 0
                        ? ` (removed ${res.removedFromIndex.length} from the index)`
                        : ''
                    s.notify(
                      n === 1
                        ? `Added to .gitignore: ${res.patternsAdded[0]}${extra}`
                        : `Added ${n} patterns to .gitignore${extra}`
                    )
                  } else {
                    s.notify('Already listed in .gitignore')
                  }
                  if (!res.success && res.stderr.trim()) {
                    s.notify(res.stderr.trim().slice(0, 400), true)
                  }
                  await refreshAfter()
                  s.setSelection(targetPaths)
                } catch (e) {
                  s.notify(e instanceof IpcError ? e.message : String(e), true)
                }
              })()
            }
          },
          ...(targetPaths.length === 1 && !isDir
            ? [
                {
                  label: 'Show changes',
                  action: () => {
                    close()
                    void (async () => {
                      try {
                        const res = await call(
                          api.git.showDiff({ repoRoot: rootPath, path: targetPaths[0]! })
                        )
                        if (!res.launched) {
                          s.notify(res.message || 'Diff tool not configured', true)
                        }
                      } catch (e) {
                        s.notify(e instanceof IpcError ? e.message : String(e), true)
                      }
                    })()
                  }
                } satisfies SubEntry,
                {
                  label: 'Git History…',
                  action: () => {
                    close()
                    useGitFileHistory.getState().open(rootPath, targetPaths[0]!)
                  }
                } satisfies SubEntry
              ]
            : []),
          {
            label: 'Copy repo-relative path',
            action: () => {
              close()
              void (async () => {
                try {
                  const res = await call(
                    api.git.relativePaths({ repoRoot: rootPath, paths: targetPaths })
                  )
                  await navigator.clipboard.writeText(res.paths.join('\r\n'))
                  s.notify(res.paths.length === 1 ? 'Relative path copied' : 'Relative paths copied')
                } catch (e) {
                  s.notify(e instanceof IpcError ? e.message : String(e), true)
                }
              })()
            }
          },
          {
            label: 'Open repository root',
            action: () => {
              close()
              void s.navigate(rootPath)
            }
          },
          {
            label: 'Open terminal at root',
            action: () => {
              close()
              void (async () => {
                try {
                  await call(api.git.openTerminal({ repoRoot: rootPath }))
                } catch (e) {
                  s.notify(e instanceof IpcError ? e.message : String(e), true)
                }
              })()
            }
          },
          {
            label: 'Refresh Git status',
            action: () => {
              close()
              void (async () => {
                await refreshAfter()
                s.notify('Git status refreshed')
                s.setSelection(targetPaths)
              })()
            }
          }
        ]
        return [
          {
            type: 'submenu' as const,
            label: 'Git',
            builtin: 'git' as const,
            items: gitItems
          }
        ]
      })(),
      {
        type: 'item',
        label: 'Properties',
        disabled: paths.length === 0,
        builtin: 'properties',
        hint:
          paths.length > 1
            ? shiftHeld
              ? 'Separate windows'
              : 'Shift = separate windows'
            : undefined,
        action: (ev?: MenuActionEv) => {
          close()
          void s.openPropertiesWindows(paths, {
            separate: !!(ev?.shiftKey || shiftHeld)
          })
        }
      }
    )
    return filterHiddenBuiltins(
        result,
        s.settings.contextMenu.hiddenBuiltins,
        s.settings.contextMenu.builtinLayout
      )
  }, [menu, closeContextMenu, store, gitByRoot, imageVer, shiftHeld, clipPeek])

  // Clamp open submenu flyout (portaled to body; fixed coords).
  useLayoutEffect(() => {
    if (openSub === null) {
      setSubPlace({ flipX: false, fixedTop: 0, fixedLeft: 0, maxHeight: null, ready: false })
      return
    }
    const wrap = subWrapRefs.current.get(openSub)
    const sub = subRef.current
    if (!wrap || !sub) return

    const margin = 8
    const vw = window.innerWidth
    const vh = window.visualViewport?.height ?? window.innerHeight
    const vTop = window.visualViewport?.offsetTop ?? 0
    const wrapRect = wrap.getBoundingClientRect()
    const raw = sub.getBoundingClientRect()
    const maxHeight = Math.max(80, vh - margin * 2)
    const height = Math.min(raw.height, maxHeight)
    const subW = raw.width

    const fitsRight = wrapRect.right + 2 + subW <= vw - margin
    const fitsLeft = wrapRect.left - 2 - subW >= margin
    const flipX = !fitsRight && fitsLeft

    const fixedLeft = flipX ? wrapRect.left - subW - 2 : wrapRect.right + 2
    let fixedTop = wrapRect.top - 5
    if (fixedTop + height > vTop + vh - margin) {
      fixedTop = vTop + vh - margin - height
    }
    if (fixedTop < vTop + margin) {
      fixedTop = vTop + margin
    }

    setSubPlace({ flipX, fixedTop, fixedLeft, maxHeight, ready: true })
  }, [openSub, items])

  useLayoutEffect(() => {
    if (!menu) {
      setPos(null)
      return
    }
    const el = ref.current
    if (!el) return

    const clampMenu = (): void => {
      const margin = 8
      const vh = window.visualViewport?.height ?? window.innerHeight
      const vTop = window.visualViewport?.offsetTop ?? 0
      const vw = window.innerWidth
      const maxHeight = Math.max(120, vh - margin * 2)
      el.style.maxHeight = `${maxHeight}px`
      el.style.overflowY = 'auto'
      const rect = el.getBoundingClientRect()
      const menuH = Math.min(rect.height, maxHeight)
      const menuW = rect.width

      let x = menu.x
      let y = menu.y
      if (x + menuW > vw - margin) x = Math.max(margin, vw - margin - menuW)
      if (x < margin) x = margin
      if (y + menuH > vTop + vh - margin) {
        y = Math.max(vTop + margin, vTop + vh - margin - menuH)
      }
      if (y < vTop + margin) y = vTop + margin

      setPos({ x, y, maxHeight })
    }

    clampMenu()
    window.addEventListener('resize', clampMenu)
    window.visualViewport?.addEventListener('resize', clampMenu)
    window.visualViewport?.addEventListener('scroll', clampMenu)
    return () => {
      window.removeEventListener('resize', clampMenu)
      window.visualViewport?.removeEventListener('resize', clampMenu)
      window.visualViewport?.removeEventListener('scroll', clampMenu)
    }
  }, [menu, items])

  useLayoutEffect(() => {
    if (!menu) return
    setFocusIdx(-1)
    clearCloseSubTimer()
    openSubRef.current = null
    setOpenSub(null)
    setSubFocusIdx(-1)
    setSubPlace({ flipX: false, fixedTop: 0, fixedLeft: 0, maxHeight: null, ready: false })
  }, [menu, clearCloseSubTimer])

  useEffect(() => {
    if (!menu) return
    const onKey = (e: KeyboardEvent): void => {
      const actionable = items
        .map((it, i) => ({ it, i }))
        .filter((x) => (x.it.type === 'item' || x.it.type === 'submenu') && !x.it.disabled)
      const focused = items[focusIdx]
      const subItems = openSub !== null && focused?.type === 'submenu' ? focused.items : null
      const subActionable = subItems
        ? subItems.map((it, i) => ({ it, i })).filter((x) => !x.it.sep)
        : []
      if (e.key === 'Escape') {
        if (openSub !== null) showSub(null)
        else closeContextMenu()
      } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault()
        if (subItems) {
          const idxs = subActionable.map((x) => x.i)
          if (idxs.length === 0) return
          const cur = idxs.indexOf(subFocusIdx)
          const next =
            e.key === 'ArrowDown'
              ? idxs[(cur + 1) % idxs.length]
              : idxs[(cur - 1 + idxs.length) % idxs.length]
          if (next !== undefined) setSubFocusIdx(next)
        } else {
          const idxs = actionable.map((x) => x.i)
          const cur = idxs.indexOf(focusIdx)
          const next =
            e.key === 'ArrowDown'
              ? idxs[(cur + 1) % idxs.length]
              : idxs[(cur - 1 + idxs.length) % idxs.length]
          if (next !== undefined) {
            setFocusIdx(next)
            showSub(null)
          }
        }
      } else if (e.key === 'ArrowRight' && focused?.type === 'submenu' && openSub === null) {
        e.preventDefault()
        showSub(focusIdx)
        const first = focused.items.findIndex((x) => !x.sep)
        setSubFocusIdx(first >= 0 ? first : 0)
      } else if (e.key === 'ArrowLeft' && openSub !== null) {
        e.preventDefault()
        showSub(null)
      } else if (e.key === 'Enter') {
        if (subItems && subFocusIdx >= 0) {
          const sub = subItems[subFocusIdx]
          if (sub && !sub.sep && sub.action) sub.action(menuMods(e))
        } else if (focused?.type === 'submenu' && !focused.disabled) {
          showSub(focusIdx)
          const first = focused.items.findIndex((x) => !x.sep)
          setSubFocusIdx(first >= 0 ? first : 0)
        } else if (focused && focused.type === 'item' && !focused.disabled) {
          focused.action(menuMods(e))
        }
      }
      e.stopPropagation()
    }
    const onClick = (e: MouseEvent): void => {
      const t = e.target as Node
      if (ref.current?.contains(t)) return
      if (subRef.current?.contains(t)) return
      closeContextMenu()
    }
    window.addEventListener('keydown', onKey, true)
    window.addEventListener('mousedown', onClick)
    return () => {
      window.removeEventListener('keydown', onKey, true)
      window.removeEventListener('mousedown', onClick)
    }
  }, [menu, items, focusIdx, openSub, subFocusIdx, closeContextMenu, showSub])

  if (!menu) return null

  return (
    <div
      ref={ref}
      className={`context-menu${menu.slideshow ? ' slideshow-ctx' : ''}`}
      style={{
        left: pos?.x ?? menu.x,
        top: pos?.y ?? menu.y,
        maxHeight: pos?.maxHeight ?? 'calc(100vh - 16px)',
        overflowY: 'auto',
        visibility: pos ? 'visible' : 'hidden'
      }}
      role="menu"
      onMouseDown={(e) => e.stopPropagation()}
      onMouseMove={(e) => {
        if (e.shiftKey !== shiftHeld) setShiftHeld(e.shiftKey)
      }}
    >
      {items.map((item, i) => {
        if (item.type === 'sep') return <div key={i} className="menu-sep" />
        if (item.type === 'submenu') {
          const open = openSub === i
          return (
            <div
              key={i}
              ref={(el) => {
                if (el) subWrapRefs.current.set(i, el)
                else subWrapRefs.current.delete(i)
              }}
              className="menu-sub-wrap"
              onMouseEnter={() => {
                showSub(i)
                setFocusIdx(i)
              }}
            >
              <button
                className={`menu-item has-sub${focusIdx === i || open ? ' focused' : ''}`}
                disabled={item.disabled}
                onClick={() => showSub(open ? null : i)}
                role="menuitem"
                aria-haspopup="menu"
                aria-expanded={open}
              >
                {item.label}
                <span className="menu-hint">▸</span>
              </button>
              {open
                ? createPortal(
                    <div
                      ref={subRef}
                      className={`context-menu context-submenu${subPlace.flipX ? ' flip' : ''}`}
                      role="menu"
                      onMouseEnter={() => {
                        clearCloseSubTimer()
                        setFocusIdx(i)
                      }}
                      style={{
                        position: 'fixed',
                        left: subPlace.fixedLeft,
                        top: subPlace.fixedTop,
                        maxHeight: subPlace.maxHeight ?? undefined,
                        visibility: subPlace.ready ? 'visible' : 'hidden'
                      }}
                    >
                      <SubMenuFlyout entries={item.items} />
                    </div>,
                    document.body
                  )
                : null}
            </div>
          )
        }
        return (
          <button
            key={i}
            className={`menu-item${item.danger ? ' danger' : ''}${focusIdx === i ? ' focused' : ''}`}
            disabled={item.disabled}
            onClick={(e) => item.action(menuMods(e))}
            onMouseEnter={() => showSub(null, { delayMs: 300 })}
            role="menuitem"
          >
            {item.label}
            {item.hint && <span className="menu-hint">{item.hint}</span>}
          </button>
        )
      })}
    </div>
  )
}
