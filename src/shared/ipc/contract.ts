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
  fsTrash: 'fs:trash',
  fsDeletePermanent: 'fs:deletePermanent',
  fsRestoreFromTrash: 'fs:restoreFromTrash',
  fsExists: 'fs:exists',
  fsWatch: 'fs:watch',
  fsUnwatch: 'fs:unwatch',
  fsListDrives: 'fs:listDrives',
  fsProperties: 'fs:properties',
  fsMeasureFolder: 'fs:measureFolder',
  fsSetAttributes: 'fs:setAttributes',

  shellOpenPath: 'shell:openPath',
  shellShowItemInFolder: 'shell:showItemInFolder',
  shellOpenRecycleBin: 'shell:openRecycleBin',
  shellClipboardWriteFiles: 'shell:clipboardWriteFiles',
  shellClipboardReadFiles: 'shell:clipboardReadFiles',

  sessionGet: 'session:get',
  sessionSet: 'session:set',

  settingsGet: 'settings:get',
  settingsSet: 'settings:set',
  settingsClearThumbCache: 'settings:clearThumbCache',

  previewGet: 'preview:get',

  searchQuery: 'search:query',
  searchAddRoot: 'search:addRoot',
  searchRemoveRoot: 'search:removeRoot',
  searchReindex: 'search:reindex',
  searchListRoots: 'search:listRoots',
  searchCancel: 'search:cancel',

  thumbsGet: 'thumbs:get',
  iconsGet: 'icons:get',
  metaGetMany: 'meta:getMany',

  appGetPath: 'app:getPath',
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
      payload: { rootPath: string; processed: number; total?: number; done?: boolean }
    }
  | { type: 'op-progress'; payload: { opId: string; done: number; total: number } }
  | {
      type: 'external-open'
      /** Open/reveal a path from CLI, protocol URL, or a second-instance launch. */
      payload: { path: string; reveal: boolean }
    }
