import { app, dialog, ipcMain, BrowserWindow, type IpcMainInvokeEvent } from 'electron'
import fsp from 'node:fs/promises'
import { z, type ZodType } from 'zod'
import { ok, err, errFromUnknown, AppError, type Result } from '@shared/result'
import { IPC, EVENT_CHANNEL } from '@shared/ipc/contract'
import { expandWindowsEnvPath } from '../paths/expandEnv'
import {
  listRequestSchema,
  pathRequestSchema,
  calculateFolderStatisticsRequestSchema,
  pathsRequestSchema,
  nameInParentRequestSchema,
  renameRequestSchema,
  transferRequestSchema,
  relocateRequestSchema,
  checkConflictsRequestSchema,
  resolveIssuesRequestSchema,
  setVolumeLabelRequestSchema
} from '@shared/schemas/fs'
import { sessionSchema } from '@shared/schemas/session'
import { cropSlideshowImageRequestSchema } from '@shared/schemas/imageEdit'
import { settingsPatchSchema } from '@shared/schemas/settings'
import {
  buildSettingsExportDocument,
  parseSettingsImport
} from '@shared/schemas/settingsExport'
import {
  previewChmTopicSchema,
  previewEnsurePlayableSchema,
  previewMediaMetaSchema,
  previewRequestSchema,
  previewWindowTargetSchema
} from '@shared/schemas/preview'
import { searchQueryRequestSchema, reindexRequestSchema } from '@shared/schemas/search'
import { slideshowListRequestSchema } from '@shared/schemas/slideshow'
import { openWindowsToolRequestSchema } from '@shared/schemas/windowsTools'
import {
  updateCompiledListsRequestSchema,
  validateCompiledListsRequestSchema,
  listCompiledDatsRequestSchema,
  compiledRootSchema,
  writeLastListRequestSchema,
  compositeFileSchema,
  writeCompositeListRequestSchema,
  expandCompositeRequestSchema,
  applyCompiledLinesRequestSchema,
  slideshowRelayKeySchema,
  compiledPathAtRequestSchema
} from '@shared/schemas/compiledLists'
import {
  adsPathSchema,
  adsNamedSchema,
  adsWriteTextSchema,
  adsWriteBytesSchema,
  adsCopySchema,
  adsInvalidateMetaSchema,
  adsListNamesManySchema
} from '@shared/schemas/ads'
import {
  usnQueryRequestSchema,
  usnEnableRequestSchema,
  usnDisableRequestSchema,
  usnClearRequestSchema,
  usnRecentRequestSchema
} from '@shared/schemas/usn'
import { networkListSharesRequestSchema } from '@shared/schemas/network'
import { listDirectory, statPath, pathExists, requireAbsolute } from '../fs/list'
import { listDrives, setVolumeLabel, disconnectMappedNetworkDrive } from '../fs/drives'
import {
  startNetworkDiscovery,
  cancelNetworkDiscovery,
  listNetworkShares,
  localComputerDisplayName,
  openMapNetworkDriveDialog,
  openDisconnectNetworkDriveDialog
} from '../fs/network'
import {
  getRememberedNetworkHosts,
  replaceRememberedNetworkHosts
} from '../fs/networkRemembered'
import { getProperties, measureFolder, setPathAttributes } from '../fs/properties'
import { calculateFolderStatistics } from '../fs/folderStats'
import { setFolderCustomIcon } from '../fs/folderIcon'
import {
  propertiesRequestSchema,
  setAttributesRequestSchema
} from '@shared/schemas/properties'
import {
  makeDirectory,
  createFile,
  renameEntry,
  copyEntries,
  moveEntries,
  relocateEntries,
  checkConflicts,
  trashEntries,
  deletePermanently,
  resolveOpIssues
} from '../fs/ops'
import { createShortcuts } from '../fs/shortcuts'
import { compressToZip, extractZips } from '../fs/zip'
import {
  saveEditedImage,
  getImageEditState,
  hasImageOriginal,
  revertImageOriginal,
  dropImageVersion,
  commitImageVersion,
  readImageForEdit,
  writeEditedImageToPath,
  cropSlideshowImageFromOriginal
} from '../fs/imageEdit'
import { restoreFromRecycleBin, listRecycleBin, emptyRecycleBin, deleteFromRecycleBin } from '../fs/recycle'
import { watchDirectory, unwatchDirectory, muteWatchers } from '../fs/watch'
import { requestCancelActiveOps } from '../fs/opProgress'
import { broadcast } from './events'
import { getMainWindow, markRendererReady } from '../externalOpen'
import { findUpdateInstaller, runUpdateInstaller } from '../update/installers'
import { cancelSlideshowList, listSlideshowImages } from '../slideshow/listImages'
import {
  updateCompiledLists,
  validateCompiledLists,
  listCompiledDats,
  readDatIndex,
  readLastList,
  writeLastList,
  readCompositeList,
  writeCompositeList,
  lastListIsUsable,
  expandCompositePlaylist
} from '../slideshow/compiledLists'
import {
  openCompiledListsWindow,
  closeCompiledListsWindow
} from '../slideshow/compiledListsWindow'
import {
  buildVirtualPlaylist,
  clearVirtualPlaylist,
  pathAtPlayIndex,
  snapshotPreferPath
} from '../slideshow/virtualPlaylist'
import {
  openPath,
  showItemInFolder,
  openCommandLineHere,
  showSystemProperties,
  openWindowsTool,
  openRecycleBin,
  clipboardWriteFiles,
  clipboardReadFiles,
  startOsFileDrag,
  execExternal
} from '../shell'
import { sessionStore } from '../session/store'
import { getSettings, patchSettings, replaceSettings } from '../settings/store'
import {
  listRemoteConnections,
  listRemoteConnectionsForExport,
  upsertRemoteConnection,
  renameRemoteConnection,
  deleteRemoteConnection,
  replaceRemoteConnections
} from '../remote/connectionsStore'
import {
  connectRemote,
  disconnectRemote,
  listConnectedRemoteIds,
  remoteStartLocation
} from '../remote/sessionPool'
import { REMOTE_TEST_PRESETS } from '@shared/schemas/remoteConnections'
import {
  remoteUpsertRequestSchema,
  remoteIdRequestSchema,
  remoteRenameRequestSchema
} from '@shared/schemas/remoteIpc'
import { registerScriptIpc } from '../scripts/ipc'
import { registerAiIpc } from '../ai/ipc'
import { listScriptsForExport, replaceScriptsFromExport } from '../scripts/library'

