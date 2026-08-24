/**
 * Everything-inspired query parser (D34).
 * Produces a StructuredQuery used by SQL and live-walk filters.
 */
import { isBasicNameQuery } from '@shared/searchQuery'
import { queryTokens, tokenHasWildcards } from './queryBuilder'
export { isBasicNameQuery } from '@shared/searchQuery'

export type TextPred =
  | { kind: 'substr'; value: string; wholeWord?: boolean }
  | { kind: 'glob'; value: string }
  | { kind: 'regex'; source: string; flags: string }
  | { kind: 'startwith'; value: string }
  | { kind: 'endwith'; value: string }
  | { kind: 'exact'; value: string }

export type SizePred =
  | { op: 'eq' | 'gt' | 'lt' | 'ge' | 'le'; bytes: number }
  | { op: 'range'; min: number; max: number }

export type DatePred =
  | { field: 'mtime' | 'ctime'; op: 'eq' | 'gt' | 'lt' | 'ge' | 'le'; ms: number }
  | { field: 'mtime' | 'ctime'; op: 'range'; min: number; max: number }

export type StructuredQuery = {
  /** AND of OR-groups of text predicates (applied to name or path). */
  textGroups: TextPred[][]
  notText: TextPred[]
  pathPrefixes: string[]
  pathContains: string[]
  excludePathContains: string[]
  exts: string[]
  excludeExts: string[]
  fileOnly: boolean
  folderOnly: boolean
  matchPath: boolean
  matchCase: boolean
  wholeWord: boolean
  regex: boolean
  size: SizePred | null
  dates: DatePred[]
  empty: boolean | null
  lenMin: number | null
  lenMax: number | null
  attrib: { hidden?: boolean; system?: boolean; readonly?: boolean; archive?: boolean } | null
  depthMin: number | null
  depthMax: number | null
  parentName: string | null
  infolder: string | null
  childName: string | null
  childCountMin: number | null
  childCountMax: number | null
  dupe: 'name' | 'size' | 'namepart' | null
  content: string | null
  contentUtf8: boolean
  /** Attached note (D61) — ADS `mfe_note`, read-only at search time. */
  hasNote: boolean
  excludeHasNote: boolean
  noteText: string | null
  noteStatus: string | null
  openTodo: boolean
  openTodoNeedle: string | null
  countLimit: number | null
  /** True when query used Everything operators beyond plain tokens. */
  advanced: boolean
}

const MACROS: Record<string, string[]> = {
  pic: ['jpg', 'jpeg', 'jfif', 'png', 'gif', 'bmp', 'webp', 'tif', 'tiff', 'tga', 'hdr', 'ico', 'svg', 'heic', 'avif'],
  video: ['mp4', 'mkv', 'avi', 'divx', 'mov', 'wmv', 'webm', 'm4v', 'mpg', 'mpeg', 'ts', 'flv', 'rmvb', 'rm'],
  audio: ['mp3', 'wav', 'flac', 'aac', 'm4a', 'ogg', 'wma', 'opus'],
  doc: ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'txt', 'rtf', 'odt', 'csv', 'md'],
  exe: ['exe', 'msi', 'com', 'bat', 'cmd', 'ps1', 'scr'],
  zip: ['zip', 'rar', '7z', 'tar', 'gz', 'bz2', 'xz', 'cab', 'iso']
}

/** Everything-style query functions/modifiers — not arbitrary `word:value` filenames. */
const QUERY_FN_KEYS = new Set([
  'size',
  'dm',
  'datemodified',
  'dc',
  'datecreated',
  'ext',
  'parent',
  'infolder',
  'startwith',
  'endwith',
  'len',
  'empty',
  'count',
  'attrib',
  'attributes',
  'depth',
  'child',
  'childcount',
  'dupe',
  'sizedupe',
  'namepartdupe',
  'content',
  'utf8content',
  'note',
  'hasnote',
  'notestatus',
  'todo',
  'path',
  'nopath',
  'regex',
  'case',
  'nocase',
  'file',
  'folder',
  'ww',
  'wholeword',
  'noww',
  ...Object.keys(MACROS)
])

