import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type JSX } from 'react'
import { findExactFolderView } from '@shared/folderViews'
import { useAppStore } from '../store/appStore'
import { samePath, basename } from '../lib/paths'
import { isImageExt } from '../lib/icons'
import { buildQuickAccess, materializeQuickAccessTokens } from '../lib/quickAccess'

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

/** Common “New” targets — Explorer-style quick create + rename. */
const NEW_FILE_TYPES: { stem: string; ext: string; label: string }[] = [
  { stem: 'New Text Document', ext: '.txt', label: 'Text Document' },
  { stem: 'New Markdown', ext: '.md', label: 'Markdown' },
  { stem: 'New Document', ext: '.json', label: 'JSON' },
  { stem: 'New Spreadsheet', ext: '.csv', label: 'CSV' },
  { stem: 'New Script', ext: '.js', label: 'JavaScript' },
  { stem: 'New Script', ext: '.ts', label: 'TypeScript' },
  { stem: 'New Script', ext: '.py', label: 'Python' },
  { stem: 'New Page', ext: '.html', label: 'HTML' },
  { stem: 'New Stylesheet', ext: '.css', label: 'CSS' },
  { stem: 'New Script', ext: '.ps1', label: 'PowerShell' },
  { stem: 'New Script', ext: '.bat', label: 'Windows Batch' }
]

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
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null)
  const [focusIdx, setFocusIdx] = useState(-1)
  const [openSub, setOpenSub] = useState<number | null>(null)
  const [subFocusIdx, setSubFocusIdx] = useState(-1)
  const [subFlip, setSubFlip] = useState(false)

  const showSub = useCallback((i: number | null): void => {
    setOpenSub(i)
    setSubFocusIdx(-1)
    if (i !== null && ref.current) {
      const rect = ref.current.getBoundingClientRect()
      setSubFlip(rect.right + 260 > window.innerWidth)
    }
  }, [])

  const items = useMemo<MenuItem[]>(() => {
    if (!menu) return []
    const s = store.getState()
    const { paths } = menu
    const entries = s.listing.entries
    const isBackground = paths.length === 0
    const single = paths.length === 1 ? paths[0]! : null
    const singleEntry = single ? entries.find((e) => samePath(e.path, single)) : null
    const isDir = menu.inTree || singleEntry?.kind === 'dir'
    const indexRoots = s.indexRoots
    const isIndexedRoot = single ? indexRoots.some((r) => samePath(r.path, single)) : false
    const result: MenuItem[] = []

    const close = closeContextMenu

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
          disabled: !s.clipboard,
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
        action: () => {
          close()
          if (!menu.inTree) s.cutSelection()
        }
      },
      {
        type: 'item',
        label: 'Copy',
        hint: 'Ctrl+C',
        action: () => {
          close()
          if (menu.inTree && single) {
            useAppStore.setState({ clipboard: { mode: 'copy', paths: [single] } })
          } else {
            s.copySelection()
          }
        }
      }
    )
    if (isDir && single) {
      result.push({
        type: 'item',
        label: 'Paste into folder',
        disabled: !s.clipboard,
        action: () => {
          close()
          const clip = store.getState().clipboard
          if (clip) {
            void s.performTransfer(
              clip.mode === 'cut' ? 'move' : 'copy',
              clip.paths,
              single,
              clip.mode === 'cut'
            )
          }
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
          if (single) s.startRename(single)
        }
      },
      {
        type: 'item',
        label: 'Delete',
        hint: 'Del',
        action: () => {
          close()
          if (menu.inTree && single) {
            useAppStore.setState((state) => ({
              tabs: state.tabs.map((t) =>
                t.id === state.activeTabId ? { ...t, selected: [single] } : t
              )
            }))
          }
          // Del → Recycle Bin (never permanent).
          void s.deleteSelection(false)
        }
      },
      {
        type: 'item',
        label: 'Delete permanently',
        hint: 'Shift+Del',
        danger: true,
        action: () => {
          close()
          if (menu.inTree && single) {
            useAppStore.setState((state) => ({
              tabs: state.tabs.map((t) =>
                t.id === state.activeTabId ? { ...t, selected: [single] } : t
              )
            }))
          }
          void s.deleteSelection(true)
        }
      },
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
          ? [
              {
                label: `All instances (*\\${basename(single)})`,
                action: () => {
                  close()
                  void s.addViewFilterPatterns([`*\\${basename(single)}`])
                }
              },
              {
                label: `Only this instance (this ${isDir ? 'folder' : 'file'})`,
                action: () => {
                  close()
                  void s.addViewFilterPatterns([single])
                }
              }
            ]
          : [
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
            ]
      }
    )
    if (isDir && single) {
      result.push({ type: 'sep' })
      if (isIndexedRoot) {
        result.push({
          type: 'item',
          label: 'Remove from search index',
          action: () => {
            close()
            void s.removeIndexRootAction(single)
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
      className="context-menu"
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
                <div className={`context-menu context-submenu${subFlip ? ' flip' : ''}`} role="menu">
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
