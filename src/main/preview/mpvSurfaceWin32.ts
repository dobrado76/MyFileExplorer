/**
 * Native Win32 helpers for Rich player (D33).
 * Positions mpv as a borderless **owned top-level overlay** over the preview host.
 * Deliberately not `--wid` and not `WS_CHILD` under Chromium (those blank the VO).
 */
import { createRequire } from 'node:module'
import type { BrowserWindow } from 'electron'
import { screen } from 'electron'
import type { PreviewMpvBounds } from '@shared/schemas/preview'

const require = createRequire(import.meta.url)

const WS_POPUP = 0x80000000
const WS_VISIBLE = 0x10000000
const WS_CLIPSIBLINGS = 0x04000000
const WS_CAPTION = 0x00c00000
const WS_THICKFRAME = 0x00040000
const WS_SYSMENU = 0x00080000
const WS_MINIMIZEBOX = 0x00020000
const WS_MAXIMIZEBOX = 0x00010000
const WS_BORDER = 0x00800000
const WS_DLGFRAME = 0x00400000
const SWP_NOACTIVATE = 0x0010
const SWP_SHOWWINDOW = 0x0040
const SWP_FRAMECHANGED = 0x0020
const SWP_NOZORDER = 0x0004
const SWP_HIDEWINDOW = 0x0080
const SW_HIDE = 0
const SW_SHOWNA = 8
/** Place below topmost windows; do not raise above other apps. */
const HWND_NOTOPMOST = -2
const GWL_STYLE = -16
const GWL_EXSTYLE = -20
const GWLP_HWNDPARENT = -8
const WS_EX_TOPMOST = 0x00000008

type Api = {
  FindWindowW: (cls: unknown, title: string) => unknown
  SetWindowLongPtrW: (hWnd: unknown, nIndex: number, dw: unknown) => unknown
  GetWindowLongPtrW: (hWnd: unknown, nIndex: number) => unknown
  SetWindowPos: (
    hWnd: unknown,
    hWndInsertAfter: unknown,
    X: number,
    Y: number,
    cx: number,
    cy: number,
    uFlags: number
  ) => number
  ShowWindow: (hWnd: unknown, nCmdShow: number) => number
  IsWindow: (hWnd: unknown) => number
}

let api: Api | null = null

function loadApi(): Api {
  if (api) return api
  const koffi = require('koffi') as typeof import('koffi').default
  const user32 = koffi.load('user32.dll')
  const is64 = process.arch === 'x64' || process.arch === 'arm64'
  api = {
    FindWindowW: user32.func(
      'void * __stdcall FindWindowW(void *lpClassName, str16 lpWindowName)'
    ) as Api['FindWindowW'],
    GetWindowLongPtrW: user32.func(
      is64
        ? 'int64 __stdcall GetWindowLongPtrW(void *hWnd, int nIndex)'
        : 'int32 __stdcall GetWindowLongW(void *hWnd, int nIndex)'
    ) as Api['GetWindowLongPtrW'],
    SetWindowLongPtrW: user32.func(
      is64
        ? 'int64 __stdcall SetWindowLongPtrW(void *hWnd, int nIndex, int64 dwNewLong)'
        : 'int32 __stdcall SetWindowLongW(void *hWnd, int nIndex, int32 dwNewLong)'
    ) as Api['SetWindowLongPtrW'],
    SetWindowPos: user32.func(
      'bool __stdcall SetWindowPos(void *hWnd, void *hWndInsertAfter, int X, int Y, int cx, int cy, uint32 uFlags)'
    ) as Api['SetWindowPos'],
    ShowWindow: user32.func('bool __stdcall ShowWindow(void *hWnd, int nCmdShow)') as Api['ShowWindow'],
    IsWindow: user32.func('bool __stdcall IsWindow(void *hWnd)') as Api['IsWindow']
  }
  return api
}

function toBigInt(v: unknown): bigint {
  if (typeof v === 'bigint') return v
  if (typeof v === 'number') return BigInt(v)
  return BigInt(String(v))
}

function isHwnd(v: unknown): boolean {
  if (v == null) return false
  if (typeof v === 'bigint') return v !== 0n
  if (typeof v === 'number') return v !== 0
  return true
}

/**
 * Find mpv’s player window by exact `--title`. No PowerShell — that path
 * can stall the main process when mpv never creates a window.
 */
export async function findMpvWindow(title: string, _pid: number, timeoutMs = 5000): Promise<unknown> {
  const u = loadApi()
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const byTitle = u.FindWindowW(null, title)
    if (isHwnd(byTitle) && u.IsWindow(byTitle)) return byTitle
    await new Promise((r) => setTimeout(r, 50))
  }
  throw new Error(`No mpv window for title “${title}”`)
}

