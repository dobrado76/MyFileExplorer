/**
 * Custom tab icons — processed square PNG under userData/tab-icons (D2 / D54).
 */
import { app, dialog, BrowserWindow } from 'electron'
import fsp from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'
import { AppError } from '@shared/result'
import { CUSTOM_TAB_ICON_STORE_PX } from '@shared/tabIcons'
import { mediaUrlFor } from '../media/protocol'
import { protocolAllowlist } from '../security/paths'

const DIR_NAME = 'tab-icons'
const MAX_SOURCE_BYTES = 24 * 1024 * 1024
const ALLOWED_EXT = new Set(['.png', '.jpg', '.jpeg', '.jfif', '.webp', '.ico'])

export function tabIconsDir(): string {
  return path.join(app.getPath('userData'), DIR_NAME)
}

export function ensureTabIconsDir(): string {
  const dir = tabIconsDir()
  protocolAllowlist.allowDirPermanently(dir)
  return dir
}

export function tabIconFilePath(id: string): string | null {
  if (!/^[a-zA-Z0-9_-]{4,80}$/.test(id)) return null
  return path.join(tabIconsDir(), `${id}.png`)
}

export function customTabIconMediaUrl(id: string): string | null {
  const file = tabIconFilePath(id)
  if (!file) return null
  ensureTabIconsDir()
  return mediaUrlFor(file)
}

function newIconId(): string {
  return `ti_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

export async function pickCustomTabIconSource(
  sender: Electron.WebContents
): Promise<{ path: string } | { cancelled: true }> {
  const win = BrowserWindow.fromWebContents(sender)
  const opts: Electron.OpenDialogOptions = {
    title: 'Choose a tab icon',
    properties: ['openFile'],
    filters: [
      { name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'jfif', 'webp', 'ico'] },
      { name: 'All files', extensions: ['*'] }
    ]
  }
  const picked = win
    ? await dialog.showOpenDialog(win, opts)
    : await dialog.showOpenDialog(opts)
  const file = picked.canceled ? null : (picked.filePaths[0] ?? null)
  if (!file) return { cancelled: true }
  return { path: file }
}

export async function importCustomTabIcon(
  sourcePath: string
): Promise<{ id: string; mediaUrl: string }> {
  const ext = path.extname(sourcePath).toLowerCase()
  if (!ALLOWED_EXT.has(ext)) {
    throw new AppError('validation', 'Choose a .png, .jpg, or .ico image')
  }
  const st = await fsp.stat(sourcePath)
  if (!st.isFile()) {
    throw new AppError('not-found', 'That path is not a file')
  }
  if (st.size > MAX_SOURCE_BYTES) {
    throw new AppError('validation', 'Image is too large (24 MB max)')
  }

  const dir = ensureTabIconsDir()
  await fsp.mkdir(dir, { recursive: true })
  const id = newIconId()
  const dest = path.join(dir, `${id}.png`)
  const destPx = CUSTOM_TAB_ICON_STORE_PX

  try {
    await sharp(sourcePath)
      .rotate()
      .resize(destPx, destPx, { fit: 'cover', position: 'centre' })
      .png()
      .toFile(dest)
  } catch (e) {
    throw new AppError(
      'io',
      `Could not read that image: ${e instanceof Error ? e.message : String(e)}`
    )
  }

  const mediaUrl = mediaUrlFor(dest)
  return { id, mediaUrl }
}
