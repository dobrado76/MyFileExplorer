/** Stable IPC channel names. Renderer never uses raw strings; preload maps these. */
import type { SearchProgressPayload } from '../searchProgress'
import type { PreviewWindowTarget } from '../schemas/preview'

export const IPC = {
  fsList: 'fs:list',
  fsStat: 'fs:stat',
  fsMkdir: 'fs:mkdir',
  fsCreateFile: 'fs:createFile',
  fsRename: 'fs:rename',
  fsCopy: 'fs:copy',
  fsMove: 'fs:move',
  fsResolveIssues: 'fs:resolveIssues',
  fsRelocate: 'fs:relocate',
  fsCheckConflicts: 'fs:checkConflicts',
  /** Right-drag “Create shortcuts here” — write .lnk files in destination. */
  fsCreateShortcuts: 'fs:createShortcuts',
  /** Compress selection to a sibling `.zip` (Explorer “Compress to ZIP file”). */
  fsCompressToZip: 'fs:compressToZip',
  /** Extract `.zip` archives into sibling folders (Explorer “Extract All…”). */
  fsExtractZip: 'fs:extractZip',
  fsTrash: 'fs:trash',
  fsDeletePermanent: 'fs:deletePermanent',
  fsRestoreFromTrash: 'fs:restoreFromTrash',
  fsListRecycleBin: 'fs:listRecycleBin',
  fsEmptyRecycleBin: 'fs:emptyRecycleBin',
  fsDeleteFromRecycleBin: 'fs:deleteFromRecycleBin',
  fsCancelOp: 'fs:cancelOp',
  fsExists: 'fs:exists',
  fsWatch: 'fs:watch',
  fsUnwatch: 'fs:unwatch',
  fsListDrives: 'fs:listDrives',
  fsSetVolumeLabel: 'fs:setVolumeLabel',
  fsProperties: 'fs:properties',
  fsMeasureFolder: 'fs:measureFolder',
  fsCalculateFolderStatistics: 'fs:calculateFolderStatistics',
  fsSetAttributes: 'fs:setAttributes',
  /** Write desktop.ini + Folder.ico for a custom folder glyph. */
  fsSetFolderIcon: 'fs:setFolderIcon',
  fsSaveEditedImage: 'fs:saveEditedImage',
  fsImageEditState: 'fs:imageEditState',
  fsHasImageOriginal: 'fs:hasImageOriginal',
  fsRevertImageOriginal: 'fs:revertImageOriginal',
  fsDropImageVersion: 'fs:dropImageVersion',
  fsCommitImageVersion: 'fs:commitImageVersion',
  fsReadImageForEdit: 'fs:readImageForEdit',
  fsSaveEditedImageAs: 'fs:saveEditedImageAs',
  fsCropSlideshowImage: 'fs:cropSlideshowImage',
  /** Ensure LaMa ONNX is cached under userData; returns fetchable model URL. */
  fsEnsureLamaModel: 'fs:ensureLamaModel',

  shellOpenPath: 'shell:openPath',
  shellShowItemInFolder: 'shell:showItemInFolder',
  /** Open wt / PowerShell / cmd in a folder. */
  shellOpenCommandLine: 'shell:openCommandLine',
  /** Open the Windows Explorer property sheet (Security / Sharing / …). */
  shellShowProperties: 'shell:showProperties',
  /** Open a This PC / MMC system window (Computer Management, Device Manager, …). */
  shellOpenWindowsTool: 'shell:openWindowsTool',
  shellOpenRecycleBin: 'shell:openRecycleBin',
  /** Spawn a user-configured external program with argv (context-menu commands). */
  shellExec: 'shell:exec',
  /** Scan static HKCR shell verbs for Discover → custom commands (D41). */
  shellDiscoverVerbs: 'shell:discoverVerbs',
  shellClipboardWriteFiles: 'shell:clipboardWriteFiles',
  shellClipboardReadFiles: 'shell:clipboardReadFiles',
  /** Sync: webContents.startDrag — must run during an active drag gesture. */
  shellStartDrag: 'shell:startDrag',

  sessionGet: 'session:get',
  sessionSet: 'session:set',

  settingsGet: 'settings:get',
  settingsSet: 'settings:set',
  settingsClearThumbCache: 'settings:clearThumbCache',
  /** Save portable settings (+ remembered network hosts) via save dialog. */
  settingsExport: 'settings:export',
  /** Replace settings from an export file / settings.json via open dialog. */
  settingsImport: 'settings:import',

  previewGet: 'preview:get',
  /** Remux MKV/etc. to playable MP4 under userData for in-pane `<video>`. */
  previewEnsurePlayable: 'preview:ensurePlayable',
  /** Async A/V tag fields after fast preview:get (does not block mediaUrl). */
  previewGetMediaMeta: 'preview:getMediaMeta',
  /** Resolve a `.chm` TOC topic to an mfe-media://chm/ URL for the preview iframe. */
  previewChmTopic: 'preview:chmTopic',
  previewOpenWindow: 'preview:openWindow',
  previewSetTarget: 'preview:setTarget',
  previewGetTarget: 'preview:getTarget',

  searchQuery: 'search:query',
  searchAddRoot: 'search:addRoot',
  /** Index a drive root (NTFS USN when available). */
  searchAddVolume: 'search:addVolume',
  searchRemoveRoot: 'search:removeRoot',
  searchReindex: 'search:reindex',
  searchListRoots: 'search:listRoots',
  searchCancel: 'search:cancel',

  thumbsGet: 'thumbs:get',
  thumbsGenerateVidCache: 'thumbs:generateVidCache',
  iconsGet: 'icons:get',
  metaGetMany: 'meta:getMany',
  metaInvalidate: 'meta:invalidate',

  appGetPath: 'app:getPath',
  /** Expand `%VAR%` using process env (Explorer address-bar parity). */
  appExpandPath: 'app:expandPath',
  appPickFolder: 'app:pickFolder',
  /** Renderer finished boot — main may flush queued external-open requests. */
  appReady: 'app:ready',
  appGetVersion: 'app:getVersion',
  appDevGate: 'app:devGate',
  mediaMetadataExtractPlex: 'mediaMetadata:extractPlex',
  mediaMetadataDownload: 'mediaMetadata:download',
  mediaMetadataRefresh: 'mediaMetadata:refresh',
  mediaMetadataClear: 'mediaMetadata:clear',
  mediaMetadataGet: 'mediaMetadata:get',
  mediaMetadataListCovers: 'mediaMetadata:listCovers',
  mediaMetadataSetCover: 'mediaMetadata:setCover',
  mediaMetadataSetWatched: 'mediaMetadata:setWatched',
  mediaMetadataFolderLibrary: 'mediaMetadata:folderLibrary',
  mediaMetadataConsolidateSubtitles: 'mediaMetadata:consolidateSubtitles',
  mediaMetadataProbePlex: 'mediaMetadata:probePlex',
  appCheckUpdate: 'app:checkUpdate',
  appRunUpdate: 'app:runUpdate',

  /** Slideshow (gated by settings.slideshowFeaturesEnabled in renderer). */
  slideshowListImages: 'slideshow:listImages',
  slideshowCancelList: 'slideshow:cancelList',
  slideshowPickOpenFile: 'slideshow:pickOpenFile',
  slideshowPickSaveFile: 'slideshow:pickSaveFile',
  slideshowReadTextFile: 'slideshow:readTextFile',
  slideshowWriteTextFile: 'slideshow:writeTextFile',
  slideshowUpdateCompiledLists: 'slideshow:updateCompiledLists',
  slideshowValidateCompiledLists: 'slideshow:validateCompiledLists',
  slideshowListCompiledDats: 'slideshow:listCompiledDats',
  slideshowReadDatIndex: 'slideshow:readDatIndex',
  slideshowReadLastList: 'slideshow:readLastList',
  slideshowWriteLastList: 'slideshow:writeLastList',
  slideshowReadCompositeList: 'slideshow:readCompositeList',
  slideshowWriteCompositeList: 'slideshow:writeCompositeList',
  slideshowLastListUsable: 'slideshow:lastListUsable',
  slideshowExpandComposite: 'slideshow:expandComposite',
  slideshowOpenCompiledListsWindow: 'slideshow:openCompiledListsWindow',
  slideshowCloseCompiledListsWindow: 'slideshow:closeCompiledListsWindow',
  slideshowRelayKey: 'slideshow:relayKey',
  slideshowApplyCompiledPlaylist: 'slideshow:applyCompiledPlaylist',
  slideshowApplyCompiledLines: 'slideshow:applyCompiledLines',
  slideshowCompiledPathAt: 'slideshow:compiledPathAt',
  slideshowClearVirtualPlaylist: 'slideshow:clearVirtualPlaylist',

  /** NTFS Alternate Data Streams (win32; soft-fail elsewhere). */
  adsList: 'ads:list',
  adsListNamesMany: 'ads:listNamesMany',
  adsExists: 'ads:exists',
  adsReadText: 'ads:readText',
  adsWriteText: 'ads:writeText',
  adsDelete: 'ads:delete',
  adsReadBytes: 'ads:readBytes',
  adsWriteBytes: 'ads:writeBytes',
  adsCopy: 'ads:copy',

  /** NTFS USN journal (drive roots only; D52). */
  usnQuery: 'usn:query',
  usnEnable: 'usn:enable',
  usnDisable: 'usn:disable',
  usnClear: 'usn:clear',
  usnRecent: 'usn:recent',

  /** Network neighborhood (async discovery; native map/disconnect dialogs). */
  networkStartDiscovery: 'network:startDiscovery',
  networkCancelDiscovery: 'network:cancelDiscovery',
  networkListShares: 'network:listShares',
  networkMapDriveDialog: 'network:mapDriveDialog',
  networkDisconnectDriveDialog: 'network:disconnectDriveDialog',
  /** Disconnect + forget a specific mapped letter (WNetCancelConnection2). */
  networkDisconnectMappedDrive: 'network:disconnectMappedDrive',
  /** This PC’s display name for Settings → Network. */
  networkLocalComputerName: 'network:localComputerName',

  /** Remote repositories (FTP / FTPS / SFTP). */
  remoteListConnections: 'remote:listConnections',
  remoteUpsertConnection: 'remote:upsertConnection',
  remoteRenameConnection: 'remote:renameConnection',
  remoteDeleteConnection: 'remote:deleteConnection',
  remoteConnect: 'remote:connect',
  remoteDisconnect: 'remote:disconnect',
  remoteConnectedIds: 'remote:connectedIds',
  remoteTestPresets: 'remote:testPresets',

  scriptDetectRuntimes: 'script:detectRuntimes',
  scriptList: 'script:list',
  scriptGet: 'script:get',
  scriptUpsert: 'script:upsert',
  scriptDelete: 'script:delete',
  scriptDuplicate: 'script:duplicate',
  scriptRun: 'script:run',
  scriptCancel: 'script:cancel',
  scriptImportFile: 'script:importFile',
  scriptExportFile: 'script:exportFile',
  scriptPickExternal: 'script:pickExternal',
  scriptRevert: 'script:revert',
  scriptHasPrevious: 'script:hasPrevious',

  aiListProviders: 'ai:listProviders',
  aiUpsertProvider: 'ai:upsertProvider',
  aiDeleteProvider: 'ai:deleteProvider',
  aiTestConnection: 'ai:testConnection',
  aiListModels: 'ai:listModels',
  aiGenerate: 'ai:generate',
  aiModify: 'ai:modify',
  aiFix: 'ai:fix'
} as const

