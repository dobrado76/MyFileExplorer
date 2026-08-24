import { dialog, BrowserWindow } from 'electron'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { AppError } from '@shared/result'
import {
  ITEM_ICON_IMG_STREAM,
  ITEM_ICON_STREAM,
  ITEM_NOTE_STREAM,
  parseItemIcon,
  parseItemNote,
  type ItemAdsRecord,
  type ItemIcon,
  type ItemNote
} from '@shared/schemas/itemAds'
import { isRemoteLocation } from '@shared/remotePaths'
import { requireAbsolute } from '../fs/list'
import {
  deleteStream,
  readStreamBytes,
  readStreamText,
  streamExists,
  withPreservedHostTimes,
  writeStreamBytes,
  writeStreamText
} from '../fs/adsWin32'
import { invalidateColumnMetaPaths } from '../meta/columns'
import { upsertNoteIndex } from '../search/noteIndex'

const MAX_ICON_SOURCE_BYTES = 24 * 1024 * 1024

function assertLocal(p: string): string {
  const n = requireAbsolute(p)
  if (isRemoteLocation(n)) {
    throw new AppError('not-allowed', 'Notes and item icons are only stored on local NTFS items')
  }
  return n
}

export async function getItemAdsMany(paths: string[]): Promise<Record<string, ItemAdsRecord>> {
  const out: Record<string, ItemAdsRecord> = {}
  if (process.platform !== 'win32') return out
  for (const raw of paths) {
    try {
      const file = requireAbsolute(raw)
      if (isRemoteLocation(file)) continue
      let note: ItemNote | null = null
      let icon: ItemIcon | null = null
      let iconPngBase64: string | null = null
      if (streamExists(file, ITEM_NOTE_STREAM)) {
        note = parseItemNote(await readStreamText(file, ITEM_NOTE_STREAM))
      }
      if (streamExists(file, ITEM_ICON_STREAM)) {
        icon = parseItemIcon(await readStreamText(file, ITEM_ICON_STREAM))
        if (icon?.kind === 'custom' && streamExists(file, ITEM_ICON_IMG_STREAM)) {
          const bytes = await readStreamBytes(file, ITEM_ICON_IMG_STREAM)
          if (bytes) iconPngBase64 = bytes.toString('base64')
        }
      }
      out[raw] = { note, icon, iconPngBase64 }
    } catch {
      /* soft-fail per path */
    }
  }
  return out
}

export async function setItemNote(filePath: string, note: ItemNote | null): Promise<{ ok: true }> {
  const file = assertLocal(filePath)
  if (process.platform !== 'win32') {
    throw new AppError('not-allowed', 'Notes require NTFS alternate data streams (Windows)')
  }
  const empty =
    !note ||
    (!note.text.trim() &&
      !note.status?.trim() &&
      !(note.checklist?.some((c) => c.text.trim())))
  await withPreservedHostTimes(file, async () => {
    if (empty) {
      if (streamExists(file, ITEM_NOTE_STREAM)) {
        deleteStream(file, ITEM_NOTE_STREAM, { preserveHostTimes: false })
      }
    } else {
      await writeStreamText(
        file,
        ITEM_NOTE_STREAM,
        JSON.stringify({ ...note, updatedAt: Date.now() }),
        false,
        { preserveHostTimes: false }
      )
    }
  })
  upsertNoteIndex(file, empty ? null : note)
  await invalidateColumnMetaPaths([file])
  return { ok: true }
}

export async function setItemIcon(
  filePath: string,
  icon: ItemIcon | null,
  imageBase64?: string
): Promise<{ ok: true }> {
  const file = assertLocal(filePath)
  if (process.platform !== 'win32') {
    throw new AppError('not-allowed', 'Item icons require NTFS alternate data streams (Windows)')
  }
  await withPreservedHostTimes(file, async () => {
    if (!icon) {
      if (streamExists(file, ITEM_ICON_STREAM)) deleteStream(file, ITEM_ICON_STREAM, { preserveHostTimes: false })
      if (streamExists(file, ITEM_ICON_IMG_STREAM)) {
        deleteStream(file, ITEM_ICON_IMG_STREAM, { preserveHostTimes: false })
      }
      return
    }
    await writeStreamText(file, ITEM_ICON_STREAM, JSON.stringify(icon), false, {
      preserveHostTimes: false
    })
    if (icon.kind === 'custom') {
      if (!imageBase64) {
        if (!streamExists(file, ITEM_ICON_IMG_STREAM)) {
          throw new AppError('validation', 'Custom icon is missing image bytes')
        }
        return
      }
      const buf = Buffer.from(imageBase64, 'base64')
      await writeStreamBytes(file, ITEM_ICON_IMG_STREAM, buf, { preserveHostTimes: false })
    } else if (streamExists(file, ITEM_ICON_IMG_STREAM)) {
      deleteStream(file, ITEM_ICON_IMG_STREAM, { preserveHostTimes: false })
    }
  })
  await invalidateColumnMetaPaths([file])
  return { ok: true }
}

export async function importItemCustomIcon(
  sender: Electron.WebContents,
  filePath: string
): Promise<{ cancelled: true } | { cancelled: false; icon: ItemIcon; imageBase64: string }> {
  assertLocal(filePath)
  const win = BrowserWindow.fromWebContents(sender)
  const picked = win
    ? await dialog.showOpenDialog(win, {
        title: 'Choose an item icon',
        properties: ['openFile'],
        filters: [
          { name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'jfif', 'webp', 'ico'] },
          { name: 'All files', extensions: ['*'] }
        ]
      })
    : await dialog.showOpenDialog({ properties: ['openFile'] })
  const src = picked.canceled ? null : (picked.filePaths[0] ?? null)
  if (!src) return { cancelled: true }

  const st = await fsp.stat(src)
  if (!st.isFile()) throw new AppError('not-found', 'That path is not a file')
  if (st.size > MAX_ICON_SOURCE_BYTES) {
    throw new AppError('validation', 'Image is too large (24 MB max)')
  }
  const ext = path.extname(src).toLowerCase()
  if (!['.png', '.jpg', '.jpeg', '.jfif', '.webp', '.ico'].includes(ext)) {
    throw new AppError('validation', 'Choose a .png, .jpg, or .ico image')
  }
  const sharp = (await import('sharp')).default
  const png = await sharp(src)
    .rotate()
    .resize(128, 128, { fit: 'cover', position: 'centre' })
    .png()
    .toBuffer()
  return {
    cancelled: false,
    icon: { kind: 'custom', sizePx: 32 },
    imageBase64: png.toString('base64')
  }
}
