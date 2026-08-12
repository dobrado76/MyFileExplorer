import type { Result } from '../result'
import type {
  CheckConflictsRequest,
  CheckConflictsResponse,
  CopyResponse,
  DriveInfo,
  ListRequest,
  ListResponse,
  MoveResponse,
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
  PreviewEnsurePlayableRequest,
  PreviewMediaMetaRequest,
  PreviewMediaMetaResponse,
  PreviewModel,
  PreviewRequest
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
    /** Move each path to an exact destination (undo/redo). */
    relocate(req: RelocateRequest): Promise<Result<{ moved: string[] }>>
    checkConflicts(req: CheckConflictsRequest): Promise<Result<CheckConflictsResponse>>
    /** Create Windows .lnk shortcuts in destinationDir for each source path. */
    createShortcuts(
      req: CheckConflictsRequest
    ): Promise<Result<{ created: string[] }>>
    /** Compress paths into a new `.zip` beside the selection. */
    compressToZip(req: PathsRequest): Promise<Result<{ zipPath: string }>>
    /** Extract `.zip` paths into sibling folders named after each archive. */
    extractZip(req: PathsRequest): Promise<Result<{ extractedDirs: string[] }>>
    trash(req: PathsRequest): Promise<Result<{ trashed: string[] }>>
    deletePermanent(req: PathsRequest): Promise<Result<{ deleted: string[] }>>
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
    /** Save dialog + write; no original backup (Save As). */
    saveEditedImageAs(req: {
      dataBase64: string
      defaultPath: string
    }): Promise<Result<{ path: string | null; cancelled: boolean }>>
    /** Ensure LaMa ONNX is cached; returns path + fetchable modelUrl for ORT. */
    ensureLamaModel(): Promise<
      Result<{ path: string; downloaded: boolean; modelUrl: string }>
    >
  }
  shell: {
    openPath(req: PathRequest): Promise<Result<{ opened: boolean; message?: string }>>
    showItemInFolder(req: PathRequest): Promise<Result<{ shown: true }>>
    /** Open Windows Terminal / PowerShell / cmd in a folder. Shift = elevated. */
    openCommandLine(req: PathRequest & { elevated?: boolean }): Promise<Result<{ opened: true }>>
    /** Open Explorer’s property sheet (NTFS Security, Sharing, etc.). */
    showProperties(req: PathRequest): Promise<Result<{ shown: true }>>
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
    clipboardWriteFiles(req: PathsRequest): Promise<Result<{ written: boolean }>>
    clipboardReadFiles(): Promise<Result<{ paths: string[] }>>
    /**
     * Hand file paths to the OS drag (Explorer / Photoshop / mail / etc.).
     * Synchronous — blocks until the drag ends. Call when a left-drag leaves
     * the window (not from HTML5 dragstart on Windows). Returns whether
     * startDrag ran.
     */
    startDrag(req: PathsRequest): boolean
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
      }>
    >
  }
  preview: {
    get(req: PreviewRequest): Promise<Result<PreviewModel>>
    ensurePlayable(req: PreviewEnsurePlayableRequest): Promise<Result<{ mediaUrl: string | null }>>
    /** A/V duration/codecs/tags — call after get when `mediaMetaPending` (non-blocking for player). */
    getMediaMeta(req: PreviewMediaMetaRequest): Promise<Result<PreviewMediaMetaResponse>>
    /** Topic HTML URL for Compiled HTML Help (`.chm`) preview. */
    chmTopic(req: PreviewChmTopicRequest): Promise<Result<{ mediaUrl: string }>>
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
    ready(): Promise<Result<{ ok: true }>>
    getVersion(): Promise<Result<{ version: string }>>
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
    }): Promise<Result<{ launched: true }>>
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
      Result<{ total: number; index: number; path: string | null; truncated: boolean; rev?: number | null }>
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
  onEvent(handler: (event: MfeEvent) => void): () => void
}
