import { clipboard } from 'electron'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { AppError } from '@shared/result'
import {
  classifyClipboard,
  isSingleHttpUrl,
  sanitizeFileStem,
  type ClipboardPasteFormat,
  type ClipboardPeek,
  type ClipboardWriteFileRequest
} from '@shared/schemas/clipboardPaste'
import { isRemoteLocation } from '@shared/remotePaths'
import { requireAbsolute, pathExists } from '../fs/list'
import { uniqueTargetName } from '../fs/ops'
import { clipboardReadFiles } from './index'

function timestampStem(prefix: string): string {
  const d = new Date()
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${prefix} ${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
}

function readClipboardParts(): {
  hasFiles: boolean
  hasImage: boolean
  text: string
  html: string
} {
  const files = clipboardReadFiles().paths
  let hasImage = false
  try {
    const img = clipboard.readImage()
    hasImage = !img.isEmpty()
  } catch {
    /* keep false */
  }
  let text = ''
  try {
    text = clipboard.readText() ?? ''
  } catch {
    /* keep empty */
  }
  let html = ''
  try {
    html = clipboard.readHTML() ?? ''
  } catch {
    /* keep empty */
  }
  return { hasFiles: files.length > 0, hasImage, text, html }
}

export function clipboardPeek(): ClipboardPeek {
  const parts = readClipboardParts()
  const kind = classifyClipboard(parts)
  if (kind === 'url') {
    const url = parts.text.trim()
    return { kind: 'url', url: url.slice(0, 4096) }
  }
  return { kind }
}

async function uniqueNameInDir(dir: string, name: string): Promise<string> {
  const dest = path.join(dir, name)
  if (!(await pathExists(dest))) return name
  return uniqueTargetName(dir, name)
}

function defaultName(format: ClipboardPasteFormat, text: string): string {
  if (format === 'png' || format === 'jpeg' || format === 'webp') {
    const ext = format === 'jpeg' ? '.jpg' : `.${format}`
    return `${timestampStem('Image')}${ext}`
  }
  if (format === 'url') {
    let host = 'Link'
    try {
      host = new URL(text.trim()).hostname || 'Link'
    } catch {
      /* keep Link */
    }
    return `${sanitizeFileStem(host, 'Link')}.url`
  }
  if (format === 'html') return `${timestampStem('Clipboard')}.html`
  return `${timestampStem('Clipboard')}.txt`
}

async function imageBytes(format: 'png' | 'jpeg' | 'webp'): Promise<Buffer> {
  const img = clipboard.readImage()
  if (img.isEmpty()) throw new AppError('not-found', 'Clipboard does not contain an image')
  const png = img.toPNG()
  if (format === 'png') return Buffer.from(png)
  const sharp = (await import('sharp')).default
  if (format === 'jpeg') return sharp(png).jpeg({ quality: 90 }).toBuffer()
  return sharp(png).webp({ quality: 90 }).toBuffer()
}

export async function clipboardWriteFile(req: ClipboardWriteFileRequest): Promise<{ path: string }> {
  const destDir = requireAbsolute(req.destDir)
  if (isRemoteLocation(destDir)) {
    throw new AppError('not-allowed', 'Cannot paste clipboard content into a remote folder')
  }
  const parts = readClipboardParts()
  const kind = classifyClipboard(parts)
  if (kind === 'empty' || kind === 'files') {
    throw new AppError('not-found', 'Clipboard does not contain text or an image')
  }

  const format = req.format
  if (format === 'png' || format === 'jpeg' || format === 'webp') {
    if (kind !== 'image') throw new AppError('validation', 'Clipboard does not contain an image')
  } else if (format === 'url') {
    if (kind !== 'url' && !isSingleHttpUrl(parts.text)) {
      throw new AppError('validation', 'Clipboard does not contain a single URL')
    }
  } else if (format === 'html') {
    if (!parts.html.trim() && kind !== 'html') {
      throw new AppError('validation', 'Clipboard does not contain HTML')
    }
  } else if (!parts.text.trim() && !parts.html.trim()) {
    throw new AppError('validation', 'Clipboard does not contain text')
  }

  const suggested = req.name?.trim() || defaultName(format, parts.text)
  const name = await uniqueNameInDir(destDir, path.basename(suggested))
  const dest = path.join(destDir, name)

  if (format === 'png' || format === 'jpeg' || format === 'webp') {
    await fsp.writeFile(dest, await imageBytes(format), { flag: 'wx' })
    return { path: dest }
  }

  if (format === 'url') {
    const url = parts.text.trim()
    const body = `[InternetShortcut]\r\nURL=${url}\r\n`
    await fsp.writeFile(dest, body, { encoding: 'utf8', flag: 'wx' })
    return { path: dest }
  }

  if (format === 'html') {
    const html = parts.html.trim() || `<!DOCTYPE html><html><body><pre>${escapeHtml(parts.text)}</pre></body></html>`
    await fsp.writeFile(dest, html, { encoding: 'utf8', flag: 'wx' })
    return { path: dest }
  }

  await fsp.writeFile(dest, parts.text, { encoding: 'utf8', flag: 'wx' })
  return { path: dest }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

