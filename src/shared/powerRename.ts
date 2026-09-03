/** Power Rename — PowerToys search/replace + BRU-style advanced pipeline (pure). */

export type PowerRenameApplyTo = 'full' | 'name' | 'ext'

export type PowerRenameNameMode = 'keep' | 'remove' | 'fixed'
export type PowerRenameCaseMode = 'same' | 'lower' | 'upper' | 'title' | 'sentence'
export type PowerRenameCropMode = 'none' | 'before' | 'after'
export type PowerRenameLeadDots = 'same' | 'remove' | 'keep-one'
export type PowerRenameMoveMode = 'none' | 'move' | 'copy'
export type PowerRenameDateMode = 'none' | 'prefix' | 'suffix'
export type PowerRenameDateType = 'modified' | 'created' | 'current'
export type PowerRenameDateFmt = 'ymd' | 'ydm' | 'dmy' | 'mdy' | 'ymd-hms' | 'unix'
export type PowerRenamePlaceMode = 'none' | 'prefix' | 'suffix' | 'insert'
export type PowerRenameNumberType = 'decimal' | 'hex' | 'roman'
export type PowerRenameExtMode = 'same' | 'lower' | 'upper' | 'fixed' | 'remove'

export type PowerRenameMoveSeg = {
  mode: PowerRenameMoveMode
  /** 1-based inclusive start (0 = unused). */
  from: number
  /** 1-based inclusive end (0 = unused). */
  to: number
  sep: string
}

export type PowerRenameAdvanced = {
  nameMode: PowerRenameNameMode
  nameFixed: string
  caseMode: PowerRenameCaseMode
  caseExcept: string
  removeFirst: number
  removeLast: number
  removeFrom: number
  removeTo: number
  removeChars: string
  removeWords: string
  cropMode: PowerRenameCropMode
  cropText: string
  removeDigits: boolean
  removeHighAscii: boolean
  removeTrim: boolean
  removeDs: boolean
  removeAccents: boolean
  removeLetters: boolean
  removeSymbols: boolean
  leadDots: PowerRenameLeadDots
  move1: PowerRenameMoveSeg
  move2: PowerRenameMoveSeg
  addPrefix: string
  addInsert: string
  addInsertAt: number
  addSuffix: string
  dateMode: PowerRenameDateMode
  dateType: PowerRenameDateType
  dateFmt: PowerRenameDateFmt
  dateSep: string
  dateSeg: string
  dateOffsetDays: number
  folderMode: PowerRenamePlaceMode
  folderSep: string
  folderLevels: number
  numberMode: PowerRenamePlaceMode
  numberStart: number
  numberIncr: number
  numberPad: number
  numberType: PowerRenameNumberType
  numberAt: number
  numberSep: string
  numberResetPerFolder: boolean
  extMode: PowerRenameExtMode
  extFixed: string
  filter: string
  filterRegex: boolean
  filterMatchCase: boolean
  filterFiles: boolean
  filterFolders: boolean
  filterMinNameLen: number
  filterMaxNameLen: number
}

export type PowerRenameOptions = {
  search: string
  replace: string
  regex: boolean
  matchAll: boolean
  caseSensitive: boolean
  applyTo: PowerRenameApplyTo
  /** BRU-style panels; omitted / defaults = no-op. */
  advanced?: PowerRenameAdvanced
}

export type PowerRenameItem = {
  path: string
  /** Basename including extension when present. */
  name: string
  kind?: 'file' | 'dir' | 'symlink'
  mtimeMs?: number
  birthtimeMs?: number
}

export type PowerRenameItemContext = {
  /** 0-based index among items that pass the selection filter (for numbering). */
  sequenceIndex: number
  /** Parent directory path (for folder-name append / numbering reset). */
  parentPath: string
}

export type PowerRenamePreviewRow = {
  path: string
  originalName: string
  newName: string
  /** True when newName differs and is a valid non-empty Windows file name. */
  willRename: boolean
  /** True when selection filter excludes this row from Apply. */
  excluded?: boolean
  error?: string
}

