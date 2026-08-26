/**
 * Put/get real Windows CF_HDROP on the clipboard so Explorer paste works both ways.
 * Electron's clipboard.writeBuffer/readBuffer pickles CF_HDROP as a custom web format —
 * SetClipboardData / GetClipboardData are required.
 */
import koffi from 'koffi'

const CF_HDROP = 15
const CF_UNICODETEXT = 13
const GMEM_MOVEABLE = 0x0002
const DROPEFFECT_COPY = 1
const DROPEFFECT_MOVE = 2

export type ClipboardDropEffect = 'copy' | 'move'

type WinClipApi = {
  OpenClipboard: (hWnd: null) => number
  CloseClipboard: () => number
  EmptyClipboard: () => number
  IsClipboardFormatAvailable: (format: number) => number
  GetClipboardData: (format: number) => unknown
  SetClipboardData: (format: number, hMem: unknown) => unknown
  RegisterClipboardFormatW: (name: string) => number
  GlobalAlloc: (flags: number, bytes: number) => unknown
  GlobalLock: (hMem: unknown) => unknown
  GlobalUnlock: (hMem: unknown) => number
  GlobalFree: (hMem: unknown) => unknown
  GlobalSize: (hMem: unknown) => number | bigint
  memcpy: (dest: unknown, src: unknown, count: number) => unknown
}

let api: WinClipApi | null | undefined
let preferredDropEffectFormat = 0

function ensureApi(): WinClipApi | null {
  if (api !== undefined) return api
  if (process.platform !== 'win32') {
    api = null
    return null
  }
  const user32 = koffi.load('user32.dll')
  const kernel32 = koffi.load('kernel32.dll')
  const msvcrt = koffi.load('msvcrt.dll')
  api = {
    OpenClipboard: user32.func('int __stdcall OpenClipboard(void *hWndNewOwner)'),
    CloseClipboard: user32.func('int __stdcall CloseClipboard()'),
    EmptyClipboard: user32.func('int __stdcall EmptyClipboard()'),
    IsClipboardFormatAvailable: user32.func('int __stdcall IsClipboardFormatAvailable(uint32 format)'),
    GetClipboardData: user32.func('void * __stdcall GetClipboardData(uint32 uFormat)'),
    SetClipboardData: user32.func('void * __stdcall SetClipboardData(uint32 uFormat, void *hMem)'),
    RegisterClipboardFormatW: user32.func('uint32 __stdcall RegisterClipboardFormatW(str16 lpszFormat)'),
    GlobalAlloc: kernel32.func('void * __stdcall GlobalAlloc(uint32 uFlags, size_t dwBytes)'),
    GlobalLock: kernel32.func('void * __stdcall GlobalLock(void *hMem)'),
    GlobalUnlock: kernel32.func('int __stdcall GlobalUnlock(void *hMem)'),
    GlobalFree: kernel32.func('void * __stdcall GlobalFree(void *hMem)'),
    GlobalSize: kernel32.func('size_t __stdcall GlobalSize(void *hMem)'),
    memcpy: msvcrt.func('void * __cdecl memcpy(void *dest, const void *src, size_t n)')
  }
  return api
}

function ensurePreferredDropEffectFormat(k: WinClipApi): number {
  if (!preferredDropEffectFormat) {
    preferredDropEffectFormat = k.RegisterClipboardFormatW('Preferred DropEffect')
  }
  return preferredDropEffectFormat
}

/** DROPFILES (20) + UTF-16LE paths, each NUL-terminated, list ends with extra NUL. */
export function buildCfHdrop(paths: string[]): Buffer {
  const header = Buffer.alloc(20)
  header.writeUInt32LE(20, 0) // pFiles
  header.writeInt32LE(0, 4) // pt.x
  header.writeInt32LE(0, 8) // pt.y
  header.writeUInt32LE(0, 12) // fNC
  header.writeUInt32LE(1, 16) // fWide
  const list = paths.map((p) => p + '\0').join('') + '\0'
  return Buffer.concat([header, Buffer.from(list, 'utf16le')])
}