export function screenRectFor(
  owner: BrowserWindow,
  bounds: PreviewMpvBounds
): { x: number; y: number; width: number; height: number } {
  const content = owner.getContentBounds()
  const dip = {
    x: content.x + bounds.x,
    y: content.y + bounds.y,
    width: Math.max(32, bounds.width),
    height: Math.max(32, bounds.height)
  }
  const scr = screen.dipToScreenRect(owner, dip)
  return {
    x: Math.round(scr.x),
    y: Math.round(scr.y),
    width: Math.max(32, Math.round(scr.width)),
    height: Math.max(32, Math.round(scr.height))
  }
}

/** Spawn mpv already at the overlay pixel rect (avoids the default 640×480 flash). */
export function overlayGeometryArg(rect: { x: number; y: number; width: number; height: number }): string {
  const w = Math.max(32, Math.round(rect.width))
  const h = Math.max(32, Math.round(rect.height))
  const x = Math.round(rect.x)
  const y = Math.round(rect.y)
  const xs = x >= 0 ? `+${x}` : `${x}`
  const ys = y >= 0 ? `+${y}` : `${y}`
  return `--geometry=${w}x${h}${xs}${ys}`
}

function readWindowHwnd(win: BrowserWindow): unknown | null {
  if (win.isDestroyed()) return null
  try {
    const buf = win.getNativeWindowHandle()
    if (buf.length >= 8) return buf.readBigUInt64LE(0)
    if (buf.length >= 4) return buf.readUInt32LE(0)
  } catch {
    /* ignore */
  }
  return null
}

/**
 * Strip chrome and park mpv as an owned overlay over the preview host.
 * Does not SetParent into Chromium (that blanks the VO).
 */
export function placeMpvOverlay(
  owner: BrowserWindow,
  mpvHwnd: unknown,
  bounds: PreviewMpvBounds
): void {
  const u = loadApi()
  if (!u.IsWindow(mpvHwnd)) throw new Error('mpv HWND is not a window')

  const style = toBigInt(u.GetWindowLongPtrW(mpvHwnd, GWL_STYLE))
  const next =
    (style &
      ~BigInt(
        WS_CAPTION |
          WS_THICKFRAME |
          WS_SYSMENU |
          WS_MINIMIZEBOX |
          WS_MAXIMIZEBOX |
          WS_BORDER |
          WS_DLGFRAME
      )) |
    BigInt(WS_POPUP | WS_VISIBLE | WS_CLIPSIBLINGS)
  u.SetWindowLongPtrW(mpvHwnd, GWL_STYLE, next)

  const ex = toBigInt(u.GetWindowLongPtrW(mpvHwnd, GWL_EXSTYLE))
  u.SetWindowLongPtrW(mpvHwnd, GWL_EXSTYLE, ex & ~BigInt(WS_EX_TOPMOST))

  const parent = readWindowHwnd(owner)
  if (parent) {
    u.SetWindowLongPtrW(mpvHwnd, GWLP_HWNDPARENT, toBigInt(parent))
  }

  const r = screenRectFor(owner, bounds)
  u.SetWindowPos(
    mpvHwnd,
    HWND_NOTOPMOST,
    r.x,
    r.y,
    r.width,
    r.height,
    SWP_NOACTIVATE | SWP_SHOWWINDOW | SWP_FRAMECHANGED
  )
  u.ShowWindow(mpvHwnd, SW_SHOWNA)
}

export function hideMpvOverlay(mpvHwnd: unknown): void {
  const u = loadApi()
  if (!mpvHwnd || !u.IsWindow(mpvHwnd)) return
  u.ShowWindow(mpvHwnd, SW_HIDE)
}

export function showMpvOverlay(
  owner: BrowserWindow,
  mpvHwnd: unknown,
  bounds: PreviewMpvBounds
): void {
  const u = loadApi()
  if (!mpvHwnd || !u.IsWindow(mpvHwnd)) return
  const r = screenRectFor(owner, bounds)
  u.SetWindowPos(
    mpvHwnd,
    HWND_NOTOPMOST,
    r.x,
    r.y,
    r.width,
    r.height,
    SWP_NOACTIVATE | SWP_NOZORDER
  )
  u.ShowWindow(mpvHwnd, SW_SHOWNA)
}

export function moveMpvOverlay(
  owner: BrowserWindow,
  mpvHwnd: unknown,
  bounds: PreviewMpvBounds,
  opts?: { hide?: boolean }
): void {
  const u = loadApi()
  if (!mpvHwnd || !u.IsWindow(mpvHwnd)) return
  const r = screenRectFor(owner, bounds)
  // Never SWP_SHOWWINDOW here — that re-raises the overlay above dialogs / other apps.
  u.SetWindowPos(
    mpvHwnd,
    HWND_NOTOPMOST,
    r.x,
    r.y,
    r.width,
    r.height,
    SWP_NOACTIVATE | SWP_NOZORDER | (opts?.hide === true ? SWP_HIDEWINDOW : 0)
  )
}
