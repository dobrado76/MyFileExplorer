/**
 * Categorizer map keys follow C# `System.Windows.Forms.Keys` names
 * (`Keys.Back`, `Keys.OemMinus`, `Keys.Oemplus`, `Keys.O`, …).
 * Mapped to browser `KeyboardEvent.code` for capture / playback.
 *
 * Numpad codes are used for manual slideshow crop — never categorize.
 */

/** Canonical Forms.Keys token → KeyboardEvent.code (US / OEM layout). */
const NET_KEY_TO_CODE: Record<string, string> = {
  // Editing / nav
  Back: 'Backspace',
  Delete: 'Delete',
  Insert: 'Insert',
  Home: 'Home',
  End: 'End',
  PageUp: 'PageUp',
  PageDown: 'PageDown',
  Prior: 'PageUp', // Forms alias
  Next: 'PageDown', // Forms alias
  Left: 'ArrowLeft',
  Up: 'ArrowUp',
  Right: 'ArrowRight',
  Down: 'ArrowDown',
  Tab: 'Tab',
  Space: 'Space',
  Escape: 'Escape',
  Enter: 'Enter',
  Return: 'Enter',

  // Letters A–Z
  ...Object.fromEntries(
    'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').map((ch) => [ch, `Key${ch}`])
  ),

  // Digits D0–D9 (main row)
  D0: 'Digit0',
  D1: 'Digit1',
  D2: 'Digit2',
  D3: 'Digit3',
  D4: 'Digit4',
  D5: 'Digit5',
  D6: 'Digit6',
  D7: 'Digit7',
  D8: 'Digit8',
  D9: 'Digit9',

  // Function keys
  F1: 'F1',
  F2: 'F2',
  F3: 'F3',
  F4: 'F4',
  F5: 'F5',
  F6: 'F6',
  F7: 'F7',
  F8: 'F8',
  F9: 'F9',
  F10: 'F10',
  F11: 'F11',
  F12: 'F12',

  // OEM / punctuation (Forms.Keys exact spelling, including Oemplus)
  OemSemicolon: 'Semicolon',
  Oemplus: 'Equal',
  Oemcomma: 'Comma',
  OemMinus: 'Minus',
  OemPeriod: 'Period',
  OemQuestion: 'Slash',
  Oemtilde: 'Backquote',
  OemOpenBrackets: 'BracketLeft',
  OemPipe: 'Backslash',
  OemCloseBrackets: 'BracketRight',
  OemQuotes: 'Quote',
  OemBackslash: 'IntlBackslash'
}

/** Lowercase / alias → canonical Forms.Keys token. */
const ALIAS_TO_CANONICAL: Record<string, string> = (() => {
  const m: Record<string, string> = {}
  for (const token of Object.keys(NET_KEY_TO_CODE)) {
    m[token.toLowerCase()] = token
  }
  // Common aliases / misspellings → canonical Forms names
  const aliases: Record<string, string> = {
    backspace: 'Back',
    bs: 'Back',
    del: 'Delete',
    ins: 'Insert',
    pgup: 'PageUp',
    pgdn: 'PageDown',
    pagedown: 'PageDown',
    pageup: 'PageUp',
    esc: 'Escape',
    escape: 'Escape',
    return: 'Return',
    enter: 'Enter',
    // OEM spelling variants (Forms uses Oemplus with lowercase p)
    oemplus: 'Oemplus',
    oemminus: 'OemMinus',
    oemcomma: 'Oemcomma',
    oemperiod: 'OemPeriod',
    oemsemicolon: 'OemSemicolon',
    oemquestion: 'OemQuestion',
    oemtilde: 'Oemtilde',
    oemopenbrackets: 'OemOpenBrackets',
    oemclosebrackets: 'OemCloseBrackets',
    oemquotes: 'OemQuotes',
    oempipe: 'OemPipe',
    oembackslash: 'OemBackslash',
    // Friendly names
    minus: 'OemMinus',
    plus: 'Oemplus',
    equal: 'Oemplus',
    equals: 'Oemplus',
    comma: 'Oemcomma',
    period: 'OemPeriod',
    slash: 'OemQuestion',
    semicolon: 'OemSemicolon',
    quote: 'OemQuotes',
    bracketleft: 'OemOpenBrackets',
    bracketright: 'OemCloseBrackets',
    backslash: 'OemPipe',
    backquote: 'Oemtilde',
    tilde: 'Oemtilde'
  }
  for (const [a, c] of Object.entries(aliases)) m[a] = c
  return m
})()

const CODE_TO_NET: Record<string, string> = (() => {
  const m: Record<string, string> = {}
  for (const [token, code] of Object.entries(NET_KEY_TO_CODE)) {
    // Prefer first canonical token for a code (skip Prior/Next/Return duplicates later)
    if (token === 'Prior' || token === 'Next' || token === 'Return') continue
    if (!m[code]) m[code] = token
  }
  m['IntlBackslash'] = 'OemBackslash'
  return m
})()

/**
 * Tokens shown in Mapping Manager (stable order; excludes nav duplicates Prior/Next/Return).
 */