export function parseCfHdrop(buf: Buffer): string[] {
  if (buf.length < 20) return []
  const offset = buf.readUInt32LE(0)
  if (offset < 20 || offset >= buf.length) return []
  const wide = buf.readUInt32LE(16) !== 0
  const body = buf.subarray(offset)
  const text = wide ? body.toString('utf16le') : body.toString('latin1')
  return text.split('\0').filter((s) => s.length > 0)
}

function allocClipboardBuffer(k: WinClipApi, data: Buffer): unknown | null {
  const hMem = k.GlobalAlloc(GMEM_MOVEABLE, data.length)
  if (!hMem) return null
  const locked = k.GlobalLock(hMem)
  if (!locked) {
    k.GlobalFree(hMem)
    return null
  }
  k.memcpy(locked, data, data.length)
  k.GlobalUnlock(hMem)
  return hMem
}

function readHglobalToBuffer(k: WinClipApi, hMem: unknown): Buffer | null {
  if (!hMem) return null
  const sizeRaw = k.GlobalSize(hMem)
  const size = typeof sizeRaw === 'bigint' ? Number(sizeRaw) : sizeRaw
  if (!Number.isFinite(size) || size <= 0 || size > 64 * 1024 * 1024) return null
  const locked = k.GlobalLock(hMem)
  if (!locked) return null
  try {
    const out = Buffer.allocUnsafe(size)
    k.memcpy(out, locked, size)
    return out
  } finally {
    k.GlobalUnlock(hMem)
  }
}

/**
 * Write file paths for OS paste. Ownership of allocated globals transfers to the
 * clipboard on successful SetClipboardData — do not GlobalFree those handles.
 */
export function winClipboardWriteFiles(
  paths: string[],
  effect: ClipboardDropEffect = 'copy'
): boolean {
  const k = ensureApi()
  if (!k || paths.length === 0) return false

  const hdrop = buildCfHdrop(paths)
  const text = Buffer.from(paths.join('\r\n') + '\0', 'utf16le')
  const effectBuf = Buffer.alloc(4)
  effectBuf.writeUInt32LE(effect === 'move' ? DROPEFFECT_MOVE : DROPEFFECT_COPY, 0)

  if (!k.OpenClipboard(null)) return false
  try {
    k.EmptyClipboard()

    const hDrop = allocClipboardBuffer(k, hdrop)
    if (!hDrop) return false
    if (!k.SetClipboardData(CF_HDROP, hDrop)) {
      k.GlobalFree(hDrop)
      return false
    }

    const fmt = ensurePreferredDropEffectFormat(k)
    if (fmt) {
      const hEffect = allocClipboardBuffer(k, effectBuf)
      if (hEffect && !k.SetClipboardData(fmt, hEffect)) {
        k.GlobalFree(hEffect)
      }
    }

    const hText = allocClipboardBuffer(k, text)
    if (hText && !k.SetClipboardData(CF_UNICODETEXT, hText)) {
      k.GlobalFree(hText)
    }

    return true
  } finally {
    k.CloseClipboard()
  }
}

/** Read Explorer (or any app) CF_HDROP + Preferred DropEffect. */
export function winClipboardReadFiles(): { paths: string[]; effect: ClipboardDropEffect } {
  const empty = { paths: [] as string[], effect: 'copy' as ClipboardDropEffect }
  const k = ensureApi()
  if (!k) return empty
  if (!k.IsClipboardFormatAvailable(CF_HDROP)) return empty
  if (!k.OpenClipboard(null)) return empty
  try {
    const hDrop = k.GetClipboardData(CF_HDROP)
    const buf = readHglobalToBuffer(k, hDrop)
    if (!buf) return empty
    const paths = parseCfHdrop(buf)
    let effect: ClipboardDropEffect = 'copy'
    const fmt = ensurePreferredDropEffectFormat(k)
    if (fmt && k.IsClipboardFormatAvailable(fmt)) {
      const hEffect = k.GetClipboardData(fmt)
      const effectBytes = readHglobalToBuffer(k, hEffect)
      if (effectBytes && effectBytes.length >= 4) {
        const v = effectBytes.readUInt32LE(0)
        // Explorer Cut sets DROPEFFECT_MOVE; Copy sets DROPEFFECT_COPY.
        if ((v & DROPEFFECT_MOVE) !== 0) effect = 'move'
      }
    }
    return { paths, effect }
  } finally {
    k.CloseClipboard()
  }
}
