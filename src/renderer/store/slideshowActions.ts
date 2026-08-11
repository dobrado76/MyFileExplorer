/**
 * Slideshow store actions — mixed into appStore. All entry points check the gate.
 */
import type { CategorizerMapRow } from '@shared/slideshow/categorizerMap'
import {
  isDeleteMapRow,
  parseCategorizerMap,
  serializeCategorizerMap
} from '@shared/slideshow/categorizerMap'
import {
  mergeImageList,
  parseImageListDat,
  serializeImageListDat
} from '@shared/slideshow/imageListDat'
import { SLIDESHOW_IMAGE_LIST_CAP } from '@shared/slideshow/constants'
import { api, call, IpcError } from '../lib/ipc'
import type { SlideshowAction, SlideshowSession, SlideshowState } from '../lib/slideshowTypes'
import { emptySlideshowSession } from '../lib/slideshowTypes'
import { basename, samePath, isUnderPath } from '../lib/paths'

type Get = () => SlideshowHost
type Set = (partial: Partial<SlideshowHost> | ((s: SlideshowHost) => Partial<SlideshowHost>)) => void

/** Minimal host surface from appStore. */
export type SlideshowHost = {
  settings: {
    slideshowFeaturesEnabled: boolean
    slideshow: {
      delayMs: number
      order: 'random' | 'name' | 'size' | 'dimensions'
      ascending: boolean
      loop: boolean
      drawCaption: boolean
      categorizerMapPath: string
      categorizerMap: CategorizerMapRow[]
      cacheActive: boolean
      imageListCache: string[]
      invalidImagesDir: string
      compiledFileListsFolder: string
      compiledListEntries: { name: string; folder: string }[]
      compiledPlaylistIndex: number
    }
  }
  slideshow: SlideshowSession
  tabs: { id: string; path: string; selected: string[] }[]
  activeTabId: string
  listingsByTabId: Record<string, { entries: { path: string; kind: string }[] } | undefined>
  dialog: unknown
  notify(text: string, isError?: boolean): void
  applySettingsPatch(patch: {
    slideshowFeaturesEnabled?: boolean
    slideshow?: Partial<SlideshowHost['settings']['slideshow']>
  }): Promise<void>
  refresh(): Promise<void>
  activeTab(): { path: string; selected: string[] }
  openDialog(dialog: unknown): void
  closeDialog(): void
}

function gateOn(get: Get): boolean {
  return get().settings.slideshowFeaturesEnabled === true
}

function clearActive(set: Set, get: Get): void {
  set({ slideshow: { ...get().slideshow, active: null } })
}

let actionSeq = 0
function nextActionId(): string {
  actionSeq += 1
  return `ssa-${actionSeq}`
}

function clampImageList(paths: string[]): string[] {
  return paths.length > SLIDESHOW_IMAGE_LIST_CAP
    ? paths.slice(0, SLIDESHOW_IMAGE_LIST_CAP)
    : paths
}

/** Restore cache toggle, image list, and categorizer map from persisted settings. */
export function hydrateSlideshowCacheFromSettings(get: Get, set: Set): void {
  const ss = get().settings.slideshow
  set({
    slideshow: {
      ...get().slideshow,
      cacheActive: ss.cacheActive === true,
      imageListCache: clampImageList([...(ss.imageListCache ?? [])]),
      categorizerMap: [...(ss.categorizerMap ?? [])]
    }
  })
}

function persistSlideshowCache(get: Get): void {
  const session = get().slideshow
  void get().applySettingsPatch({
    slideshow: {
      cacheActive: session.cacheActive,
      imageListCache: session.imageListCache
    }
  })
}

function persistCategorizerMap(get: Get, rows: CategorizerMapRow[]): void {
  void get().applySettingsPatch({
    slideshow: { categorizerMap: rows }
  })
}

