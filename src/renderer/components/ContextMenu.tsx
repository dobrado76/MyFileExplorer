import { createElement, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type JSX, type ReactNode } from 'react'
import { findExactFolderView } from '@shared/folderViews'
import { buildCommandMenuRows, commandMatches, type CommandMenuSubRow } from '@shared/contextMenuCommands'
import {
  applyBuiltinLayoutToMenu,
  collapseMenuSeparators,
  isContextMenuBuiltinEnabled,
  type ContextMenuBuiltinId
} from '@shared/contextMenuBuiltins'
import { discoveredVerbMatches } from '@shared/schemas/shellVerbs'
import { FilePlus2 } from 'lucide-react'
import { useAppStore, dropOperation } from '../store/appStore'
import { samePath, basename, parentOf, joinPath } from '../lib/paths'
import { isImageExt, isVideoExt } from '../lib/icons'
import { isEditableImagePath } from '@shared/imageEdit'
import { parseUnc } from '@shared/networkPaths'
import { isDeleteMapRow } from '@shared/slideshow/categorizerMap'
import { buildQuickAccess, materializeQuickAccessTokens } from '../lib/quickAccess'
import { api, call } from '../lib/ipc'
import { NEW_FILE_TYPES } from '../lib/newItemTypes'
import { slideshowCurrentPath } from '../lib/slideshowTypes'
import { ShellIcon } from './ShellIcon'

/** File extension including leading dot (e.g. `.ffs_gui`), or null. */
function fileExtension(filePath: string): string | null {
  const name = basename(filePath)
  const dot = name.lastIndexOf('.')
  if (dot <= 0 || dot === name.length - 1) return null
  return name.slice(dot)
}

type MenuActionEv = { shiftKey?: boolean }

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
            onClick={(e) => sub.action?.({ shiftKey: e.shiftKey })}
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
      void s.openCommandLineHere(folderPath, { elevated: !!ev?.shiftKey })
    }
  }
}