export type IpcChannel = (typeof IPC)[keyof typeof IPC]

/** Single event channel main -> renderer. */
export const EVENT_CHANNEL = 'mfe-event'

export type MfeEvent =
  | { type: 'fs-changed'; payload: { path: string; reason: string } }
  /** Watcher closed unexpectedly — renderer should re-arm if the path is still visible. */
  | { type: 'fs-watch-lost'; payload: { path: string } }
  | {
      type: 'search-progress'
      payload: SearchProgressPayload
    }
  | {
      type: 'index-progress'
      payload: {
        rootPath: string
        processed: number
        total?: number
        done?: boolean
        message?: string
      }
    }
  | {
      type: 'op-progress'
      payload: {
        opId: string
        kind:
          | 'copy'
          | 'move'
          | 'trash'
          | 'delete'
          | 'relocate'
          | 'vid-thumbs'
          | 'zip'
          | 'compile-lists'
          | 'folder-stats'
          | 'media-metadata'
        done: number
        total: number
        /** Basename (or short path) of the item currently being processed. */
        current?: string
        /** Human label e.g. "Copying…". */
        label?: string
        /** Optional byte progress within the current large file. */
        bytesDone?: number
        bytesTotal?: number
        phase: 'running' | 'done'
      }
    }
  | {
      type: 'external-open'
      /** Open/reveal a path from CLI, protocol URL, or a second-instance launch. */
      payload: { path: string; reveal: boolean }
    }
  | {
      type: 'history-nav'
      /** Mouse side buttons (Windows app-command) → tab Back / Forward. */
      payload: { dir: 'back' | 'forward' }
    }
  | {
      type: 'slideshow-list-progress'
      payload: { found: number; current?: string }
    }
  | {
      type: 'compiled-playlist-apply'
      /**
       * Virtual compiled playlist meta (not a flat path array).
       * Legacy `paths` ignored when `total` is present.
       */
      payload: {
        total: number
        index: number
        path: string | null
        truncated?: boolean
        rev?: number | null
        /** Compiled lists Play — force autoplay even if currently manual. */
        resumePlaying?: boolean
        /** @deprecated flat expand — unused for virtual compiled */
        paths?: string[]
        preferPath?: string | null
      }
    }
  | {
      type: 'compiled-lists-window-closed'
      payload: Record<string, never>
    }
  | {
      type: 'slideshow-key'
      /** Keystroke relayed from the Compiled lists window to the main slideshow. */
      payload: {
        key: string
        code: string
        ctrlKey: boolean
        altKey: boolean
        shiftKey: boolean
        metaKey: boolean
      }
    }
  | {
      type: 'network-discovery'
      payload: {
        generation: number
        status: 'running' | 'done' | 'error'
        hosts?: { name: string; unc: string }[]
        message?: string
      }
    }
  | {
      type: 'update-download-progress'
      payload: {
        bytesDone: number
        /** 0 when the server omitted Content-Length. */
        bytesTotal: number
        phase: 'running' | 'done' | 'error'
        fileName?: string
      }
    }
  | {
      type: 'preview-target'
      payload: PreviewWindowTarget
    }
  | {
      type: 'preview-window'
      payload: { open: boolean }
    }
  | {
      type: 'script-output'
      payload: { runId: string; stream: 'stdout' | 'stderr'; text: string }
    }
  | {
      type: 'script-ended'
      payload: {
        runId: string
        exitCode: number | null
        cancelled: boolean
        elapsedMs: number
        dryRun: boolean
      }
    }
  | {
      type: 'cover-list'
      payload: {
        path: string
        done: boolean
        cover?: {
          id: string
          source: 'plex' | 'tmdb' | 'current'
          label: string
          selected: boolean
          previewBase64: string
          width: number
          height: number
        }
      }
    }