export function resolveSlideshowRoots(get: Get, explicitRoots?: string[]): string[] {
  if (explicitRoots && explicitRoots.length > 0) return explicitRoots
  const tab = get().activeTab()
  const listing = get().listingsByTabId[get().activeTabId]
  const selected = tab.selected
  const folderSelected: string[] = []
  for (const p of selected) {
    const e = listing?.entries.find((x) => samePath(x.path, p))
    if (e?.kind === 'dir') folderSelected.push(p)
  }
  if (folderSelected.length > 0) return folderSelected
  return tab.path ? [tab.path] : []
}

export async function loadCategorizerMapFromPath(get: Get, set: Set, filePath: string): Promise<void> {
  if (!gateOn(get)) return
  const { text } = await call(api.slideshow.readTextFile({ path: filePath }))
  const rows = parseCategorizerMap(text)
  set({
    slideshow: {
      ...get().slideshow,
      categorizerMap: rows
    }
  })
  await get().applySettingsPatch({
    slideshow: { categorizerMap: rows, categorizerMapPath: filePath }
  })
  get().notify(`Imported categorizer map (${rows.length} keys)`)
}

export function createSlideshowActions(get: Get, set: Set) {
  const actions = {
    setSlideshowCacheActive(v: boolean) {
      if (!gateOn(get)) return
      set({ slideshow: { ...get().slideshow, cacheActive: v } })
      persistSlideshowCache(get)
    },

    clearSlideshowImageCache() {
      if (!gateOn(get)) return
      set({ slideshow: { ...get().slideshow, imageListCache: [] } })
      persistSlideshowCache(get)
      get().notify('Slideshow image list cleared')
    },

    async loadCategorizerMapDialog() {
      if (!gateOn(get)) return
      const { path: filePath } = await call(
        api.slideshow.pickOpenFile({
          title: 'Import categorizer map',
          filters: [
            { name: 'Categorizer map', extensions: ['txt', 'map', 'cfg'] },
            { name: 'All files', extensions: ['*'] }
          ]
        })
      )
      if (!filePath) return
      try {
        await loadCategorizerMapFromPath(get, set, filePath)
      } catch (e) {
        get().notify(e instanceof IpcError ? e.message : String(e), true)
      }
    },

    async saveCategorizerMapDialog() {
      if (!gateOn(get)) return
      const rows = get().slideshow.categorizerMap
      const { path: filePath } = await call(
        api.slideshow.pickSaveFile({
          title: 'Export categorizer map',
          defaultPath: get().settings.slideshow.categorizerMapPath || 'categorizer.map',
          filters: [
            { name: 'Categorizer map', extensions: ['txt', 'map', 'cfg'] },
            { name: 'All files', extensions: ['*'] }
          ]
        })
      )
      if (!filePath) return
      try {
        await call(
          api.slideshow.writeTextFile({
            path: filePath,
            text: serializeCategorizerMap(rows)
          })
        )
        // Path is only a dialog hint; map already lives in settings.
        await get().applySettingsPatch({ slideshow: { categorizerMapPath: filePath } })
        get().notify('Categorizer map exported')
      } catch (e) {
        get().notify(e instanceof IpcError ? e.message : String(e), true)
      }
    },

    async loadSlideshowImageListDialog(mode: 'replace' | 'add') {
      if (!gateOn(get)) return
      const { path: filePath } = await call(
        api.slideshow.pickOpenFile({
          title: mode === 'add' ? 'Add image list' : 'Load image list',
          filters: [
            { name: 'Image list', extensions: ['dat', 'txt'] },
            { name: 'All files', extensions: ['*'] }
          ]
        })
      )
      if (!filePath) return
      try {
        const { text } = await call(api.slideshow.readTextFile({ path: filePath }))
        const parsed = parseImageListDat(text)
        const prev = get().slideshow.imageListCache
        const next = clampImageList(mode === 'add' ? mergeImageList(prev, parsed) : parsed)
        set({ slideshow: { ...get().slideshow, imageListCache: next, cacheActive: true } })
        persistSlideshowCache(get)
        get().notify(
          mode === 'add'
            ? `Added to list (${next.length} images)`
            : `Loaded list (${next.length} images)`
        )
      } catch (e) {
        get().notify(e instanceof IpcError ? e.message : String(e), true)
      }
    },

    async saveSlideshowImageListDialog() {
      if (!gateOn(get)) return
      const paths = get().slideshow.imageListCache
      const { path: filePath } = await call(
        api.slideshow.pickSaveFile({
          title: 'Save image list',
          defaultPath: 'slideshow-list.dat',
          filters: [{ name: 'Image list', extensions: ['dat'] }]
        })
      )
      if (!filePath) return
      try {
        await call(
          api.slideshow.writeTextFile({ path: filePath, text: serializeImageListDat(paths) })
        )
        get().notify(`Saved ${paths.length} paths`)
      } catch (e) {
        get().notify(e instanceof IpcError ? e.message : String(e), true)
      }
    },

    async startSlideshow(explicitRoots?: string[]) {
      if (!gateOn(get)) return
      if (get().slideshow.active) {
        get().notify('Slideshow already running', true)
        return
      }
      warnedMissingInvalidDir = false
      // Host may expose closeImageViewer — optional
      const host = get() as SlideshowHost & { closeImageViewer?: () => void; imageViewer?: unknown }
      if (host.imageViewer && host.closeImageViewer) host.closeImageViewer()
      const session = get().slideshow
      let paths: string[] = []
      let builtFromCache = false

      if (session.cacheActive && session.imageListCache.length > 0) {
        paths = [...session.imageListCache]
        builtFromCache = true
      } else {
        const roots = resolveSlideshowRoots(get, explicitRoots)
        if (roots.length === 0) {
          get().notify('No folder to slideshow', true)
          return
        }
        const ss = get().settings.slideshow
        set({
          slideshow: {
            ...get().slideshow,
            active: {
              status: 'building',
              paths: [],
              index: 0,
              builtFromCache: false,
              buildFound: 0,
              buildCurrent: roots[0]!,
              actions: []
            }
          }
        })
        try {
          const res = await call(
            api.slideshow.listImages({
              roots,
              order: ss.order,
              ascending: ss.ascending
            })
          )
          paths = res.paths
          if (get().slideshow.cacheActive) {
            const capped = clampImageList(paths)
            paths = capped
            set({
              slideshow: {
                ...get().slideshow,
                imageListCache: capped
              }
            })
            persistSlideshowCache(get)
          }
          if (res.truncated) {
            get().notify('Image list truncated at cap', true)
          }
        } catch (e) {
          clearActive(set, get)
          get().notify(e instanceof IpcError ? e.message : String(e), true)
          return
        }
      }

      if (paths.length === 0) {
        clearActive(set, get)
        get().notify('No images found', true)
        return
      }

      const active: SlideshowState = {
        status: 'playing',
        paths,
        index: 0,
        builtFromCache,
        buildFound: paths.length,
        buildCurrent: '',
        actions: [],
        compiledMode: false
      }
      set({ slideshow: { ...get().slideshow, active } })
    },

    /**
     * Start/resume compiled slideshow from !!Lists/last.txt (+ Index ADS).
     * Opens the detached lists window.
     */
    async startCompiledSlideshow(opts?: { resume?: boolean }) {
      if (!gateOn(get)) return
      const root = get().settings.slideshow.compiledFileListsFolder.trim()
      if (!root) {
        get().notify('Set Compiled file lists folder in Settings', true)
        return
      }
      warnedMissingInvalidDir = false
      const host = get() as SlideshowHost & { closeImageViewer?: () => void; imageViewer?: unknown }
      if (host.imageViewer && host.closeImageViewer) host.closeImageViewer()

      try {
        await call(api.slideshow.openCompiledListsWindow())
        const { lines } = await call(api.slideshow.readLastList({ compiledRoot: root }))
        if (!lines.some((l) => l.count > 0)) {
          get().notify('No counts in last.txt — set # in the lists window, then Start there')
          return
        }
        const { paths } = await call(api.slideshow.expandComposite({ lines }))
        if (paths.length === 0) {
          get().notify('Compiled playlist is empty', true)
          return
        }
        const capped = clampImageList(paths)
        let index = 0
        if (opts?.resume !== false) {
          const saved = get().settings.slideshow.compiledPlaylistIndex ?? 0
          index = Math.max(0, Math.min(saved, capped.length - 1))
        }
        if (get().slideshow.active) {
          // Replace in-place if already running
          const a = get().slideshow.active
          if (!a) return
          const prefer = a.paths[a.index]
          let nextIndex = index
          if (prefer) {
            const found = capped.findIndex((p) => samePath(p, prefer))
            if (found >= 0) nextIndex = found
          }
          set({
            slideshow: {
              ...get().slideshow,
              active: {
                status: a.status,
                paths: capped,
                index: nextIndex,
                builtFromCache: a.builtFromCache,
                buildFound: capped.length,
                buildCurrent: a.buildCurrent,
                actions: a.actions,
                compiledMode: true
              }
            }
          })
          return
        }
        set({
          slideshow: {
            ...get().slideshow,
            active: {
              status: 'playing',
              paths: capped,
              index,
              builtFromCache: true,
              buildFound: capped.length,
              buildCurrent: '',
              actions: [],
              compiledMode: true
            }
          }
        })
      } catch (e) {
        get().notify(e instanceof IpcError ? e.message : String(e), true)
      }
    },

    /** Second toolbar button: config if no last.txt, else resume compiled slideshow. */
    async compiledSlideshowToolbarClick() {
      if (!gateOn(get)) return
      const root = get().settings.slideshow.compiledFileListsFolder.trim()
      if (!root) {
        get().notify('Set Compiled file lists folder in Settings', true)
        return
      }
      try {
        const { usable } = await call(api.slideshow.lastListUsable({ compiledRoot: root }))
        if (!usable) {
          get().openDialog({ kind: 'compiled-lists-config', returnSection: 'slideshow' })
          return
        }
        await actions.startCompiledSlideshow({ resume: true })
      } catch (e) {
        get().notify(e instanceof IpcError ? e.message : String(e), true)
      }
    },

    /** Apply playlist from detached lists window (mid-session or start). */
    applyCompiledPlaylist(paths: string[], preferPath?: string | null) {
      if (!gateOn(get)) return
      const capped = clampImageList(paths)
      if (capped.length === 0) {
        get().notify('Compiled playlist is empty', true)
        return
      }
      const a = get().slideshow.active
      if (!a) {
        set({
          slideshow: {
            ...get().slideshow,
            active: {
              status: 'playing',
              paths: capped,
              index: 0,
              builtFromCache: true,
              buildFound: capped.length,
              buildCurrent: '',
              actions: [],
              compiledMode: true
            }
          }
        })
        return
      }
      let index = a.index
      const prefer = preferPath || a.paths[a.index]
      if (prefer) {
        const found = capped.findIndex((p) => samePath(p, prefer))
        index = found >= 0 ? found : Math.min(a.index, capped.length - 1)
      } else {
        index = Math.min(a.index, capped.length - 1)
      }
      set({
        slideshow: {
          ...get().slideshow,
          active: {
            ...a,
            paths: capped,
            index,
            compiledMode: true,
            buildFound: capped.length
          }
        }
      })
    },

    slideshowInterrupt() {
      if (!gateOn(get)) return
      const a = get().slideshow.active
      if (!a || a.status !== 'playing') return
      set({
        slideshow: {
          ...get().slideshow,
          active: { ...a, status: 'manual' }
        }
      })
    },

    slideshowAdvanceAuto() {
      if (!gateOn(get)) return
      const a = get().slideshow.active
      if (!a || a.status !== 'playing') return
      const next = a.index + 1
      if (next >= a.paths.length) {
        if (get().settings.slideshow.loop) {
          set({
            slideshow: {
              ...get().slideshow,
              active: { ...a, index: 0 }
            }
          })
        } else {
          void actions.stopSlideshow()
        }
        return
      }
      set({
        slideshow: {
          ...get().slideshow,
          active: { ...a, index: next }
        }
      })
    },

    /**
     * Unloadable / undecodable current image:
     * - remove from active list + image-list cache (persisted)
     * - move into `invalidImagesDir` when configured (not a soft skip)
     */
    slideshowSkipUnloadable() {
      if (!gateOn(get)) return
      const a = get().slideshow.active
      if (!a || a.status === 'building' || a.paths.length === 0) return
      const badPath = a.paths[a.index]
      if (!badPath) return
      const removeIdx = a.index

      const paths = a.paths.filter((_, i) => i !== removeIdx)
      const imageListCache = get().slideshow.imageListCache.filter((p) => !samePath(p, badPath))

      if (paths.length === 0) {
        set({
          slideshow: {
            ...get().slideshow,
            active: null,
            imageListCache
          }
        })
        persistSlideshowCache(get)
        void moveInvalidSlideshowImage(get, badPath)
        get().notify('No displayable images left — slideshow stopped', true)
        return
      }

      let index: number
      if (removeIdx >= paths.length) {
        if (a.status === 'playing' && !get().settings.slideshow.loop) {
          set({
            slideshow: {
              ...get().slideshow,
              active: null,
              imageListCache
            }
          })
          persistSlideshowCache(get)
          void moveInvalidSlideshowImage(get, badPath)
          return
        }
        index = 0
      } else {
        index = removeIdx
      }

      set({
        slideshow: {
          ...get().slideshow,
          imageListCache,
          active: { ...a, paths, index }
        }
      })
      persistSlideshowCache(get)
      void moveInvalidSlideshowImage(get, badPath)
    },

    slideshowNavigate(dir: -1 | 1 | 'first' | 'last') {
      if (!gateOn(get)) return
      const a = get().slideshow.active
      if (!a || a.paths.length === 0) return
      const n = a.paths.length
      let index = a.index
      if (dir === 'first') index = 0
      else if (dir === 'last') index = n - 1
      else if (get().settings.slideshow.loop) {
        index = (((a.index + dir) % n) + n) % n
      } else {
        index = Math.max(0, Math.min(n - 1, a.index + dir))
      }
      set({
        slideshow: {
          ...get().slideshow,
          active: { ...a, status: a.status === 'building' ? a.status : 'manual', index }
        }
      })
    },

    slideshowMapAction(row: CategorizerMapRow) {
      if (!gateOn(get)) return
      const a = get().slideshow.active
      if (!a || a.status === 'building' || a.paths.length === 0) return
      const curPath = a.paths[a.index]
      if (!curPath) return
      const insertIndex = a.index
      const paths = a.paths.filter((_, i) => i !== a.index)
      const nextIndex = Math.min(insertIndex, Math.max(0, paths.length - 1))
      let action: SlideshowAction
      if (isDeleteMapRow(row)) {
        action = {
          id: nextActionId(),
          type: 'delete',
          path: curPath,
          mapName: row.name,
          keyToken: row.keyToken,
          insertIndex
        }
      } else {
        action = {
          id: nextActionId(),
          type: 'categorize',
          path: curPath,
          mapName: row.name,
          keyToken: row.keyToken,
          destPath: row.path,
          insertIndex
        }
      }
      set({
        slideshow: {
          ...get().slideshow,
          active: {
            ...a,
            status: 'manual',
            paths,
            index: paths.length === 0 ? 0 : nextIndex,
            actions: [...a.actions, action]
          }
        }
      })
      if (paths.length === 0) {
        get().notify('List empty — stop to commit pending actions')
      }
    },

    slideshowUndoAction() {
      if (!gateOn(get)) return
      const a = get().slideshow.active
      if (!a || a.actions.length === 0) return
      const stack = [...a.actions]
      const last = stack.pop()!
      const paths = [...a.paths]
      const idx = Math.min(last.insertIndex, paths.length)
      paths.splice(idx, 0, last.path)
      set({
        slideshow: {
          ...get().slideshow,
          active: {
            ...a,
            status: 'manual',
            paths,
            index: idx,
            actions: stack
          }
        }
      })
    },

    async stopSlideshow() {
      const a = get().slideshow.active
      if (!a) return
      if (a.compiledMode) {
        void get().applySettingsPatch({
          slideshow: { compiledPlaylistIndex: a.index }
        })
      }
      const pending = [...a.actions]
      set({ slideshow: { ...get().slideshow, active: null } })
      // Lists window and slideshow are paired — closing either ends both.
      void call(api.slideshow.closeCompiledListsWindow()).catch(() => {})
      if (pending.length === 0) {
        if (gateOn(get)) await get().refresh()
        return
      }
      get().notify(`Committing ${pending.length} slideshow action(s)…`)
      try {
        for (const act of pending) {
          if (act.type === 'delete') {
            await call(api.fs.trash({ paths: [act.path] }))
          } else {
            const dest = act.destPath.replace(/[/\\]+$/, '')
            await ensureDir(dest)
            await call(
              api.fs.move({
                sources: [act.path],
                destinationDir: dest,
                conflictPolicy: 'rename'
              })
            )
          }
        }
        get().notify(`Committed ${pending.length} action(s)`)
      } catch (e) {
        get().notify(e instanceof IpcError ? e.message : String(e), true)
      }
      if (gateOn(get)) await get().refresh()
    },

    resetSlideshowForGateOff() {
      void api.slideshow.cancelList().catch(() => {})
      void api.slideshow.closeCompiledListsWindow().catch(() => {})
      set({ slideshow: emptySlideshowSession() })
    },

    setCategorizerMap(rows: CategorizerMapRow[]) {
      if (!gateOn(get)) return
      set({ slideshow: { ...get().slideshow, categorizerMap: rows } })
      persistCategorizerMap(get, rows)
    },

    /** After in-place edit save: force overlay to re-fetch the current frame. */
    slideshowInvalidateImage(path: string) {
      const ss = get().slideshow
      const a = ss.active
      if (!a) return
      const cur = a.paths[a.index]
      if (!cur || !samePath(cur, path)) return
      set({ slideshow: { ...ss, imageRevision: ss.imageRevision + 1 } })
    }
  }
  return actions
}

