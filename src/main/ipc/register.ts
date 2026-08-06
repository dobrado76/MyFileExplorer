import { app, dialog, ipcMain, BrowserWindow, type IpcMainInvokeEvent } from 'electron'
import { z, type ZodType } from 'zod'
import { ok, err, errFromUnknown, type Result } from '@shared/result'
import { IPC } from '@shared/ipc/contract'
import {
  listRequestSchema,
  pathRequestSchema,
  pathsRequestSchema,
  nameInParentRequestSchema,
  renameRequestSchema,
  transferRequestSchema,
  relocateRequestSchema,
  checkConflictsRequestSchema
} from '@shared/schemas/fs'
import { sessionSchema } from '@shared/schemas/session'
import { settingsPatchSchema } from '@shared/schemas/settings'
import { previewRequestSchema } from '@shared/schemas/preview'
import { searchQueryRequestSchema, reindexRequestSchema } from '@shared/schemas/search'
import { listDirectory, statPath, pathExists } from '../fs/list'
import { listDrives } from '../fs/drives'
import { getProperties, measureFolder, setPathAttributes } from '../fs/properties'
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
  deletePermanently
} from '../fs/ops'
import {
  saveEditedImage,
  hasImageOriginal,
  revertImageOriginal,
  readImageForEdit,
  writeEditedImageToPath
} from '../fs/imageEdit'
import { restoreFromRecycleBin, listRecycleBin, emptyRecycleBin, deleteFromRecycleBin } from '../fs/recycle'
import { watchDirectory, unwatchDirectory, muteWatchers } from '../fs/watch'
import { requestCancelActiveOps } from '../fs/opProgress'
import { markRendererReady } from '../externalOpen'
import { findUpdateInstaller, runUpdateInstaller } from '../update/installers'
import {
  openPath,
  showItemInFolder,
  openRecycleBin,
  clipboardWriteFiles,
  clipboardReadFiles,
  startOsFileDrag
} from '../shell'
import { sessionStore } from '../session/store'
import { settingsStore, patchSettings } from '../settings/store'
import { getPreview } from '../preview'
import { getThumbUrl, clearThumbCache } from '../thumbs'
import { generateVidThumbStrips } from '../thumbs/generateVidThumbs'
import { getShellIconUrl } from '../icons/shell'
import { getColumnMetaMany } from '../meta/columns'
import { metaGetManyRequestSchema } from '@shared/schemas/meta'
import {
  runSearchQuery,
  addIndexRoot,
  removeIndexRoot,
  scheduleIndex,
  listIndexRoots,
  cancelSearch
} from '../search'
import { logMain } from '../logging'
import { ensureLamaModel } from '../images/lamaModel'
import { lamaModelFetchUrl } from '../media/modelProtocol'

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
const thumbRequestSchema = z.object({
  path: z.string().min(1),
  size: z.number().int().min(16).max(1024)
})
const generateVidThumbsSchema = z.object({
  paths: z.array(z.string().min(1)).min(1),
  mode: z.enum(['missing', 'all']),
  recursive: z.boolean().optional()
})

