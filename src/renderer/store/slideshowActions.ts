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
import {
  emptySlideshowSession,
  slideshowLiveLength,
  slideshowCurrentPath
} from '../lib/slideshowTypes'
import {
  clearFolderPlaylist,
  folderPathAt,
  folderPlaylistFirstIndex,
  folderPlaylistLastIndex,
  folderPlaylistLiveLength,
  folderPlaylistMarkSkipped,
  folderPlaylistNextIndex,
  folderPlaylistPhysicalLength,
  folderPlaylistUnskip,
  setFolderPlaylist
} from '../lib/folderPlaylist'
import {
  clearViewOrderCache,
  discardParkedImageListCache,
  parkImageListCache,
  takeParkedImageListCacheIfAny
} from '../lib/slideshowPlayHeap'
import { basename, samePath, isUnderPath } from '../lib/paths'

type Get = () => SlideshowHost
type Set = (partial: Partial<SlideshowHost> | ((s: SlideshowHost) => Partial<SlideshowHost>)) => void

type HostListing = {
  path: string
  entries: { path: string; kind: string }[]
  loading: boolean
  error: string | null
  offline: boolean
}

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
      titleFilename: boolean
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
  listingsByTabId: Record<string, HostListing | undefined>
  listing: HostListing
  devGateActive: boolean
  dialog: unknown
  notify(text: string, isError?: boolean): void
  bumpColumnMeta(path: string): void
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

function compiledGateOn(get: Get): boolean {
  return get().devGateActive === true && gateOn(get)
}

/**
 * Playing: drop explorer listing DirEntries + reactive imageListCache copies so
 * Chromium GC/decode time does not scale with folder size. Playlist stays in
 * folderPlaylist (and parked cache) only.
 */
function enterSlideshowPlaying(get: Get, set: Set, paths: string[], active: SlideshowState): void {
  const s = get()
  clearViewOrderCache()
  setFolderPlaylist(paths)
  // Park only once — mid-play re-entry must not replace a parked list with [].
  if (s.slideshow.imageListCache.length > 0) {
    parkImageListCache(s.slideshow.imageListCache)
  }

  const listingsByTabId: Record<string, HostListing | undefined> = { ...s.listingsByTabId }
  for (const tid of Object.keys(listingsByTabId)) {
    const L = listingsByTabId[tid]
    if (!L || L.entries.length === 0) continue
    listingsByTabId[tid] = { ...L, entries: [] }
  }
  const activeListing = listingsByTabId[s.activeTabId]
  const listing =
    activeListing && activeListing.entries.length === 0
      ? activeListing
      : { ...s.listing, entries: [] }

  set({
    listingsByTabId,
    listing,
    settings: {
      ...s.settings,
      slideshow: { ...s.settings.slideshow, imageListCache: [] }
    },
    slideshow: {
      ...s.slideshow,
      imageListCache: [],
      active
    }
  })
}

function endSlideshowSession(set: Set, get: Get): void {
  clearFolderPlaylist()
  const restored = takeParkedImageListCacheIfAny()
  const s = get()
  if (restored) {
    set({
      slideshow: { ...s.slideshow, imageListCache: restored, active: null },
      settings: {
        ...s.settings,
        slideshow: { ...s.settings.slideshow, imageListCache: restored }
      }
    })
    return
  }
  set({ slideshow: { ...s.slideshow, active: null } })
}

