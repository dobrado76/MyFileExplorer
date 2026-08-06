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
import type { PreviewModel, PreviewRequest } from '../schemas/preview'
import type { MetaGetManyRequest, MetaGetManyResponse } from '../schemas/meta'
import type {
  IndexRootInfo,
  ReindexRequest,
  SearchQueryRequest,
  SearchQueryResponse
} from '../schemas/search'
import type { RecycleBinListResponse } from '../schemas/recycle'
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
    properties(req: PropertiesRequest): Promise<Result<PropertiesModel>>
    measureFolder(req: PropertiesRequest): Promise<Result<FolderMeasureResult>>
    setAttributes(req: SetAttributesRequest): Promise<Result<SetAttributesResponse>>
    /** Save Filerobot output; first edit backs up pristine bytes under userData. */
    saveEditedImage(req: {
      path: string
      dataBase64: string
    }): Promise<Result<{ path: string; preservedOriginal: boolean }>>
    hasImageOriginal(req: PathRequest): Promise<Result<{ hasOriginal: boolean }>>
    revertImageOriginal(req: PathRequest): Promise<Result<{ path: string; reverted: boolean }>>
    /** Load image bytes for Filerobot (data URL-safe base64). */
    readImageForEdit(req: PathRequest): Promise<Result<{ dataBase64: string; mime: string }>>
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
    /** Open the Windows Recycle Bin in system Explorer (legacy fallback). */
    openRecycleBin(): Promise<Result<{ opened: boolean; message?: string }>>
    clipboardWriteFiles(req: PathsRequest): Promise<Result<{ written: boolean }>>
    clipboardReadFiles(): Promise<Result<{ paths: string[] }>>
    /**
     * Hand file paths to the OS drag (Explorer / Photoshop / mail / etc.).
     * Synchronous — blocks until the drag ends. Call from dragstart after
     * preventDefault(). Returns whether startDrag ran.
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
  }
  preview: {
    get(req: PreviewRequest): Promise<Result<PreviewModel>>
  }
  search: {
    query(req: SearchQueryRequest): Promise<Result<SearchQueryResponse>>
    addRoot(req: PathRequest): Promise<Result<{ roots: IndexRootInfo[] }>>
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
    /** Windows shell icon (folder / file-type / exe) via app.getFileIcon. */
    get(req: { path: string; size: number }): Promise<Result<{ url: string | null }>>
  }
  meta: {
    /** Batch column metadata (image / A/V / generation fields). */
    getMany(req: MetaGetManyRequest): Promise<Result<MetaGetManyResponse>>
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
    pickFolder(): Promise<Result<{ path: string | null }>>
    /** Tell main the UI is ready for queued external-open requests. */
    ready(): Promise<Result<{ ok: true }>>
    getVersion(): Promise<Result<{ version: string }>>
    checkUpdate(req: { folder: string }): Promise<
      Result<{
        candidate: {
          path: string
          fileName: string
          version: string | null
          newer: boolean
          currentVersion: string
        } | null
      }>
    >
    /** Launch installer from the updates folder, then quit the app. */
    runUpdate(req: { path: string; folder: string }): Promise<Result<{ launched: true }>>
  }
  onEvent(handler: (event: MfeEvent) => void): () => void
}