function isKnownQueryFn(key: string, macros: Record<string, string[]>): boolean {
  const k = key.toLowerCase()
  return QUERY_FN_KEYS.has(k) || Object.prototype.hasOwnProperty.call(macros, k)
}

/**
 * A search must include something to find — never “everything except X”.
 * Exclusions (`!tmp`, `!ext:`, `nopath:`) and `file:` / `folder:` alone do not count.
 */
export function queryHasPositiveConstraint(q: StructuredQuery): boolean {
  return (
    q.textGroups.length > 0 ||
    q.pathPrefixes.length > 0 ||
    q.pathContains.length > 0 ||
    q.exts.length > 0 ||
    q.size != null ||
    q.dates.length > 0 ||
    q.empty != null ||
    q.lenMin != null ||
    q.lenMax != null ||
    q.attrib != null ||
    q.depthMin != null ||
    q.depthMax != null ||
    q.parentName != null ||
    q.infolder != null ||
    q.childName != null ||
    q.childCountMin != null ||
    q.childCountMax != null ||
    q.dupe != null ||
    q.content != null ||
    q.hasNote ||
    q.noteText != null ||
    q.noteStatus != null ||
    q.openTodo
  )
}

export function queryHasNoteFilter(q: StructuredQuery): boolean {
  return q.hasNote || q.excludeHasNote || q.noteText != null || q.noteStatus != null || q.openTodo
}

/** Name / size / date / path filters the SQLite index can apply without reading ADS. */
export function queryHasIndexableConstraint(q: StructuredQuery): boolean {
  return (
    q.textGroups.length > 0 ||
    q.pathPrefixes.length > 0 ||
    q.pathContains.length > 0 ||
    q.exts.length > 0 ||
    q.size != null ||
    q.dates.length > 0 ||
    q.empty != null ||
    q.lenMin != null ||
    q.lenMax != null ||
    q.parentName != null ||
    q.infolder != null
  )
}

export function searchDecodeMessage(query: string, q: StructuredQuery): string | null {
  if (!query.trim()) return 'Type a file name to search.'
  if (queryHasPositiveConstraint(q)) return null
  if (q.notText.length > 0 || q.excludeExts.length > 0 || q.excludePathContains.length > 0) {
    return 'That search only excludes names. Add a file name to find. A name starting with ! (like !!Thumbs.db) is a file name — put a space before ! to exclude (photo !tmp).'
  }
  if (q.fileOnly || q.folderOnly) {
    return 'Add a file name or a filter (ext:jpg, pic:, size:>1mb). file: / folder: alone would list everything.'
  }
  return 'Could not search: no file name or filter to match.'
}

/** True when the query has non-name filters (ext, size, path, …). */
function queryHasStructuredFilters(q: StructuredQuery): boolean {
  return (
    q.pathPrefixes.length > 0 ||
    q.pathContains.length > 0 ||
    q.excludePathContains.length > 0 ||
    q.exts.length > 0 ||
    q.excludeExts.length > 0 ||
    q.fileOnly ||
    q.folderOnly ||
    q.size != null ||
    q.dates.length > 0 ||
    q.empty != null ||
    q.lenMin != null ||
    q.lenMax != null ||
    q.attrib != null ||
    q.depthMin != null ||
    q.depthMax != null ||
    q.parentName != null ||
    q.infolder != null ||
    q.childName != null ||
    q.childCountMin != null ||
    q.childCountMax != null ||
    q.dupe != null ||
    q.content != null ||
    q.hasNote ||
    q.excludeHasNote ||
    q.noteText != null ||
    q.noteStatus != null ||
    q.openTodo ||
    q.countLimit != null ||
    q.notText.length > 0
  )
}

/**
 * Plain typing in the search box must always constrain names.
 * If tokenization produced no name predicates (and no structured filters), treat
 * the raw string as a basic filename / substring search.
 */
function finalizeBasicNameSearch(q: StructuredQuery, raw: string): void {
  const trimmed = raw.trim()
  if (!trimmed || q.textGroups.length > 0 || queryHasStructuredFilters(q)) return
  q.textGroups.push([toTextPred(trimmed, q)])
  q.advanced = false
}

