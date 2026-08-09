import { useCallback, useEffect, useMemo, useRef, useState, type JSX } from 'react'
import { useAppStore, dropOperation } from '../store/appStore'
import { api, call } from '../lib/ipc'
import { samePath, isUnderPath, basename, segmentsOf } from '../lib/paths'
import {
  beginRightDragGesture,
  getLiveRightDragSession,
  isVolumeRootPath,
  shouldSuppressContextMenu
} from '../lib/rightDrag'
import {
  beginLeftFileDragGesture,
  shouldSuppressClickAfterLeftDrag
} from '../lib/leftFileDrag'
import { isExcludedByViewFilter } from '../lib/viewFilter'
import { ChevronDown, ChevronRight } from '../lib/icons'
import { buildQuickAccess, materializeQuickAccessTokens } from '../lib/quickAccess'
import { ShellIcon } from './ShellIcon'
import { RenameInput } from './RenameInput'

type NodeState = {
  expanded: boolean
  children: string[] | null
  loading: boolean
  /** child path (lower) → Windows Hidden / dotfile */
  childHidden?: Record<string, boolean>
}
type NodesMap = Record<string, NodeState>

function pruneRemoved(map: NodesMap, removed: string[]): NodesMap {
  const isGone = (p: string): boolean =>
    removed.some((r) => samePath(p, r) || isUnderPath(p, r))
  const next: NodesMap = {}
  for (const [key, node] of Object.entries(map)) {
    if (isGone(key)) continue
    const children = node.children?.filter((c) => !isGone(c)) ?? node.children
    next[key] = children === node.children ? node : { ...node, children: children ?? null }
  }
  return next
}

function pathDepth(path: string): number {
  return path.replace(/[\\/]+$/, '').split(/[\\/]/).filter(Boolean).length
}

function collectExpandedPaths(map: NodesMap): string[] {
  return Object.entries(map)
    .filter(([, n]) => n.expanded)
    .map(([p]) => p)
}

function collapseUnder(map: NodesMap, root: string): NodesMap {
  const next: NodesMap = { ...map }
  for (const [key, node] of Object.entries(map)) {
    if (samePath(key, root) || isUnderPath(key, root)) {
      if (node.expanded) next[key] = { ...node, expanded: false }
    }
  }
  return next
}

type FolderTreeProps = {
  /** When set, this tree is bound to that tab (multi-pane). Default: active tab. */
  tabId?: string
}