function clearActive(set: Set, get: Get): void {
  // Same restore path as stop — mid-play empty-list exit must return parked cache.
  endSlideshowSession(set, get)
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

/** Ignores stale expand/apply results after a newer ±/# playlist push. */
let compiledApplyRev = 0
function nextCompiledApplyRev(): number {
  compiledApplyRev += 1
  return compiledApplyRev
}

/** Folder-list build generation — Esc/stop must not apply a walk that is still running. */
let slideshowBuildSeq = 0

/** Latest compiledPathAt wins — undo / nav must not be overwritten by an older fetch. */
let compiledPlayGen = 0

function invalidateSlideshowBuild(): void {
  slideshowBuildSeq += 1
  compiledApplyRev += 1
  void api.slideshow.cancelList().catch(() => {})
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

async function persistSlideshowCache(get: Get): Promise<void> {
  const session = get().slideshow
  await get().applySettingsPatch({
    slideshow: {
      cacheActive: session.cacheActive,
      imageListCache: session.imageListCache
    }
  })
}

/** Paths dropped from the image-list cache this session — flushed once on stop. */
const pendingCacheDrops = new Set<string>()

function queueCacheDrop(filePath: string): void {
  pendingCacheDrops.add(filePath.toLowerCase())
}

function flushPendingCacheDrops(get: Get, set: Set): void {
  if (pendingCacheDrops.size === 0) return
  const cache = get().slideshow.imageListCache
  const next =
    cache.length === 0 ? cache : cache.filter((p) => !pendingCacheDrops.has(p.toLowerCase()))
  pendingCacheDrops.clear()
  if (next === cache) return
  set({ slideshow: { ...get().slideshow, imageListCache: next } })
  persistSlideshowCache(get)
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
      let paths: string[]
      let builtFromCache = false

      if (session.cacheActive && session.imageListCache.length > 0) {
        // Same reference as session cache — do not copy 100k strings.
        paths = session.imageListCache
        builtFromCache = true
      } else {
        const roots = resolveSlideshowRoots(get, explicitRoots)
        if (roots.length === 0) {
          get().notify('No folder to slideshow', true)
          return
        }
        const ss = get().settings.slideshow
        const seq = ++slideshowBuildSeq
        set({
          slideshow: {
            ...get().slideshow,
            active: {
              status: 'building',
              index: 0,
              currentPath: null,
              pathCount: 0,
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
          if (seq !== slideshowBuildSeq) return
          const stillBuilding = get().slideshow.active?.status === 'building'
          if (!stillBuilding) return
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
            await persistSlideshowCache(get)
          }
          if (res.truncated) {
            get().notify('Image list truncated at cap', true)
          }
        } catch (e) {
          if (seq !== slideshowBuildSeq) return
          clearActive(set, get)
          if (e instanceof IpcError && e.code === 'cancelled') return
          get().notify(e instanceof IpcError ? e.message : String(e), true)
          return
        }
      }

      if (paths.length === 0) {
        clearActive(set, get)
        get().notify('No images found', true)
        return
      }

      const a = get().slideshow.active
      if (!builtFromCache && (!a || a.status !== 'building')) return

      pendingCacheDrops.clear()
      const active: SlideshowState = {
        status: 'playing',
        index: 0,
        currentPath: paths[0] ?? null,
        pathCount: paths.length,
        builtFromCache,
        buildFound: paths.length,
        buildCurrent: '',
        actions: [],
        compiledMode: false
      }
      enterSlideshowPlaying(get, set, paths, active)
    },

    /**
     * Start/resume compiled slideshow from !!Lists/last.txt (+ Index ADS).
     * Opens lists + black overlay immediately; main builds a virtual playlist
     * (no flat path×count array).
     */
    async startCompiledSlideshow(opts?: { resume?: boolean }) {
      if (!compiledGateOn(get)) return
      const root = get().settings.slideshow.compiledFileListsFolder.trim()
      if (!root) {
        get().notify('Set Compiled file lists folder in Settings', true)
        return
      }
      warnedMissingInvalidDir = false
      const host = get() as SlideshowHost & { closeImageViewer?: () => void; imageViewer?: unknown }
      if (host.imageViewer && host.closeImageViewer) host.closeImageViewer()

      const startRev = nextCompiledApplyRev()

      try {
        await call(api.slideshow.openCompiledListsWindow())
        actions.applyCompiledVirtual(
          { total: 0, index: 0, path: null, truncated: false },
          startRev
        )

        const { lines } = await call(api.slideshow.readLastList({ compiledRoot: root }))
        const ss = get().settings.slideshow
        const preferIndex =
          opts?.resume !== false ? (ss.compiledPlaylistIndex ?? 0) : 0

        if (startRev < compiledApplyRev) return

        const snap = await call(
          api.slideshow.applyCompiledLines({
            lines,
            order: ss.order,
            ascending: ss.ascending,
            preferIndex,
            rev: nextCompiledApplyRev()
          })
        )
        // Broadcast already applied via event; ensure local state if event raced.
        if (get().slideshow.active?.compiledMode) {
          actions.applyCompiledVirtual(snap, snap.rev ?? compiledApplyRev)
        }
        if (snap.truncated) {
          get().notify('Compiled playlist truncated at 2,147,483,647 entries')
        }
      } catch (e) {
        if (!get().slideshow.active?.compiledMode) {
          actions.applyCompiledVirtual(
            { total: 0, index: 0, path: null },
            nextCompiledApplyRev()
          )
        }
        get().notify(e instanceof IpcError ? e.message : String(e), true)
      }
    },

    /**
     * Second toolbar button: always open lists + start compiled session
     * (blank screen when last.txt has no counts / empty Index).
     */
    async compiledSlideshowToolbarClick() {
      if (!compiledGateOn(get)) return
      await actions.startCompiledSlideshow({ resume: true })
    },

    /** Apply virtual compiled playlist meta from main (not a flat path array). */
    applyCompiledVirtual(
      meta: {
        total: number
        index: number
        path: string | null
        truncated?: boolean
        resumePlaying?: boolean
      },
      rev?: number | null
    ) {
      if (!compiledGateOn(get)) return
      if (rev != null) {
        if (rev < compiledApplyRev) return
        compiledApplyRev = rev
      } else {
        compiledApplyRev += 1
      }
      clearFolderPlaylist()
      const prev = get().slideshow.active
      const status =
        meta.resumePlaying === true
          ? 'playing'
          : prev?.compiledMode && prev.status !== 'building'
            ? prev.status
            : 'playing'
      const active: SlideshowState = {
        status,
        index: meta.total <= 0 ? 0 : Math.max(0, Math.min(meta.index, meta.total - 1)),
        currentPath: meta.path,
        pathCount: meta.total,
        builtFromCache: true,
        buildFound: meta.total,
        buildCurrent: '',
        actions: prev?.compiledMode ? prev.actions : [],
        compiledMode: true,
        compiledTotal: meta.total,
        compiledTruncated: meta.truncated === true
      }
      // First transition into compiled play: drop explorer heap. Later ± updates: cursor only.
      const firstPlay = !prev || prev.status === 'building' || !prev.compiledMode
      if (firstPlay) enterSlideshowPlaying(get, set, [], active)
      else set({ slideshow: { ...get().slideshow, active } })
    },

    /** @deprecated flat-path apply — only used if legacy broadcast includes paths[]. */
    applyCompiledPlaylist(
      paths: string[],
      preferPath?: string | null,
      rev?: number | null
    ) {
      if (!compiledGateOn(get)) return
      // Legacy: treat as tiny flat list converted to virtual-shaped state.
      if (rev != null) {
        if (rev < compiledApplyRev) return
        compiledApplyRev = rev
      } else {
        compiledApplyRev += 1
      }
      const capped = clampImageList(paths)
      setFolderPlaylist(capped)
      let index = 0
      if (preferPath) {
        const found = capped.findIndex((p) => samePath(p, preferPath))
        if (found >= 0) index = found
      }
      const a = get().slideshow.active
      set({
        slideshow: {
          ...get().slideshow,
          active: {
            status: 'playing',
            index,
            currentPath: folderPathAt(index),
            pathCount: capped.length,
            builtFromCache: true,
            buildFound: capped.length,
            buildCurrent: '',
            actions: a?.compiledMode ? a.actions : [],
            compiledMode: true,
            compiledTotal: capped.length
          }
        }
      })
    },

    async setCompiledPlayIndex(index: number, status?: SlideshowState['status']) {
      const a = get().slideshow.active
      if (!a?.compiledMode) return
      const gen = ++compiledPlayGen
      const n = a.compiledTotal ?? 0
      if (n <= 0) {
        set({
          slideshow: {
            ...get().slideshow,
            active: { ...a, index: 0, currentPath: null, status: status ?? a.status }
          }
        })
        return
      }
      const i = Math.max(0, Math.min(index, n - 1))
      try {
        const { path } = await call(api.slideshow.compiledPathAt({ index: i }))
        if (gen !== compiledPlayGen) return
        const cur = get().slideshow.active
        if (!cur?.compiledMode) return
        set({
          slideshow: {
            ...get().slideshow,
            active: {
              ...cur,
              index: i,
              currentPath: path,
              status: status ?? cur.status
            }
          }
        })
      } catch {
        /* ignore */
      }
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

    slideshowResumePlaying() {
      if (!gateOn(get)) return
      const a = get().slideshow.active
      if (!a || a.status !== 'manual') return
      set({
        slideshow: {
          ...get().slideshow,
          active: { ...a, status: 'playing' }
        }
      })
    },

    async slideshowCropSave(imagePath: string, crop: import('@shared/slideshow/crop').SlideshowAccumulatedCrop) {
      if (!gateOn(get)) return false
      try {
        await call(api.fs.cropSlideshowImage({ path: imagePath, crop }))
        actions.slideshowInvalidateImage(imagePath)
        get().bumpColumnMeta(imagePath)
        get().notify('Crop saved')
        return true
      } catch (e) {
        get().notify(e instanceof IpcError ? e.message : String(e), true)
        return false
      }
    },

    slideshowAdvanceAuto() {
      if (!gateOn(get)) return
      const a = get().slideshow.active
      if (!a || a.status !== 'playing') return
      const n = slideshowLiveLength(a)
      if (n <= 0) return
      if (a.compiledMode) {
        const next = a.index + 1
        if (next >= n) {
          if (get().settings.slideshow.loop) void actions.setCompiledPlayIndex(0)
          else void actions.stopSlideshow()
          return
        }
        void actions.setCompiledPlayIndex(next)
        return
      }
      const next = folderPlaylistNextIndex(a.index, 1, get().settings.slideshow.loop)
      if (next == null) {
        void actions.stopSlideshow()
        return
      }
      set({
        slideshow: {
          ...get().slideshow,
          active: {
            ...a,
            index: next,
            currentPath: folderPathAt(next),
            pathCount: folderPlaylistPhysicalLength()
          }
        }
      })
    },

    /**
     * Unloadable / undecodable current image:
     * - skip current index (paths array stays put)
     * - queue a cache drop (flushed on stop)
     * - move into `invalidImagesDir` when configured (not a soft skip)
     */
    slideshowSkipUnloadable() {
      if (!gateOn(get)) return
      const a = get().slideshow.active
      if (!a || a.status === 'building') return

      if (a.compiledMode) {
        const badPath = a.currentPath
        if (!badPath) return
        queueCacheDrop(badPath)
        void call(api.slideshow.compiledPathAt({ index: a.index })).catch(() => {})
        void moveInvalidSlideshowImage(get, badPath)
        const n = a.compiledTotal ?? 0
        if (n <= 0) return
        const next = a.index + 1
        if (next >= n) {
          if (get().settings.slideshow.loop) void actions.setCompiledPlayIndex(0)
          else get().notify('No displayable images left in compiled session', true)
          return
        }
        void actions.setCompiledPlayIndex(next, a.status)
        return
      }

      if (folderPlaylistPhysicalLength() === 0) return
      const badPath = folderPathAt(a.index)
      if (!badPath) return
      const removeIdx = a.index
      folderPlaylistMarkSkipped(removeIdx)
      queueCacheDrop(badPath)
      void moveInvalidSlideshowImage(get, badPath)

      if (folderPlaylistLiveLength() === 0) {
        clearActive(set, get)
        get().notify('No displayable images left — slideshow stopped', true)
        return
      }

      const index = folderPlaylistNextIndex(removeIdx, 1, true)
      if (index == null) {
        clearActive(set, get)
        return
      }
      set({
        slideshow: {
          ...get().slideshow,
          active: {
            ...a,
            index,
            currentPath: folderPathAt(index),
            pathCount: folderPlaylistPhysicalLength()
          }
        }
      })
    },

    slideshowNavigate(dir: -1 | 1 | 'first' | 'last') {
      if (!gateOn(get)) return
      const a = get().slideshow.active
      if (!a) return
      const n = slideshowLiveLength(a)
      if (n <= 0) return
      const loop = get().settings.slideshow.loop
      let index: number | null
      if (a.compiledMode) {
        if (dir === 'first') index = 0
        else if (dir === 'last') index = n - 1
        else if (loop) index = (((a.index + dir) % n) + n) % n
        else index = Math.max(0, Math.min(n - 1, a.index + dir))
        void actions.setCompiledPlayIndex(index, a.status === 'building' ? a.status : 'manual')
        return
      }
      if (dir === 'first') index = folderPlaylistFirstIndex()
      else if (dir === 'last') index = folderPlaylistLastIndex()
      else index = folderPlaylistNextIndex(a.index, dir, loop)
      if (index == null) return
      set({
        slideshow: {
          ...get().slideshow,
          active: {
            ...a,
            status: a.status === 'building' ? a.status : 'manual',
            index,
            currentPath: folderPathAt(index),
            pathCount: folderPlaylistPhysicalLength()
          }
        }
      })
    },

    slideshowMapAction(row: CategorizerMapRow) {
      if (!gateOn(get)) return
      const a = get().slideshow.active
      if (!a || a.status === 'building') return
      const curPath = slideshowCurrentPath(a)
      if (!curPath) return
      const insertIndex = a.index

      if (a.compiledMode) {
        // Soft-skip: do not rebuild virtual list; buffer action and advance.
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
              actions: [...a.actions, action]
            }
          }
        })
        const n = a.compiledTotal ?? 0
        if (n <= 0) return
        const next = Math.min(a.index + 1, n - 1)
        void actions.setCompiledPlayIndex(next === a.index && n > 1 ? 0 : next, 'manual')
        return
      }

      if (folderPlaylistPhysicalLength() === 0) return
      folderPlaylistMarkSkipped(insertIndex)
      const nextIndex = folderPlaylistNextIndex(insertIndex, 1, true)
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
      const idx = nextIndex ?? insertIndex
      set({
        slideshow: {
          ...get().slideshow,
          active: {
            ...a,
            status: 'manual',
            index: idx,
            currentPath: folderPathAt(idx),
            pathCount: folderPlaylistPhysicalLength(),
            actions: [...a.actions, action]
          }
        }
      })
      if (folderPlaylistLiveLength() === 0) {
        get().notify('List empty — stop to commit pending actions')
      }
    },

    slideshowUndoAction() {
      if (!gateOn(get)) return
      const a = get().slideshow.active
      if (!a || a.actions.length === 0) return
      const stack = [...a.actions]
      const last = stack.pop()!
      if (a.compiledMode) {
        set({
          slideshow: {
            ...get().slideshow,
            active: {
              ...a,
              status: 'manual',
              actions: stack
            }
          }
        })
        const n = a.compiledTotal ?? 0
        const idx = n <= 0 ? 0 : Math.min(last.insertIndex, Math.max(0, n - 1))
        void actions.setCompiledPlayIndex(idx, 'manual')
        return
      }
      folderPlaylistUnskip(last.insertIndex)
      const idx = Math.min(last.insertIndex, Math.max(0, folderPlaylistPhysicalLength() - 1))
      set({
        slideshow: {
          ...get().slideshow,
          active: {
            ...a,
            status: 'manual',
            index: idx,
            currentPath: folderPathAt(idx),
            pathCount: folderPlaylistPhysicalLength(),
            actions: stack
          }
        }
      })
    },

    async stopSlideshow() {
      invalidateSlideshowBuild()
      const a = get().slideshow.active
      if (!a) return
      if (a.compiledMode) {
        void get().applySettingsPatch({
          slideshow: { compiledPlaylistIndex: a.index }
        })
      }
      const pending = [...a.actions]
      endSlideshowSession(set, get)
      flushPendingCacheDrops(get, set)
      void call(api.slideshow.clearVirtualPlaylist()).catch(() => {})
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
      invalidateSlideshowBuild()
      pendingCacheDrops.clear()
      discardParkedImageListCache()
      clearFolderPlaylist()
      void api.slideshow.clearVirtualPlaylist().catch(() => {})
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
      const cur = slideshowCurrentPath(a)
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
  if (!get().devGateActive) return
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