function newSubmenu(
  parent: string,
  close: () => void,
  s: ReturnType<typeof useAppStore.getState>
): MenuItem {
  const folderProbe = joinPath(parent, '__mfe_new_folder')
  const fileProbe = (ext: string): string => joinPath(parent, `__mfe_new${ext}`)
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
  const store = useAppStore

  const ref = useRef<HTMLDivElement>(null)
  const subRef = useRef<HTMLDivElement>(null)
  const closeSubTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null)
  const [focusIdx, setFocusIdx] = useState(-1)
  const [openSub, setOpenSub] = useState<number | null>(null)
  const openSubRef = useRef<number | null>(null)
  openSubRef.current = openSub
  const [subFocusIdx, setSubFocusIdx] = useState(-1)
  /** Async Version Control state for a single editable image (omit submenu until ready). */
  const [imageVer, setImageVer] = useState<{ path: string; count: number } | null>(null)
  /** Live Shift key — Explorer-style “as administrator” label on Open Command Line. */
  const [shiftHeld, setShiftHeld] = useState(false)
  /** Submenu placement relative to its parent row (after viewport clamp). */
  const [subPlace, setSubPlace] = useState<{
    flipX: boolean
    top: number
    maxHeight: number | null
    ready: boolean
  }>({ flipX: false, top: -5, maxHeight: null, ready: false })

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
            setSubPlace({ flipX: false, top: -5, maxHeight: null, ready: false })
          }, delay)
          return
        }
        openSubRef.current = null
        setOpenSub(null)
        setSubFocusIdx(-1)
        setSubPlace({ flipX: false, top: -5, maxHeight: null, ready: false })
        return
      }
      if (openSubRef.current === i) return
      openSubRef.current = i
      setOpenSub(i)
      setSubFocusIdx(-1)
      setSubPlace({ flipX: false, top: -5, maxHeight: null, ready: false })
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
          hint: defaultOp === 'copy' ? 'default' : undefined,
          action: () => {
            close()
            void s.performTransfer('copy', paths, dest)
          }
        },
        {
          type: 'item',
          label: 'Move here',
          hint: defaultOp === 'move' ? 'default' : undefined,
          action: () => {
            close()
            void s.performTransfer('move', paths, dest)
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

    // Tree section headers: Drives / Network (Map / Disconnect / Refresh).
    if (menu.treeSection) {
      const out: MenuItem[] = [
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
      ]
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
      const folderPath = s.activeTab().path
      const hasExact = !!findExactFolderView(folderPath, s.settings.folderViews)
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
          hint: 'Ctrl+V',
          builtin: 'paste',
          action: () => {
            close()
            void s.paste()
          }
        },
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
                void s.customizeFolderView(folderPath, false)
              }
            },
            {
              label: 'This folder and subfolders',
              action: () => {
                close()
                void s.customizeFolderView(folderPath, true)
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
                  void s.removeFolderCustomization(folderPath)
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
        ...(parseUnc(folderPath)?.kind === 'host'
          ? []
          : [openCommandLineMenuItem(folderPath, close, s, shiftHeld)]),
        {
          type: 'submenu',
          label: 'Video previews',
          builtin: 'video-previews',
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
        {
          type: 'item',
          label: 'Alternate streams…',
          builtin: 'alternate-streams',
          action: () => {
            close()
            s.openDialog({ kind: 'ads-manager', path: folderPath })
          }
        },
        {
          type: 'item',
          label: 'Calculate Statistics',
          hint: shiftHeld ? 'Skip tagged' : 'Shift = skip tagged',
          builtin: 'calculate-folder-statistics',
          disabled: folderPath.toLowerCase().startsWith('mfe-remote://'),
          action: (ev) => {
            close()
            void s.calculateFolderStatistics(folderPath, { skipTagged: !!ev?.shiftKey })
          }
        },
        {
          type: 'item',
          label: 'Properties',
          builtin: 'properties',
          action: () => {
            close()
            s.openDialog({ kind: 'properties', path: folderPath })
          }
        }
      )
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
          if (isDir) void s.navigate(single)
          else {
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
          {
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
            : [])
        )
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
        builtin: 'paste-into-folder',
        action: () => {
          close()
          void (async () => {
            let clip = store.getState().clipboard
            if (!clip || clip.paths.length === 0) {
              try {
                const os = await call(api.shell.clipboardReadFiles())
                if (os.paths.length > 0) clip = { mode: 'copy', paths: os.paths }
              } catch {
                clip = null
              }
            }
            if (!clip || clip.paths.length === 0) return
            await s.performTransfer(
              clip.mode === 'cut' ? 'move' : 'copy',
              clip.paths,
              single,
              clip.mode === 'cut'
            )
          })()
        }
      })
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
      if (isDir && single) {
        fileToolsItems.push({
          label: 'Change Icon…',
          action: () => {
            close()
            void s.changeFolderIcon(single)
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
      {
        type: 'item',
        label: 'Delete',
        hint: 'Del',
        builtin: 'delete',
        action: () => {
          close()
          // Del → Recycle Bin (never permanent).
          void s.deleteSelection(
            false,
            menu.inTree && single ? [single] : paths.length > 0 ? paths : undefined
          )
        }
      },
      {
        type: 'item',
        label: 'Delete permanently',
        hint: 'Shift+Del',
        danger: true,
        builtin: 'delete-permanently',
        action: () => {
          close()
          void s.deleteSelection(
            true,
            menu.inTree && single ? [single] : paths.length > 0 ? paths : undefined
          )
        }
      },
      ...(paths.length > 0
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
      ...(isDir && single && parseUnc(single)?.kind !== 'host'
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
    if (isDir && single) {
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
      ...(isDir && single
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
      {
        type: 'item',
        label: 'Properties',
        disabled: paths.length !== 1,
        builtin: 'properties',
        action: () => {
          close()
          if (single) s.openDialog({ kind: 'properties', path: single })
        }
      }
    )
    return filterHiddenBuiltins(
        result,
        s.settings.contextMenu.hiddenBuiltins,
        s.settings.contextMenu.builtinLayout
      )
  }, [menu, closeContextMenu, store, imageVer, shiftHeld])

  // Clamp open submenu into the viewport (flip X, shift Y, scroll if taller than screen).
  useLayoutEffect(() => {
    if (openSub === null) return
    const sub = subRef.current
    if (!sub) return
    const wrap = sub.parentElement
    if (!wrap) return

    const margin = 4
    const vw = window.innerWidth
    const vh = window.innerHeight
    const wrapRect = wrap.getBoundingClientRect()
    const raw = sub.getBoundingClientRect()
    const maxHeight = Math.max(80, vh - margin * 2)
    const height = Math.min(raw.height, maxHeight)

    const fitsRight = wrapRect.right + 2 + raw.width <= vw - margin
    const fitsLeft = wrapRect.left - 2 - raw.width >= margin
    const flipX = !fitsRight && fitsLeft

    let top = -5
    if (wrapRect.top + top + height > vh - margin) {
      top = vh - margin - height - wrapRect.top
    }
    if (wrapRect.top + top < margin) {
      top = margin - wrapRect.top
    }

    setSubPlace({ flipX, top, maxHeight, ready: true })
  }, [openSub, items])

  useLayoutEffect(() => {
    if (!menu) {
      setPos(null)
      return
    }
    const el = ref.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const x = Math.min(menu.x, window.innerWidth - rect.width - 4)
    const y = Math.min(menu.y, window.innerHeight - rect.height - 4)
    setPos({ x: Math.max(0, x), y: Math.max(0, y) })
    setFocusIdx(-1)
    clearCloseSubTimer()
    openSubRef.current = null
    setOpenSub(null)
    setSubFocusIdx(-1)
    setSubPlace({ flipX: false, top: -5, maxHeight: null, ready: false })
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
          if (sub && !sub.sep && sub.action) sub.action({ shiftKey: e.shiftKey })
        } else if (focused?.type === 'submenu' && !focused.disabled) {
          showSub(focusIdx)
          const first = focused.items.findIndex((x) => !x.sep)
          setSubFocusIdx(first >= 0 ? first : 0)
        } else if (focused && focused.type === 'item' && !focused.disabled) {
          focused.action({ shiftKey: e.shiftKey })
        }
      }
      e.stopPropagation()
    }
    const onClick = (): void => closeContextMenu()
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
              {open && (
                <div
                  ref={subRef}
                  className={`context-menu context-submenu${subPlace.flipX ? ' flip' : ''}`}
                  role="menu"
                  onMouseEnter={() => {
                    // Crossing the parent→flyout gap may briefly hit a sibling;
                    // arriving here cancels the delayed close.
                    clearCloseSubTimer()
                    setFocusIdx(i)
                  }}
                  style={{
                    top: subPlace.top,
                    maxHeight: subPlace.maxHeight ?? undefined,
                    visibility: subPlace.ready ? 'visible' : 'hidden'
                  }}
                >
                  <SubMenuFlyout entries={item.items} />
                </div>
              )}
            </div>
          )
        }
        return (
          <button
            key={i}
            className={`menu-item${item.danger ? ' danger' : ''}${focusIdx === i ? ' focused' : ''}`}
            disabled={item.disabled}
            onClick={(e) => item.action({ shiftKey: e.shiftKey })}
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