const SIZE_NAMES: Record<string, [number, number]> = {
  empty: [0, 0],
  tiny: [0, 10 * 1024],
  small: [10 * 1024, 100 * 1024],
  medium: [100 * 1024, 1024 * 1024],
  large: [1024 * 1024, 128 * 1024 * 1024],
  huge: [128 * 1024 * 1024, 1024 * 1024 * 1024],
  gigantic: [1024 * 1024 * 1024, Number.MAX_SAFE_INTEGER]
}

export type ParseOptions = {
  matchPath?: boolean
  matchCase?: boolean
  wholeWord?: boolean
  regex?: boolean
  /** User-defined macro → ext list (from saved filters). */
  customMacros?: Record<string, string[]>
}

function parseBasicNameQuery(raw: string, opts: ParseOptions): StructuredQuery {
  // Filename search is always name-only and literal. Match path / regex toggles
  // must not turn `report.pdf` into a path scan or a `.` = any-character regex.
  const q = emptyQuery({
    matchCase: opts.matchCase,
    wholeWord: opts.wholeWord,
    matchPath: false,
    regex: false
  })
  for (const token of queryTokens(raw)) {
    if (tokenHasWildcards(token)) {
      q.textGroups.push([{ kind: 'glob', value: token }])
    } else {
      q.textGroups.push([{ kind: 'substr', value: token, wholeWord: q.wholeWord }])
    }
  }
  return q
}

function emptyQuery(opts: ParseOptions): StructuredQuery {
  return {
    textGroups: [],
    notText: [],
    pathPrefixes: [],
    pathContains: [],
    excludePathContains: [],
    exts: [],
    excludeExts: [],
    fileOnly: false,
    folderOnly: false,
    matchPath: Boolean(opts.matchPath),
    matchCase: Boolean(opts.matchCase),
    wholeWord: Boolean(opts.wholeWord),
    regex: Boolean(opts.regex),
    size: null,
    dates: [],
    empty: null,
    lenMin: null,
    lenMax: null,
    attrib: null,
    depthMin: null,
    depthMax: null,
    parentName: null,
    infolder: null,
    childName: null,
    childCountMin: null,
    childCountMax: null,
    dupe: null,
    content: null,
    contentUtf8: false,
    hasNote: false,
    excludeHasNote: false,
    noteText: null,
    noteStatus: null,
    openTodo: false,
    openTodoNeedle: null,
    countLimit: null,
    advanced: false
  }
}

function parseSizeBytes(raw: string): number | null {
  const m = /^(<=|>=|<|>|)?\s*([\d.]+)\s*(b|kb|mb|gb|tb)?$/i.exec(raw.trim())
  if (!m) return null
  const n = Number(m[2])
  if (!Number.isFinite(n)) return null
  const unit = (m[3] || 'b').toLowerCase()
  const mul =
    unit === 'tb' ? 1024 ** 4 : unit === 'gb' ? 1024 ** 3 : unit === 'mb' ? 1024 ** 2 : unit === 'kb' ? 1024 : 1
  return Math.round(n * mul)
}

function startOfDay(d = new Date()): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
}

function parseDateToken(field: 'mtime' | 'ctime', raw: string): DatePred | null {
  const v = raw.trim().toLowerCase()
  const now = Date.now()
  const today = startOfDay()
  if (v === 'today') return { field, op: 'range', min: today, max: now }
  if (v === 'yesterday') return { field, op: 'range', min: today - 86400000, max: today }
  if (v === 'thisweek') return { field, op: 'range', min: today - 7 * 86400000, max: now }
  if (v === 'thismonth') {
    const start = new Date(new Date().getFullYear(), new Date().getMonth(), 1).getTime()
    return { field, op: 'range', min: start, max: now }
  }
  if (v === 'thisyear') {
    const start = new Date(new Date().getFullYear(), 0, 1).getTime()
    return { field, op: 'range', min: start, max: now }
  }
  const last = /^last(\d+)days?$/.exec(v)
  if (last) {
    const n = Number(last[1])
    return { field, op: 'range', min: now - n * 86400000, max: now }
  }
  const opM = /^(<=|>=|<|>)(.+)$/.exec(v)
  if (opM) {
    const t = Date.parse(opM[2]!)
    if (!Number.isFinite(t)) return null
    const op = opM[1] === '>' ? 'gt' : opM[1] === '<' ? 'lt' : opM[1] === '>=' ? 'ge' : 'le'
    return { field, op, ms: t }
  }
  const t = Date.parse(v)
  if (Number.isFinite(t)) return { field, op: 'ge', ms: t }
  return null
}

