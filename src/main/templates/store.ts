import { app, dialog, BrowserWindow } from 'electron'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { AppError } from '@shared/result'
import {
  MAX_FILE_TEMPLATES,
  sanitizeTemplateStem,
  templateDefaultStem,
  templateExt,
  uniqueTemplatePrettyName,
  type FileTemplate
} from '@shared/schemas/templates'
import { getSettings, patchSettings } from '../settings/store'
import { requireAbsolute, pathExists } from '../fs/list'
import { uniqueTargetName } from '../fs/ops'
import { isRemoteLocation } from '@shared/remotePaths'

const DIR_NAME = 'Templates'
const MAX_SOURCE_BYTES = 32 * 1024 * 1024

export function templatesDir(): string {
  return path.join(app.getPath('userData'), DIR_NAME)
}

function newTemplateId(): string {
  return `tpl_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

async function pickTemplateSource(
  sender: Electron.WebContents,
  title: string
): Promise<
  | { cancelled: true }
  | { cancelled: false; file: string; ext: string; inputName: string; stem: string }
> {
  const win = BrowserWindow.fromWebContents(sender)
  const opts: Electron.OpenDialogOptions = {
    title,
    properties: ['openFile']
  }
  const picked = win
    ? await dialog.showOpenDialog(win, opts)
    : await dialog.showOpenDialog(opts)
  const file = picked.canceled ? null : (picked.filePaths[0] ?? null)
  if (!file) return { cancelled: true }

  const st = await fsp.stat(file)
  if (!st.isFile()) throw new AppError('not-found', 'That path is not a file')
  if (st.size > MAX_SOURCE_BYTES) {
    throw new AppError('validation', 'Template file is too large (32 MB max)')
  }

  const ext = path.extname(file) || '.txt'
  return {
    cancelled: false,
    file,
    ext,
    inputName: path.basename(file).slice(0, 200),
    stem: path.basename(file, path.extname(file))
  }
}

export async function importFileTemplate(
  sender: Electron.WebContents
): Promise<{ cancelled: true } | { cancelled: false; template: FileTemplate }> {
  const current = getSettings().templates ?? []
  if (current.length >= MAX_FILE_TEMPLATES) {
    throw new AppError('validation', `At most ${MAX_FILE_TEMPLATES} templates`)
  }
  const picked = await pickTemplateSource(sender, 'Add template file')
  if (picked.cancelled) return picked

  const id = newTemplateId()
  const sourceFile = `${id}${picked.ext}`
  const dir = templatesDir()
  await fsp.mkdir(dir, { recursive: true })
  await fsp.copyFile(picked.file, path.join(dir, sourceFile))

  const pretty = sanitizeTemplateStem(picked.stem, 'Template')
  const template: FileTemplate = {
    id,
    name: pretty,
    suggestedStem: pretty,
    inputName: picked.inputName,
    sourceFile
  }
  await patchSettings({ templates: [...current, template] })
  return { cancelled: false, template }
}

/** Swap the stored copy; pretty name stays. */
export async function replaceFileTemplate(
  sender: Electron.WebContents,
  id: string
): Promise<{ cancelled: true } | { cancelled: false; template: FileTemplate }> {
  const current = getSettings().templates ?? []
  const found = current.find((t) => t.id === id)
  if (!found) throw new AppError('not-found', 'Template not found')

  const picked = await pickTemplateSource(sender, 'Replace template file')
  if (picked.cancelled) return picked

  const dir = templatesDir()
  await fsp.mkdir(dir, { recursive: true })
  const sourceFile = `${id}${picked.ext}`
  await fsp.copyFile(picked.file, path.join(dir, sourceFile))
  if (found.sourceFile !== sourceFile) {
    try {
      await fsp.unlink(path.join(dir, found.sourceFile))
    } catch {
      /* missing old copy is fine */
    }
  }

  const template: FileTemplate = {
    ...found,
    inputName: picked.inputName,
    sourceFile
  }
  await patchSettings({
    templates: current.map((t) => (t.id === id ? template : t))
  })
  return { cancelled: false, template }
}

export async function duplicateFileTemplate(id: string): Promise<FileTemplate> {
  const current = getSettings().templates ?? []
  if (current.length >= MAX_FILE_TEMPLATES) {
    throw new AppError('validation', `At most ${MAX_FILE_TEMPLATES} templates`)
  }
  const found = current.find((t) => t.id === id)
  if (!found) throw new AppError('not-found', 'Template not found')
  const src = path.join(templatesDir(), found.sourceFile)
  if (!(await pathExists(src))) {
    throw new AppError('not-found', 'Template file is missing — remove it from Manage Templates')
  }

  const newId = newTemplateId()
  const ext = path.extname(found.sourceFile) || '.txt'
  const sourceFile = `${newId}${ext}`
  await fsp.copyFile(src, path.join(templatesDir(), sourceFile))

  const name = uniqueTemplatePrettyName(found.name, current)
  const template: FileTemplate = {
    ...found,
    id: newId,
    name,
    suggestedStem: sanitizeTemplateStem(name, found.suggestedStem),
    sourceFile
  }
  const idx = current.findIndex((t) => t.id === id)
  const next = [...current]
  next.splice(idx >= 0 ? idx + 1 : next.length, 0, template)
  await patchSettings({ templates: next })
  return template
}

export async function deleteFileTemplate(id: string): Promise<{ ok: true }> {
  const current = getSettings().templates ?? []
  const found = current.find((t) => t.id === id)
  if (!found) throw new AppError('not-found', 'Template not found')
  const file = path.join(templatesDir(), found.sourceFile)
  try {
    await fsp.unlink(file)
  } catch {
    /* missing file is fine */
  }
  await patchSettings({ templates: current.filter((t) => t.id !== id) })
  return { ok: true }
}

export async function instantiateTemplate(
  id: string,
  destDirRaw: string
): Promise<{ path: string }> {
  const destDir = requireAbsolute(destDirRaw)
  if (isRemoteLocation(destDir)) {
    throw new AppError('not-allowed', 'Cannot create a template file in a remote folder')
  }
  const found = (getSettings().templates ?? []).find((t) => t.id === id)
  if (!found) throw new AppError('not-found', 'Template not found')
  const src = path.join(templatesDir(), found.sourceFile)
  if (!(await pathExists(src))) {
    throw new AppError('not-found', 'Template file is missing — remove it from Manage Templates')
  }
  const ext = templateExt(found) || path.extname(found.sourceFile)
  const stem = templateDefaultStem(found)
  const destName = (await pathExists(path.join(destDir, `${stem}${ext}`)))
    ? await uniqueTargetName(destDir, `${stem}${ext}`)
    : `${stem}${ext}`
  const dest = path.join(destDir, destName)
  await fsp.copyFile(src, dest)
  return { path: dest }
}