export function FolderTree({ tabId: tabIdProp }: FolderTreeProps = {} as FolderTreeProps): JSX.Element {
  const activeTabIdStore = useAppStore((s) => s.activeTabId)
  const tabId = tabIdProp ?? activeTabIdStore
  const drives = useAppStore((s) => s.drives)
  const tabs = useAppStore((s) => s.tabs)
  const activePath = useAppStore((s) => s.tabs.find((t) => t.id === tabId)?.path ?? '')
  const rootPath = useAppStore((s) => s.tabs.find((t) => t.id === tabId)?.rootPath ?? null)
  const navigate = useAppStore((s) => s.navigate)
  const focusPane = useAppStore((s) => s.focusPane)
  const paneTabIds = useAppStore((s) => s.paneTabIds)
  const activeTabId = tabId
  const performTransfer = useAppStore((s) => s.performTransfer)
  const dragPaths = useAppStore((s) => s.dragPaths)
  const setDragPaths = useAppStore((s) => s.setDragPaths)
  const openContextMenu = useAppStore((s) => s.openContextMenu)
  const treeMutation = useAppStore((s) => s.treeMutation)
  const treeRefreshRev = useAppStore((s) => s.treeRefreshRev)
  const pinQuickAccess = useAppStore((s) => s.pinQuickAccess)
  const renamingPath = useAppStore((s) => s.renamingPath)
  const renameSource = useAppStore((s) => s.renameSource)
  const submitRename = useAppStore((s) => s.submitRename)
  const cancelRename = useAppStore((s) => s.cancelRename)
  const setTreeFocusPath = useAppStore((s) => s.setTreeFocusPath)
  const treeFocusPath = useAppStore((s) => s.treeFocusPath)
  const treeExpanded = useAppStore((s) => s.activeTab().treeExpanded)
  const setTreeExpanded = useAppStore((s) => s.setTreeExpanded)
  const knownFolders = useAppStore((s) => s.knownFolders)
  const quickAccessSetting = useAppStore((s) => s.settings.quickAccess)
  const quickAccessPins = useAppStore((s) => s.settings.quickAccessPins)
  const quickAccessHiddenDefaults = useAppStore((s) => s.settings.quickAccessHiddenDefaults)
  const quickAccess = useMemo(() => {
    const tokens = materializeQuickAccessTokens(
      quickAccessSetting,
      quickAccessPins,
      quickAccessHiddenDefaults
    )
    return buildQuickAccess(knownFolders, tokens)
  }, [knownFolders, quickAccessSetting, quickAccessPins, quickAccessHiddenDefaults])

  // Expansion / children cache is per tab — switching tabs must not share tree UI state.
  const [nodesByTab, setNodesByTab] = useState<Record<string, NodesMap>>({})
  const nodes = nodesByTab[activeTabId] ?? {}
  const dropHighlightPath = useAppStore((s) => s.dropHighlightPath)
  const setDropHighlight = useAppStore((s) => s.setDropHighlight)
  /** Tab id whose session `treeExpanded` has been applied (avoids wiping on tab switch). */
  const [expandReadyTabId, setExpandReadyTabId] = useState<string | null>(null)
  const settings = useAppStore((s) => s.settings)
  const viewFilterOn = settings.viewFilterEnabled
  const viewPatterns = settings.viewFilterPatterns

  const setNodes = useCallback(
    (updater: NodesMap | ((prev: NodesMap) => NodesMap), tabId = activeTabId): void => {
      setNodesByTab((prev) => {
        const cur = prev[tabId] ?? {}
        const next = typeof updater === 'function' ? updater(cur) : updater
        if (next === cur) return prev
        return { ...prev, [tabId]: next }
      })
    },
    [activeTabId]
  )

  const loadChildren = useCallback(
    async (
      path: string,
      tabId = activeTabId,
      opts?: { preserveExpanded?: boolean }
    ): Promise<string[]> => {
      const preserve = opts?.preserveExpanded === true
      setNodes((n) => {
        const prev = n[path]
        return {
          ...n,
          [path]: {
            expanded: preserve ? (prev?.expanded ?? false) : true,
            children: prev?.children ?? null,
            loading: true,
            childHidden: prev?.childHidden
          }
        }
      }, tabId)
      try {
        const res = await call(api.fs.list({ path, includeHidden: true }))
        const dirEntries = res.entries
          .filter((e) => e.kind === 'dir')
          .sort((a, b) =>
            a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })
          )
        const dirs = dirEntries.map((e) => e.path)
        const childHidden: Record<string, boolean> = {}
        for (const e of dirEntries) {
          if (e.isHidden) childHidden[e.path.toLowerCase()] = true
        }
        setNodes(
          (n) => {
            const prev = n[path]
            return {
              ...n,
              [path]: {
                expanded: preserve ? (prev?.expanded ?? false) : true,
                children: dirs,
                loading: false,
                childHidden
              }
            }
          },
          tabId
        )
        return dirs
      } catch {
        setNodes(
          (n) => {
            const prev = n[path]
            return {
              ...n,
              [path]: {
                expanded: preserve ? (prev?.expanded ?? false) : true,
                children: [],
                loading: false,
                childHidden: {}
              }
            }
          },
          tabId
        )
        return []
      }
    },
    [activeTabId, setNodes]
  )

  const toggle = useCallback(
    (path: string): void => {
      const node = nodes[path]
      if (node?.expanded) {
        // Collapse this folder and descendants so session restore stays accurate.
        setNodes((n) => collapseUnder(n, path))
      } else if (node?.children) {
        setNodes((n) => ({ ...n, [path]: { ...n[path]!, expanded: true } }))
      } else {
        void loadChildren(path)
      }
    },
    [nodes, loadChildren, setNodes]
  )

  // Drop closed tabs' tree caches.
  useEffect(() => {
    const live = new Set(tabs.map((t) => t.id))
    setNodesByTab((prev) => {
      let changed = false
      const next: Record<string, NodesMap> = {}
      for (const [id, map] of Object.entries(prev)) {
        if (live.has(id)) next[id] = map
        else changed = true
      }
      return changed ? next : prev
    })
  }, [tabs])

  // Clear the drop highlight when the drag ends anywhere (incl. cancelled).
  useEffect(() => {
    if (dragPaths.length === 0) setDropHighlight(null)
  }, [dragPaths, setDropHighlight])

  // Latest node map for the active tab (async walks).
  const nodesRef = useRef(nodes)
  useEffect(() => {
    nodesRef.current = nodes
  }, [nodes])

  const activeTabIdRef = useRef(activeTabId)
  useEffect(() => {
    activeTabIdRef.current = activeTabId
  }, [activeTabId])

  // Restore persisted expand/collapse for the active tab, then allow saves.
  useEffect(() => {
    const tabId = activeTabId
    const persisted = [...treeExpanded].sort((a, b) => pathDepth(a) - pathDepth(b))
    let cancelled = false
    const run = async (): Promise<void> => {
      for (const path of persisted) {
        if (cancelled || activeTabIdRef.current !== tabId) return
        const map = nodesRef.current
        const key = Object.keys(map).find((k) => samePath(k, path)) ?? path
        const node = map[key]
        if (!node?.children && !node?.loading) {
          await loadChildren(key, tabId)
        } else if (node && !node.expanded) {
          setNodes(
            (n) => (n[key] ? { ...n, [key]: { ...n[key]!, expanded: true } } : n),
            tabId
          )
        }
      }
      if (!cancelled && activeTabIdRef.current === tabId) setExpandReadyTabId(tabId)
    }
    void run()
    return () => {
      cancelled = true
    }
    // Only re-hydrate when switching tabs (session paths are read from this render).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTabId])

  // Persist expand set into session.json (debounced via store).
  useEffect(() => {
    if (expandReadyTabId !== activeTabId) return
    setTreeExpanded(collectExpandedPaths(nodes), activeTabId)
  }, [nodes, expandReadyTabId, activeTabId, setTreeExpanded])

  // After FS mutations: prune removed folders in every tab; reload parents for the active tab.
  useEffect(() => {
    if (treeMutation.rev === 0) return
    const removed = treeMutation.removed
    if (removed.length > 0) {
      setNodesByTab((prev) => {
        const next: Record<string, NodesMap> = {}
        for (const [tabId, map] of Object.entries(prev)) {
          next[tabId] = pruneRemoved(map, removed)
        }
        return next
      })
    }
    const tabId = activeTabIdRef.current
    for (const parent of treeMutation.reloadParents) {
      void loadChildren(parent, tabId, { preserveExpanded: true })
    }
  }, [treeMutation.rev, treeMutation.removed, treeMutation.reloadParents, loadChildren])

  // Refresh (F5): re-list every folder this tab has already loaded in the tree.
  useEffect(() => {
    if (treeRefreshRev === 0) return
    const tabId = activeTabIdRef.current
    const map = nodesRef.current
    for (const [path, node] of Object.entries(map)) {
      if (node.children !== null || node.loading) {
        void loadChildren(path, tabId, { preserveExpanded: true })
      }
    }
  }, [treeRefreshRev, loadChildren])

  // Scoped tabs open with the root folder expanded (this tab only).
  useEffect(() => {
    if (!rootPath) return
    const node = nodesRef.current[rootPath]
    if (!node?.children && !node?.loading) void loadChildren(rootPath)
  }, [rootPath, activeTabId, loadChildren])

  // Auto-expand every ancestor of the active path so the current folder is
  // visible under Drives — but not when browsing via Quick access. Expanding
  // C:\Users\…\Downloads just because Downloads was clicked in Quick access
  // is noisy and collapses the useful shortcut UX.
  const inQuickAccess = useMemo(
    () =>
      !!activePath &&
      quickAccess.some(
        (e) => samePath(e.path, activePath) || isUnderPath(activePath, e.path)
      ),
    [activePath, quickAccess]
  )

  useEffect(() => {
    if (!activePath || inQuickAccess) return
    const tabId = activeTabId
    let cancelled = false
    const run = async (): Promise<void> => {
      const segs = segmentsOf(activePath).map((s) => s.path)
      // Expand all ancestors (the active folder itself only needs to be visible).
      let key = segs[0]
      for (let i = 0; i < segs.length - 1 && key; i++) {
        if (cancelled || activeTabIdRef.current !== tabId) return
        const map = nodesRef.current
        const node = map[key]
        let children = node?.children
        if (!children) {
          children = await loadChildren(key, tabId)
          if (cancelled || activeTabIdRef.current !== tabId) return
        } else if (!node?.expanded) {
          const k = key
          setNodes((n) => (n[k] ? { ...n, [k]: { ...n[k]!, expanded: true } } : n), tabId)
        }
        // Use the exact child string as the next key so casing matches render keys.
        const next = segs[i + 1]!
        key = children.find((c) => samePath(c, next)) ?? next
      }
    }
    void run()
    return () => {
      cancelled = true
    }
  }, [activePath, activeTabId, inQuickAccess, loadChildren, setNodes])

  // Scroll the selected node into view once per navigation (per tab).
  const treeRef = useRef<HTMLDivElement>(null)
  const scrolledFor = useRef<string | null>(null)
  useEffect(() => {
    scrolledFor.current = null
  }, [activeTabId])
  useEffect(() => {
    if (!activePath || scrolledFor.current === activePath) return
    const el = treeRef.current?.querySelector('.tree-node.selected')
    if (el) {
      el.scrollIntoView({ block: 'nearest' })
      scrolledFor.current = activePath
    }
  }, [activePath, activeTabId, nodes])

  function isFsHidden(childPath: string, parentPath: string | null): boolean {
    if (!parentPath) return false
    const parent = nodes[parentPath]
    return !!parent?.childHidden?.[childPath.toLowerCase()]
  }

  function renderNode(
    path: string,
    label: string,
    depth: number,
    section: 'qa' | 'drives' | 'scoped' = 'drives',
    parentPath: string | null = null
  ): JSX.Element {
    const node = nodes[path]
    const expanded = node?.expanded ?? false
    // While browsing via Quick access, only highlight there — not the same
    // folder again under Drives (even if that branch was already expanded).
    const selected =
      samePath(path, activePath) && !(inQuickAccess && section === 'drives')
    const treeFocused = treeFocusPath !== null && samePath(path, treeFocusPath)
    const fsHidden = isFsHidden(path, parentPath)
    const renaming =
      renameSource === 'tree' && renamingPath !== null && samePath(path, renamingPath)
    const visibleChildren =
      node?.children?.filter((child) => {
        const winHidden = !!node.childHidden?.[child.toLowerCase()]
        return !isExcludedByViewFilter(
          { path: child, isHidden: winHidden },
          viewPatterns,
          viewFilterOn
        )
      }) ?? null
    // Explorer: keep the chevron until we know there are no subfolders; hide once listed empty.
    const showTwisty = visibleChildren === null || visibleChildren.length > 0
    const canDrag = !renaming && !isVolumeRootPath(path)
    return (
      <div key={`${section}:${path}`}>
        <div
          className={`tree-node${selected ? ' selected' : ''}${treeFocused && !selected ? ' tree-focused' : ''}${fsHidden ? ' fs-hidden' : ''}${dropHighlightPath && samePath(dropHighlightPath, path) ? ' drop-target' : ''}`}
          style={{ paddingLeft: 6 + depth * 14 }}
          data-drop-dir={path}
          draggable={false}
          onClick={() => {
            if (shouldSuppressClickAfterLeftDrag()) return
            setTreeFocusPath(path)
            treeRef.current?.focus()
            const paneIdx = paneTabIds.indexOf(tabId)
            if (paneIdx >= 0) focusPane(paneIdx)
            void navigate(path, { tabId })
          }}
          onDoubleClick={() => {
            if (showTwisty) toggle(path)
          }}
          onPointerDown={(e) => {
            if (!canDrag) return
            if (e.button === 2) {
              e.preventDefault()
              e.stopPropagation()
              setTreeFocusPath(path)
              beginRightDragGesture([path], e.clientX, e.clientY, e.currentTarget, e.pointerId, {
                ghostLabel: label,
                onActivated: (paths) => setDragPaths(paths),
                onHighlight: (dest) => setDropHighlight(dest),
                onFinish: ({ active, paths, clientX, clientY, dest }) => {
                  setDragPaths([])
                  setDropHighlight(null)
                  if (!active) {
                    openContextMenu({
                      x: clientX,
                      y: clientY,
                      paths,
                      inTree: true
                    })
                    return
                  }
                  if (dest) {
                    openContextMenu({
                      x: clientX,
                      y: clientY,
                      paths,
                      dropTransfer: { destDir: dest }
                    })
                  }
                },
                onCancel: () => {
                  setDragPaths([])
                  setDropHighlight(null)
                }
              })
              return
            }
            if (e.button !== 0) return
            setTreeFocusPath(path)
            beginLeftFileDragGesture([path], e.clientX, e.clientY, e.currentTarget, e.pointerId, {
              ghostLabel: label,
              onActivated: (paths) => setDragPaths(paths),
              onHighlight: (dest) => setDropHighlight(dest),
              onDrop: ({ paths, dest, ctrlKey, shiftKey }) => {
                setDragPaths([])
                setDropHighlight(null)
                const src = paths[0]
                if (!dest || !src) return
                void performTransfer(dropOperation(src, dest, ctrlKey, shiftKey), paths, dest)
              },
              onCancel: () => {
                setDragPaths([])
                setDropHighlight(null)
              }
            })
          }}
          onContextMenu={(e) => {
            e.preventDefault()
            // Right-drag owns the menu (opened from pointerup).
            if (shouldSuppressContextMenu() || getLiveRightDragSession()) return
            setTreeFocusPath(path)
            openContextMenu({ x: e.clientX, y: e.clientY, paths: [path], inTree: true })
          }}
          onDragEnd={() => {
            setDragPaths([])
            setDropHighlight(null)
          }}
          onDragOver={(e) => {
            if (
              dragPaths.length > 0 &&
              !dragPaths.some((p) => samePath(p, path) || isUnderPath(path, p))
            ) {
              e.preventDefault()
              setDropHighlight(path)
            }
          }}
          onDragLeave={() => {
            if (dropHighlightPath && samePath(dropHighlightPath, path)) setDropHighlight(null)
          }}
          onDrop={(e) => {
            e.preventDefault()
            setDropHighlight(null)
            const src = dragPaths[0]
            if (dragPaths.length > 0 && src) {
              void performTransfer(dropOperation(src, path, e.ctrlKey, e.shiftKey), dragPaths, path)
            }
          }}
          role="treeitem"
          aria-expanded={showTwisty ? expanded : undefined}
          aria-selected={selected}
        >
          {showTwisty ? (
            <button
              type="button"
              className="twisty"
              aria-label={expanded ? 'Collapse' : 'Expand'}
              onClick={(e) => {
                e.stopPropagation()
                toggle(path)
              }}
            >
              {expanded ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
            </button>
          ) : (
            <span className="twisty twisty-spacer" aria-hidden />
          )}
          <ShellIcon path={path} size={16} isDir />
          {renaming ? (
            <RenameInput
              name={label}
              isDir
              className="rename-input tree-rename-input"
              onSubmit={(v) => void submitRename(v)}
              onCancel={cancelRename}
            />
          ) : (
            <span className="tree-label">{label}</span>
          )}
        </div>
        {expanded &&
          visibleChildren?.map((child) =>
            renderNode(child, basename(child), depth + 1, section, path)
          )}
      </div>
    )
  }

  // Scoped tab: the tab's root folder is the only top-level tree node.
  if (rootPath) {
    return (
      <div ref={treeRef} className="tree" role="tree" aria-label="Folders" tabIndex={0}>
        <div className="tree-section">{basename(rootPath)}</div>
        {renderNode(rootPath, basename(rootPath), 0, 'scoped')}
      </div>
    )
  }

  return (
    <div ref={treeRef} className="tree" role="tree" aria-label="Folders" tabIndex={0}>
      <div
        className="tree-section"
        onDragOver={(e) => {
          if (dragPaths.length === 1) e.preventDefault()
        }}
        onDrop={(e) => {
          e.preventDefault()
          const src = dragPaths[0]
          if (src) void pinQuickAccess(src)
        }}
        title="Drop a folder here to pin it"
      >
        Quick access
      </div>
      {quickAccess.length === 0 ? (
        <div className="tree-empty-hint">Pin folders via context menu or drop here</div>
      ) : (
        quickAccess.map((entry) => renderNode(entry.path, entry.label, 0, 'qa'))
      )}
      <div className="tree-section">Drives</div>
      {drives.map((d) => renderNode(d.path, d.label, 0, 'drives'))}
    </div>
  )
}
