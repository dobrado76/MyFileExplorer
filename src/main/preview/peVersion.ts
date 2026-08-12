/**
 * Read Windows VERSIONINFO from PE files (exe/dll/…) via version.dll.
 * Matches Explorer Properties → Details (File description, Product name, …).
 */
import koffi from 'koffi'

type WinVersionApi = {
  GetFileVersionInfoSizeW: (lptstrFilename: string, lpdwHandle: number[]) => number
  GetFileVersionInfoW: (
    lptstrFilename: string,
    dwHandle: number,
    dwLen: number,
    lpData: Buffer
  ) => boolean
  VerQueryValueW: (pBlock: Buffer, lpSubBlock: string, outPtr: unknown[], outLen: number[]) => boolean
  VerLanguageNameW: (wLang: number, szLang: Buffer, cchLang: number) => number
}

let winVersionApi: WinVersionApi | null | undefined

function ensureWinVersionApi(): WinVersionApi | null {
  if (winVersionApi !== undefined) return winVersionApi
  if (process.platform !== 'win32') {
    winVersionApi = null
    return null
  }
  const version = koffi.load('version.dll')
  const kernel32 = koffi.load('kernel32.dll')
  winVersionApi = {
    GetFileVersionInfoSizeW: version.func(
      'uint32 __stdcall GetFileVersionInfoSizeW(str16 lptstrFilename, _Out_ uint32 *lpdwHandle)'
    ) as WinVersionApi['GetFileVersionInfoSizeW'],
    GetFileVersionInfoW: version.func(
      'bool __stdcall GetFileVersionInfoW(str16 lptstrFilename, uint32 dwHandle, uint32 dwLen, void *lpData)'
    ) as WinVersionApi['GetFileVersionInfoW'],
    VerQueryValueW: version.func(
      'bool __stdcall VerQueryValueW(const void *pBlock, str16 lpSubBlock, _Out_ void **lplpBuffer, _Out_ uint32 *puLen)'
    ) as WinVersionApi['VerQueryValueW'],
    VerLanguageNameW: kernel32.func(
      'uint32 __stdcall VerLanguageNameW(uint32 wLang, _Out_ uint16 *szLang, uint32 cchLang)'
    ) as WinVersionApi['VerLanguageNameW']
  }
  return winVersionApi
}

export type PeVersionInfo = {
  fileDescription: string | null
  fileVersion: string | null
  productName: string | null
  productVersion: string | null
  copyright: string | null
  companyName: string | null
  originalFilename: string | null
  internalName: string | null
  comments: string | null
  legalTrademarks: string | null
  privateBuild: string | null
  specialBuild: string | null
  language: string | null
  /** From VS_FIXEDFILEINFO when string FileVersion is missing. */
  fileVersionFixed: string | null
  productVersionFixed: string | null
}

const STRING_KEYS = [
  'FileDescription',
  'FileVersion',
  'ProductName',
  'ProductVersion',
  'LegalCopyright',
  'CompanyName',
  'OriginalFilename',
  'InternalName',
  'Comments',
  'LegalTrademarks',
  'PrivateBuild',
  'SpecialBuild'
] as const

type StringKey = (typeof STRING_KEYS)[number]

/**
 * `VerQueryValueW` string lengths are in **characters** (incl. NUL), not bytes.
 * Binary blocks (`\`, Translation) report **bytes**.
 */
function readVersionString(ptr: unknown, charCount: number): string {
  if (!ptr || charCount < 1) return ''
  const arr = koffi.decode(ptr, koffi.array('uint16', charCount)) as number[]
  let end = arr.indexOf(0)
  if (end < 0) end = arr.length
  return String.fromCharCode(...arr.slice(0, end)).trim()
}

function dwordPairVersion(ms: number, ls: number): string {
  const a = (ms >>> 16) & 0xffff
  const b = ms & 0xffff
  const c = (ls >>> 16) & 0xffff
  const d = ls & 0xffff
  return `${a}.${b}.${c}.${d}`
}

function languageName(langId: number): string | null {
  const api = ensureWinVersionApi()
  if (!api) return null
  const buf = Buffer.alloc(512)
  const n = api.VerLanguageNameW(langId, buf, 256)
  if (!n) return null
  const words: number[] = []
  for (let i = 0; i < n && i < 256; i++) {
    words.push(buf.readUInt16LE(i * 2))
  }
  const text = String.fromCharCode(...words).trim()
  return text || null
}

