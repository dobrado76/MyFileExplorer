import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { IPC, EVENT_CHANNEL, type MfeEvent } from '@shared/ipc/contract'
import type { MyFileExplorerApi } from '@shared/ipc/api'

function invoke<TReq, TRes>(channel: string): (req: TReq) => Promise<TRes> {
  return (req: TReq) => ipcRenderer.invoke(channel, req) as Promise<TRes>
}

function invokeVoid<TRes>(channel: string): () => Promise<TRes> {
  return () => ipcRenderer.invoke(channel) as Promise<TRes>
}

/**
 * Dev/HMR safety: allowlisted raw invoke when a typed method is missing from a
 * stale contextBridge (preload rebuild without Electron restart).
 */
const ALLOWED_RAW_INVOKE = new Set<string>(Object.values(IPC))

function invokeRaw(channel: string, req?: unknown): Promise<unknown> {
  if (!ALLOWED_RAW_INVOKE.has(channel)) {
    return Promise.reject(new Error(`IPC channel not allowlisted: ${channel}`))
  }
  return ipcRenderer.invoke(channel, req)
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
    planOp: invoke(IPC.fsPlanOp),
    createShortcuts: invoke(IPC.fsCreateShortcuts),
    createLink: invoke(IPC.fsCreateLink),
    compressToZip: invoke(IPC.fsCompressToZip),
    extractZip: invoke(IPC.fsExtractZip),
    trash: invoke(IPC.fsTrash),
    deletePermanent: invoke(IPC.fsDeletePermanent),
    restoreFromTrash: invoke(IPC.fsRestoreFromTrash),
    listRecycleBin: invokeVoid(IPC.fsListRecycleBin),
    emptyRecycleBin: invokeVoid(IPC.fsEmptyRecycleBin),
    deleteFromRecycleBin: invoke(IPC.fsDeleteFromRecycleBin),
    cancelOp: invokeVoid(IPC.fsCancelOp),
    findLockers: invoke(IPC.fsFindLockers),
    endProcess: invoke(IPC.fsEndProcess),
    exists: invoke(IPC.fsExists),
    watch: invoke(IPC.fsWatch),
    unwatch: invoke(IPC.fsUnwatch),
    listDrives: invokeVoid(IPC.fsListDrives),
    setVolumeLabel: invoke(IPC.fsSetVolumeLabel),
    properties: invoke(IPC.fsProperties),
    propertiesCombined: invoke(IPC.fsPropertiesCombined),
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
    clipboardPeek: invokeVoid(IPC.shellClipboardPeek),
    clipboardWriteFile: invoke(IPC.shellClipboardWriteFile),
    /**
     * Sync: main runs webContents.startDrag during this call (blocks until the
     * OS drag ends). Used when a left-drag leaves the BrowserWindow — not from
     * HTML5 dragstart (that breaks in-app drops on Windows).
     */
    startDrag: (req) => ipcRenderer.sendSync(IPC.shellStartDrag, req) as boolean
  },
  templates: {
    import: invokeVoid(IPC.templatesImport),
    delete: invoke(IPC.templatesDelete),
    replace: invoke(IPC.templatesReplace),
    duplicate: invoke(IPC.templatesDuplicate),
    instantiate: invoke(IPC.templatesInstantiate)
  },
  itemAds: {
    getMany: invoke(IPC.itemAdsGetMany),
    setNote: invoke(IPC.itemAdsSetNote),
    setIcon: invoke(IPC.itemAdsSetIcon),
    importCustomIcon: invoke(IPC.itemAdsImportCustomIcon)
  },
  tabs: {
    importCustomIcon: invokeVoid(IPC.tabsImportCustomIcon),
    customIconUrl: invoke(IPC.tabsCustomIconUrl)
  },
  quickLaunch: {
    pickProgram: invokeVoid(IPC.quickLaunchPickProgram),
    importIcon: invokeVoid(IPC.quickLaunchImportIcon),
    iconUrl: invoke(IPC.quickLaunchIconUrl),
    deleteIcon: invoke(IPC.quickLaunchDeleteIcon),
    launch: invoke(IPC.quickLaunchLaunch),
    reveal: invoke(IPC.quickLaunchReveal)
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
    getDisplayUrl: invoke(IPC.previewGetDisplayUrl),
    ensurePlayable: invoke(IPC.previewEnsurePlayable),
    getMediaMeta: invoke(IPC.previewGetMediaMeta),
    chmTopic: invoke(IPC.previewChmTopic),
    openWindow: invokeVoid(IPC.previewOpenWindow),
    setTarget: invoke(IPC.previewSetTarget),
    getTarget: invokeVoid(IPC.previewGetTarget)
  },
  properties: {
    openWindows: invoke(IPC.propertiesOpenWindows),
    getWindowArgs: invokeVoid(IPC.propertiesGetWindowArgs)
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
    setDevGateEnable: invoke(IPC.appDevGateSetEnable),
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
    loadCustomCover: invoke(IPC.mediaMetadataLoadCustomCover),
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
  git: {
    detect: invokeVoid(IPC.gitDetect),
    test: invoke(IPC.gitTest),
    discover: invoke(IPC.gitDiscover),
    getStatus: invoke(IPC.gitGetStatus),
    refresh: invoke(IPC.gitRefresh),
    invalidate: invoke(IPC.gitInvalidate),
    stage: invoke(IPC.gitStage),
    unstage: invoke(IPC.gitUnstage),
    discard: invoke(IPC.gitDiscard),
    ignore: invoke(IPC.gitIgnore),
    commit: invoke(IPC.gitCommit),
    fetch: invoke(IPC.gitFetch),
    pull: invoke(IPC.gitPull),
    push: invoke(IPC.gitPush),
    outgoing: invoke(IPC.gitOutgoing),
    listBranches: invoke(IPC.gitListBranches),
    switchBranch: invoke(IPC.gitSwitchBranch),
    createBranch: invoke(IPC.gitCreateBranch),
    createTag: invoke(IPC.gitCreateTag),
    deleteTag: invoke(IPC.gitDeleteTag),
    checkoutCommit: invoke(IPC.gitCheckoutCommit),
    mergeCommit: invoke(IPC.gitMergeCommit),
    rebaseOnto: invoke(IPC.gitRebaseOnto),
    reset: invoke(IPC.gitReset),
    cherryPick: invoke(IPC.gitCherryPick),
    revert: invoke(IPC.gitRevert),
    stash: invoke(IPC.gitStash),
    stashPop: invoke(IPC.gitStashPop),
    clone: invoke(IPC.gitClone),
    showDiff: invoke(IPC.gitShowDiff),
    openTerminal: invoke(IPC.gitOpenTerminal),
    relativePaths: invoke(IPC.gitRelativePaths),
    pickExecutable: invokeVoid(IPC.gitPickExecutable),
    pickDiffTool: invokeVoid(IPC.gitPickDiffTool),
    log: invoke(IPC.gitLog),
    showCommit: invoke(IPC.gitShowCommit),
    logFile: invoke(IPC.gitLogFile)
  },
  virtualFolder: {
    get: invoke(IPC.virtualFolderGet),
    list: invoke(IPC.virtualFolderList),
    create: invoke(IPC.virtualFolderCreate),
    createGroup: invoke(IPC.virtualFolderCreateGroup),
    add: invoke(IPC.virtualFolderAdd),
    remove: invoke(IPC.virtualFolderRemove),
    move: invoke(IPC.virtualFolderMove),
    reorder: invoke(IPC.virtualFolderReorder),
    relink: invoke(IPC.virtualFolderRelink),
    setLabel: invoke(IPC.virtualFolderSetLabel),
    updatePaths: invoke(IPC.virtualFolderUpdatePaths),
    extractGroup: invoke(IPC.virtualFolderExtractGroup),
    absorbDocument: invoke(IPC.virtualFolderAbsorbDocument),
    transferGroup: invoke(IPC.virtualFolderTransferGroup),
    previewStats: invoke(IPC.virtualFolderPreviewStats)
  },
  virtualFolderProject: {
    status: invokeVoid(IPC.virtualFolderProjectStatus),
    mount: invoke(IPC.virtualFolderProjectMount),
    unmount: invoke(IPC.virtualFolderProjectUnmount),
    listMounts: invokeVoid(IPC.virtualFolderProjectListMounts)
  },
  onEvent: (handler: (event: MfeEvent) => void) => {
    const listener = (_e: IpcRendererEvent, event: MfeEvent): void => handler(event)
    ipcRenderer.on(EVENT_CHANNEL, listener)
    return () => {
      ipcRenderer.removeListener(EVENT_CHANNEL, listener)
    }
  },
  invokeRaw
}

contextBridge.exposeInMainWorld('myFileExplorer', api)
