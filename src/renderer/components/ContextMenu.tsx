import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type JSX } from 'react'
import { findExactFolderView } from '@shared/folderViews'
import { useAppStore, dropOperation } from '../store/appStore'
import { samePath, basename, parentOf } from '../lib/paths'
import { isImageExt, isVideoExt } from '../lib/icons'
import { isEditableImagePath } from '@shared/imageEdit'
import { isDeleteMapRow } from '@shared/slideshow/categorizerMap'
import { buildQuickAccess, materializeQuickAccessTokens } from '../lib/quickAccess'
import { api, call } from '../lib/ipc'
import { NEW_FILE_TYPES } from '../lib/newItemTypes'

/** File extension including leading dot (e.g. `.ffs_gui`), or null. */
function fileExtension(filePath: string): string | null {
  const name = basename(filePath)
  const dot = name.lastIndexOf('.')
  if (dot <= 0 || dot === name.length - 1) return null
  return name.slice(dot)
}

type SubEntry = { label: string; action(): void; sep?: boolean }

type MenuItem =
  | { type: 'sep' }
  | {
      type: 'item'
      label: string
      hint?: string
      danger?: boolean
      disabled?: boolean
      action(): void
    }
  | { type: 'submenu'; label: string; disabled?: boolean; items: SubEntry[] }