function assertRemoteReposEnabled(): void {
  if (!getSettings().remoteRepos.enabled) {
    throw new AppError(
      'not-allowed',
      'Remote repositories are disabled — enable them in Settings → Remote repositories'
    )
  }
}
import { ensurePlayablePreview, getChmTopicPreview, getMediaPreviewMeta, getPreview } from '../preview'
import {
  getPreviewTarget,
  openPreviewWindow,
  setPreviewTarget
} from '../preview/previewWindow'
import { getThumbUrl, clearThumbCache } from '../thumbs'
import { generateVidThumbStrips } from '../thumbs/generateVidThumbs'
import { getShellIconUrl } from '../icons/shell'
import { getColumnMetaMany, invalidateColumnMetaPaths } from '../meta/columns'
import { metaGetManyRequestSchema } from '@shared/schemas/meta'
import {
  runSearchQuery,
  addIndexRoot,
  addVolumeRoot,
  removeIndexRoot,
  scheduleIndex,
  listIndexRoots,
  cancelSearch
} from '../search'
import { logMain } from '../logging'
import { ensureLamaModel } from '../images/lamaModel'
import { lamaModelFetchUrl } from '../media/modelProtocol'
import { isDevGateActive } from '../devGate'
import {
  clearMany,
  downloadInternetMany,
  extractPlexMany,
  getFolderMediaLibrary,
  consolidateSubtitles,
  getMediaMetadataView,
  listMediaCovers,
  probePlex,
  refreshMany,
  setMediaCover,
  setWatchedMany
} from '../mediaMetadata'
import {
  mediaMetadataPathSchema,
  mediaMetadataPathsSchema,
  mediaMetadataSetCoverSchema,
  mediaMetadataSetWatchedSchema
} from '@shared/schemas/mediaMetadata'

function assertDevGate(): void {
  if (!isDevGateActive()) throw new AppError('validation', 'Unavailable')
}

function assertMediaMetadataEnabled(): void {
  if (!getSettings().mediaMetadata.enabled) {
    throw new AppError('validation', 'Media metadata is disabled')
  }
}

function handleDev<S extends ZodType, T>(
  channel: string,
  schema: S,
  fn: (req: z.infer<S>, event: IpcMainInvokeEvent) => Promise<T> | T
): void {
  handle(channel, schema, (req, event) => {
    assertDevGate()
    return fn(req, event)
  })
}

function handle<S extends ZodType, T>(
  channel: string,
  schema: S,
  fn: (req: z.infer<S>, event: IpcMainInvokeEvent) => Promise<T> | T
): void {
  ipcMain.handle(channel, async (event, raw): Promise<Result<T>> => {
    const parsed = schema.safeParse(raw)
    if (!parsed.success) {
      return err(
        'validation',
        `Invalid request for ${channel}: ${parsed.error.issues[0]?.message ?? 'bad input'}`
      )
    }
    try {
      return ok(await fn(parsed.data, event))
    } catch (e) {
      const envelope = errFromUnknown(e)
      logMain('warn', `${channel} failed: ${envelope.error.code} ${envelope.error.message}`)
      return envelope
    }
  })
}

const emptySchema = z.union([z.undefined(), z.null(), z.object({}).strict()]).optional()
const getPathRequestSchema = z.object({
  name: z.enum([
    'userData',
    'home',
    'desktop',
    'documents',
    'downloads',
    'pictures',
    'music',
    'videos'
  ])
})
const expandPathRequestSchema = z.object({
  path: z.string().min(1).max(32_768)
})
const thumbRequestSchema = z.object({
  path: z.string().min(1),
  size: z.number().int().min(16).max(1024)
})
const iconRequestSchema = z.object({
  path: z.string().min(1),
  size: z.number().int().min(16).max(1024),
  /** When true, never share the file-extension icon cache (tree folders). */
  isDir: z.boolean().optional(),
  /**
   * Tree glyphs: attribute-only folder icons (skip live SHGetFileInfo).
   * Prevents Dropbox/OneDrive / dead-map hangs from freezing the UI.
   */
  fast: z.boolean().optional()
})
const generateVidThumbsSchema = z.object({
  paths: z.array(z.string().min(1)).min(1),
  mode: z.enum(['missing', 'all']),
  recursive: z.boolean().optional()
})