/**
 * Best-effort VERSIONINFO. Returns null when the file has no version resource.
 */
export function readPeVersionInfo(filePath: string): PeVersionInfo | null {
  const api = ensureWinVersionApi()
  if (!api || process.platform !== 'win32') return null
  try {
    const handleOut = [0]
    const size = api.GetFileVersionInfoSizeW(filePath, handleOut)
    if (!size) return null
    const block = Buffer.alloc(size)
    if (!api.GetFileVersionInfoW(filePath, 0, size, block)) return null

    const outPtr: unknown[] = [null]
    const outLen = [0]
    let fileVersionFixed: string | null = null
    let productVersionFixed: string | null = null
    if (api.VerQueryValueW(block, '\\', outPtr, outLen) && outPtr[0]) {
      const fixedLen = outLen[0] ?? 0
      if (fixedLen >= 52) {
        // VS_FIXEDFILEINFO: dwSignature@0, … dwFileVersionMS@8, dwFileVersionLS@12,
        // dwProductVersionMS@16, dwProductVersionLS@20 (all uint32 LE).
        const fixed = Buffer.from(
          koffi.decode(outPtr[0], koffi.array('uint8', fixedLen)) as Uint8Array
        )
        const fileMs = fixed.readUInt32LE(8)
        const fileLs = fixed.readUInt32LE(12)
        const prodMs = fixed.readUInt32LE(16)
        const prodLs = fixed.readUInt32LE(20)
        fileVersionFixed = dwordPairVersion(fileMs, fileLs)
        productVersionFixed = dwordPairVersion(prodMs, prodLs)
      }
    }

    // Translations: array of {LANGID, codepage} DWORD pairs.
    const translations: { lang: number; cp: number }[] = []
    outPtr[0] = null
    outLen[0] = 0
    if (api.VerQueryValueW(block, '\\VarFileInfo\\Translation', outPtr, outLen) && outPtr[0]) {
      const transLen = outLen[0] ?? 0
      if (transLen >= 4) {
        const raw = Buffer.from(
          koffi.decode(outPtr[0], koffi.array('uint8', transLen)) as Uint8Array
        )
        for (let i = 0; i + 3 < raw.length; i += 4) {
          translations.push({ lang: raw.readUInt16LE(i), cp: raw.readUInt16LE(i + 2) })
        }
      }
    }
    if (translations.length === 0) {
      translations.push({ lang: 0x0409, cp: 0x04b0 }) // en-US Unicode fallback
    }

    const strings: Partial<Record<StringKey, string>> = {}
    for (const { lang, cp } of translations) {
      const prefix = `\\StringFileInfo\\${lang.toString(16).padStart(4, '0')}${cp.toString(16).padStart(4, '0')}`
      for (const key of STRING_KEYS) {
        if (strings[key]) continue
        outPtr[0] = null
        outLen[0] = 0
        if (!api.VerQueryValueW(block, `${prefix}\\${key}`, outPtr, outLen) || !outPtr[0]) continue
        const text = readVersionString(outPtr[0], outLen[0] ?? 0)
        if (text) strings[key] = text
      }
    }

    const langId = translations[0]?.lang
    const language = typeof langId === 'number' ? languageName(langId) : null

    const info: PeVersionInfo = {
      fileDescription: strings.FileDescription ?? null,
      fileVersion: strings.FileVersion ?? fileVersionFixed,
      productName: strings.ProductName ?? null,
      productVersion: strings.ProductVersion ?? productVersionFixed,
      copyright: strings.LegalCopyright ?? null,
      companyName: strings.CompanyName ?? null,
      originalFilename: strings.OriginalFilename ?? null,
      internalName: strings.InternalName ?? null,
      comments: strings.Comments ?? null,
      legalTrademarks: strings.LegalTrademarks ?? null,
      privateBuild: strings.PrivateBuild ?? null,
      specialBuild: strings.SpecialBuild ?? null,
      language,
      fileVersionFixed,
      productVersionFixed
    }

    const any =
      info.fileDescription ||
      info.fileVersion ||
      info.productName ||
      info.productVersion ||
      info.copyright ||
      info.companyName ||
      info.originalFilename ||
      info.internalName ||
      info.comments ||
      info.legalTrademarks ||
      info.privateBuild ||
      info.specialBuild ||
      info.language
    return any ? info : null
  } catch {
    return null
  }
}
