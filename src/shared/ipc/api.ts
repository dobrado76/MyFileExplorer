import type { Result } from '../result'
import type {
  CheckConflictsRequest,
  CheckConflictsResponse,
  CopyResponse,
  DeletePermanentResponse,
  DriveInfo,
  ListRequest,
  ListResponse,
  MoveResponse,
  ResolveIssuesRequest,
  ResolveIssuesResponse,
  TrashResponse,
  NameInParentRequest,
  PathRequest,
  PathsRequest,
  RelocateRequest,
  RenameRequest,
  SetVolumeLabelRequest,
  StatResult,
  TransferRequest
} from '../schemas/fs'
import type {
  FolderMeasureResult,
  PropertiesModel,
  PropertiesRequest,
  SetAttributesRequest,
  SetAttributesResponse
} from '../schemas/properties'
import type { SessionState } from '../schemas/session'
import type { Settings, SettingsPatch } from '../schemas/settings'
import type {
  PreviewChmTopicRequest,
  PreviewDisplayUrlRequest,
  PreviewEnsurePlayableRequest,
  PreviewMediaMetaRequest,
  PreviewMediaMetaResponse,
  PreviewModel,
  PreviewRequest,
  PreviewWindowTarget
} from '../schemas/preview'
import type { MetaGetManyRequest, MetaGetManyResponse } from '../schemas/meta'
import type {
  IndexRootInfo,
  ReindexRequest,
  SearchQueryRequest,
  SearchQueryResponse
} from '../schemas/search'
import type { RecycleBinListResponse } from '../schemas/recycle'
import type { SlideshowListRequest } from '../schemas/slideshow'
import type { MfeEvent } from './contract'