function tokenize(input: string): string[] {
  const tokens: string[] = []
  let i = 0
  let inGroup = false
  while (i < input.length) {
    while (i < input.length && /\s/.test(input[i]!)) i++
    if (i >= input.length) break
    if (input[i] === '"') {
      i++
      let s = ''
      while (i < input.length && input[i] !== '"') {
        s += input[i]
        i++
      }
      if (i < input.length && input[i] === '"') i++
      tokens.push(`"${s}"`)
      continue
    }
    if (input[i] === '|' ) {
      tokens.push('|')
      i++
      continue
    }
    // Grouping: `<` … `>` — but keep `>` inside `size:>1mb` (after `:`).
    if (input[i] === '<' && !inGroup) {
      tokens.push('<')
      inGroup = true
      i++
      continue
    }
    if (input[i] === '>' && inGroup) {
      tokens.push('>')
      inGroup = false
      i++
      continue
    }
    let s = ''
    while (i < input.length && !/\s/.test(input[i]!) && input[i] !== '|') {
      if (input[i] === '"' && s.includes(':')) {
        i++
        s += '"'
        while (i < input.length && input[i] !== '"') {
          s += input[i]
          i++
        }
        if (i < input.length && input[i] === '"') {
          s += '"'
          i++
        }
        continue
      }
      if (input[i] === '<' && !inGroup) {
        // Comparison ops inside function values (depth:<=2) — not group delimiters
        if (s.length === 0 || s[s.length - 1] !== ':') break
      }
      if (input[i] === '>' && inGroup) break
      s += input[i]
      i++
    }
    if (s) tokens.push(s)
  }
  return tokens
}