export const CATEGORIZER_KEY_TOKENS: readonly string[] = [
  'Back',
  'Delete',
  'Insert',
  'Home',
  'End',
  'PageUp',
  'PageDown',
  'Left',
  'Up',
  'Right',
  'Down',
  'Tab',
  'Space',
  ...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split(''),
  'D0',
  'D1',
  'D2',
  'D3',
  'D4',
  'D5',
  'D6',
  'D7',
  'D8',
  'D9',
  'F1',
  'F2',
  'F3',
  'F4',
  'F5',
  'F6',
  'F7',
  'F8',
  'F9',
  'F10',
  'F11',
  'F12',
  'OemMinus',
  'Oemplus',
  'Oemcomma',
  'OemPeriod',
  'OemQuestion',
  'OemSemicolon',
  'Oemtilde',
  'OemOpenBrackets',
  'OemCloseBrackets',
  'OemQuotes',
  'OemPipe',
  'OemBackslash'
]

export type CategorizerKeyToken = string

/** Strip optional `Keys.` prefix and resolve aliases to Forms.Keys spelling. */
export function normalizeKeyToken(raw: string): string | null {
  let t = raw.trim()
  if (!t) return null
  if (/^keys\./i.test(t)) t = t.slice(5)
  const canon = ALIAS_TO_CANONICAL[t.toLowerCase()]
  if (canon && NET_KEY_TO_CODE[canon]) return canon
  // Exact canonical already
  if (NET_KEY_TO_CODE[t]) return t
  return null
}

/** Forms.Keys token (or alias) → KeyboardEvent.code. */
export function keyTokenToCode(token: string): string | null {
  const canon = normalizeKeyToken(token)
  if (!canon) return null
  return NET_KEY_TO_CODE[canon] ?? null
}

/** KeyboardEvent.code → canonical Forms.Keys token (for capture / save). */
export function codeToKeyToken(code: string): string | null {
  if (isNumpadCode(code)) return null
  if (code === 'Tab') return null // reserved: open image editor during slideshow
  // Reserved: physical \ | (OemPipe) undoes the last buffered categorize/delete.
  if (code === 'Backslash' || code === 'IntlBackslash') return null
  return CODE_TO_NET[code] ?? null
}

/** Whether this token is a known Forms.Keys mapping we support. */
export function isKnownKeyToken(token: string): boolean {
  return normalizeKeyToken(token) != null
}

/** Minimal key fields shared by real KeyboardEvents and IPC relays. */
export type SlideshowKeyLike = {
  key: string
  code: string
  ctrlKey?: boolean
  altKey?: boolean
  shiftKey?: boolean
  metaKey?: boolean
}

/** Numpad crop edges (manual slideshow). */
export type SlideshowCropEdge = 'top' | 'right' | 'bottom' | 'left'

/** Numpad — crop tool during manual slideshow; never categorize. */
export function isNumpadCode(code: string): boolean {
  return code.startsWith('Numpad')
}

export function numpadCropEdgeFromCode(code: string): SlideshowCropEdge | null {
  switch (code) {
    case 'Numpad2':
      return 'bottom'
    case 'Numpad8':
      return 'top'
    case 'Numpad4':
      return 'left'
    case 'Numpad6':
      return 'right'
    default:
      return null
  }
}

/** Numpad0 / Enter — save crop (crop mode) or resume autoplay (manual). */
export function isSlideshowCropSaveKey(e: SlideshowKeyLike): boolean {
  return e.code === 'Numpad0' || e.code === 'Enter' || e.key === 'Enter'
}

/** Numpad5 / Escape — abandon crop (crop mode only). */
export function isSlideshowCropCancelKey(e: SlideshowKeyLike): boolean {
  return e.code === 'Numpad5' || e.code === 'Escape' || e.key === 'Escape'
}

/** Numpad keys used for manual crop — relay even when Ctrl/Alt/Meta held (compiled lists window). */
export function isSlideshowCropNumpadKey(e: SlideshowKeyLike): boolean {
  return (
    numpadCropEdgeFromCode(e.code) != null ||
    isSlideshowCropSaveKey(e) ||
    isSlideshowCropCancelKey(e)
  )
}

export function isSlideshowStopKey(e: SlideshowKeyLike): boolean {
  return e.key === 'Escape' || e.key === ' '
}

/** Tab — open in-app image editor during slideshow. */
export function isEditImageSlideshowKey(e: SlideshowKeyLike): boolean {
  return e.key === 'Tab' || e.code === 'Tab'
}

/** @deprecated Prefer isSlideshowStopKey — Enter no longer stops (crop save / resume). */
export function isStopSlideshowKey(e: SlideshowKeyLike): boolean {
  return isSlideshowStopKey(e)
}

export function isPipeUndoKey(e: SlideshowKeyLike): boolean {
  // Physical key under Backspace / above Enter (US ANSI \ |, Forms Keys.OemPipe).
  // Shift is not required — C# treated OemPipe as that key, not only `|`.
  if (e.code === 'Backslash' || e.code === 'IntlBackslash') return true
  return e.key === '\\' || e.key === '|'
}