export type MyFileExplorerApi = {
  fs: {
    list(req: ListRequest): Promise<Result<ListResponse>>
    stat(req: PathRequest): Promise<Result<StatResult>>
    mkdir(req: NameInParentRequest): Promise<Result<{ path: string }>>
    createFile(req: NameInParentRequest): Promise<Result<{ path: string }>>
    rename(req: RenameRequest): Promise<Result<{ path: string }>>
    copy(req: TransferRequest): Promise<Result<CopyResponse>>
    move(req: TransferRequest): Promise<Result<MoveResponse>>
    resolveIssues(req: ResolveIssuesRequest): Promise<Result<ResolveIssuesResponse>>
    /** Move each path to an exact destination (undo/redo). */
    relocate(req: RelocateRequest): Promise<Result<{ moved: string[] }>>
    checkConflicts(req: CheckConflictsRequest): Promise<Result<CheckConflictsResponse>>
    /** Preview a copy/move/trash/delete before running (Ctrl-plan gate). */
    planOp(req: import('../schemas/fs').FileOpPlanRequest): Promise<Result<import('../schemas/fs').FileOpPlanResponse>>
    /** Create Windows .lnk shortcuts in destinationDir for each source path. */
    createShortcuts(
      req: CheckConflictsRequest
    ): Promise<Result<{ created: string[] }>>
    createLink(
      req: import('../schemas/createLink').CreateLinkRequest
    ): Promise<Result<{ path: string }>>
    /** Compress paths into a new `.zip` beside the selection. */
    compressToZip(req: PathsRequest): Promise<Result<{ zipPath: string }>>
    /** Extract `.zip` paths into sibling folders named after each archive. */
    extractZip(req: PathsRequest): Promise<Result<{ extractedDirs: string[] }>>
    trash(req: PathsRequest): Promise<Result<TrashResponse>>
    deletePermanent(req: PathsRequest): Promise<Result<DeletePermanentResponse>>
    /** Restore trashed items by their original full paths (Windows Recycle Bin). */
    restoreFromTrash(req: PathsRequest): Promise<Result<{ restored: string[]; missing: string[] }>>
    /** List items currently in the Windows Recycle Bin. */
    listRecycleBin(): Promise<Result<RecycleBinListResponse>>
    /** Permanently empty the Recycle Bin. */
    emptyRecycleBin(): Promise<Result<{ emptied: true }>>
    /** Permanently delete selected items from the Recycle Bin. */
    deleteFromRecycleBin(
      req: PathsRequest
    ): Promise<Result<{ deleted: string[]; missing: string[] }>>
    /** Request cancel of the in-flight copy/move/trash/delete/vid-thumbs op. */
    cancelOp(): Promise<Result<{ cancelled: boolean }>>
    /** Processes locking / using a path (D65). */
    findLockers(
      req: import('../schemas/lockers').FindLockersRequest
    ): Promise<Result<import('../schemas/lockers').FindLockersResponse>>
    /** End a locking process after user confirm (D65). */
    endProcess(
      req: import('../schemas/lockers').EndProcessRequest
    ): Promise<Result<{ ended: true }>>
    exists(req: PathRequest): Promise<Result<{ exists: boolean }>>
    watch(req: PathRequest): Promise<Result<{ watching: true }>>
    unwatch(req: PathRequest): Promise<Result<{ ok: true }>>
    listDrives(): Promise<Result<{ drives: DriveInfo[] }>>
    /** Set or clear the Windows volume label for a drive root (`C:\`). */
    setVolumeLabel(
      req: SetVolumeLabelRequest
    ): Promise<Result<{ path: string; volumeName: string }>>
    properties(req: PropertiesRequest): Promise<Result<PropertiesModel>>
    measureFolder(req: PropertiesRequest): Promise<Result<FolderMeasureResult>>
    calculateFolderStatistics(
      req: import('../schemas/fs').CalculateFolderStatisticsRequest
    ): Promise<Result<import('../folderStats').FolderStatisticsResult>>
    setAttributes(req: SetAttributesRequest): Promise<Result<SetAttributesResponse>>
    /** Custom folder icon via desktop.ini + Folder.ico. */
    setFolderIcon(req: { path: string; iconPath: string }): Promise<Result<{ path: string }>>
    /** Save Filerobot output as tip ADS (`VER_n`); `$DATA` stays pristine original. */
    saveEditedImage(req: {
      path: string
      dataBase64: string
    }): Promise<Result<{ path: string; preservedOriginal: boolean; versionCount: number }>>
    /** Version Control state (`VER_COUNT` / tip). */
    imageEditState(req: PathRequest): Promise<
      Result<{ versionCount: number; tipVer: number; hasVersions: boolean }>
    >
    /** @deprecated Prefer imageEditState — true when VER_COUNT ≥ 1. */
    hasImageOriginal(req: PathRequest): Promise<Result<{ hasOriginal: boolean }>>
    /** Drop all VER_* / VER_COUNT (leave $DATA). */
    revertImageOriginal(req: PathRequest): Promise<Result<{ path: string; reverted: boolean }>>
    dropImageVersion(req: {
      path: string
      ver: number
    }): Promise<Result<{ path: string; versionCount: number }>>
    /** Collapse tip into $DATA; preserve non-version ADS. */
    commitImageVersion(req: PathRequest): Promise<Result<{ path: string; committed: boolean }>>
    /** Load image bytes for Filerobot (tip by default; optional ADS override). */
    readImageForEdit(req: {
      path: string
      ads?: string | null
    }): Promise<Result<{ dataBase64: string; mime: string }>>
    /** Slideshow numpad crop — single encode from pristine `$DATA`. */
    cropSlideshowImage(req: import('../schemas/imageEdit').CropSlideshowImageRequest): Promise<
      Result<{ path: string; preservedOriginal: boolean; versionCount: number }>
    >
    /** Save dialog + write; no original backup (Save As). */
    saveEditedImageAs(req: {
      dataBase64: string
      defaultPath: string
      sourcePath: string
    }): Promise<Result<{ path: string | null; cancelled: boolean }>>
    /** Ensure LaMa ONNX is cached; returns path + fetchable modelUrl for ORT. */
    ensureLamaModel(): Promise<
      Result<{ path: string; downloaded: boolean; modelUrl: string }>
    >
  }
  shell: {
    openPath(req: PathRequest): Promise<Result<{ opened: boolean; message?: string }>>
    showItemInFolder(req: PathRequest): Promise<Result<{ shown: true }>>
    /** Open cmd or PowerShell (Settings) in a folder. Shift = elevated (UAC). */
    openCommandLine(req: PathRequest & { elevated?: boolean }): Promise<Result<{ opened: true }>>
    /** Open Explorer’s property sheet (NTFS Security, Sharing, etc.). */
    showProperties(req: PathRequest): Promise<Result<{ shown: true }>>
    /** Open Computer Management, Device Manager, Control Panel, or This PC Properties. */
    openWindowsTool(req: {
      id: import('../schemas/windowsTools').WindowsToolId
    }): Promise<Result<{ opened: true }>>
    /** Open the Windows Recycle Bin in system Explorer (legacy fallback). */
    openRecycleBin(): Promise<Result<{ opened: boolean; message?: string }>>
    /**
     * Launch a user-configured program with argv (no shell). Executable may
     * include `%ENV%` segments; must resolve to an absolute existing path.
     */
    exec(req: { executable: string; args: string[] }): Promise<Result<{ launched: true }>>
    /**
     * Scan static Windows shell verbs (HKCR) for Settings → Context menu → Discover.
     * Never loads COM shell extensions.
     */
    discoverVerbs(): Promise<Result<import('../schemas/shellVerbs').DiscoverShellVerbsResponse>>
    clipboardWriteFiles(
      req: import('../schemas/fs').ClipboardWriteFilesRequest
    ): Promise<Result<{ written: boolean }>>
    clipboardReadFiles(): Promise<Result<{ paths: string[]; effect: 'copy' | 'move' }>>
    clipboardPeek(): Promise<Result<import('../schemas/clipboardPaste').ClipboardPeek>>
    clipboardWriteFile(
      req: import('../schemas/clipboardPaste').ClipboardWriteFileRequest
    ): Promise<Result<{ path: string }>>
    /**
     * Hand file paths to the OS drag (Explorer / Photoshop / mail / etc.).
     * Synchronous — blocks until the drag ends. Call when a left-drag leaves
     * the window (not from HTML5 dragstart on Windows). Returns whether
     * startDrag ran.
     */
    startDrag(req: PathsRequest): boolean
  }
  templates: {
    import(): Promise<
      Result<
        | { cancelled: true }
        | { cancelled: false; template: import('../schemas/templates').FileTemplate }
      >
    >
    delete(req: { id: string }): Promise<Result<{ ok: true }>>
    replace(req: { id: string }): Promise<
      Result<
        | { cancelled: true }
        | { cancelled: false; template: import('../schemas/templates').FileTemplate }
      >
    >
    duplicate(req: { id: string }): Promise<Result<import('../schemas/templates').FileTemplate>>
    instantiate(req: { id: string; destDir: string }): Promise<Result<{ path: string }>>
  }
  itemAds: {
    getMany(req: { paths: string[] }): Promise<
      Result<Record<string, import('../schemas/itemAds').ItemAdsRecord>>
    >
    setNote(req: {
      path: string
      note: import('../schemas/itemAds').ItemNote | null
    }): Promise<Result<{ ok: true }>>
    setIcon(req: {
      path: string
      icon: import('../schemas/itemAds').ItemIcon | null
      imageBase64?: string
    }): Promise<Result<{ ok: true }>>
    importCustomIcon(req: { path: string }): Promise<
      Result<
        | { cancelled: true }
        | {
            cancelled: false
            icon: import('../schemas/itemAds').ItemIcon
            imageBase64: string
          }
      >
    >
  }
  tabs: {
    /** Open-file dialog; Sharp cover-crops to a square PNG under userData. */
    importCustomIcon(): Promise<
      Result<{ cancelled: true } | { cancelled: false; id: string; mediaUrl: string }>
    >
    customIconUrl(req: { id: string }): Promise<Result<{ mediaUrl: string | null }>>
  }
  quickLaunch: {
    pickProgram(): Promise<
      Result<{ cancelled: true } | { cancelled: false; path: string; name: string }>
    >
    importIcon(): Promise<
      Result<{ cancelled: true } | { cancelled: false; id: string; mediaUrl: string }>
    >
    iconUrl(req: { id: string }): Promise<Result<{ mediaUrl: string | null }>>
    deleteIcon(req: { id: string }): Promise<Result<{ ok: true }>>
    launch(req: { id: string }): Promise<Result<{ launched: true }>>
    reveal(req: { id: string }): Promise<Result<{ shown: true }>>
  }
  session: {
    get(): Promise<Result<SessionState>>
    set(session: SessionState): Promise<Result<SessionState>>
  }
  settings: {
    get(): Promise<Result<Settings>>
    set(patch: SettingsPatch): Promise<Result<Settings>>
    clearThumbCache(): Promise<Result<{ cleared: true }>>
    exportFile(): Promise<Result<{ saved: boolean; path?: string }>>
    importFile(): Promise<
      Result<{
        imported: boolean
        settings?: Settings
        networkHostCount?: number
        remoteConnectionCount?: number
        scriptCount?: number
      }>
    >
  }
  preview: {
    get(req: PreviewRequest): Promise<Result<PreviewModel>>
    /** Slideshow: media URL only — no generation parse / full-file Sharp. */
    getDisplayUrl(req: PreviewDisplayUrlRequest): Promise<Result<{ mediaUrl: string | null }>>
    ensurePlayable(req: PreviewEnsurePlayableRequest): Promise<Result<{ mediaUrl: string | null }>>
    /** A/V duration/codecs/tags — call after get when `mediaMetaPending` (non-blocking for player). */
    getMediaMeta(req: PreviewMediaMetaRequest): Promise<Result<PreviewMediaMetaResponse>>
    /** Topic HTML URL for Compiled HTML Help (`.chm`) preview. */
    chmTopic(req: PreviewChmTopicRequest): Promise<Result<{ mediaUrl: string }>>
    openWindow(): Promise<Result<{ opened: true }>>
    setTarget(req: PreviewWindowTarget): Promise<Result<{ ok: true }>>
    getTarget(): Promise<Result<PreviewWindowTarget>>
  }
  search: {
    query(req: SearchQueryRequest): Promise<Result<SearchQueryResponse>>
    addRoot(req: PathRequest): Promise<Result<{ roots: IndexRootInfo[] }>>
    addVolume(req: PathRequest): Promise<Result<{ roots: IndexRootInfo[] }>>
    removeRoot(req: PathRequest): Promise<Result<{ roots: IndexRootInfo[] }>>
    reindex(req: ReindexRequest): Promise<Result<{ started: boolean }>>
    listRoots(): Promise<Result<{ roots: IndexRootInfo[] }>>
    cancel(): Promise<Result<{ cancelled: boolean }>>
  }
  thumbs: {
    get(req: {
      path: string
      size: number
    }): Promise<Result<{ url: string | null; frames?: string[] }>>
    generateVidCache(req: {
      paths: string[]
      mode: 'missing' | 'all'
      recursive?: boolean
    }): Promise<
      Result<{
        generated: number
        skipped: number
        failed: { path: string; message: string }[]
      }>
    >
  }
  icons: {
    /** Windows shell icon (folder / file-type / exe) via SHGetFileInfo. */
    get(req: {
      path: string
      size: number
      /** Pass true for directories so they never reuse a file-extension glyph. */
      isDir?: boolean
      /**
       * Deferred paths (Dropbox / mapped drives): return a type icon immediately
       * and set `pendingRich` so the client can upgrade via a second call.
       */
      fast?: boolean
    }): Promise<Result<{ url: string | null; pendingRich?: boolean }>>
  }
  meta: {
    /** Batch column metadata (image / A/V / generation fields / ADS). */
    getMany(req: MetaGetManyRequest): Promise<Result<MetaGetManyResponse>>
    /** Drop cached column meta for paths (e.g. after ADS edits). */
    invalidate(req: { paths: string[] }): Promise<Result<{ ok: true }>>
  }
  app: {
    getPath(req: {
      name:
        | 'userData'
        | 'home'
        | 'desktop'
        | 'documents'
        | 'downloads'
        | 'pictures'
        | 'music'
        | 'videos'
    }): Promise<Result<{ path: string }>>
    /** Expand Windows `%VARIABLE%` segments in a typed/pasted path. */
    expandPath(req: { path: string }): Promise<Result<{ path: string }>>
    pickFolder(): Promise<Result<{ path: string | null }>>
    /** Tell main the UI is ready for queued external-open requests. */
    ready(): Promise<Result<{ ok: true; platform: string }>>
    getVersion(): Promise<Result<{ version: string }>>
    devGate(): Promise<Result<{ active: boolean; present: boolean; enable: boolean }>>
    /** Write ENABLE in existing userData DEV.cfg. Never creates the file. */
    setDevGateEnable(req: { enable: boolean }): Promise<
      Result<{ active: boolean; present: boolean; enable: boolean }>
    >
    checkUpdate(req: { source: string }): Promise<
      Result<{
        candidate: {
          path: string
          downloadUrl?: string
          fileName: string
          version: string | null
          newer: boolean
          currentVersion: string
          sourceKind: 'folder' | 'url'
        } | null
      }>
    >
    /** Launch installer (local path or download from GitHub), then quit the app. */
    runUpdate(req: {
      path: string
      source: string
      downloadUrl?: string
      version?: string
    }): Promise<Result<{ launched: true }>>
  }
  mediaMetadata: {
    extractPlex(req: {
      paths: string[]
      kindHints?: Record<string, 'movie' | 'show' | 'episode'>
      nameHints?: Record<string, string>
    }): Promise<
      Result<{
        done: number
        failed: { path: string; message: string }[]
        updated: string[]
        stoppedReason?: string
        needsKind?: { path: string; title: string }[]
        needsName?: { path: string; suggested: string; message: string }[]
      }>
    >
    download(req: {
      paths: string[]
      kindHints?: Record<string, 'movie' | 'show' | 'episode'>
      pickHints?: Record<string, string>
      nameHints?: Record<string, string>
    }): Promise<
      Result<{
        done: number
        failed: { path: string; message: string }[]
        updated: string[]
        stoppedReason?: string
        needsKind?: { path: string; title: string }[]
        needsPick?: {
          path: string
          title: string
          suggested: string
          candidates: { id: string; title: string; year?: number; subtitle?: string }[]
        }[]
        needsName?: { path: string; suggested: string; message: string }[]
      }>
    >
    refresh(req: {
      paths: string[]
      kindHints?: Record<string, 'movie' | 'show' | 'episode'>
      pickHints?: Record<string, string>
      nameHints?: Record<string, string>
    }): Promise<
      Result<{
        done: number
        failed: { path: string; message: string }[]
        updated: string[]
        stoppedReason?: string
        needsKind?: { path: string; title: string }[]
        needsPick?: {
          path: string
          title: string
          suggested: string
          candidates: { id: string; title: string; year?: number; subtitle?: string }[]
        }[]
        needsName?: { path: string; suggested: string; message: string }[]
      }>
    >
    clear(req: { paths: string[] }): Promise<
      Result<{
        done: number
        failed: { path: string; message: string }[]
        updated: string[]
        stoppedReason?: string
      }>
    >
    get(req: { path: string }): Promise<
      Result<{
        metadata: import('../mediaMetadata').MediaMetadata | null
        thumbnailBase64: string | null
      }>
    >
    listCovers(req: { path: string }): Promise<
      Result<{
        title: string
        covers: {
          id: string
          source: 'plex' | 'tmdb' | 'current' | 'custom'
          label: string
          selected: boolean
          previewBase64: string
          width: number
          height: number
        }[]
      }>
    >
    loadCustomCover(req: {
      path: string
      imagePath: string
    }): Promise<
      Result<{
        cover: {
          id: string
          source: 'plex' | 'tmdb' | 'current' | 'custom'
          label: string
          selected: boolean
          previewBase64: string
          width: number
          height: number
        }
      }>
    >
    setCover(req: {
      path: string
      coverId: string
      previewBase64?: string
    }): Promise<Result<{ ok: true }>>
    setWatched(req: { paths: string[]; watched: boolean }): Promise<Result<{ updated: string[] }>>
    consolidateSubtitles(req: { paths: string[] }): Promise<
      Result<{
        copied: number
        skipped: number
        recycled: number
        failed: { path: string; message: string }[]
      }>
    >
    folderLibrary(req: { path: string }): Promise<
      Result<{
        isContainer: boolean
        items: {
          path: string
          watched: boolean
          genres: string[]
          kind: 'movie' | 'show' | 'episode'
          season?: number
          episode?: number
          title?: string
          showTitle?: string
        }[]
      }>
    >
    probePlex(): Promise<
      Result<{
        installed: boolean
        running: boolean
        dataDir: string | null
        tokenFound: boolean
        url: string
      }>
    >
  }
  slideshow: {
    listImages(req: SlideshowListRequest): Promise<Result<{ paths: string[]; truncated?: boolean }>>
    cancelList(): Promise<Result<{ cancelled: true }>>
    pickOpenFile(req: {
      title?: string
      defaultPath?: string
      filters?: { name: string; extensions: string[] }[]
    }): Promise<Result<{ path: string | null }>>
    pickSaveFile(req: {
      title?: string
      defaultPath?: string
      filters?: { name: string; extensions: string[] }[]
    }): Promise<Result<{ path: string | null }>>
    readTextFile(req: { path: string }): Promise<Result<{ text: string }>>
    writeTextFile(req: { path: string; text: string }): Promise<Result<{ ok: true }>>
    updateCompiledLists(req: {
      compiledRoot: string
      entries: { name: string; folder: string }[]
    }): Promise<
      Result<{
        updated: number
        totalFiles: number
        datUpdated: number
        txtUpdated: number
      }>
    >
    validateCompiledLists(req: { compiledRoot: string }): Promise<
      Result<{
        ok: boolean
        checkedLists: number
        issueCount: number
        issues: {
          kind: 'missing-folder' | 'missing-list'
          listPath: string
          listLabel: string
          refPath?: string
          message: string
        }[]
      }>
    >
    listCompiledDats(req: {
      compiledRoot: string
      entries: { name: string; folder: string }[]
    }): Promise<
      Result<{
        tabs: {
          name: string
          dats: {
            path: string
            name: string
            kind: 'dat' | 'txt'
            fileCount: number
            indexPresent: boolean
          }[]
        }[]
      }>
    >
    readDatIndex(req: { path: string }): Promise<Result<{ paths: string[] }>>
    readLastList(req: { compiledRoot: string }): Promise<
      Result<{ lines: { datPath: string; count: number }[] }>
    >
    writeLastList(req: {
      compiledRoot: string
      lines: { datPath: string; count: number }[]
    }): Promise<Result<{ ok: true }>>
    readCompositeList(req: { path: string }): Promise<
      Result<{ lines: { datPath: string; count: number }[] }>
    >
    writeCompositeList(req: {
      path: string
      lines: { datPath: string; count: number }[]
    }): Promise<Result<{ ok: true }>>
    lastListUsable(req: { compiledRoot: string }): Promise<Result<{ usable: boolean }>>
    expandComposite(req: {
      lines: { datPath: string; count: number }[]
      order?: 'random' | 'name' | 'size' | 'dimensions'
      ascending?: boolean
    }): Promise<Result<{ paths: string[] }>>
    openCompiledListsWindow(): Promise<Result<{ opened: true }>>
    closeCompiledListsWindow(): Promise<Result<{ closed: boolean }>>
    /** Relay a keystroke from the Compiled lists window to the main slideshow. */
    relayKey(req: {
      key: string
      code: string
      ctrlKey: boolean
      altKey: boolean
      shiftKey: boolean
      metaKey: boolean
    }): Promise<Result<{ ok: true }>>
    /** Build main-process virtual playlist from last.txt lines; broadcast meta. */
    applyCompiledLines(req: {
      lines: { datPath: string; count: number }[]
      order: 'random' | 'name' | 'size' | 'dimensions'
      ascending: boolean
      preferPath?: string | null
      preferIndex?: number
      rev?: number | null
      /** Compiled lists Play — force status back to autoplay. */
      resumePlaying?: boolean
    }): Promise<
      Result<{
        total: number
        index: number
        path: string | null
        truncated: boolean
        listCounts?: { path: string; fileCount: number }[]
        rev?: number | null
      }>
    >
    compiledPathAt(req: { index: number }): Promise<Result<{ path: string | null }>>
    clearVirtualPlaylist(): Promise<Result<{ ok: true }>>
    /** @deprecated Prefer applyCompiledLines for compiled slideshow. */
    applyCompiledPlaylist(req: {
      paths: string[]
      preferPath?: string | null
      rev?: number | null
    }): Promise<Result<{ ok: true }>>
  }
  ads: {
    list(req: { path: string }): Promise<Result<{ streams: { name: string; size: number }[] }>>
    listNamesMany(req: { paths: string[] }): Promise<Result<{ names: string[] }>>
    exists(req: { path: string; name: string }): Promise<Result<{ exists: boolean }>>
    readText(req: { path: string; name: string }): Promise<Result<{ text: string }>>
    writeText(req: {
      path: string
      name: string
      value: string
      writeEmpty?: boolean
    }): Promise<Result<{ ok: true }>>
    delete(req: { path: string; name: string }): Promise<Result<{ deleted: boolean }>>
    readBytes(req: { path: string; name: string }): Promise<Result<{ dataBase64: string | null }>>
    writeBytes(req: {
      path: string
      name: string
      dataBase64: string
    }): Promise<Result<{ ok: true }>>
    copy(req: {
      source: string
      dest: string
      ignoreNames?: string[]
    }): Promise<Result<{ copied: number }>>
  }
  usn: {
    query(req: { path: string }): Promise<Result<import('../schemas/usn').UsnQueryResponse>>
    enable(req: {
      path: string
      maxBytes: number
      deltaBytes: number
      elevate?: boolean
    }): Promise<Result<import('../schemas/usn').UsnQueryResponse>>
    disable(req: { path: string; elevate?: boolean }): Promise<Result<{ disabled: true }>>
    clear(req: {
      path: string
      maxBytes: number
      deltaBytes: number
      elevate?: boolean
    }): Promise<Result<import('../schemas/usn').UsnQueryResponse>>
    recent(req: {
      path: string
      limit?: number
      elevate?: boolean
    }): Promise<Result<import('../schemas/usn').UsnRecentResponse>>
  }
  network: {
    startDiscovery(): Promise<Result<{ generation: number }>>
    cancelDiscovery(): Promise<Result<{ cancelled: boolean }>>
    listShares(req: { server: string }): Promise<
      Result<{ shares: { name: string; unc: string; remark?: string }[] }>
    >
    mapDriveDialog(): Promise<Result<{ opened: boolean; result: number }>>
    disconnectDriveDialog(): Promise<Result<{ opened: boolean; result: number }>>
    /** Disconnect + forget one mapped letter (`N:`). */
    disconnectMappedDrive(req: {
      path: string
      force?: boolean
    }): Promise<Result<{ disconnected: true; letter: string; remotePath?: string }>>
    /** Local PC name for Settings → “Show local computer …”. */
    localComputerName(): Promise<Result<{ name: string }>>
  }
  remote: {
    listConnections(): Promise<
      Result<{ connections: import('../schemas/remoteConnections').RemoteConnection[] }>
    >
    upsertConnection(req: {
      id?: string
      name: string
      protocol: import('../schemas/remoteConnections').RemoteProtocol
      host: string
      port?: number
      username: string
      startPath?: string
      insecureFtpAck?: boolean
      password?: string | null
      clearFingerprint?: boolean
    }): Promise<Result<{ connection: import('../schemas/remoteConnections').RemoteConnection }>>
    renameConnection(req: {
      id: string
      name: string
    }): Promise<Result<{ connection: import('../schemas/remoteConnections').RemoteConnection }>>
    deleteConnection(req: { id: string }): Promise<Result<{ deleted: true }>>
    connect(req: { id: string }): Promise<
      Result<{
        connection: import('../schemas/remoteConnections').RemoteConnection
        location: string
      }>
    >
    disconnect(req: { id: string }): Promise<Result<{ disconnected: true }>>
    connectedIds(): Promise<Result<{ ids: string[] }>>
    testPresets(): Promise<
      Result<{ presets: import('../schemas/remoteConnections').RemoteTestPreset[] }>
    >
  }
  script: {
    detectRuntimes(): Promise<
      Result<{ runtimes: { kind: string; command: string; available: boolean }[] }>
    >
    list(): Promise<Result<{ scripts: import('../schemas/scripts').ScriptDefinition[] }>>
    get(req: { id: string }): Promise<
      Result<{
        script: import('../schemas/scripts').ScriptDefinition
        source: string
        hasPrevious: boolean
      }>
    >
    upsert(req: {
      script: Partial<import('../schemas/scripts').ScriptDefinition>
      source: string
      backupPrevious?: boolean
    }): Promise<Result<{ script: import('../schemas/scripts').ScriptDefinition }>>
    delete(req: { id: string }): Promise<Result<{ deleted: true }>>
    duplicate(req: {
      id: string
      name?: string
    }): Promise<Result<{ script: import('../schemas/scripts').ScriptDefinition }>>
    run(
      req: import('../schemas/scripts').ScriptRunRequest
    ): Promise<
      Result<{
        runId: string
        exitCode: number | null
        cancelled: boolean
        elapsedMs: number
        output: string
      }>
    >
    cancel(req: { runId: string }): Promise<Result<{ cancelled: boolean }>>
    importFile(): Promise<
      Result<{ imported: boolean; script?: import('../schemas/scripts').ScriptDefinition }>
    >
    exportFile(req: { id: string }): Promise<Result<{ saved: boolean; path?: string }>>
    pickExternal(): Promise<Result<{ path: string | null }>>
    revert(req: { id: string }): Promise<Result<{ source: string }>>
    hasPrevious(req: { id: string }): Promise<Result<{ hasPrevious: boolean }>>
  }
  ai: {
    listProviders(): Promise<
      Result<{
        providers: Array<import('../schemas/ai').AiProviderProfile & { hasApiKey: boolean }>
      }>
    >
    upsertProvider(req: {
      id?: string
      name: string
      type: import('../schemas/ai').AiProviderType
      baseUrl: string
      model: string
      local?: boolean
      timeoutSec?: number
      apiKey?: string | null
    }): Promise<
      Result<{ provider: import('../schemas/ai').AiProviderProfile & { hasApiKey: boolean } }>
    >
    deleteProvider(req: { id: string }): Promise<Result<{ deleted: true }>>
    testConnection(req: { id: string }): Promise<
      Result<{ ok: true; modelCount: number; message: string }>
    >
    listModels(req: { id: string }): Promise<Result<{ models: { id: string }[] }>>
    generate(
      req: import('../schemas/ai').AiGenerateRequest
    ): Promise<Result<{ script: import('../schemas/ai').GeneratedScript; local: boolean }>>
    modify(req: {
      source: string
      instruction: string
      language?: import('../schemas/scripts').ScriptLanguage
      target?: import('../schemas/scripts').ScriptRunMode
      providerId?: string
      model?: string
    }): Promise<Result<{ script: import('../schemas/ai').GeneratedScript; local: boolean }>>
    fix(req: {
      source: string
      exitCode: number
      stderr: string
      stdout?: string
      os?: string
      runtime?: string
      redactPaths: boolean
      target?: import('../schemas/scripts').ScriptRunMode
      providerId?: string
      model?: string
    }): Promise<Result<{ script: import('../schemas/ai').GeneratedScript; local: boolean }>>
  }
  git: {
    detect(): Promise<Result<import('../schemas/git').GitExecutableInfo>>
    test(req?: { executablePath?: string }): Promise<Result<import('../schemas/git').GitExecutableInfo>>
    discover(req: { path: string }): Promise<
      Result<{ inRepo: boolean; rootPath?: string; gitDir?: string }>
    >
    getStatus(req: { path: string }): Promise<
      Result<{
        inRepo: boolean
        status: import('../schemas/git').GitRepositoryStatus | null
      }>
    >
    refresh(req: {
      repoRoot: string
    }): Promise<Result<{ status: import('../schemas/git').GitRepositoryStatus }>>
    invalidate(req: { repoRoot: string }): Promise<Result<{ ok: true }>>
    stage(req: {
      repoRoot: string
      paths: string[]
    }): Promise<Result<import('../schemas/git').GitCommandResult>>
    unstage(req: {
      repoRoot: string
      paths: string[]
    }): Promise<Result<import('../schemas/git').GitCommandResult>>
    discard(req: {
      repoRoot: string
      paths: string[]
    }): Promise<Result<import('../schemas/git').GitCommandResult>>
    ignore(req: {
      repoRoot: string
      paths: string[]
    }): Promise<Result<import('../schemas/git').GitIgnoreResult>>
    commit(req: {
      repoRoot: string
      message: string
      pushAfter?: boolean
      stageAll?: boolean
    }): Promise<Result<import('../schemas/git').GitCommandResult>>
    fetch(req: { repoRoot: string }): Promise<Result<import('../schemas/git').GitCommandResult>>
    pull(req: { repoRoot: string }): Promise<Result<import('../schemas/git').GitCommandResult>>
    push(req: { repoRoot: string }): Promise<Result<import('../schemas/git').GitCommandResult>>
    outgoing(req: {
      repoRoot: string
    }): Promise<Result<import('../schemas/git').GitOutgoingResult>>
    listBranches(req: {
      repoRoot: string
    }): Promise<Result<{ branches: import('../schemas/git').GitBranchInfo[] }>>
    switchBranch(req: {
      repoRoot: string
      branch: string
    }): Promise<Result<import('../schemas/git').GitCommandResult>>
    createBranch(req: {
      repoRoot: string
      branch: string
      switchTo?: boolean
      startPoint?: string
    }): Promise<Result<import('../schemas/git').GitCommandResult>>
    createTag(req: {
      repoRoot: string
      tag: string
      commit: string
      pushToRemote?: boolean
      forceRemote?: boolean
      remote?: string
    }): Promise<Result<import('../schemas/git').GitCommandResult>>
    deleteTag(req: {
      repoRoot: string
      tag: string
      deleteRemote?: boolean
      remote?: string
    }): Promise<Result<import('../schemas/git').GitCommandResult>>
    checkoutCommit(req: {
      repoRoot: string
      commit: string
    }): Promise<Result<import('../schemas/git').GitCommandResult>>
    mergeCommit(req: {
      repoRoot: string
      commit: string
    }): Promise<Result<import('../schemas/git').GitCommandResult>>
    rebaseOnto(req: {
      repoRoot: string
      commit: string
    }): Promise<Result<import('../schemas/git').GitCommandResult>>
    reset(req: {
      repoRoot: string
      commit: string
      mode: import('../schemas/git').GitResetMode
    }): Promise<Result<import('../schemas/git').GitCommandResult>>
    cherryPick(req: {
      repoRoot: string
      commit: string
    }): Promise<Result<import('../schemas/git').GitCommandResult>>
    revert(req: {
      repoRoot: string
      commit: string
    }): Promise<Result<import('../schemas/git').GitCommandResult>>
    stash(req: {
      repoRoot: string
      message?: string
      includeUntracked?: boolean
    }): Promise<Result<import('../schemas/git').GitCommandResult>>
    stashPop(req: { repoRoot: string }): Promise<Result<import('../schemas/git').GitCommandResult>>
    clone(req: {
      parentDir: string
      folderName: string
      url: string
    }): Promise<Result<import('../schemas/git').GitCloneResult>>
    showDiff(req: {
      repoRoot: string
      path: string
      commit?: string
      otherCommit?: string
    }): Promise<Result<{ launched: boolean; message?: string }>>
    openTerminal(req: { repoRoot: string }): Promise<Result<{ opened: true }>>
    relativePaths(req: {
      repoRoot: string
      paths: string[]
    }): Promise<Result<{ paths: string[] }>>
    pickExecutable(): Promise<Result<{ path: string | null }>>
    pickDiffTool(): Promise<Result<{ path: string | null }>>
    log(req: {
      repoRoot: string
      limit?: number
      skip?: number
    }): Promise<Result<import('../schemas/gitLog').GitLogResult>>
    showCommit(req: {
      repoRoot: string
      commit: string
    }): Promise<Result<import('../schemas/gitLog').GitCommitDetail>>
    logFile(req: {
      repoRoot: string
      path: string
      limit?: number
      skip?: number
    }): Promise<Result<import('../schemas/gitLog').GitFileLogResult>>
  }
  virtualFolder: {
    get(req: { path: string }): Promise<
      Result<{
        document: import('../virtualFolder').VirtualFolderDocument
        mtimeMs: number
        readOnly: boolean
        warnings: string[]
      }>
    >
    list(req: { path: string }): Promise<Result<import('../schemas/virtualFolder').VirtualFolderListResponse>>
    create(req: {
      parentDir: string
      name?: string
    }): Promise<
      Result<{
        path: string
        document: import('../virtualFolder').VirtualFolderDocument
        mtimeMs: number
      }>
    >
    add(req: {
      documentPath: string
      paths: string[]
      expectedMtimeMs?: number
    }): Promise<Result<import('../schemas/virtualFolder').VirtualFolderMutateResponse>>
    remove(req: {
      documentPath: string
      entryIds: string[]
      expectedMtimeMs?: number
    }): Promise<Result<import('../schemas/virtualFolder').VirtualFolderMutateResponse>>
    reorder(req: {
      documentPath: string
      entryIds: string[]
      expectedMtimeMs?: number
    }): Promise<Result<import('../schemas/virtualFolder').VirtualFolderMutateResponse>>
    relink(req: {
      documentPath: string
      entryId: string
      newPath: string
      expectedMtimeMs?: number
    }): Promise<Result<import('../schemas/virtualFolder').VirtualFolderMutateResponse>>
    setLabel(req: {
      documentPath: string
      entryId: string
      label: string | null
      expectedMtimeMs?: number
    }): Promise<Result<import('../schemas/virtualFolder').VirtualFolderMutateResponse>>
    updatePaths(req: {
      documentPath: string
      renames: { from: string; to: string }[]
      expectedMtimeMs?: number
    }): Promise<Result<import('../schemas/virtualFolder').VirtualFolderMutateResponse>>
    previewStats(req: {
      path: string
    }): Promise<Result<import('../schemas/virtualFolder').VirtualFolderPreviewStats>>
  }
  onEvent(handler: (event: MfeEvent) => void): () => void
}
