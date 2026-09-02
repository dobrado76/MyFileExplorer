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
  /** Dry-run / preview plan for copy, move, trash, or permanent delete. */
  fsPlanOp: 'fs:planOp',
  /** Right-drag “Create shortcuts here” — write .lnk files in destination. */
  fsCreateShortcuts: 'fs:createShortcuts',
  fsCreateLink: 'fs:createLink',
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
  /** Who is locking a path (Restart Manager + CIM). */
  fsFindLockers: 'fs:findLockers',
  /** End a locking process tree (taskkill /T /F) after user confirm. */
  fsEndProcess: 'fs:endProcess',
  fsExists: 'fs:exists',
  fsWatch: 'fs:watch',
  fsUnwatch: 'fs:unwatch',
  fsListDrives: 'fs:listDrives',
  fsSetVolumeLabel: 'fs:setVolumeLabel',
  fsProperties: 'fs:properties',
  fsPropertiesCombined: 'fs:propertiesCombined',
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
  /** Open cmd or PowerShell (Settings → Behavior) in a folder. */
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
  /** Experimental Directory shell redirect status (D72, machine-local). */
  shellRedirectGetStatus: 'shellRedirect:getStatus',
  shellRedirectEnable: 'shellRedirect:enable',
  shellRedirectDisable: 'shellRedirect:disable',
  shellRedirectRestore: 'shellRedirect:restore',
  shellRedirectRepair: 'shellRedirect:repair',
  shellRedirectTest: 'shellRedirect:test',
  shellRedirectReadInvocations: 'shellRedirect:readInvocations',
  shellRedirectClearInvocations: 'shellRedirect:clearInvocations',
  shellClipboardWriteFiles: 'shell:clipboardWriteFiles',
  shellClipboardReadFiles: 'shell:clipboardReadFiles',
  /** Classify OS clipboard without sending file/image bytes (D56). */
  shellClipboardPeek: 'shell:clipboardPeek',
  /** Write non-file clipboard as a new file (D56). */
  shellClipboardWriteFile: 'shell:clipboardWriteFile',
  /** Put an image file on the OS clipboard as a bitmap (slideshow / paste into other apps). */
  shellClipboardWriteImage: 'shell:clipboardWriteImage',
  /** Sync: webContents.startDrag — must run during an active drag gesture. */
  shellStartDrag: 'shell:startDrag',

  sessionGet: 'session:get',
  sessionSet: 'session:set',

  templatesImport: 'templates:import',
  templatesDelete: 'templates:delete',
  templatesReplace: 'templates:replace',
  templatesDuplicate: 'templates:duplicate',
  templatesInstantiate: 'templates:instantiate',

  /** NTFS item notes / icon overlays (D61 / D62). */
  itemAdsGetMany: 'itemAds:getMany',
  itemAdsSetNote: 'itemAds:setNote',
  itemAdsSetIcon: 'itemAds:setIcon',
  itemAdsImportCustomIcon: 'itemAds:importCustomIcon',

  /** Native picker + Sharp cover-crop to userData/tab-icons (D54). */
  tabsImportCustomIcon: 'tabs:importCustomIcon',
  /** mfe-media URL for a stored custom tab icon PNG. */
  tabsCustomIconUrl: 'tabs:customIconUrl',

  /** Toolbar Quick Launch (D63). */
  quickLaunchPickProgram: 'quickLaunch:pickProgram',
  quickLaunchImportIcon: 'quickLaunch:importIcon',
  quickLaunchIconUrl: 'quickLaunch:iconUrl',
  quickLaunchDeleteIcon: 'quickLaunch:deleteIcon',
  quickLaunchLaunch: 'quickLaunch:launch',
  quickLaunchReveal: 'quickLaunch:reveal',

  settingsGet: 'settings:get',
  settingsSet: 'settings:set',
  settingsClearThumbCache: 'settings:clearThumbCache',
  /** Save portable settings (+ remembered network hosts) via save dialog. */
  settingsExport: 'settings:export',
  /** Replace settings from an export file / settings.json via open dialog. */
  settingsImport: 'settings:import',

  previewGet: 'preview:get',
  /** Slideshow / overlay: media URL only (no gen-metadata full-file parse). */
  previewGetDisplayUrl: 'preview:getDisplayUrl',
  /** Remux MKV/etc. to playable MP4 under userData for in-pane `<video>`. */
  previewEnsurePlayable: 'preview:ensurePlayable',
  /** Async A/V tag fields after fast preview:get (does not block mediaUrl). */
  previewGetMediaMeta: 'preview:getMediaMeta',
  /** Resolve a `.chm` TOC topic to an mfe-media://chm/ URL for the preview iframe. */
  previewChmTopic: 'preview:chmTopic',
  previewOpenWindow: 'preview:openWindow',
  previewSetTarget: 'preview:setTarget',
  previewGetTarget: 'preview:getTarget',

  /** Open one detached Properties window per path (peer of the shell). */
  propertiesOpenWindows: 'properties:openWindows',
  /** Args for the calling Properties BrowserWindow (single path or combined). */
  propertiesGetWindowArgs: 'properties:getWindowArgs',

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
  appDevGateSetEnable: 'app:devGateSetEnable',
  mediaMetadataExtractPlex: 'mediaMetadata:extractPlex',
  mediaMetadataDownload: 'mediaMetadata:download',
  mediaMetadataRefresh: 'mediaMetadata:refresh',
  mediaMetadataClear: 'mediaMetadata:clear',
  mediaMetadataGet: 'mediaMetadata:get',
  mediaMetadataListCovers: 'mediaMetadata:listCovers',
  mediaMetadataSetCover: 'mediaMetadata:setCover',
  mediaMetadataLoadCustomCover: 'mediaMetadata:loadCustomCover',
  mediaMetadataSetWatched: 'mediaMetadata:setWatched',
  mediaMetadataSave: 'mediaMetadata:save',
  mediaMetadataFolderLibrary: 'mediaMetadata:folderLibrary',
  mediaMetadataConsolidateSubtitles: 'mediaMetadata:consolidateSubtitles',
  mediaMetadataProbePlex: 'mediaMetadata:probePlex',
  appCheckUpdate: 'app:checkUpdate',
  appRunUpdate: 'app:runUpdate',
  appReleaseNotes: 'app:releaseNotes',

  userMetadataGetMany: 'userMetadata:getMany',
  userMetadataSet: 'userMetadata:set',
  userMetadataSetMany: 'userMetadata:setMany',
  userMetadataValidateText: 'userMetadata:validateText',
  userMetadataTestPattern: 'userMetadata:testPattern',
  userMetadataExportPack: 'userMetadata:exportPack',
  userMetadataImportPack: 'userMetadata:importPack',

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

  /** Virtual Folders (`.mfevirtual` virtual collections — D67). */
  virtualFolderGet: 'virtualFolder:get',
  virtualFolderList: 'virtualFolder:list',
  virtualFolderCreate: 'virtualFolder:create',
  virtualFolderAdd: 'virtualFolder:add',
  virtualFolderRemove: 'virtualFolder:remove',
  virtualFolderMove: 'virtualFolder:move',
  virtualFolderReorder: 'virtualFolder:reorder',
  virtualFolderRelink: 'virtualFolder:relink',
  virtualFolderSetLabel: 'virtualFolder:setLabel',
  virtualFolderUpdatePaths: 'virtualFolder:updatePaths',
  virtualFolderCreateGroup: 'virtualFolder:createGroup',
  virtualFolderExtractGroup: 'virtualFolder:extractGroup',
  virtualFolderAbsorbDocument: 'virtualFolder:absorbDocument',
  virtualFolderTransferGroup: 'virtualFolder:transferGroup',
  virtualFolderPreviewStats: 'virtualFolder:previewStats',

  /** Virtual Folder OS projection (D68) — registered on win32 only. */
  virtualFolderProjectStatus: 'virtualFolderProject:status',
  virtualFolderProjectMount: 'virtualFolderProject:mount',
  virtualFolderProjectUnmount: 'virtualFolderProject:unmount',
  virtualFolderProjectListMounts: 'virtualFolderProject:listMounts',

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
  aiFix: 'ai:fix',

  gitDetect: 'git:detect',
  gitTest: 'git:test',
  gitDiscover: 'git:discover',
  gitGetStatus: 'git:getStatus',
  gitRefresh: 'git:refresh',
  gitInvalidate: 'git:invalidate',
  gitStage: 'git:stage',
  gitUnstage: 'git:unstage',
  gitDiscard: 'git:discard',
  gitIgnore: 'git:ignore',
  gitCommit: 'git:commit',
  gitFetch: 'git:fetch',
  gitPull: 'git:pull',
  gitPush: 'git:push',
  gitOutgoing: 'git:outgoing',
  gitListBranches: 'git:listBranches',
  gitSwitchBranch: 'git:switchBranch',
  gitCreateBranch: 'git:createBranch',
  gitCreateTag: 'git:createTag',
  gitDeleteTag: 'git:deleteTag',
  gitCheckoutCommit: 'git:checkoutCommit',
  gitMergeCommit: 'git:mergeCommit',
  gitRebaseOnto: 'git:rebaseOnto',
  gitReset: 'git:reset',
  gitCherryPick: 'git:cherryPick',
  gitRevert: 'git:revert',
  gitStash: 'git:stash',
  gitStashPop: 'git:stashPop',
  gitClone: 'git:clone',
  gitShowDiff: 'git:showDiff',
  gitOpenTerminal: 'git:openTerminal',
  gitRelativePaths: 'git:relativePaths',
  gitPickExecutable: 'git:pickExecutable',
  gitPickDiffTool: 'git:pickDiffTool',
  gitLog: 'git:log',
  gitShowCommit: 'git:showCommit',
  gitLogFile: 'git:logFile',

  pairCompareStart: 'pairCompare:start',
  pairCompareCancel: 'pairCompare:cancel',
  pairCompareResult: 'pairCompare:result',
  pairCompareBuildPlan: 'pairCompare:buildPlan',
  pairCompareRevalidatePlan: 'pairCompare:revalidatePlan',
  pairCompareExecutePlan: 'pairCompare:executePlan',
  pairCompareDispose: 'pairCompare:dispose'
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
          source: 'plex' | 'tmdb' | 'current' | 'custom'
          label: string
          selected: boolean
          previewBase64: string
          width: number
          height: number
        }
      }
    }
  | {
      type: 'dev-gate'
      payload: { present: boolean; enable: boolean; active: boolean }
    }
  | {
      type: 'git-status'
      payload: { status: import('../schemas/git').GitRepositoryStatus }
    }
  | {
      type: 'pair-compare-progress'
      payload: {
        sessionId: string
        phase: 'discover' | 'hash' | 'done' | 'cancelled'
        itemsScanned: number
        currentRelativePath?: string
        filesHashed?: number
        bytesHashed?: number
      }
    }