export function registerIpcHandlers(): void {
  // fs
  handle(IPC.fsList, listRequestSchema, (req) => listDirectory(req.path, req.includeHidden ?? true))
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
    return renameEntry(req.path, req.newName)
  })
  handle(IPC.fsCopy, transferRequestSchema, async (req) => {
    muteWatchers()
    return copyEntries(req.sources, req.destinationDir, req.conflictPolicy)
  })
  handle(IPC.fsMove, transferRequestSchema, async (req) => {
    muteWatchers()
    return moveEntries(req.sources, req.destinationDir, req.conflictPolicy)
  })
  handle(IPC.fsRelocate, relocateRequestSchema, async (req) => {
    muteWatchers()
    return relocateEntries(req.pairs)
  })
  handle(IPC.fsCheckConflicts, checkConflictsRequestSchema, (req) =>
    checkConflicts(req.sources, req.destinationDir)
  )
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
  handle(IPC.fsProperties, propertiesRequestSchema, (req) => getProperties(req.path))
  handle(IPC.fsMeasureFolder, propertiesRequestSchema, (req) => measureFolder(req.path))
  handle(IPC.fsSetAttributes, setAttributesRequestSchema, (req) =>
    setPathAttributes(req.path, {
      readOnly: req.readOnly,
      hidden: req.hidden,
      archive: req.archive,
      system: req.system
    })
  )
  handle(
    IPC.fsSaveEditedImage,
    z.object({ path: z.string().min(1), dataBase64: z.string().min(1) }),
    (req) => saveEditedImage(req.path, req.dataBase64)
  )
  handle(IPC.fsHasImageOriginal, pathRequestSchema, (req) => hasImageOriginal(req.path))
  handle(IPC.fsRevertImageOriginal, pathRequestSchema, async (req) => {
    muteWatchers()
    return revertImageOriginal(req.path)
  })
  handle(IPC.fsReadImageForEdit, pathRequestSchema, (req) => readImageForEdit(req.path))
  handle(IPC.fsEnsureLamaModel, emptySchema, async () => {
    const result = await ensureLamaModel()
    return {
      ...result,
      modelUrl: lamaModelFetchUrl()
    }
  })
  handle(
    IPC.fsSaveEditedImageAs,
    z.object({ dataBase64: z.string().min(1), defaultPath: z.string().min(1) }),
    async (req, event) => {
      const win = BrowserWindow.fromWebContents(event.sender)
      const opts = {
        title: 'Save image as',
        defaultPath: req.defaultPath,
        filters: [
          { name: 'JPEG', extensions: ['jpg', 'jpeg'] },
          { name: 'PNG', extensions: ['png'] },
          { name: 'WebP', extensions: ['webp'] },
          { name: 'GIF', extensions: ['gif'] },
          { name: 'TIFF', extensions: ['tif', 'tiff'] },
          {
            name: 'All supported',
            extensions: ['jpg', 'jpeg', 'png', 'webp', 'gif', 'tif', 'tiff', 'bmp']
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
      const written = await writeEditedImageToPath(result.filePath, req.dataBase64)
      return { path: written.path, cancelled: false }
    }
  )

  // shell
  handle(IPC.shellOpenPath, pathRequestSchema, (req) => openPath(req.path))
  handle(IPC.shellShowItemInFolder, pathRequestSchema, (req) => showItemInFolder(req.path))
  handle(IPC.shellOpenRecycleBin, emptySchema, () => openRecycleBin())
  handle(IPC.shellClipboardWriteFiles, pathsRequestSchema, (req) => clipboardWriteFiles(req.paths))
  handle(IPC.shellClipboardReadFiles, emptySchema, () => clipboardReadFiles())
  // Sync + blocking: startDrag must run inside the renderer's dragstart stack.
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
  handle(IPC.settingsGet, emptySchema, () => settingsStore().get())
  handle(IPC.settingsSet, settingsPatchSchema, (patch) => patchSettings(patch))
  handle(IPC.settingsClearThumbCache, emptySchema, async () => {
    await clearThumbCache()
    return { cleared: true as const }
  })

  // preview
  handle(IPC.previewGet, previewRequestSchema, (req) => getPreview(req.path))

  // search
  handle(IPC.searchQuery, searchQueryRequestSchema, (req) => runSearchQuery(req))
  handle(IPC.searchAddRoot, pathRequestSchema, (req) => ({ roots: addIndexRoot(req.path) }))
  handle(IPC.searchRemoveRoot, pathRequestSchema, (req) => ({ roots: removeIndexRoot(req.path) }))
  handle(IPC.searchReindex, reindexRequestSchema, (req) => scheduleIndex(req.rootPath))
  handle(IPC.searchListRoots, emptySchema, () => ({ roots: listIndexRoots() }))
  handle(IPC.searchCancel, emptySchema, () => cancelSearch())

  // thumbs / shell icons / column metadata
  handle(IPC.thumbsGet, thumbRequestSchema, (req) => getThumbUrl(req.path, req.size))
  handle(IPC.thumbsGenerateVidCache, generateVidThumbsSchema, (req) =>
    generateVidThumbStrips(req.paths, req.mode, req.recursive ?? false)
  )
  handle(IPC.iconsGet, thumbRequestSchema, (req) => getShellIconUrl(req.path, req.size))
  handle(IPC.metaGetMany, metaGetManyRequestSchema, async (req) => ({
    values: await getColumnMetaMany(req.paths, req.columns)
  }))

  // app
  handle(IPC.appGetPath, getPathRequestSchema, (req) => ({ path: app.getPath(req.name) }))
  handle(IPC.appPickFolder, emptySchema, async (_req, event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    const result = win
      ? await dialog.showOpenDialog(win, { properties: ['openDirectory'] })
      : await dialog.showOpenDialog({ properties: ['openDirectory'] })
    return { path: result.canceled ? null : (result.filePaths[0] ?? null) }
  })
  handle(IPC.appReady, emptySchema, () => {
    markRendererReady()
    return { ok: true as const }
  })
  handle(IPC.appGetVersion, emptySchema, () => ({ version: app.getVersion() }))
  handle(
    IPC.appCheckUpdate,
    z.object({ folder: z.string() }),
    async (req) => ({ candidate: await findUpdateInstaller(req.folder) })
  )
  handle(
    IPC.appRunUpdate,
    z.object({ path: z.string().min(1), folder: z.string().min(1) }),
    (req) => runUpdateInstaller(req.path, req.folder)
  )
}
