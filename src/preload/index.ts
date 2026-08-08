import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { IPC, EVENT_CHANNEL, type MfeEvent } from '@shared/ipc/contract'
import type { MyFileExplorerApi } from '@shared/ipc/api'

function invoke<TReq, TRes>(channel: string): (req: TReq) => Promise<TRes> {
  return (req: TReq) => ipcRenderer.invoke(channel, req) as Promise<TRes>
}

function invokeVoid<TRes>(channel: string): () => Promise<TRes> {
  return () => ipcRenderer.invoke(channel) as Promise<TRes>
}

const api: MyFileExplorerApi = {
  fs: {
    list: invoke(IPC.fsList),
    stat: invoke(IPC.fsStat),
    mkdir: invoke(IPC.fsMkdir),
    createFile: invoke(IPC.fsCreateFile),
    rename: invoke(IPC.fsRename),
    copy: invoke(IPC.fsCopy),
    move: invoke(IPC.fsMove),
    relocate: invoke(IPC.fsRelocate),
    checkConflicts: invoke(IPC.fsCheckConflicts),
    trash: invoke(IPC.fsTrash),
    deletePermanent: invoke(IPC.fsDeletePermanent),
    restoreFromTrash: invoke(IPC.fsRestoreFromTrash),
    listRecycleBin: invokeVoid(IPC.fsListRecycleBin),
    emptyRecycleBin: invokeVoid(IPC.fsEmptyRecycleBin),
    deleteFromRecycleBin: invoke(IPC.fsDeleteFromRecycleBin),
    cancelOp: invokeVoid(IPC.fsCancelOp),
    exists: invoke(IPC.fsExists),
    watch: invoke(IPC.fsWatch),
    unwatch: invoke(IPC.fsUnwatch),
    listDrives: invokeVoid(IPC.fsListDrives),
    properties: invoke(IPC.fsProperties),
    measureFolder: invoke(IPC.fsMeasureFolder),
    setAttributes: invoke(IPC.fsSetAttributes),
    saveEditedImage: invoke(IPC.fsSaveEditedImage),
    hasImageOriginal: invoke(IPC.fsHasImageOriginal),
    revertImageOriginal: invoke(IPC.fsRevertImageOriginal),
    readImageForEdit: invoke(IPC.fsReadImageForEdit),
    saveEditedImageAs: invoke(IPC.fsSaveEditedImageAs),
    ensureLamaModel: invokeVoid(IPC.fsEnsureLamaModel)
  },
  shell: {
    openPath: invoke(IPC.shellOpenPath),
    showItemInFolder: invoke(IPC.shellShowItemInFolder),
    openRecycleBin: invokeVoid(IPC.shellOpenRecycleBin),
    clipboardWriteFiles: invoke(IPC.shellClipboardWriteFiles),
    clipboardReadFiles: invokeVoid(IPC.shellClipboardReadFiles),
    /**
     * Sync: main runs webContents.startDrag during this call (blocks until the
     * OS drag ends). Used when a left-drag leaves the BrowserWindow — not from
     * HTML5 dragstart (that breaks in-app drops on Windows).
     */
    startDrag: (req) => ipcRenderer.sendSync(IPC.shellStartDrag, req) as boolean
  },
  session: {
    get: invokeVoid(IPC.sessionGet),
    set: invoke(IPC.sessionSet)
  },
  settings: {
    get: invokeVoid(IPC.settingsGet),
    set: invoke(IPC.settingsSet),
    clearThumbCache: invokeVoid(IPC.settingsClearThumbCache)
  },
  preview: {
    get: invoke(IPC.previewGet)
  },
  search: {
    query: invoke(IPC.searchQuery),
    addRoot: invoke(IPC.searchAddRoot),
    removeRoot: invoke(IPC.searchRemoveRoot),
    reindex: invoke(IPC.searchReindex),
    listRoots: invokeVoid(IPC.searchListRoots),
    cancel: invokeVoid(IPC.searchCancel)
  },
  thumbs: {
    get: invoke(IPC.thumbsGet),
    generateVidCache: invoke(IPC.thumbsGenerateVidCache)
  },
  icons: {
    get: invoke(IPC.iconsGet)
  },
  meta: {
    getMany: invoke(IPC.metaGetMany)
  },
  app: {
    getPath: invoke(IPC.appGetPath),
    pickFolder: invokeVoid(IPC.appPickFolder),
    ready: invokeVoid(IPC.appReady),
    getVersion: invokeVoid(IPC.appGetVersion),
    checkUpdate: invoke(IPC.appCheckUpdate),
    runUpdate: invoke(IPC.appRunUpdate)
  },
  onEvent: (handler: (event: MfeEvent) => void) => {
    const listener = (_e: IpcRendererEvent, event: MfeEvent): void => handler(event)
    ipcRenderer.on(EVENT_CHANNEL, listener)
    return () => {
      ipcRenderer.removeListener(EVENT_CHANNEL, listener)
    }
  }
}

contextBridge.exposeInMainWorld('myFileExplorer', api)