const INVALID_NAME_CHARS = /[\\/:*?"<>|]/

export function defaultPowerRenameAdvanced(): PowerRenameAdvanced {
  return {
    nameMode: 'keep',
    nameFixed: '',
    caseMode: 'same',
    caseExcept: '',
    removeFirst: 0,
    removeLast: 0,
    removeFrom: 0,
    removeTo: 0,
    removeChars: '',
    removeWords: '',
    cropMode: 'none',
    cropText: '',
    removeDigits: false,
    removeHighAscii: false,
    removeTrim: false,
    removeDs: false,
    removeAccents: false,
    removeLetters: false,
    removeSymbols: false,
    leadDots: 'same',
    move1: { mode: 'none', from: 0, to: 0, sep: '' },
    move2: { mode: 'none', from: 0, to: 0, sep: '' },
    addPrefix: '',
    addInsert: '',
    addInsertAt: 0,
    addSuffix: '',
    dateMode: 'none',
    dateType: 'modified',
    dateFmt: 'ymd',
    dateSep: '-',
    dateSeg: '',
    dateOffsetDays: 0,
    folderMode: 'none',
    folderSep: '_',
    folderLevels: 1,
    numberMode: 'none',
    numberStart: 1,
    numberIncr: 1,
    numberPad: 0,
    numberType: 'decimal',
    numberAt: 0,
    numberSep: '_',
    numberResetPerFolder: false,
    extMode: 'same',
    extFixed: '',
    filter: '',
    filterRegex: false,
    filterMatchCase: false,
    filterFiles: true,
    filterFolders: true,
    filterMinNameLen: 0,
    filterMaxNameLen: 0
  }
}

export function defaultPowerRenameOptions(): PowerRenameOptions {
  return {
    search: '',
    replace: '',
    regex: false,
    matchAll: false,
    caseSensitive: false,
    applyTo: 'name',
    advanced: defaultPowerRenameAdvanced()
  }
}

/** How many advanced panels differ from defaults (for UI badge). */
export function countActiveAdvanced(adv: PowerRenameAdvanced): number {
  const d = defaultPowerRenameAdvanced()
  let n = 0
  if (adv.nameMode !== d.nameMode || (adv.nameMode === 'fixed' && adv.nameFixed !== '')) n++
  if (adv.caseMode !== d.caseMode || adv.caseExcept.trim() !== '') n++
  if (
    adv.removeFirst ||
    adv.removeLast ||
    adv.removeFrom ||
    adv.removeTo ||
    adv.removeChars ||
    adv.removeWords ||
    adv.cropMode !== 'none' ||
    adv.removeDigits ||
    adv.removeHighAscii ||
    adv.removeTrim ||
    adv.removeDs ||
    adv.removeAccents ||
    adv.removeLetters ||
    adv.removeSymbols ||
    adv.leadDots !== 'same'
  ) {
    n++
  }
  if (adv.move1.mode !== 'none' || adv.move2.mode !== 'none') n++
  if (adv.addPrefix || adv.addInsert || adv.addSuffix) n++
  if (adv.dateMode !== 'none') n++
  if (adv.folderMode !== 'none') n++
  if (adv.numberMode !== 'none') n++
  if (adv.extMode !== 'same') n++
  if (
    adv.filter ||
    !adv.filterFiles ||
    !adv.filterFolders ||
    adv.filterMinNameLen > 0 ||
    adv.filterMaxNameLen > 0
  ) {
    n++
  }
  return n
}

function splitName(name: string): { stem: string; ext: string } {
  const base = name
  const dot = base.lastIndexOf('.')
  if (dot <= 0 || dot === base.length - 1) return { stem: base, ext: '' }
  return { stem: base.slice(0, dot), ext: base.slice(dot) }
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * DOS/cmd wildcards: `*` → any run, `?` → one char; everything else literal.
 * Escapes regex metacharacters first, then restores wildcard tokens.
 */
export function dosWildcardToRegExp(pattern: string): string {
  let out = ''
  for (const ch of pattern) {
    if (ch === '*') out += '.*'
    else if (ch === '?') out += '.'
    else out += escapeRegExp(ch)
  }
  return out
}

function flagsFor(matchAll: boolean, caseSensitive: boolean): string {
  let f = ''
  if (matchAll) f += 'g'
  if (!caseSensitive) f += 'i'
  return f
}

/**
 * Apply search/replace to one string segment.
 * Non-regex mode treats `*` / `?` as DOS wildcards.
 */
export function replaceInText(
  text: string,
  opts: Pick<PowerRenameOptions, 'search' | 'replace' | 'regex' | 'matchAll' | 'caseSensitive'>
): { text: string; error?: string } {
  if (opts.search === '') return { text }
  try {
    const pattern = opts.regex ? opts.search : dosWildcardToRegExp(opts.search)
    const re = new RegExp(pattern, flagsFor(opts.matchAll, opts.caseSensitive))
    return { text: text.replace(re, opts.replace) }
  } catch (e) {
    return {
      text,
      error: e instanceof Error ? e.message : 'Invalid regular expression'
    }
  }
}

function parentPathOf(p: string): string {
  const norm = p.replace(/\//g, '\\')
  const i = norm.lastIndexOf('\\')
  if (i < 0) return ''
  if (i === 2 && /^[A-Za-z]:\\/.test(norm)) return norm.slice(0, 3)
  return norm.slice(0, i)
}

function basenameOfPath(p: string): string {
  const norm = p.replace(/\//g, '\\')
  const i = norm.lastIndexOf('\\')
  return i < 0 ? norm : norm.slice(i + 1)
}

function folderLevelsName(filePath: string, levels: number, sep: string): string {
  const n = Math.max(1, Math.floor(levels) || 1)
  const parts: string[] = []
  let cur = parentPathOf(filePath)
  for (let i = 0; i < n && cur; i++) {
    const base = basenameOfPath(cur)
    if (!base || /^[A-Za-z]:$/.test(base) || base.endsWith(':')) break
    parts.unshift(base)
    const next = parentPathOf(cur)
    if (next === cur) break
    cur = next
  }
  return parts.join(sep || '_')
}

function padNumber(n: number, pad: number, type: PowerRenameNumberType): string {
  if (type === 'hex') {
    const h = Math.max(0, Math.floor(n)).toString(16)
    return pad > 0 ? h.padStart(pad, '0') : h
  }
  if (type === 'roman') return toRoman(Math.max(0, Math.floor(n)))
  const s = String(Math.max(0, Math.floor(n)))
  return pad > 0 ? s.padStart(pad, '0') : s
}

function toRoman(num: number): string {
  if (num <= 0) return '0'
  if (num > 3999) return String(num)
  const map: [number, string][] = [
    [1000, 'M'],
    [900, 'CM'],
    [500, 'D'],
    [400, 'CD'],
    [100, 'C'],
    [90, 'XC'],
    [50, 'L'],
    [40, 'XL'],
    [10, 'X'],
    [9, 'IX'],
    [5, 'V'],
    [4, 'IV'],
    [1, 'I']
  ]
  let n = num
  let out = ''
  for (const [v, s] of map) {
    while (n >= v) {
      out += s
      n -= v
    }
  }
  return out
}

function formatDateStamp(
  ms: number,
  fmt: PowerRenameDateFmt,
  sep: string,
  seg: string
): string {
  const d = new Date(ms)
  if (Number.isNaN(d.getTime())) return ''
  if (fmt === 'unix') return String(Math.floor(ms / 1000))
  const y = d.getFullYear()
  const mo = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  const h = String(d.getHours()).padStart(2, '0')
  const mi = String(d.getMinutes()).padStart(2, '0')
  const s = String(d.getSeconds()).padStart(2, '0')
  const sp = sep || '-'
  let core = ''
  switch (fmt) {
    case 'ydm':
      core = `${y}${sp}${day}${sp}${mo}`
      break
    case 'dmy':
      core = `${day}${sp}${mo}${sp}${y}`
      break
    case 'mdy':
      core = `${mo}${sp}${day}${sp}${y}`
      break
    case 'ymd-hms':
      core = `${y}${sp}${mo}${sp}${day}${seg || '_'}${h}${sp}${mi}${sp}${s}`
      break
    case 'ymd':
    default:
      core = `${y}${sp}${mo}${sp}${day}`
      break
  }
  return core
}

function stripAccents(s: string): string {
  return s.normalize('NFD').replace(/\p{M}/gu, '')
}

function applyCase(stem: string, mode: PowerRenameCaseMode, exceptRaw: string): string {
  if (mode === 'same') return stem
  const except = new Set(
    exceptRaw
      .split(/[\s,]+/)
      .map((w) => w.trim())
      .filter(Boolean)
      .map((w) => w.toLowerCase())
  )
  const transformWord = (w: string, fn: (x: string) => string): string => {
    if (except.has(w.toLowerCase())) return w
    return fn(w)
  }
  if (mode === 'lower') {
    return stem.replace(/[^\s._-]+/g, (w) => transformWord(w, (x) => x.toLowerCase()))
  }
  if (mode === 'upper') {
    return stem.replace(/[^\s._-]+/g, (w) => transformWord(w, (x) => x.toUpperCase()))
  }
  if (mode === 'title') {
    return stem.replace(/[^\s._-]+/g, (w) =>
      transformWord(w, (x) => x.charAt(0).toUpperCase() + x.slice(1).toLowerCase())
    )
  }
  // sentence: first letter of stem upper, rest lower (except listed words kept)
  const lower = stem.toLowerCase()
  if (!lower) return stem
  let out = lower.charAt(0).toUpperCase() + lower.slice(1)
  if (except.size === 0) return out
  return out.replace(/[^\s._-]+/g, (w, i) => {
    if (i === 0) return w
    if (except.has(w.toLowerCase())) {
      const orig = exceptRaw
        .split(/[\s,]+/)
        .map((x) => x.trim())
        .find((x) => x.toLowerCase() === w.toLowerCase())
      return orig ?? w
    }
    return w
  })
}

function applyRemove(stem: string, adv: PowerRenameAdvanced): string {
  let s = stem
  const first = Math.max(0, Math.floor(adv.removeFirst) || 0)
  const last = Math.max(0, Math.floor(adv.removeLast) || 0)
  if (first > 0) s = s.slice(first)
  if (last > 0 && last < s.length) s = s.slice(0, s.length - last)
  else if (last >= s.length) s = ''

  const from = Math.floor(adv.removeFrom) || 0
  const to = Math.floor(adv.removeTo) || 0
  if (from > 0 && to >= from) {
    const a = from - 1
    const b = to
    if (a < s.length) s = s.slice(0, a) + s.slice(Math.min(b, s.length))
  }

  if (adv.removeChars) {
    const set = new Set([...adv.removeChars])
    s = [...s].filter((ch) => !set.has(ch)).join('')
  }

  if (adv.removeWords.trim()) {
    const words = new Set(
      adv.removeWords
        .split(/[\s,]+/)
        .map((w) => w.trim())
        .filter(Boolean)
        .map((w) => w.toLowerCase())
    )
    s = s
      .split(/([\s._-]+)/)
      .filter((tok) => !words.has(tok.toLowerCase()))
      .join('')
  }

  if (adv.cropMode !== 'none' && adv.cropText) {
    const idx = s.toLowerCase().indexOf(adv.cropText.toLowerCase())
    if (idx >= 0) {
      if (adv.cropMode === 'before') s = s.slice(idx + adv.cropText.length)
      else s = s.slice(0, idx)
    }
  }

  if (adv.removeDigits) s = s.replace(/\d+/g, '')
  if (adv.removeHighAscii) s = [...s].filter((ch) => ch.codePointAt(0)! < 128).join('')
  if (adv.removeLetters) s = s.replace(/\p{L}/gu, '')
  if (adv.removeSymbols) s = s.replace(/[^\p{L}\p{N}\s._-]/gu, '')
  if (adv.removeAccents) s = stripAccents(s)
  if (adv.removeTrim) s = s.trim()
  if (adv.removeDs) s = s.replace(/ {2,}/g, ' ')

  if (adv.leadDots === 'remove') s = s.replace(/^\.+/, '')
  else if (adv.leadDots === 'keep-one') s = s.replace(/^\.+/, '.')

  return s
}

function applyMoveSeg(stem: string, seg: PowerRenameMoveSeg): string {
  if (seg.mode === 'none') return stem
  const from = Math.floor(seg.from) || 0
  const to = Math.floor(seg.to) || 0
  if (from <= 0 || to < from) return stem
  const a = from - 1
  const b = Math.min(to, stem.length)
  if (a >= stem.length) return stem
  const piece = stem.slice(a, b)
  const rest = stem.slice(0, a) + stem.slice(b)
  const sep = seg.sep
  if (seg.mode === 'copy') return rest + (sep || '') + piece
  return rest + (sep || '') + piece
}

function applyAdd(stem: string, adv: PowerRenameAdvanced): string {
  let s = stem
  if (adv.addPrefix) s = adv.addPrefix + s
  if (adv.addInsert) {
    const at = Math.max(0, Math.floor(adv.addInsertAt) || 0)
    s = s.slice(0, at) + adv.addInsert + s.slice(at)
  }
  if (adv.addSuffix) s = s + adv.addSuffix
  return s
}

function applyPlace(
  stem: string,
  mode: PowerRenamePlaceMode,
  value: string,
  sep: string,
  at: number
): string {
  if (mode === 'none' || !value) return stem
  if (mode === 'prefix') return value + (sep || '') + stem
  if (mode === 'suffix') return stem + (sep || '') + value
  const pos = Math.max(0, Math.floor(at) || 0)
  return stem.slice(0, pos) + (sep || '') + value + (sep ? '' : '') + stem.slice(pos)
}

function validateName(newName: string, original: string): { newName: string; error?: string } {
  if (!newName.trim()) {
    return { newName: original, error: 'Resulting name is empty' }
  }
  if (INVALID_NAME_CHARS.test(newName) || newName === '.' || newName === '..') {
    return { newName: original, error: 'Invalid characters in name' }
  }
  if (/[. ]$/.test(newName)) {
    return { newName: original, error: 'Name cannot end with a space or period' }
  }
  return { newName }
}

function applySearchReplaceSegment(
  name: string,
  opts: PowerRenameOptions
): { name: string; error?: string } {
  if (opts.search === '') return { name }
  const { stem, ext } = splitName(name)
  let target: string
  let prefix = ''
  let suffix = ''

  switch (opts.applyTo) {
    case 'name':
      target = stem
      suffix = ext
      break
    case 'ext':
      if (!ext) return { name }
      prefix = stem + '.'
      target = ext.slice(1)
      break
    case 'full':
    default:
      target = name
      break
  }

  const { text, error } = replaceInText(target, opts)
  if (error) return { name, error }

  let newName = prefix + text + suffix
  if (opts.applyTo === 'ext' && text === '') newName = stem
  return { name: newName }
}

function applyExtension(extWithDot: string, adv: PowerRenameAdvanced): string {
  if (adv.extMode === 'same') return extWithDot
  if (adv.extMode === 'remove') return ''
  const bare = extWithDot.startsWith('.') ? extWithDot.slice(1) : extWithDot
  if (adv.extMode === 'lower') return bare ? `.${bare.toLowerCase()}` : ''
  if (adv.extMode === 'upper') return bare ? `.${bare.toUpperCase()}` : ''
  if (adv.extMode === 'fixed') {
    const f = adv.extFixed.replace(/^\./, '')
    return f ? `.${f}` : ''
  }
  return extWithDot
}

function matchesFilter(item: PowerRenameItem, adv: PowerRenameAdvanced): boolean {
  const kind = item.kind ?? 'file'
  const isDir = kind === 'dir'
  if (isDir && !adv.filterFolders) return false
  if (!isDir && !adv.filterFiles) return false
  const len = item.name.length
  if (adv.filterMinNameLen > 0 && len < adv.filterMinNameLen) return false
  if (adv.filterMaxNameLen > 0 && len > adv.filterMaxNameLen) return false
  if (!adv.filter) return true
  try {
    const pattern = adv.filterRegex ? adv.filter : dosWildcardToRegExp(adv.filter)
    const re = new RegExp(pattern, adv.filterMatchCase ? '' : 'i')
    return re.test(item.name)
  } catch {
    return false
  }
}

function transformStem(
  stem: string,
  opts: PowerRenameOptions,
  ctx: PowerRenameItemContext,
  item: PowerRenameItem
): string {
  const adv = opts.advanced ?? defaultPowerRenameAdvanced()
  let s = stem

  if (adv.nameMode === 'remove') s = ''
  else if (adv.nameMode === 'fixed') s = adv.nameFixed

  s = applyCase(s, adv.caseMode, adv.caseExcept)
  s = applyRemove(s, adv)
  s = applyMoveSeg(s, adv.move1)
  s = applyMoveSeg(s, adv.move2)
  s = applyAdd(s, adv)

  if (adv.dateMode !== 'none') {
    let ms = Date.now()
    if (adv.dateType === 'modified') ms = item.mtimeMs ?? Date.now()
    else if (adv.dateType === 'created') ms = item.birthtimeMs || item.mtimeMs || Date.now()
    ms += (adv.dateOffsetDays || 0) * 86_400_000
    const stamp = formatDateStamp(ms, adv.dateFmt, adv.dateSep, adv.dateSeg)
    const place = adv.dateMode === 'prefix' ? 'prefix' : 'suffix'
    s = applyPlace(s, place, stamp, adv.dateSep || '-', 0)
  }

  if (adv.folderMode !== 'none') {
    const folder = folderLevelsName(item.path, adv.folderLevels, adv.folderSep)
    s = applyPlace(
      s,
      adv.folderMode === 'prefix' ? 'prefix' : adv.folderMode === 'suffix' ? 'suffix' : 'insert',
      folder,
      adv.folderSep,
      0
    )
  }

  if (adv.numberMode !== 'none') {
    const num =
      (adv.numberStart || 0) + ctx.sequenceIndex * (adv.numberIncr === 0 ? 1 : adv.numberIncr)
    const token = padNumber(num, adv.numberPad, adv.numberType)
    if (adv.numberMode === 'prefix') s = token + (adv.numberSep || '') + s
    else if (adv.numberMode === 'suffix') s = s + (adv.numberSep || '') + token
    else {
      const at = Math.max(0, Math.floor(adv.numberAt) || 0)
      s = s.slice(0, at) + (adv.numberSep || '') + token + s.slice(at)
    }
  }

  return s
}

/** Transform a single basename; does not touch directory paths. */
export function transformBasename(
  name: string,
  opts: PowerRenameOptions,
  ctx?: PowerRenameItemContext,
  item?: PowerRenameItem
): { newName: string; error?: string } {
  const adv = opts.advanced ?? defaultPowerRenameAdvanced()
  const fullOpts: PowerRenameOptions = { ...opts, advanced: adv }
  const itemCtx: PowerRenameItemContext = ctx ?? { sequenceIndex: 0, parentPath: '' }
  const itemInfo: PowerRenameItem = item ?? { path: '', name }

  const replaced = applySearchReplaceSegment(name, fullOpts)
  if (replaced.error) return { newName: name, error: replaced.error }

  let { stem, ext } = splitName(replaced.name)
  stem = transformStem(stem, fullOpts, itemCtx, itemInfo)
  ext = applyExtension(ext, adv)

  const newName = stem + ext
  return validateName(newName, name)
}

/**
 * Assign sequence indices for numbering (optional reset per parent folder).
 * Only items that pass the filter receive indices.
 */
export function assignSequenceIndices(
  items: PowerRenameItem[],
  adv: PowerRenameAdvanced
): Map<string, number> {
  const map = new Map<string, number>()
  if (adv.numberResetPerFolder) {
    const perFolder = new Map<string, number>()
    for (const item of items) {
      if (!matchesFilter(item, adv)) continue
      const parent = parentPathOf(item.path)
      const next = perFolder.get(parent) ?? 0
      map.set(item.path, next)
      perFolder.set(parent, next + 1)
    }
  } else {
    let i = 0
    for (const item of items) {
      if (!matchesFilter(item, adv)) continue
      map.set(item.path, i++)
    }
  }
  return map
}

export function previewPowerRename(
  items: PowerRenameItem[],
  opts: PowerRenameOptions
): PowerRenamePreviewRow[] {
  const adv = opts.advanced ?? defaultPowerRenameAdvanced()
  const fullOpts: PowerRenameOptions = { ...opts, advanced: adv }
  const seq = assignSequenceIndices(items, adv)

  return items.map((item) => {
    const excluded = !matchesFilter(item, adv)
    if (excluded) {
      return {
        path: item.path,
        originalName: item.name,
        newName: item.name,
        willRename: false,
        excluded: true
      }
    }
    const sequenceIndex = seq.get(item.path) ?? 0
    const { newName, error } = transformBasename(
      item.name,
      fullOpts,
      { sequenceIndex, parentPath: parentPathOf(item.path) },
      item
    )
    const willRename = !error && newName !== item.name
    return {
      path: item.path,
      originalName: item.name,
      newName,
      willRename,
      excluded: false,
      error
    }
  })
}