export function registerIpcHandlers(): void {
  // fs
  handle(IPC.fsList, listRequestSchema, async (req) => {
    // Enumerating can kick ReadDirectoryChanges; mute so soft re-lists don't
    // loop (stat/FindFirstFile → watch → list → …). Post-list mute is
    // size-aware so small folders stay responsive to external changes.
    muteWatchers(120_000)
    try {
      const res = await listDirectory(req.path, req.includeHidden ?? true)
      const n = res.entries.length
      muteWatchers(n >= 8_000 ? 2500 : n >= 1_000 ? 800 : 400)
      return res
    } catch (e) {
      muteWatchers(800)
      throw e
    }
  })
  handle(IPC.fsStat, pathRequestSchema, (req) => statPath(req.path))
  handle(IPC.fsMkdir, nameInParentRequestSchema, async (req) => {
    muteWatchers()
    return makeDirectory(req.parent, req.name)
  })
  handle(IPC.fsCreateFile, nameInParentRequestSchema, async (req) => {
    muteWatchers()
    return createFile(req.parent, req.name)
  })
  handle(IPC.fsRename, renameRequestSchema, async (req) => {
    muteWatchers()
    return renameEntry(req.path, req.newName, req.conflictPolicy ?? 'fail')
  })
  handle(IPC.fsCopy, transferRequestSchema, async (req) => {
    muteWatchers()
    return copyEntries(req.sources, req.destinationDir, req.conflictPolicy)
  })
  handle(IPC.fsMove, transferRequestSchema, async (req) => {
    muteWatchers()
    return moveEntries(req.sources, req.destinationDir, req.conflictPolicy)
  })
  handle(IPC.fsResolveIssues, resolveIssuesRequestSchema, async (req) => {
    muteWatchers()
    return resolveOpIssues(req)
  })
  handle(IPC.fsRelocate, relocateRequestSchema, async (req) => {
    muteWatchers()
    return relocateEntries(req.pairs)
  })
  handle(IPC.fsCheckConflicts, checkConflictsRequestSchema, (req) =>
    checkConflicts(req.sources, req.destinationDir, req.targets)
  )
  handle(IPC.fsCreateShortcuts, checkConflictsRequestSchema, async (req) => {
    muteWatchers()
    return createShortcuts(req.sources, req.destinationDir)
  })
  handle(IPC.fsCompressToZip, pathsRequestSchema, async (req) => {
    muteWatchers()
    return compressToZip(req.paths)
  })
  handle(IPC.fsExtractZip, pathsRequestSchema, async (req) => {
    muteWatchers()
    return extractZips(req.paths)
  })
  handle(IPC.fsTrash, pathsRequestSchema, async (req) => {
    muteWatchers()
    return trashEntries(req.paths)
  })
  handle(IPC.fsRestoreFromTrash, pathsRequestSchema, async (req) => {
    muteWatchers()
    return restoreFromRecycleBin(req.paths)
  })
  handle(IPC.fsListRecycleBin, emptySchema, () => listRecycleBin())
  handle(IPC.fsEmptyRecycleBin, emptySchema, async () => {
    muteWatchers()
    return emptyRecycleBin()
  })
  handle(IPC.fsDeleteFromRecycleBin, pathsRequestSchema, async (req) => {
    muteWatchers()
    return deleteFromRecycleBin(req.paths)
  })
  handle(IPC.fsDeletePermanent, pathsRequestSchema, async (req) => {
    muteWatchers()
    return deletePermanently(req.paths)
  })
  handle(IPC.fsCancelOp, emptySchema, () => requestCancelActiveOps())
  handle(IPC.fsExists, pathRequestSchema, async (req) => ({ exists: await pathExists(req.path) }))
  handle(IPC.fsWatch, pathRequestSchema, (req, event) => watchDirectory(event.sender, req.path))
  handle(IPC.fsUnwatch, pathRequestSchema, (req, event) => unwatchDirectory(event.sender, req.path))
  handle(IPC.fsListDrives, emptySchema, async () => ({ drives: await listDrives() }))
  handle(IPC.fsSetVolumeLabel, setVolumeLabelRequestSchema, (req) =>
    setVolumeLabel(req.path, req.name)
  )
  handle(IPC.fsProperties, propertiesRequestSchema, (req) => getProperties(req.path))
  handle(IPC.fsMeasureFolder, propertiesRequestSchema, (req) => measureFolder(req.path))
  handle(IPC.fsCalculateFolderStatistics, calculateFolderStatisticsRequestSchema, (req) =>
    calculateFolderStatistics(req.path, {
      skipTagged: req.skipTagged === true,
      skipOnError: req.skipOnError === true
    })
  )
  handle(IPC.fsSetAttributes, setAttributesRequestSchema, (req) =>
    setPathAttributes(req.path, {
      readOnly: req.readOnly,
      hidden: req.hidden,
      archive: req.archive,
      system: req.system
    })
  )
  handle(
    IPC.fsSetFolderIcon,
    z.object({ path: z.string().min(1), iconPath: z.string().min(1) }),
    (req) => setFolderCustomIcon(req.path, req.iconPath)
  )
  handle(
    IPC.fsSaveEditedImage,
    z.object({ path: z.string().min(1), dataBase64: z.string().min(1) }),
    async (req) => {
      const res = await saveEditedImage(req.path, req.dataBase64)
      await invalidateColumnMetaPaths([res.path])
      return res
    }
  )
  handle(IPC.fsImageEditState, pathRequestSchema, (req) => getImageEditState(req.path))
  handle(IPC.fsHasImageOriginal, pathRequestSchema, (req) => hasImageOriginal(req.path))
  handle(IPC.fsRevertImageOriginal, pathRequestSchema, async (req) => {
    muteWatchers()
    const res = await revertImageOriginal(req.path)
    await invalidateColumnMetaPaths([res.path])
    return res
  })
  handle(
    IPC.fsDropImageVersion,
    z.object({ path: z.string().min(1), ver: z.number().int().min(1).max(4) }),
    async (req) => {
      muteWatchers()
      const res = await dropImageVersion(req.path, req.ver)
      await invalidateColumnMetaPaths([res.path])
      return res
    }
  )
  handle(IPC.fsCommitImageVersion, pathRequestSchema, async (req) => {
    muteWatchers()
    const res = await commitImageVersion(req.path)
    await invalidateColumnMetaPaths([res.path])
    return res
  })
  handle(
    IPC.fsReadImageForEdit,
    z.object({
      path: z.string().min(1),
      ads: z.string().min(1).nullable().optional()
    }),
    (req) => readImageForEdit(req.path, req.ads)
  )
  handle(IPC.fsCropSlideshowImage, cropSlideshowImageRequestSchema, async (req) => {
    muteWatchers()
    const res = await cropSlideshowImageFromOriginal(req.path, req.crop)
    await invalidateColumnMetaPaths([res.path])
    return res
  })
  handle(IPC.fsEnsureLamaModel, emptySchema, async () => {
    const result = await ensureLamaModel()
    return {
      ...result,
      modelUrl: lamaModelFetchUrl()
    }
  })
  handle(
    IPC.fsSaveEditedImageAs,
    z.object({
      dataBase64: z.string().min(1),
      defaultPath: z.string().min(1),
      sourcePath: z.string().min(1)
    }),
    async (req, event) => {
      const win = BrowserWindow.fromWebContents(event.sender)
      const opts = {
        title: 'Save image as',
        defaultPath: req.defaultPath,
        filters: [
          { name: 'JPEG', extensions: ['jpg', 'jpeg', 'jfif'] },
          { name: 'PNG', extensions: ['png'] },
          { name: 'WebP', extensions: ['webp'] },
          { name: 'GIF', extensions: ['gif'] },
          { name: 'TIFF', extensions: ['tif', 'tiff'] },
          { name: 'Targa', extensions: ['tga'] },
          {
            name: 'All supported',
            extensions: ['jpg', 'jpeg', 'jfif', 'png', 'webp', 'gif', 'tif', 'tiff', 'tga', 'bmp']
          }
        ]
      }
      const result = win
        ? await dialog.showSaveDialog(win, opts)
        : await dialog.showSaveDialog(opts)
      if (result.canceled || !result.filePath) {
        return { path: null as string | null, cancelled: true }
      }
      muteWatchers()
      const written = await writeEditedImageToPath(
        result.filePath,
        req.dataBase64,
        req.sourcePath
      )
      return { path: written.path, cancelled: false }
    }
  )

  // shell
  handle(IPC.shellOpenPath, pathRequestSchema, (req) => openPath(req.path))
  handle(IPC.shellShowItemInFolder, pathRequestSchema, (req) => showItemInFolder(req.path))
  handle(
    IPC.shellOpenCommandLine,
    z.object({
      path: z.string().min(1),
      elevated: z.boolean().optional()
    }),
    (req) => openCommandLineHere(req.path, { elevated: req.elevated === true })
  )
  handle(IPC.shellShowProperties, pathRequestSchema, (req) => showSystemProperties(req.path))
  handle(IPC.shellOpenWindowsTool, openWindowsToolRequestSchema, (req) => openWindowsTool(req.id))
  handle(IPC.shellOpenRecycleBin, emptySchema, () => openRecycleBin())
  handle(
    IPC.shellExec,
    z.object({
      executable: z.string().min(1).max(1024),
      args: z.array(z.string().max(32767)).max(256)
    }),
    (req) => execExternal(req.executable, req.args)
  )
  handle(IPC.shellDiscoverVerbs, emptySchema, async () => {
    const { discoverShellVerbs } = await import('../shell/discoverShellVerbs')
    return discoverShellVerbs()
  })
  handle(IPC.shellClipboardWriteFiles, pathsRequestSchema, (req) => clipboardWriteFiles(req.paths))
  handle(IPC.shellClipboardReadFiles, emptySchema, () => clipboardReadFiles())
  // Sync + blocking: startDrag runs DoDragDrop until the OS gesture ends.
  // Called when a left-drag leaves the window (not from HTML5 dragstart).
  ipcMain.on(IPC.shellStartDrag, (event, raw) => {
    const parsed = pathsRequestSchema.safeParse(raw)
    if (!parsed.success) {
      logMain('warn', 'shell:startDrag: invalid payload')
      event.returnValue = false
      return
    }
    try {
      event.returnValue = startOsFileDrag(event.sender, parsed.data.paths)
    } catch (e) {
      logMain('warn', `shell:startDrag failed: ${e instanceof Error ? e.message : String(e)}`)
      event.returnValue = false
    }
  })

  // session
  handle(IPC.sessionGet, emptySchema, () => sessionStore().get())
  handle(IPC.sessionSet, sessionSchema, (session) => sessionStore().set(session))

  // settings
  handle(IPC.settingsGet, emptySchema, () => getSettings())
  handle(IPC.settingsSet, settingsPatchSchema, (patch) => patchSettings(patch))
  handle(IPC.settingsClearThumbCache, emptySchema, async () => {
    await clearThumbCache()
    return { cleared: true as const }
  })
  handle(IPC.settingsExport, emptySchema, async (_req, event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    const doc = buildSettingsExportDocument({
      settings: getSettings(),
      networkHosts: getRememberedNetworkHosts(),
      remoteConnections: listRemoteConnectionsForExport(),
      scripts: await listScriptsForExport(),
      appVersion: app.getVersion()
    })
    const opts = {
      title: 'Export settings',
      defaultPath: `MyFileExplorer-settings.json`,
      filters: [{ name: 'JSON', extensions: ['json'] }]
    }
    const picked = win
      ? await dialog.showSaveDialog(win, opts)
      : await dialog.showSaveDialog(opts)
    if (picked.canceled || !picked.filePath) return { saved: false as const }
    await fsp.writeFile(picked.filePath, JSON.stringify(doc, null, 2), 'utf8')
    return { saved: true as const, path: picked.filePath }
  })
  handle(IPC.settingsImport, emptySchema, async (_req, event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    const opts = {
      title: 'Import settings',
      filters: [{ name: 'JSON', extensions: ['json'] }],
      properties: ['openFile' as const]
    }
    const picked = win
      ? await dialog.showOpenDialog(win, opts)
      : await dialog.showOpenDialog(opts)
    if (picked.canceled || !picked.filePaths[0]) return { imported: false as const }
    const text = await fsp.readFile(picked.filePaths[0], 'utf8')
    let raw: unknown
    try {
      raw = JSON.parse(text) as unknown
    } catch {
      throw new Error('Settings file is not valid JSON')
    }
    const parsed = parseSettingsImport(raw)
    const settings = replaceSettings(parsed.settings)
    let networkHostCount: number | undefined
    if (parsed.networkHosts) {
      networkHostCount = replaceRememberedNetworkHosts(parsed.networkHosts).length
    }
    let remoteConnectionCount: number | undefined
    if (parsed.remoteConnections) {
      remoteConnectionCount = replaceRemoteConnections(parsed.remoteConnections).length
    }
    let scriptCount: number | undefined
    if (parsed.scripts) {
      scriptCount = await replaceScriptsFromExport(parsed.scripts)
    }
    return {
      imported: true as const,
      settings,
      ...(networkHostCount !== undefined ? { networkHostCount } : {}),
      ...(remoteConnectionCount !== undefined ? { remoteConnectionCount } : {}),
      ...(scriptCount !== undefined ? { scriptCount } : {})
    }
  })

  // preview
  handle(IPC.previewGet, previewRequestSchema, (req) =>
    getPreview(req.path, req.ads === undefined ? undefined : req.ads)
  )
  handle(IPC.previewEnsurePlayable, previewEnsurePlayableSchema, (req) =>
    ensurePlayablePreview(req.path, { force: req.force })
  )
  handle(IPC.previewGetMediaMeta, previewMediaMetaSchema, (req) => getMediaPreviewMeta(req.path))
  handle(IPC.previewChmTopic, previewChmTopicSchema, (req) =>
    getChmTopicPreview(req.path, req.topic)
  )
  handle(IPC.previewOpenWindow, emptySchema, () => openPreviewWindow())
  handle(IPC.previewSetTarget, previewWindowTargetSchema, (req) => setPreviewTarget(req))
  handle(IPC.previewGetTarget, emptySchema, () => getPreviewTarget())

  // search
  handle(IPC.searchQuery, searchQueryRequestSchema, (req) => runSearchQuery(req))
  handle(IPC.searchAddRoot, pathRequestSchema, (req) => ({ roots: addIndexRoot(req.path) }))
  handle(IPC.searchAddVolume, pathRequestSchema, (req) => ({ roots: addVolumeRoot(req.path) }))
  handle(IPC.searchRemoveRoot, pathRequestSchema, (req) => ({ roots: removeIndexRoot(req.path) }))
  handle(IPC.searchReindex, reindexRequestSchema, (req) => scheduleIndex(req.rootPath))
  handle(IPC.searchListRoots, emptySchema, () => ({ roots: listIndexRoots() }))
  handle(IPC.searchCancel, emptySchema, () => cancelSearch())

  // thumbs / shell icons / column metadata
  handle(IPC.thumbsGet, thumbRequestSchema, (req) => getThumbUrl(req.path, req.size))
  handle(IPC.thumbsGenerateVidCache, generateVidThumbsSchema, (req) =>
    generateVidThumbStrips(req.paths, req.mode, req.recursive ?? false)
  )
  handle(IPC.iconsGet, iconRequestSchema, (req) =>
    getShellIconUrl(req.path, req.size, req.isDir, { fast: req.fast === true })
  )
  handle(IPC.metaGetMany, metaGetManyRequestSchema, async (req) => ({
    values: await getColumnMetaMany(req.paths, req.columns)
  }))
  handle(IPC.metaInvalidate, adsInvalidateMetaSchema, async (req) => {
    await invalidateColumnMetaPaths(req.paths)
    return { ok: true as const }
  })

  // app
  handle(IPC.appGetPath, getPathRequestSchema, (req) => ({ path: app.getPath(req.name) }))
  handle(IPC.appExpandPath, expandPathRequestSchema, (req) => ({
    path: expandWindowsEnvPath(req.path)
  }))
  handle(IPC.appPickFolder, emptySchema, async (_req, event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    const result = win
      ? await dialog.showOpenDialog(win, { properties: ['openDirectory'] })
      : await dialog.showOpenDialog({ properties: ['openDirectory'] })
    return { path: result.canceled ? null : (result.filePaths[0] ?? null) }
  })
  handle(IPC.appReady, emptySchema, () => {
    markRendererReady()
    return { ok: true as const, platform: process.platform }
  })
  handle(IPC.appGetVersion, emptySchema, () => ({ version: app.getVersion() }))
  handle(IPC.appDevGate, emptySchema, () => ({ active: isDevGateActive() }))
  handle(IPC.mediaMetadataExtractPlex, mediaMetadataPathsSchema, (req) => {
    assertMediaMetadataEnabled()
    return extractPlexMany(req.paths, req.kindHints, req.nameHints)
  })
  handle(IPC.mediaMetadataDownload, mediaMetadataPathsSchema, (req) => {
    assertMediaMetadataEnabled()
    return downloadInternetMany(req.paths, req.kindHints, req.pickHints, req.nameHints)
  })
  handle(IPC.mediaMetadataRefresh, mediaMetadataPathsSchema, (req) => {
    assertMediaMetadataEnabled()
    return refreshMany(req.paths, req.kindHints, req.pickHints, req.nameHints)
  })
  handle(IPC.mediaMetadataClear, mediaMetadataPathsSchema, (req) => {
    assertMediaMetadataEnabled()
    return clearMany(req.paths)
  })
  handle(IPC.mediaMetadataGet, mediaMetadataPathSchema, (req) => getMediaMetadataView(req.path))
  handle(IPC.mediaMetadataListCovers, mediaMetadataPathSchema, (req) => {
    assertMediaMetadataEnabled()
    return listMediaCovers(req.path)
  })
  handle(IPC.mediaMetadataSetCover, mediaMetadataSetCoverSchema, async (req) => {
    assertMediaMetadataEnabled()
    await setMediaCover(req.path, req.coverId, req.previewBase64)
    return { ok: true as const }
  })
  handle(IPC.mediaMetadataSetWatched, mediaMetadataSetWatchedSchema, (req) => {
    assertMediaMetadataEnabled()
    return setWatchedMany(req.paths, req.watched)
  })
  handle(IPC.mediaMetadataFolderLibrary, mediaMetadataPathSchema, (req) => {
    assertMediaMetadataEnabled()
    return getFolderMediaLibrary(req.path)
  })
  handle(IPC.mediaMetadataConsolidateSubtitles, mediaMetadataPathsSchema, (req) => {
    assertMediaMetadataEnabled()
    return consolidateSubtitles(req.paths)
  })
  handle(IPC.mediaMetadataProbePlex, emptySchema, () => probePlex())
  handle(
    IPC.appCheckUpdate,
    z.object({ source: z.string() }),
    async (req) => ({ candidate: await findUpdateInstaller(req.source) })
  )
  handle(
    IPC.appRunUpdate,
    z.object({
      path: z.string().min(1),
      source: z.string().min(1),
      downloadUrl: z.string().optional(),
      version: z.string().optional()
    }),
    (req) => runUpdateInstaller(req.path, req.source, req.downloadUrl, req.version)
  )

  // slideshow (renderer gates on slideshowFeaturesEnabled; compiled lists also require dev gate)
  handle(IPC.slideshowListImages, slideshowListRequestSchema, (req) => listSlideshowImages(req))
  handle(IPC.slideshowCancelList, emptySchema, () => {
    cancelSlideshowList()
    return { cancelled: true as const }
  })
  handle(
    IPC.slideshowPickOpenFile,
    z.object({
      title: z.string().optional(),
      defaultPath: z.string().optional(),
      filters: z
        .array(z.object({ name: z.string(), extensions: z.array(z.string()) }))
        .optional()
    }),
    async (req, event) => {
      const win = BrowserWindow.fromWebContents(event.sender)
      const opts = {
        title: req.title,
        defaultPath: req.defaultPath,
        properties: ['openFile'] as ('openFile')[],
        filters: req.filters
      }
      const result = win
        ? await dialog.showOpenDialog(win, opts)
        : await dialog.showOpenDialog(opts)
      return { path: result.canceled ? null : (result.filePaths[0] ?? null) }
    }
  )
  handle(
    IPC.slideshowPickSaveFile,
    z.object({
      title: z.string().optional(),
      defaultPath: z.string().optional(),
      filters: z
        .array(z.object({ name: z.string(), extensions: z.array(z.string()) }))
        .optional()
    }),
    async (req, event) => {
      const win = BrowserWindow.fromWebContents(event.sender)
      const opts = {
        title: req.title,
        defaultPath: req.defaultPath,
        filters: req.filters
      }
      const result = win
        ? await dialog.showSaveDialog(win, opts)
        : await dialog.showSaveDialog(opts)
      return { path: result.canceled ? null : (result.filePath ?? null) }
    }
  )
  handle(IPC.slideshowReadTextFile, z.object({ path: z.string().min(1) }), async (req) => {
    const p = requireAbsolute(req.path)
    const text = await fsp.readFile(p, 'utf8')
    return { text }
  })
  handle(
    IPC.slideshowWriteTextFile,
    z.object({ path: z.string().min(1), text: z.string() }),
    async (req) => {
      const p = requireAbsolute(req.path)
      await fsp.writeFile(p, req.text, 'utf8')
      return { ok: true as const }
    }
  )

  // Compiled file lists
  handleDev(IPC.slideshowUpdateCompiledLists, updateCompiledListsRequestSchema, async (req) =>
    updateCompiledLists(req.compiledRoot, req.entries)
  )
  handleDev(IPC.slideshowValidateCompiledLists, validateCompiledListsRequestSchema, async (req) =>
    validateCompiledLists(req.compiledRoot)
  )
  handleDev(IPC.slideshowListCompiledDats, listCompiledDatsRequestSchema, async (req) => ({
    tabs: await listCompiledDats(req.compiledRoot, req.entries)
  }))
  handleDev(IPC.slideshowReadDatIndex, z.object({ path: z.string().min(1) }), async (req) => ({
    paths: await readDatIndex(req.path)
  }))
  handleDev(IPC.slideshowReadLastList, compiledRootSchema, async (req) => ({
    lines: await readLastList(req.compiledRoot)
  }))
  handleDev(IPC.slideshowWriteLastList, writeLastListRequestSchema, async (req) => {
    await writeLastList(req.compiledRoot, req.lines)
    return { ok: true as const }
  })
  handleDev(IPC.slideshowReadCompositeList, compositeFileSchema, async (req) => ({
    lines: await readCompositeList(req.path)
  }))
  handleDev(IPC.slideshowWriteCompositeList, writeCompositeListRequestSchema, async (req) => {
    await writeCompositeList(req.path, req.lines)
    return { ok: true as const }
  })
  handleDev(IPC.slideshowLastListUsable, compiledRootSchema, async (req) => ({
    usable: await lastListIsUsable(req.compiledRoot)
  }))
  handleDev(IPC.slideshowExpandComposite, expandCompositeRequestSchema, async (req) => ({
    paths: await expandCompositePlaylist(
      req.lines,
      req.order ?? 'name',
      req.ascending ?? true
    )
  }))
  handleDev(IPC.slideshowOpenCompiledListsWindow, emptySchema, () => openCompiledListsWindow())
  handleDev(IPC.slideshowCloseCompiledListsWindow, emptySchema, () => {
    clearVirtualPlaylist()
    return closeCompiledListsWindow()
  })
  handle(IPC.slideshowRelayKey, slideshowRelayKeySchema, (req) => {
    const win = getMainWindow()
    if (win && !win.isDestroyed()) {
      win.webContents.send(EVENT_CHANNEL, { type: 'slideshow-key', payload: req })
    }
    return { ok: true as const }
  })
  handleDev(
    IPC.slideshowApplyCompiledLines,
    applyCompiledLinesRequestSchema,
    async (req) => {
      const built = await buildVirtualPlaylist(req.lines, req.order, req.ascending)
      const snap =
        req.preferPath || req.preferIndex != null
          ? snapshotPreferPath(req.preferPath ?? null, req.preferIndex ?? 0)
          : built
      const payload = {
        total: snap.total,
        index: snap.index,
        path: snap.path,
        truncated: snap.truncated,
        listCounts: built.listCounts ?? [],
        rev: req.rev ?? null,
        resumePlaying: req.resumePlaying === true
      }
      broadcast({ type: 'compiled-playlist-apply', payload })
      return payload
    }
  )
  handleDev(IPC.slideshowCompiledPathAt, compiledPathAtRequestSchema, (req) => ({
    path: pathAtPlayIndex(req.index)
  }))
  handleDev(IPC.slideshowClearVirtualPlaylist, emptySchema, () => {
    clearVirtualPlaylist()
    return { ok: true as const }
  })
  // Legacy flat-path broadcast (small lists / tests only).
  handleDev(
    IPC.slideshowApplyCompiledPlaylist,
    z.object({
      paths: z.array(z.string()),
      preferPath: z.string().nullable().optional(),
      rev: z.number().int().optional().nullable()
    }),
    (req) => {
      // Empty paths → clear virtual session + black compiled overlay.
      if (req.paths.length === 0) {
        clearVirtualPlaylist()
        broadcast({
          type: 'compiled-playlist-apply',
          payload: {
            total: 0,
            index: 0,
            path: null,
            rev: req.rev ?? null
          }
        })
        return { ok: true as const }
      }
      broadcast({
        type: 'compiled-playlist-apply',
        payload: {
          total: req.paths.length,
          index: 0,
          path: req.preferPath ?? req.paths[0] ?? null,
          paths: req.paths,
          preferPath: req.preferPath ?? null,
          rev: req.rev ?? null
        }
      })
      return { ok: true as const }
    }
  )

  // NTFS Alternate Data Streams
  handle(IPC.adsList, adsPathSchema, async (req) => {
    const p = requireAbsolute(req.path)
    const { listStreams } = await import('../fs/adsWin32')
    const streams = listStreams(p).map((s) => ({ name: s.name, size: s.size }))
    return { streams }
  })
  handle(IPC.adsListNamesMany, adsListNamesManySchema, async (req) => {
    const paths: string[] = []
    for (const raw of req.paths) {
      try {
        paths.push(requireAbsolute(raw))
      } catch {
        /* skip invalid */
      }
    }
    const { listStreamNamesMany } = await import('../fs/adsWin32')
    return { names: await listStreamNamesMany(paths) }
  })
  handle(IPC.adsExists, adsNamedSchema, async (req) => {
    const p = requireAbsolute(req.path)
    const { streamExists } = await import('../fs/adsWin32')
    return { exists: streamExists(p, req.name) }
  })
  handle(IPC.adsReadText, adsNamedSchema, async (req) => {
    const p = requireAbsolute(req.path)
    const { readStreamText } = await import('../fs/adsWin32')
    return { text: await readStreamText(p, req.name) }
  })
  handle(IPC.adsWriteText, adsWriteTextSchema, async (req) => {
    const p = requireAbsolute(req.path)
    const { writeStreamText } = await import('../fs/adsWin32')
    await writeStreamText(p, req.name, req.value, req.writeEmpty ?? false)
    await invalidateColumnMetaPaths([p])
    return { ok: true as const }
  })
  handle(IPC.adsDelete, adsNamedSchema, async (req) => {
    const p = requireAbsolute(req.path)
    const { deleteStream } = await import('../fs/adsWin32')
    const deleted = deleteStream(p, req.name)
    await invalidateColumnMetaPaths([p])
    return { deleted }
  })
  handle(IPC.adsReadBytes, adsNamedSchema, async (req) => {
    const p = requireAbsolute(req.path)
    const { readStreamBytes } = await import('../fs/adsWin32')
    const buf = await readStreamBytes(p, req.name)
    return { dataBase64: buf ? buf.toString('base64') : null }
  })
  handle(IPC.adsWriteBytes, adsWriteBytesSchema, async (req) => {
    const p = requireAbsolute(req.path)
    const { writeStreamBytes } = await import('../fs/adsWin32')
    await writeStreamBytes(p, req.name, Buffer.from(req.dataBase64, 'base64'))
    await invalidateColumnMetaPaths([p])
    return { ok: true as const }
  })
  handle(IPC.adsCopy, adsCopySchema, async (req) => {
    const source = requireAbsolute(req.source)
    const dest = requireAbsolute(req.dest)
    const { copyStreams } = await import('../fs/adsWin32')
    const copied = await copyStreams(source, dest, req.ignoreNames)
    await invalidateColumnMetaPaths([dest])
    return { copied }
  })

  handle(IPC.usnQuery, usnQueryRequestSchema, async (req) => {
    const { queryUsnJournalForPath } = await import('../fs/usnJournal')
    return queryUsnJournalForPath(req.path)
  })
  handle(IPC.usnEnable, usnEnableRequestSchema, async (req) => {
    const { enableUsnJournal } = await import('../fs/usnJournal')
    return enableUsnJournal(req.path, req.maxBytes, req.deltaBytes, req.elevate === true)
  })
  handle(IPC.usnDisable, usnDisableRequestSchema, async (req) => {
    const { disableUsnJournal } = await import('../fs/usnJournal')
    return disableUsnJournal(req.path, req.elevate === true)
  })
  handle(IPC.usnClear, usnClearRequestSchema, async (req) => {
    const { clearUsnJournal } = await import('../fs/usnJournal')
    return clearUsnJournal(req.path, req.maxBytes, req.deltaBytes, req.elevate === true)
  })
  handle(IPC.usnRecent, usnRecentRequestSchema, async (req) => {
    const { recentUsnEntries } = await import('../fs/usnJournal')
    return recentUsnEntries(req.path, req.limit ?? 200, req.elevate === true)
  })

  handle(IPC.networkStartDiscovery, emptySchema, async () => startNetworkDiscovery())
  handle(IPC.networkCancelDiscovery, emptySchema, async () => cancelNetworkDiscovery())
  handle(IPC.networkListShares, networkListSharesRequestSchema, async (req) => ({
    shares: await listNetworkShares(req.server)
  }))
  handle(IPC.networkMapDriveDialog, emptySchema, async () => openMapNetworkDriveDialog())
  handle(IPC.networkDisconnectDriveDialog, emptySchema, async () =>
    openDisconnectNetworkDriveDialog()
  )
  handle(
    IPC.networkDisconnectMappedDrive,
    z.object({
      path: z.string().min(1),
      force: z.boolean().optional()
    }),
    async (req) => disconnectMappedNetworkDrive(req.path, { force: req.force === true })
  )
  handle(IPC.networkLocalComputerName, emptySchema, () => ({
    name: localComputerDisplayName()
  }))

  handle(IPC.remoteListConnections, emptySchema, () => ({
    connections: listRemoteConnections()
  }))
  handle(IPC.remoteUpsertConnection, remoteUpsertRequestSchema, (req) => {
    const connection = upsertRemoteConnection({
      id: req.id,
      name: req.name,
      protocol: req.protocol,
      host: req.host,
      port: req.port,
      username: req.username,
      startPath: req.startPath,
      insecureFtpAck: req.insecureFtpAck,
      password: req.password,
      hostFingerprint: req.clearFingerprint ? null : undefined
    })
    return { connection }
  })
  handle(IPC.remoteRenameConnection, remoteRenameRequestSchema, (req) => {
    return { connection: renameRemoteConnection(req.id, req.name) }
  })
  handle(IPC.remoteDeleteConnection, remoteIdRequestSchema, async (req) => {
    await disconnectRemote(req.id)
    deleteRemoteConnection(req.id)
    return { deleted: true as const }
  })
  handle(IPC.remoteConnect, remoteIdRequestSchema, async (req) => {
    assertRemoteReposEnabled()
    const connection = await connectRemote(req.id)
    return { connection, location: remoteStartLocation(connection) }
  })
  handle(IPC.remoteDisconnect, remoteIdRequestSchema, async (req) => {
    await disconnectRemote(req.id)
    return { disconnected: true as const }
  })
  handle(IPC.remoteConnectedIds, emptySchema, () => ({
    ids: listConnectedRemoteIds()
  }))
  handle(IPC.remoteTestPresets, emptySchema, () => ({
    presets: REMOTE_TEST_PRESETS
  }))

  registerScriptIpc(handle)
  registerAiIpc(handle)
}
