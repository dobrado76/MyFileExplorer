/** Stable IPC channel names. Renderer never uses raw strings; preload maps these. */
export const IPC = {
  fsList: 'fs:list',
  fsStat: 'fs:stat',
  fsMkdir: 'fs:mkdir',
  fsCreateFile: 'fs:createFile',
  fsRename: 'fs:rename',
  fsCopy: 'fs:copy',
  fsMove: 'fs:move',
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
  fsSetAttributes: 'fs:setAttributes',
  fsSaveEditedImage: 'fs:saveEditedImage',
  fsHasImageOriginal: 'fs:hasImageOriginal',
  fsRevertImageOriginal: 'fs:revertImageOriginal',
  fsReadImageForEdit: 'fs:readImageForEdit',
  fsSaveEditedImageAs: 'fs:saveEditedImageAs',
  /** Ensure LaMa ONNX is cached under userData; returns fetchable model URL. */
  fsEnsureLamaModel: 'fs:ensureLamaModel',

  shellOpenPath: 'shell:openPath',
  shellShowItemInFolder: 'shell:showItemInFolder',
  /** Open the Windows Explorer property sheet (Security / Sharing / …). */
  shellShowProperties: 'shell:showProperties',
  shellOpenRecycleBin: 'shell:openRecycleBin',
  shellClipboardWriteFiles: 'shell:clipboardWriteFiles',
  shellClipboardReadFiles: 'shell:clipboardReadFiles',
  /** Sync: webContents.startDrag — must run during an active drag gesture. */
  shellStartDrag: 'shell:startDrag',

  sessionGet: 'session:get',
  sessionSet: 'session:set',

  settingsGet: 'settings:get',
  settingsSet: 'settings:set',
  settingsClearThumbCache: 'settings:clearThumbCache',

  previewGet: 'preview:get',
  /** Remux MKV/etc. to playable MP4 under userData for in-pane `<video>`. */
  previewEnsurePlayable: 'preview:ensurePlayable',
  /** Resolve a `.chm` TOC topic to an mfe-media://chm/ URL for the preview iframe. */
  previewChmTopic: 'preview:chmTopic',

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

  appGetPath: 'app:getPath',
  /** Expand `%VAR%` using process env (Explorer address-bar parity). */
  appExpandPath: 'app:expandPath',
  appPickFolder: 'app:pickFolder',
  /** Renderer finished boot — main may flush queued external-open requests. */
  appReady: 'app:ready',
  appGetVersion: 'app:getVersion',
  appCheckUpdate: 'app:checkUpdate',
  appRunUpdate: 'app:runUpdate'
} as const

export type IpcChannel = (typeof IPC)[keyof typeof IPC]

/** Single event channel main -> renderer. */
export const EVENT_CHANNEL = 'mfe-event'

export type MfeEvent =
  | { type: 'fs-changed'; payload: { path: string; reason: string } }
  | {
      type: 'search-progress'
      payload: { phase: 'walking' | 'done'; current?: number; total?: number; message?: string }
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
        kind: 'copy' | 'move' | 'trash' | 'delete' | 'relocate' | 'vid-thumbs' | 'zip'
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