function toTextPred(raw: string, q: StructuredQuery): TextPred {
  let value = raw
  if (value.startsWith('"') && value.endsWith('"')) {
    value = value.slice(1, -1)
    return { kind: 'exact', value }
  }
  if (q.regex || value.startsWith('regex:')) {
    const src = value.replace(/^regex:/i, '')
    return { kind: 'regex', source: src, flags: q.matchCase ? '' : 'i' }
  }
  if (value.includes('*') || value.includes('?')) return { kind: 'glob', value }
  if (/^\.[^.*?"<>|\\/]+$/.test(value)) return { kind: 'glob', value: `*${value}` }
  return { kind: 'substr', value, wholeWord: q.wholeWord }
}

function unquoteFnValue(raw: string): string {
  const v = raw.trim()
  if (v.length >= 2 && v.startsWith('"') && v.endsWith('"')) return v.slice(1, -1)
  return v
}

function applyFunction(q: StructuredQuery, key: string, val: string, macros: Record<string, string[]>): void {
  q.advanced = true
  const k = key.toLowerCase()
  const v = unquoteFnValue(val)

  if (k === 'size') {
    const named = SIZE_NAMES[v.toLowerCase()]
    if (named) {
      q.size = { op: 'range', min: named[0], max: named[1] }
      return
    }
    const opM = /^(<=|>=|<|>)?(.+)$/.exec(v)
    if (opM) {
      const bytes = parseSizeBytes(opM[2]!)
      if (bytes != null) {
        const prefix = opM[1] || ''
        const op =
          prefix === '>' ? 'gt' : prefix === '<' ? 'lt' : prefix === '>=' ? 'ge' : prefix === '<=' ? 'le' : 'eq'
        q.size = { op, bytes }
      }
    }
    return
  }
  if (k === 'dm' || k === 'datemodified') {
    const d = parseDateToken('mtime', v)
    if (d) q.dates.push(d)
    return
  }
  if (k === 'dc' || k === 'datecreated') {
    const d = parseDateToken('ctime', v)
    if (d) q.dates.push(d)
    return
  }
  if (k === 'ext') {
    q.exts.push(
      ...v
        .split(/[;,]/)
        .map((x) => x.replace(/^\./, '').trim().toLowerCase())
        .filter(Boolean)
    )
    return
  }
  if (k === 'parent' || k === 'infolder') {
    if (k === 'parent') q.parentName = v
    else q.infolder = v
    return
  }
  if (k === 'startwith') {
    q.textGroups.push([{ kind: 'startwith', value: v }])
    return
  }
  if (k === 'endwith') {
    q.textGroups.push([{ kind: 'endwith', value: v }])
    return
  }
  if (k === 'len') {
    const m = /^(<=|>=|<|>)?(\d+)$/.exec(v)
    if (m) {
      const n = Number(m[2])
      const p = m[1] || ''
      if (p === '>' || p === '>=') q.lenMin = n + (p === '>' ? 1 : 0)
      else if (p === '<' || p === '<=') q.lenMax = n - (p === '<' ? 1 : 0)
      else {
        q.lenMin = n
        q.lenMax = n
      }
    }
    return
  }
  if (k === 'empty') {
    q.empty = v === '' || v === '1' || v.toLowerCase() === 'true' || v.toLowerCase() === 'yes'
    return
  }
  if (k === 'count') {
    const n = Number(v)
    if (Number.isFinite(n) && n > 0) q.countLimit = Math.floor(n)
    return
  }
  if (k === 'attrib' || k === 'attributes') {
    q.attrib = q.attrib ?? {}
    for (const ch of v.toLowerCase()) {
      if (ch === 'h') q.attrib.hidden = true
      if (ch === 's') q.attrib.system = true
      if (ch === 'r') q.attrib.readonly = true
      if (ch === 'a') q.attrib.archive = true
    }
    return
  }
  if (k === 'depth') {
    const m = /^(<=|>=|<|>)?(\d+)$/.exec(v)
    if (m) {
      const n = Number(m[2])
      const p = m[1] || ''
      if (p === '>' || p === '>=') q.depthMin = n + (p === '>' ? 1 : 0)
      else if (p === '<' || p === '<=') q.depthMax = n - (p === '<' ? 1 : 0)
      else {
        q.depthMin = n
        q.depthMax = n
      }
    }
    return
  }
  if (k === 'child') {
    q.childName = v
    return
  }
  if (k === 'childcount') {
    const m = /^(<=|>=|<|>)?(\d+)$/.exec(v)
    if (m) {
      const n = Number(m[2])
      const p = m[1] || ''
      if (p === '>' || p === '>=') q.childCountMin = n + (p === '>' ? 1 : 0)
      else if (p === '<' || p === '<=') q.childCountMax = n - (p === '<' ? 1 : 0)
      else {
        q.childCountMin = n
        q.childCountMax = n
      }
    }
    return
  }
  if (k === 'dupe') {
    q.dupe = 'name'
    return
  }
  if (k === 'sizedupe') {
    q.dupe = 'size'
    return
  }
  if (k === 'namepartdupe') {
    q.dupe = 'namepart'
    return
  }
  if (k === 'content') {
    q.content = v
    q.contentUtf8 = false
    return
  }
  if (k === 'utf8content') {
    q.content = v
    q.contentUtf8 = true
    return
  }
  if (k === 'note') {
    const t = v.trim()
    if (t) q.noteText = t
    else q.hasNote = true
    return
  }
  if (k === 'hasnote') {
    q.hasNote = true
    return
  }
  if (k === 'notestatus') {
    const t = v.trim()
    if (t) q.noteStatus = t
    else q.hasNote = true
    return
  }
  if (k === 'todo') {
    q.openTodo = true
    const t = v.trim()
    q.openTodoNeedle = t || null
    return
  }
  if (k === 'path') {
    q.pathContains.push(v)
    q.matchPath = true
    return
  }
  if (k === 'nopath') {
    q.excludePathContains.push(v)
    return
  }

  const macroExts = macros[k] ?? MACROS[k]
  if (macroExts) {
    q.exts.push(...macroExts)
  }
}

function pushExcludeExts(q: StructuredQuery, raw: string): void {
  const parts = raw
    .split(/[;,]/)
    .map((x) => x.replace(/^\./, '').trim().toLowerCase())
    .filter(Boolean)
  if (parts.length) q.excludeExts.push(...parts)
}

function applyExcludeFunction(q: StructuredQuery, key: string, val: string, macros: Record<string, string[]>): void {
  q.advanced = true
  const k = key.toLowerCase()
  if (k === 'ext') {
    pushExcludeExts(q, val)
    return
  }
  if (k === 'hasnote' || (k === 'note' && !val.trim())) {
    q.excludeHasNote = true
    return
  }
  const macroExts = macros[k] ?? MACROS[k]
  if (macroExts) {
    q.excludeExts.push(...macroExts)
  }
}

export function parseEverythingQuery(input: string, opts: ParseOptions = {}): StructuredQuery {
  const trimmed = input.trim()
  if (!trimmed) return emptyQuery(opts)
  if (isBasicNameQuery(trimmed)) {
    return parseBasicNameQuery(trimmed, opts)
  }

  const q = emptyQuery(opts)
  const macros = { ...MACROS, ...(opts.customMacros ?? {}) }
  const tokens = tokenize(trimmed)
  if (tokens.length === 0) return q

  let orGroup: TextPred[] = []
  const flushOr = (): void => {
    if (orGroup.length) {
      q.textGroups.push(orGroup)
      orGroup = []
    }
  }

  let i = 0
  while (i < tokens.length) {
    const t = tokens[i]!

    if (t === '|') {
      i++
      continue
    }
    if (t === '<') {
      // grouping: collect until '>' as OR of text
      i++
      const group: TextPred[] = []
      while (i < tokens.length && tokens[i] !== '>') {
        const g = tokens[i]!
        if (g === '|') {
          i++
          continue
        }
        group.push(toTextPred(g, q))
        i++
      }
      if (i < tokens.length && tokens[i] === '>') i++
      if (group.length) q.textGroups.push(group)
      q.advanced = true
      continue
    }
    if (t === '>') {
      i++
      continue
    }

    // modifiers
    const mod = /^(case|nocase|path|nopath|file|folder|regex|ww|wholeword|noww):(.*)$/i.exec(t)
    if (mod) {
      const m = mod[1]!.toLowerCase()
      const rest = mod[2] ?? ''
      if ((m === 'path' || m === 'nopath') && rest) {
        applyFunction(q, m, rest, macros)
        i++
        if (tokens[i] !== '|') flushOr()
        continue
      }
      q.advanced = true
      if (m === 'case') q.matchCase = true
      else if (m === 'nocase') q.matchCase = false
      else if (m === 'path') {
        q.matchPath = true
        if (rest) orGroup.push(toTextPred(rest, q))
      } else if (m === 'nopath') q.matchPath = false
      else if (m === 'file') q.fileOnly = true
      else if (m === 'folder') q.folderOnly = true
      else if (m === 'regex') {
        q.regex = true
        if (rest) orGroup.push({ kind: 'regex', source: rest, flags: q.matchCase ? '' : 'i' })
      } else if (m === 'ww' || m === 'wholeword') {
        q.wholeWord = true
        if (rest) orGroup.push({ kind: 'substr', value: rest, wholeWord: true })
      } else if (m === 'noww') q.wholeWord = false
      i++
      // peek OR
      if (tokens[i] === '|') {
        /* stay in or group */
      } else {
        flushOr()
      }
      continue
    }

    // bare drive path token: d: or d:\foo
    if (/^[a-zA-Z]:\\?/i.test(t) && !t.includes(':', 2)) {
      q.advanced = true
      let prefix = t
      if (/^[a-zA-Z]:$/i.test(prefix)) prefix += '\\'
      q.pathPrefixes.push(prefix)
      i++
      flushOr()
      continue
    }
    if (/^[a-zA-Z]:\\.+/.test(t)) {
      q.advanced = true
      q.pathPrefixes.push(t.endsWith('\\') ? t : t + '\\')
      i++
      flushOr()
      continue
    }

    // function: key:value — only known Everything operators (not arbitrary name.ext tokens)
    const fn = /^([a-zA-Z][a-zA-Z0-9_]*):(.*)$/.exec(t)
    if (fn && !['http', 'https', 'file'].includes(fn[1]!.toLowerCase()) && isKnownQueryFn(fn[1]!, macros)) {
      const key = fn[1]!
      const val = fn[2] ?? ''
      if (key.toLowerCase() === 'regex' && val) {
        q.regex = true
        orGroup.push({ kind: 'regex', source: val, flags: q.matchCase ? '' : 'i' })
        q.advanced = true
      } else {
        applyFunction(q, key, val, macros)
      }
      i++
      if (tokens[i] !== '|') flushOr()
      continue
    }

    // NOT — `!ext:jpg` / `!pic:` exclude extensions; other `!token` excludes name/path text
    if (t.startsWith('!') && t.length > 1) {
      q.advanced = true
      const rest = t.slice(1)
      const fn = /^([a-zA-Z][a-zA-Z0-9_]*):(.*)$/.exec(rest)
      if (fn && !['http', 'https', 'file'].includes(fn[1]!.toLowerCase()) && isKnownQueryFn(fn[1]!, macros)) {
        applyExcludeFunction(q, fn[1]!, fn[2] ?? '', macros)
      } else {
        q.notText.push(toTextPred(rest, q))
      }
      i++
      flushOr()
      continue
    }

    // plain / quoted text — OR with following |
    orGroup.push(toTextPred(t, q))
    i++
    if (tokens[i] === '|') {
      i++
      continue
    }
    flushOr()
  }
  flushOr()
  finalizeBasicNameSearch(q, trimmed)
  return q
}

/** Match a single TextPred against a string. */
export function matchTextPred(pred: TextPred, text: string, matchCase: boolean): boolean {
  const hay = matchCase ? text : text.toLowerCase()
  switch (pred.kind) {
    case 'substr': {
      const needle = matchCase ? pred.value : pred.value.toLowerCase()
      if (pred.wholeWord) {
        const re = new RegExp(
          `(?:^|[^\\w])${needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:$|[^\\w])`,
          matchCase ? '' : 'i'
        )
        return re.test(text)
      }
      return hay.includes(needle)
    }
    case 'exact':
      return matchCase ? text === pred.value : hay === pred.value.toLowerCase()
    case 'startwith':
      return matchCase
        ? text.startsWith(pred.value)
        : hay.startsWith(pred.value.toLowerCase())
    case 'endwith':
      return matchCase ? text.endsWith(pred.value) : hay.endsWith(pred.value.toLowerCase())
    case 'glob': {
      let src = '^'
      for (const ch of pred.value) {
        if (ch === '*') src += '.*'
        else if (ch === '?') src += '.'
        else if (/[.+^${}()|[\]\\]/.test(ch)) src += `\\${ch}`
        else src += ch
      }
      src += '$'
      return new RegExp(src, matchCase ? '' : 'i').test(text)
    }
    case 'regex':
      try {
        return new RegExp(pred.source, pred.flags).test(text)
      } catch {
        return false
      }
  }
}

export function matchTextGroups(
  groups: TextPred[][],
  name: string,
  fullPath: string,
  matchPath: boolean,
  matchCase: boolean
): boolean {
  if (groups.length === 0) return true
  const targets = matchPath ? [name, fullPath] : [name]
  return groups.every((group) =>
    group.some((pred) => targets.some((t) => matchTextPred(pred, t, matchCase)))
  )
}

export function depthFromRoot(fullPath: string, rootPrefix: string | null): number {
  const n = fullPath.replace(/\//g, '\\').replace(/\\+$/, '')
  const base = (rootPrefix ?? '').replace(/\//g, '\\').replace(/\\+$/, '')
  const rest = base && n.toLowerCase().startsWith(base.toLowerCase() + '\\')
    ? n.slice(base.length + 1)
    : n.includes(':\\')
      ? n.slice(n.indexOf(':\\') + 2)
      : n
  if (!rest) return 0
  return rest.split('\\').filter(Boolean).length
}

export function rowMatchesStructured(
  row: {
    path: string
    name: string
    size: number
    mtimeMs: number
    isDir: boolean
    attrs?: number | null
  },
  q: StructuredQuery,
  opts?: { rootPrefix?: string | null; childCount?: number }
): boolean {
  if (q.fileOnly && row.isDir) return false
  if (q.folderOnly && !row.isDir) return false

  // Never match the whole corpus. Exclude-only / empty / file:-only → no hits.
  if (!queryHasPositiveConstraint(q)) {
    return false
  }

  const ext = row.isDir
    ? ''
    : row.name.includes('.')
      ? row.name.slice(row.name.lastIndexOf('.') + 1).toLowerCase()
      : ''

  if (q.exts.length) {
    if (row.isDir || !q.exts.includes(ext)) return false
  }
  if (q.excludeExts.length && !row.isDir && q.excludeExts.includes(ext)) return false

  for (const p of q.pathPrefixes) {
    if (!row.path.toLowerCase().startsWith(p.toLowerCase())) return false
  }
  for (const c of q.pathContains) {
    if (!row.path.toLowerCase().includes(c.toLowerCase())) return false
  }
  for (const c of q.excludePathContains) {
    if (row.path.toLowerCase().includes(c.toLowerCase())) return false
  }

  if (!matchTextGroups(q.textGroups, row.name, row.path, q.matchPath, q.matchCase)) {
    return false
  }
  for (const n of q.notText) {
    const targets = q.matchPath ? [row.name, row.path] : [row.name]
    if (targets.some((t) => matchTextPred(n, t, q.matchCase))) return false
  }

  if (q.size) {
    if (q.size.op === 'range') {
      if (row.size < q.size.min || row.size > q.size.max) return false
    } else {
      const b = q.size.bytes
      if (q.size.op === 'eq' && row.size !== b) return false
      if (q.size.op === 'gt' && !(row.size > b)) return false
      if (q.size.op === 'lt' && !(row.size < b)) return false
      if (q.size.op === 'ge' && !(row.size >= b)) return false
      if (q.size.op === 'le' && !(row.size <= b)) return false
    }
  }

  for (const d of q.dates) {
    // ctime not stored — approximate with mtime
    const ms = row.mtimeMs
    if (d.op === 'range') {
      if (ms < d.min || ms > d.max) return false
    } else {
      if (d.op === 'eq' && ms !== d.ms) return false
      if (d.op === 'gt' && !(ms > d.ms)) return false
      if (d.op === 'lt' && !(ms < d.ms)) return false
      if (d.op === 'ge' && !(ms >= d.ms)) return false
      if (d.op === 'le' && !(ms <= d.ms)) return false
    }
  }

  if (q.empty != null) {
    if (q.empty && row.size !== 0) return false
    if (!q.empty && row.size === 0) return false
  }
  if (q.lenMin != null && row.name.length < q.lenMin) return false
  if (q.lenMax != null && row.name.length > q.lenMax) return false

  if (q.parentName) {
    const parts = row.path.replace(/\//g, '\\').split('\\')
    const parent = parts[parts.length - 2] ?? ''
    if (parent.toLowerCase() !== q.parentName.toLowerCase()) return false
  }
  if (q.infolder) {
    if (!row.path.toLowerCase().includes('\\' + q.infolder.toLowerCase() + '\\') &&
        !row.path.toLowerCase().endsWith('\\' + q.infolder.toLowerCase())) {
      return false
    }
  }

  if (q.depthMin != null || q.depthMax != null) {
    const depth = depthFromRoot(row.path, opts?.rootPrefix ?? null)
    if (q.depthMin != null && depth < q.depthMin) return false
    if (q.depthMax != null && depth > q.depthMax) return false
  }

  if (q.childCountMin != null || q.childCountMax != null) {
    if (!row.isDir) return false
    const cc = opts?.childCount
    if (cc == null) return false
    if (q.childCountMin != null && cc < q.childCountMin) return false
    if (q.childCountMax != null && cc > q.childCountMax) return false
  }

  if (q.attrib && row.attrs != null) {
    const FILE_ATTRIBUTE_READONLY = 0x1
    const FILE_ATTRIBUTE_HIDDEN = 0x2
    const FILE_ATTRIBUTE_SYSTEM = 0x4
    const FILE_ATTRIBUTE_ARCHIVE = 0x20
    if (q.attrib.readonly && !(row.attrs & FILE_ATTRIBUTE_READONLY)) return false
    if (q.attrib.hidden && !(row.attrs & FILE_ATTRIBUTE_HIDDEN)) return false
    if (q.attrib.system && !(row.attrs & FILE_ATTRIBUTE_SYSTEM)) return false
    if (q.attrib.archive && !(row.attrs & FILE_ATTRIBUTE_ARCHIVE)) return false
  }

  return true
}