async function ensureDir(dir: string): Promise<void> {
  const ex = await call(api.fs.exists({ path: dir }))
  if (ex.exists) return
  const normalized = dir.replace(/[/\\]+$/, '')
  const parent = normalized.replace(/[/\\][^/\\]+$/, '')
  const name = basename(normalized)
  if (parent && parent !== normalized) {
    await ensureDir(parent)
  }
  if (name && parent) {
    try {
      await call(api.fs.mkdir({ parent, name }))
    } catch {
      /* exists / race */
    }
  }
}

let warnedMissingInvalidDir = false

/** Move an unloadable slideshow image into the configured review folder. */
async function moveInvalidSlideshowImage(get: Get, badPath: string): Promise<void> {
  const destRaw = get().settings.slideshow.invalidImagesDir?.trim() ?? ''
  if (!destRaw) {
    if (!warnedMissingInvalidDir) {
      warnedMissingInvalidDir = true
      get().notify(
        'Set Invalid images folder (Settings → Slideshow) to move bad files for review',
        true
      )
    }
    return
  }
  const dest = destRaw.replace(/[/\\]+$/, '')
  if (samePath(badPath, dest) || isUnderPath(badPath, dest)) return
  try {
    await ensureDir(dest)
    await call(
      api.fs.move({
        sources: [badPath],
        destinationDir: dest,
        conflictPolicy: 'rename'
      })
    )
    get().notify(`Moved invalid image: ${basename(badPath)}`)
  } catch (e) {
    get().notify(
      e instanceof IpcError
        ? `Could not move invalid image: ${e.message}`
        : `Could not move invalid image: ${String(e)}`,
      true
    )
  }
}

export type SlideshowActions = ReturnType<typeof createSlideshowActions>
