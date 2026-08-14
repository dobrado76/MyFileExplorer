/** SAMI (`.smi`) subtitle decode — often EUC-KR / CP949, not UTF-8. */

const CHARSET_ALIASES: Record<string, string> = {
  'utf-8': 'utf-8',
  utf8: 'utf-8',
  'utf-16': 'utf-16le',
  'utf-16le': 'utf-16le',
  'utf-16be': 'utf-16be',
  'euc-kr': 'euc-kr',
  'ks_c_5601-1987': 'euc-kr',
  'ks-c-5601-1987': 'euc-kr',
  'windows-949': 'euc-kr',
  cp949: 'euc-kr',
  uhc: 'euc-kr',
  'shift-jis': 'shift_jis',
  shift_jis: 'shift_jis',
  sjis: 'shift_jis',
  'windows-932': 'shift_jis',
  'euc-jp': 'euc-jp',
  gb2312: 'gb18030',
  gbk: 'gb18030',
  gb18030: 'gb18030',
  'windows-936': 'gb18030',
  big5: 'big5',
  'windows-950': 'big5',
  'windows-1252': 'windows-1252',
  'iso-8859-1': 'windows-1252'
}

const DISPLAY: Record<string, string> = {
  'utf-8': 'UTF-8',
  'utf-16le': 'UTF-16LE',
  'utf-16be': 'UTF-16BE',
  'euc-kr': 'EUC-KR',
  shift_jis: 'Shift_JIS',
  'euc-jp': 'EUC-JP',
  gb18030: 'GB18030',
  big5: 'Big5',
  'windows-1252': 'Windows-1252'
}

function normalizeCharset(raw: string): string | null {
  const k = raw.trim().toLowerCase().replace(/_/g, '-')
  return CHARSET_ALIASES[k] ?? (CHARSET_ALIASES[raw.trim().toLowerCase()] ?? null)
}

/** ASCII-only sniff from the header (charset names and lang= are 7-bit). */
export function sniffSamiCharset(buf: Buffer): string | null {
  const head = buf.subarray(0, Math.min(buf.length, 8192)).toString('latin1')
  const named = /charset\s*=\s*["']?([\w-]+)/i.exec(head)
  if (named?.[1]) {
    const n = normalizeCharset(named[1])
    if (n) return n
  }
  if (/lang\s*:\s*kr|KRCC|ko-KR|kr-KR/i.test(head)) return 'euc-kr'
  if (/lang\s*:\s*ja|JPCC|ja-JP/i.test(head)) return 'shift_jis'
  if (/lang\s*:\s*zh-TW|TWCC|big5/i.test(head)) return 'big5'
  if (/lang\s*:\s*zh|CNCC|zh-CN|GB2312/i.test(head)) return 'gb18030'
  return null
}

function tryDecode(buf: Buffer, label: string): string | null {
  try {
    return new TextDecoder(label).decode(buf)
  } catch {
    return null
  }
}

function scoreDecoded(text: string): number {
  let bad = 0
  let cjk = 0
  const n = Math.min(text.length, 8000)
  for (let i = 0; i < n; i++) {
    const c = text.charCodeAt(i)
    if (c === 0xfffd) bad++
    if (c >= 0xac00 && c <= 0xd7af) cjk++
    else if (c >= 0x4e00 && c <= 0x9fff) cjk++
    else if (c >= 0x3040 && c <= 0x30ff) cjk++
  }
  return cjk * 4 - bad * 20
}

function utf8LooksClean(buf: Buffer): boolean {
  if (buf.includes(0)) return false
  const text = buf.toString('utf8')
  const n = Math.min(text.length, 4000)
  let bad = 0
  for (let i = 0; i < n; i++) if (text.charCodeAt(i) === 0xfffd) bad++
  return bad / Math.max(n, 1) < 0.01
}

function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
}

export function decodeSamiBuffer(buf: Buffer): { text: string; encoding: string } {
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) {
    return { text: stripBom(buf.subarray(2).toString('utf16le')), encoding: 'UTF-16LE' }
  }
  if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) {
    return {
      text: stripBom(new TextDecoder('utf-16be').decode(buf.subarray(2))),
      encoding: 'UTF-16BE'
    }
  }
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) {
    return { text: buf.subarray(3).toString('utf8'), encoding: 'UTF-8' }
  }

  const hinted = sniffSamiCharset(buf)
  const candidates: string[] = []
  if (hinted) candidates.push(hinted)
  if (utf8LooksClean(buf)) candidates.push('utf-8')
  else candidates.push('euc-kr', 'shift_jis', 'gb18030', 'windows-1252', 'utf-8')

  let best: { text: string; encoding: string; score: number } | null = null
  const seen = new Set<string>()
  for (const label of candidates) {
    if (seen.has(label)) continue
    seen.add(label)
    const text = tryDecode(buf, label)
    if (text == null) continue
    const score = scoreDecoded(text)
    if (!best || score > best.score) {
      best = { text: stripBom(text), encoding: DISPLAY[label] ?? label, score }
    }
  }
  return best ?? { text: buf.toString('latin1'), encoding: 'Latin-1' }
}
