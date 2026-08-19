import { dialog, BrowserWindow, type IpcMainInvokeEvent } from 'electron'
import fsp from 'node:fs/promises'
import { z } from 'zod'
import { IPC } from '@shared/ipc/contract'
import {
  scriptCancelRequestSchema,
  scriptDuplicateRequestSchema,
  scriptExportRequestSchema,
  scriptIdRequestSchema,
  scriptRunRequestSchema,
  scriptUpsertRequestSchema
} from '@shared/schemas/scripts'
import { detectRuntimes } from './runtimes'
import {
  deleteScript,
  duplicateScript,
  exportScriptDocument,
  getScript,
  hasPreviousSource,
  importScriptDocument,
  languageForExternalPath,
  listScripts,
  readScriptSource,
  revertScriptSource,
  upsertScript
} from './library'
import { assertScriptingEnabled, cancelScriptRun, executeScriptRun } from './execute'

const emptySchema = z.union([z.undefined(), z.null(), z.object({}).strict()]).optional()

const upsertWithBackupSchema = scriptUpsertRequestSchema.extend({
  backupPrevious: z.boolean().optional()
})

type Handle = <S extends z.ZodType, T>(
  channel: string,
  schema: S,
  fn: (req: z.infer<S>, event: IpcMainInvokeEvent) => Promise<T> | T
) => void

export function registerScriptIpc(handle: Handle): void {
  handle(IPC.scriptDetectRuntimes, emptySchema, () => ({
    runtimes: detectRuntimes()
  }))
  handle(IPC.scriptList, emptySchema, () => ({ scripts: listScripts() }))
  handle(IPC.scriptGet, scriptIdRequestSchema, async (req) => {
    const script = getScript(req.id)
    const source = await readScriptSource(script)
    return { script, source, hasPrevious: hasPreviousSource(req.id) }
  })
  handle(IPC.scriptUpsert, upsertWithBackupSchema, async (req) => {
    assertScriptingEnabled()
    const script = await upsertScript({
      script: req.script,
      source: req.source,
      backupPrevious: req.backupPrevious
    })
    return { script }
  })
  handle(IPC.scriptDelete, scriptIdRequestSchema, async (req) => {
    assertScriptingEnabled()
    await deleteScript(req.id)
    return { deleted: true as const }
  })
  handle(IPC.scriptDuplicate, scriptDuplicateRequestSchema, async (req) => {
    assertScriptingEnabled()
    return { script: await duplicateScript(req.id, req.name) }
  })
  handle(IPC.scriptRun, scriptRunRequestSchema, (req) => executeScriptRun(req))
  handle(IPC.scriptCancel, scriptCancelRequestSchema, (req) => cancelScriptRun(req.runId))
  handle(IPC.scriptImportFile, emptySchema, async (_req, event) => {
    assertScriptingEnabled()
    const win = BrowserWindow.fromWebContents(event.sender)
    const opts = {
      title: 'Import script',
      filters: [
        { name: 'MyFileExplorer script', extensions: ['mfescript', 'json'] },
        { name: 'All files', extensions: ['*'] }
      ],
      properties: ['openFile' as const]
    }
    const picked = win
      ? await dialog.showOpenDialog(win, opts)
      : await dialog.showOpenDialog(opts)
    if (picked.canceled || !picked.filePaths[0]) return { imported: false as const }
    const json = await fsp.readFile(picked.filePaths[0], 'utf8')
    const script = await importScriptDocument(json)
    return { imported: true as const, script }
  })
  handle(IPC.scriptExportFile, scriptExportRequestSchema, async (req, event) => {
    assertScriptingEnabled()
    const { json, suggestedName } = await exportScriptDocument(req.id)
    const win = BrowserWindow.fromWebContents(event.sender)
    const opts = {
      title: 'Export script',
      defaultPath: suggestedName,
      filters: [{ name: 'MyFileExplorer script', extensions: ['mfescript'] }]
    }
    const picked = win
      ? await dialog.showSaveDialog(win, opts)
      : await dialog.showSaveDialog(opts)
    if (picked.canceled || !picked.filePath) return { saved: false as const }
    await fsp.writeFile(picked.filePath, json, 'utf8')
    return { saved: true as const, path: picked.filePath }
  })
  handle(IPC.scriptPickExternal, emptySchema, async (_req, event) => {
    assertScriptingEnabled()
    const win = BrowserWindow.fromWebContents(event.sender)
    const opts = {
      title: 'Choose script file',
      filters: [
        { name: 'Scripts', extensions: ['ps1', 'py', 'bat', 'cmd', 'sh'] },
        { name: 'All files', extensions: ['*'] }
      ],
      properties: ['openFile' as const]
    }
    const picked = win
      ? await dialog.showOpenDialog(win, opts)
      : await dialog.showOpenDialog(opts)
    const file = picked.filePaths[0]
    if (picked.canceled || !file) return { path: null }
    languageForExternalPath(file)
    return { path: file }
  })
  handle(IPC.scriptRevert, scriptIdRequestSchema, (req) => {
    assertScriptingEnabled()
    return revertScriptSource(req.id)
  })
  handle(IPC.scriptHasPrevious, scriptIdRequestSchema, (req) => ({
    hasPrevious: hasPreviousSource(req.id)
  }))
}
