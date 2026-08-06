import { spawn } from 'node:child_process'
import { shell, clipboard } from 'electron'
import { requireAbsolute, pathExists } from '../fs/list'
import { AppError } from '@shared/result'

export async function openPath(p: string): Promise<{ opened: boolean; message?: string }> {
  const n = requireAbsolute(p)
  const message = await shell.openPath(n)
  return message ? { opened: false, message } : { opened: true }
}

/** Open the Windows Recycle Bin in system Explorer (virtual shell folder). */
export function openRecycleBin(): { opened: boolean; message?: string } {
  if (process.platform !== 'win32') {
    return { opened: false, message: 'Recycle Bin is only available on Windows' }
  }
  try {
    // explorer often exits non-zero even when it opens — fire-and-forget.
    spawn('explorer.exe', ['shell:RecycleBinFolder'], {
      detached: true,
      stdio: 'ignore'
    }).unref()
    return { opened: true }
  } catch (e) {
    return {
      opened: false,
      message: e instanceof Error ? e.message : 'Could not open Recycle Bin'
    }
  }
}

export async function showItemInFolder(p: string): Promise<{ shown: true }> {
  const n = requireAbsolute(p)
  if (!(await pathExists(n))) throw new AppError('not-found', `Not found: ${n}`)
  shell.showItemInFolder(n)
  return { shown: true }
}

/**
 * Windows CF_HDROP layout: 20-byte DROPFILES header followed by a
 * double-null-terminated UTF-16LE list of absolute paths.
 */
function buildCfHdrop(paths: string[]): Buffer {
  const header = Buffer.alloc(20)
  header.writeUInt32LE(20, 0) // pFiles: offset of file list
  header.writeUInt32LE(0, 4) // pt.x
  header.writeUInt32LE(0, 8) // pt.y
  header.writeUInt32LE(0, 12) // fNC
  header.writeUInt32LE(1, 16) // fWide: UTF-16
  const list = paths.map((p) => p + '\0').join('') + '\0'
  return Buffer.concat([header, Buffer.from(list, 'utf16le')])
}

function parseCfHdrop(buf: Buffer): string[] {
  if (buf.length < 20) return []
  const offset = buf.readUInt32LE(0)
  const wide = buf.readUInt32LE(16) !== 0
  const body = buf.subarray(offset)
  const text = wide ? body.toString('utf16le') : body.toString('latin1')
  return text.split('\0').filter((s) => s.length > 0)
}

export function clipboardWriteFiles(paths: string[]): { written: boolean } {
  const normalized = paths.map(requireAbsolute)
  // Text fallback for editors + CF_HDROP for Explorer paste on Windows.
  clipboard.writeText(normalized.join('\r\n'))
  if (process.platform === 'win32') {
    try {
      clipboard.writeBuffer('CF_HDROP', buildCfHdrop(normalized))
      return { written: true }
    } catch {
      return { written: false }
    }
  }
  return { written: false }
}

export function clipboardReadFiles(): { paths: string[] } {
  if (process.platform === 'win32') {
    try {
      const buf = clipboard.readBuffer('CF_HDROP')
      if (buf && buf.length > 0) return { paths: parseCfHdrop(buf) }
    } catch {
      // fall through to empty
    }
  }
  return { paths: [] }
}

export { startOsFileDrag } from './startDrag'