function newSubmenu(
  parent: string,
  close: () => void,
  s: ReturnType<typeof useAppStore.getState>
): MenuItem {
  return {
    type: 'submenu',
    label: 'Add',
    items: [
      {
        label: 'Folder',
        action: () => {
          close()
          void s.createFolder(parent)
        }
      },
      { label: '', sep: true, action: () => undefined },
      ...NEW_FILE_TYPES.map((t) => ({
        label: t.label,
        action: () => {
          close()
          void s.createTypedFile(parent, t.stem, t.ext)
        }
      })),
      { label: '', sep: true, action: () => undefined },
      {
        label: 'Other…',
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
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null)
  const [focusIdx, setFocusIdx] = useState(-1)
  const [openSub, setOpenSub] = useState<number | null>(null)
  const [subFocusIdx, setSubFocusIdx] = useState(-1)
  /** Submenu placement relative to its parent row (after viewport clamp). */
  const [subPlace, setSubPlace] = useState<{
    flipX: boolean
    top: number
    maxHeight: number | null
    ready: boolean
  }>({ flipX: false, top: -5, maxHeight: null, ready: false })

  const showSub = useCallback((i: number | null): void => {
    setOpenSub(i)
    setSubFocusIdx(-1)
    setSubPlace({ flipX: false, top: -5, maxHeight: null, ready: false })
  }, [])

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

    // Slideshow player — categorize / delete / undo / edit / reveal / exit.
    if (menu.slideshow) {
      const cur = paths[0] ?? s.slideshow.active?.paths[s.slideshow.active.index] ?? null
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
          action: () => {
            close()
            void s.paste()
          }
        },
        { type: 'sep' },
        {
          type: 'submenu',
          label: 'Customize this folder',
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
          action: () => {
            close()
            void s.copyPathsToClipboard([folderPath], false)
          }
        },
        {
          type: 'item',
          label: 'Show in system Explorer',
          action: () => {
            close()
            void s.showInExplorer(folderPath)
          }
        },
        {
          type: 'submenu',
          label: 'Video previews',
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
          action: () => {
            close()
            s.openDialog({ kind: 'ads-manager', path: folderPath })
          }
        },
        {
          type: 'item',
          label: 'Properties',
          action: () => {
            close()
            s.openDialog({ kind: 'properties', path: folderPath })
          }
        }
      )
      return result
    }

    result.push({
      type: 'item',
      label: 'Open',
      hint: 'Enter',
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
        action: () => {
          close()
          void s.openPath(single)
        }
      })
    }
    if (s.search.active && single) {
      result.push(
        {
          type: 'item',
          label: 'Open File Path',
          action: () => {
            close()
            void s.openFileLocation(single)
          }
        },
        {
          type: 'item',
          label: 'Open File in new tab',
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
        result.push({
          type: 'item',
          label: 'Revert to original',
          action: () => {
            close()
            void s.revertImageOriginal(single)
          }
        })
      }
      if (isVideoExt(singleEntry?.ext ?? fileExtension(single)?.slice(1) ?? '')) {
        result.push({
          type: 'item',
          label: 'Generate video preview',
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
          action: () => {
            close()
            void s.generateVideoThumbs(paths, 'all')
          }
        })
      }
    }
    if (isDir && single) {
      result.push(
        {
          type: 'item',
          label: 'Open in new tab',
          action: () => {
            close()
            void s.newTab(single)
          }
        },
        {
          type: 'item',
          label: 'Open as root in new tab',
          action: () => {
            close()
            void s.newTab(single, single)
          }
        },
        { type: 'sep' },
        newSubmenu(single, close, s)
      )
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
              action: () => {
                close()
                void s.unpinQuickAccess(single)
              }
            }
          : {
              type: 'item',
              label: 'Pin to Quick access',
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
                action: () => {
                  close()
                  void s.removeFolderCustomization(single)
                }
              }
            ]
          : [])
      )
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
    result.push(
      { type: 'sep' },
      {
        type: 'item',
        label: 'Rename',
        hint: 'F2',
        disabled: paths.length !== 1,
        action: () => {
          close()
          if (single) s.startRename(single, menu.inTree ? 'tree' : 'files')
        }
      },
      {
        type: 'item',
        label: 'Delete',
        hint: 'Del',
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
        action: () => {
          close()
          void s.copyPathsToClipboard(paths, false)
        }
      },
      {
        type: 'item',
        label: 'Copy name',
        action: () => {
          close()
          void s.copyPathsToClipboard(paths, true)
        }
      },
      {
        type: 'item',
        label: 'Show in system Explorer',
        action: () => {
          close()
          if (single) void s.showInExplorer(single)
        }
      },
      { type: 'sep' },
      {
        type: 'submenu',
        label: 'Hide from view',
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
      if (isIndexedRoot) {
        result.push({
          type: 'item',
          label: 'Remove from search index',
          action: () => {
            close()
            void s.removeIndexRootAction(single)
          }
        })
      } else if (isDriveRoot) {
        result.push({
          type: 'item',
          label: 'Index this drive',
          action: () => {
            close()
            void s.addVolumeRootAction(single)
          }
        })
      } else {
        result.push({
          type: 'item',
          label: 'Add folder to search index',
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
        action: () => {
          close()
          if (single) s.openDialog({ kind: 'ads-manager', path: single })
        }
      },
      {
        type: 'item',
        label: 'Properties',
        disabled: paths.length !== 1,
        action: () => {
          close()
          if (single) s.openDialog({ kind: 'properties', path: single })
        }
      }
    )
    return result
  }, [menu, closeContextMenu, store])

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
    setOpenSub(null)
    setSubFocusIdx(-1)
  }, [menu])

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
          if (sub && !sub.sep) sub.action()
        } else if (focused?.type === 'submenu' && !focused.disabled) {
          showSub(focusIdx)
          const first = focused.items.findIndex((x) => !x.sep)
          setSubFocusIdx(first >= 0 ? first : 0)
        } else if (focused && focused.type === 'item' && !focused.disabled) {
          focused.action()
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
                  style={{
                    top: subPlace.top,
                    maxHeight: subPlace.maxHeight ?? undefined,
                    visibility: subPlace.ready ? 'visible' : 'hidden'
                  }}
                >
                  {item.items.map((sub, j) =>
                    sub.sep ? (
                      <div key={j} className="menu-sep" />
                    ) : (
                      <button
                        key={j}
                        className={`menu-item${subFocusIdx === j ? ' focused' : ''}`}
                        onClick={sub.action}
                        role="menuitem"
                      >
                        {sub.label}
                      </button>
                    )
                  )}
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
            onClick={item.action}
            onMouseEnter={() => showSub(null)}
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
