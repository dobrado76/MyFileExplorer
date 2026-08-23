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
    resolveIssues: invoke(IPC.fsResolveIssues),
    relocate: invoke(IPC.fsRelocate),
    checkConflicts: invoke(IPC.fsCheckConflicts),
    createShortcuts: invoke(IPC.fsCreateShortcuts),
    compressToZip: invoke(IPC.fsCompressToZip),
    extractZip: invoke(IPC.fsExtractZip),
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
    setVolumeLabel: invoke(IPC.fsSetVolumeLabel),
    properties: invoke(IPC.fsProperties),
    measureFolder: invoke(IPC.fsMeasureFolder),
    calculateFolderStatistics: invoke(IPC.fsCalculateFolderStatistics),
    setAttributes: invoke(IPC.fsSetAttributes),
    setFolderIcon: invoke(IPC.fsSetFolderIcon),
    saveEditedImage: invoke(IPC.fsSaveEditedImage),
    imageEditState: invoke(IPC.fsImageEditState),
    hasImageOriginal: invoke(IPC.fsHasImageOriginal),
    revertImageOriginal: invoke(IPC.fsRevertImageOriginal),
    dropImageVersion: invoke(IPC.fsDropImageVersion),
    commitImageVersion: invoke(IPC.fsCommitImageVersion),
    readImageForEdit: invoke(IPC.fsReadImageForEdit),
    cropSlideshowImage: invoke(IPC.fsCropSlideshowImage),
    saveEditedImageAs: invoke(IPC.fsSaveEditedImageAs),
    ensureLamaModel: invokeVoid(IPC.fsEnsureLamaModel)
  },
  shell: {
    openPath: invoke(IPC.shellOpenPath),
    showItemInFolder: invoke(IPC.shellShowItemInFolder),
    openCommandLine: invoke(IPC.shellOpenCommandLine),
    showProperties: invoke(IPC.shellShowProperties),
    openWindowsTool: invoke(IPC.shellOpenWindowsTool),
    openRecycleBin: invokeVoid(IPC.shellOpenRecycleBin),
    exec: invoke(IPC.shellExec),
    discoverVerbs: invokeVoid(IPC.shellDiscoverVerbs),
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
    clearThumbCache: invokeVoid(IPC.settingsClearThumbCache),
    exportFile: invokeVoid(IPC.settingsExport),
    importFile: invokeVoid(IPC.settingsImport)
  },
  preview: {
    get: invoke(IPC.previewGet),
    ensurePlayable: invoke(IPC.previewEnsurePlayable),
    getMediaMeta: invoke(IPC.previewGetMediaMeta),
    chmTopic: invoke(IPC.previewChmTopic),
    openWindow: invokeVoid(IPC.previewOpenWindow),
    setTarget: invoke(IPC.previewSetTarget),
    getTarget: invokeVoid(IPC.previewGetTarget)
  },
  search: {
    query: invoke(IPC.searchQuery),
    addRoot: invoke(IPC.searchAddRoot),
    addVolume: invoke(IPC.searchAddVolume),
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
    getMany: invoke(IPC.metaGetMany),
    invalidate: invoke(IPC.metaInvalidate)
  },
  app: {
    getPath: invoke(IPC.appGetPath),
    expandPath: invoke(IPC.appExpandPath),
    pickFolder: invokeVoid(IPC.appPickFolder),
    ready: invokeVoid(IPC.appReady),
    getVersion: invokeVoid(IPC.appGetVersion),
    devGate: invokeVoid(IPC.appDevGate),
    checkUpdate: invoke(IPC.appCheckUpdate),
    runUpdate: invoke(IPC.appRunUpdate)
  },
  mediaMetadata: {
    extractPlex: invoke(IPC.mediaMetadataExtractPlex),
    download: invoke(IPC.mediaMetadataDownload),
    refresh: invoke(IPC.mediaMetadataRefresh),
    clear: invoke(IPC.mediaMetadataClear),
    get: invoke(IPC.mediaMetadataGet),
    listCovers: invoke(IPC.mediaMetadataListCovers),
    setCover: invoke(IPC.mediaMetadataSetCover),
    setWatched: invoke(IPC.mediaMetadataSetWatched),
    folderLibrary: invoke(IPC.mediaMetadataFolderLibrary),
    consolidateSubtitles: invoke(IPC.mediaMetadataConsolidateSubtitles),
    probePlex: invokeVoid(IPC.mediaMetadataProbePlex)
  },
  slideshow: {
    listImages: invoke(IPC.slideshowListImages),
    cancelList: invokeVoid(IPC.slideshowCancelList),
    pickOpenFile: invoke(IPC.slideshowPickOpenFile),
    pickSaveFile: invoke(IPC.slideshowPickSaveFile),
    readTextFile: invoke(IPC.slideshowReadTextFile),
    writeTextFile: invoke(IPC.slideshowWriteTextFile),
    updateCompiledLists: invoke(IPC.slideshowUpdateCompiledLists),
    validateCompiledLists: invoke(IPC.slideshowValidateCompiledLists),
    listCompiledDats: invoke(IPC.slideshowListCompiledDats),
    readDatIndex: invoke(IPC.slideshowReadDatIndex),
    readLastList: invoke(IPC.slideshowReadLastList),
    writeLastList: invoke(IPC.slideshowWriteLastList),
    readCompositeList: invoke(IPC.slideshowReadCompositeList),
    writeCompositeList: invoke(IPC.slideshowWriteCompositeList),
    lastListUsable: invoke(IPC.slideshowLastListUsable),
    expandComposite: invoke(IPC.slideshowExpandComposite),
    openCompiledListsWindow: invokeVoid(IPC.slideshowOpenCompiledListsWindow),
    closeCompiledListsWindow: invokeVoid(IPC.slideshowCloseCompiledListsWindow),
    relayKey: invoke(IPC.slideshowRelayKey),
    applyCompiledLines: invoke(IPC.slideshowApplyCompiledLines),
    compiledPathAt: invoke(IPC.slideshowCompiledPathAt),
    clearVirtualPlaylist: invokeVoid(IPC.slideshowClearVirtualPlaylist),
    applyCompiledPlaylist: invoke(IPC.slideshowApplyCompiledPlaylist)
  },
  ads: {
    list: invoke(IPC.adsList),
    listNamesMany: invoke(IPC.adsListNamesMany),
    exists: invoke(IPC.adsExists),
    readText: invoke(IPC.adsReadText),
    writeText: invoke(IPC.adsWriteText),
    delete: invoke(IPC.adsDelete),
    readBytes: invoke(IPC.adsReadBytes),
    writeBytes: invoke(IPC.adsWriteBytes),
    copy: invoke(IPC.adsCopy)
  },
  usn: {
    query: invoke(IPC.usnQuery),
    enable: invoke(IPC.usnEnable),
    disable: invoke(IPC.usnDisable),
    clear: invoke(IPC.usnClear),
    recent: invoke(IPC.usnRecent)
  },
  network: {
    startDiscovery: invokeVoid(IPC.networkStartDiscovery),
    cancelDiscovery: invokeVoid(IPC.networkCancelDiscovery),
    listShares: invoke(IPC.networkListShares),
    mapDriveDialog: invokeVoid(IPC.networkMapDriveDialog),
    disconnectDriveDialog: invokeVoid(IPC.networkDisconnectDriveDialog),
    disconnectMappedDrive: invoke(IPC.networkDisconnectMappedDrive),
    localComputerName: invokeVoid(IPC.networkLocalComputerName)
  },
  remote: {
    listConnections: invokeVoid(IPC.remoteListConnections),
    upsertConnection: invoke(IPC.remoteUpsertConnection),
    renameConnection: invoke(IPC.remoteRenameConnection),
    deleteConnection: invoke(IPC.remoteDeleteConnection),
    connect: invoke(IPC.remoteConnect),
    disconnect: invoke(IPC.remoteDisconnect),
    connectedIds: invokeVoid(IPC.remoteConnectedIds),
    testPresets: invokeVoid(IPC.remoteTestPresets)
  },
  script: {
    detectRuntimes: invokeVoid(IPC.scriptDetectRuntimes),
    list: invokeVoid(IPC.scriptList),
    get: invoke(IPC.scriptGet),
    upsert: invoke(IPC.scriptUpsert),
    delete: invoke(IPC.scriptDelete),
    duplicate: invoke(IPC.scriptDuplicate),
    run: invoke(IPC.scriptRun),
    cancel: invoke(IPC.scriptCancel),
    importFile: invokeVoid(IPC.scriptImportFile),
    exportFile: invoke(IPC.scriptExportFile),
    pickExternal: invokeVoid(IPC.scriptPickExternal),
    revert: invoke(IPC.scriptRevert),
    hasPrevious: invoke(IPC.scriptHasPrevious)
  },
  ai: {
    listProviders: invokeVoid(IPC.aiListProviders),
    upsertProvider: invoke(IPC.aiUpsertProvider),
    deleteProvider: invoke(IPC.aiDeleteProvider),
    testConnection: invoke(IPC.aiTestConnection),
    listModels: invoke(IPC.aiListModels),
    generate: invoke(IPC.aiGenerate),
    modify: invoke(IPC.aiModify),
    fix: invoke(IPC.aiFix)
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
