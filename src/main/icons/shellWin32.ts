/**
 * Extract shell icons via SHGetFileInfo — matches Explorer for special folders
 * (Downloads, etc.) and desktop.ini custom icons (Dropbox, user folders).
 * Electron's app.getFileIcon often collapses all folders to one generic glyph.
 */
import koffi from 'koffi'

const SHGFI_ICON = 0x0000_0100
const SHGFI_SMALLICON = 0x0000_0001
const SHGFI_LARGEICON = 0x0000_0000
const SHGFI_USEFILEATTRIBUTES = 0x0000_0010
const FILE_ATTRIBUTE_DIRECTORY = 0x10
const FILE_ATTRIBUTE_NORMAL = 0x80
const DI_NORMAL = 0x0003
const DIB_RGB_COLORS = 0
const BI_RGB = 0

const shell32 = koffi.load('shell32.dll')
const user32 = koffi.load('user32.dll')
const gdi32 = koffi.load('gdi32.dll')

const SHFILEINFOW = koffi.struct('SHFILEINFOW', {
  hIcon: 'void *',
  iIcon: 'int',
  dwAttributes: 'uint32',
  szDisplayName: koffi.array('uint16', 260),
  szTypeName: koffi.array('uint16', 80),
})

const BITMAPINFOHEADER = koffi.struct('BITMAPINFOHEADER', {
  biSize: 'uint32',
  biWidth: 'int32',
  biHeight: 'int32',
  biPlanes: 'uint16',
  biBitCount: 'uint16',
  biCompression: 'uint32',
  biSizeImage: 'uint32',
  biXPelsPerMeter: 'int32',
  biYPelsPerMeter: 'int32',
  biClrUsed: 'uint32',
  biClrImportant: 'uint32',
})

const BITMAPINFO = koffi.struct('BITMAPINFO', {
  bmiHeader: BITMAPINFOHEADER,
})

const SHGetFileInfoW = shell32.func(
  'void * __stdcall SHGetFileInfoW(str16 pszPath, uint32 dwFileAttributes, _Out_ SHFILEINFOW *psfi, uint32 cbFileInfo, uint32 uFlags)',
)
const DestroyIcon = user32.func('bool __stdcall DestroyIcon(void *hIcon)')
const GetDC = user32.func('void * __stdcall GetDC(void *hWnd)')
const ReleaseDC = user32.func('int __stdcall ReleaseDC(void *hWnd, void *hDC)')
const CreateCompatibleDC = gdi32.func('void * __stdcall CreateCompatibleDC(void *hdc)')
const DeleteDC = gdi32.func('bool __stdcall DeleteDC(void *hdc)')
const CreateDIBSection = gdi32.func(
  'void * __stdcall CreateDIBSection(void *hdc, const BITMAPINFO *pbmi, uint32 usage, _Out_ void **ppvBits, void *hSection, uint32 offset)',
)
const SelectObject = gdi32.func('void * __stdcall SelectObject(void *hdc, void *h)')
const DeleteObject = gdi32.func('bool __stdcall DeleteObject(void *ho)')
const DrawIconEx = user32.func(
  'bool __stdcall DrawIconEx(void *hdc, int xLeft, int yTop, void *hIcon, int cxWidth, int cyWidth, uint32 istepIfAniCur, void *hbrFlickerFreeDraw, uint32 diFlags)',
)

void BITMAPINFO

function createBuffer(hIcon: unknown, canvas: number): Buffer | null {
  const hdcScreen = GetDC(null)
  if (!hdcScreen) return null
  const hdc = CreateCompatibleDC(hdcScreen)
  if (!hdc) {
    ReleaseDC(null, hdcScreen)
    return null
  }

  const bmi = {
    bmiHeader: {
      biSize: 40,
      biWidth: canvas,
      biHeight: -canvas,
      biPlanes: 1,
      biBitCount: 32,
      biCompression: BI_RGB,
      biSizeImage: canvas * canvas * 4,
      biXPelsPerMeter: 0,
      biYPelsPerMeter: 0,
      biClrUsed: 0,
      biClrImportant: 0,
    },
  }

  let hbmp: unknown = null
  let old: unknown = null
  try {
    const bitsOut: unknown[] = [null]
    hbmp = CreateDIBSection(hdc, bmi, DIB_RGB_COLORS, bitsOut, null, 0)
    const bits = bitsOut[0]
    if (!hbmp || !bits) return null

    old = SelectObject(hdc, hbmp)
    if (!DrawIconEx(hdc, 0, 0, hIcon, canvas, canvas, 0, null, DI_NORMAL)) return null

    const byteLen = canvas * canvas * 4
    const bgra = Buffer.from(koffi.decode(bits, koffi.array('uint8_t', byteLen)) as Uint8Array)
    const rgba = Buffer.alloc(byteLen)
    for (let i = 0; i < byteLen; i += 4) {
      rgba[i] = bgra[i + 2]!
      rgba[i + 1] = bgra[i + 1]!
      rgba[i + 2] = bgra[i]!
      rgba[i + 3] = bgra[i + 3]!
    }
    return rgba
  } finally {
    if (old && hbmp) SelectObject(hdc, old)
    if (hbmp) DeleteObject(hbmp)
    DeleteDC(hdc)
    ReleaseDC(null, hdcScreen)
  }
}

/**
 * @param kindHint — only for non-existent paths (generic type icon). Prefer omitting
 *   for real folders so desktop.ini / special-folder icons resolve like Explorer.
 */
export function extractShellIconRgba(
  filePath: string,
  size: number,
  kindHint?: 'file' | 'dir',
): Buffer | null {
  const wantSmall = size <= 24
  let flags = SHGFI_ICON | (wantSmall ? SHGFI_SMALLICON : SHGFI_LARGEICON)
  let attrs = 0

  if (kindHint === 'dir') {
    flags |= SHGFI_USEFILEATTRIBUTES
    attrs = FILE_ATTRIBUTE_DIRECTORY
  } else if (kindHint === 'file') {
    flags |= SHGFI_USEFILEATTRIBUTES
    attrs = FILE_ATTRIBUTE_NORMAL
  }

  const sfi: { hIcon?: unknown } = {}
  const ret = SHGetFileInfoW(filePath, attrs, sfi, koffi.sizeof(SHFILEINFOW), flags)
  if (!ret || !sfi.hIcon) return null

  try {
    return createBuffer(sfi.hIcon, wantSmall ? 16 : 32)
  } finally {
    DestroyIcon(sfi.hIcon)
  }
}
