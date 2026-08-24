import { powerSearchStateSchema } from './schemas/search'

/** Visual power-search builder → Everything-style query string. */

export type PowerSearchScope = 'indexed' | 'folder'

export type PowerSearchItemKind = 'any' | 'file' | 'folder'

export type PowerSearchDupe = '' | 'name' | 'size' | 'namepart'

export type PowerSearchState = {
  /** Free-text name/path terms (space = AND). */
  terms: string
  /** Exclude terms (mapped to !token). */
  exclude: string
  /** Exclude extensions (mapped to !ext:). */
  excludeExtensions: string
  itemKind: PowerSearchItemKind
  /** Macro ids: pic, video, audio, doc, exe, zip */
  types: string[]
  sizePreset: '' | 'empty' | 'tiny' | 'small' | 'medium' | 'large' | 'huge' | 'custom'
  sizeCustom: string
  dateModified: '' | 'today' | 'yesterday' | 'thisweek' | 'thismonth' | 'custom'
  dateCustom: string
  extensions: string
  inFolder: string
  parentName: string
  pathContains: string
  pathPrefix: string
  startsWith: string
  endsWith: string
  attributes: Array<'h' | 's' | 'r' | 'a'>
  emptyOnly: boolean
  content: string
  noteText: string
  noteStatus: string
  hasNote: boolean
  openTodos: boolean
  dupe: PowerSearchDupe
  childName: string
  depth: string
}

export const TYPE_MACRO_OPTIONS = [
  { id: 'pic', label: 'Pictures', token: 'pic:' },
  { id: 'video', label: 'Videos', token: 'video:' },
  { id: 'audio', label: 'Audio', token: 'audio:' },
  { id: 'doc', label: 'Documents', token: 'doc:' },
  { id: 'exe', label: 'Programs', token: 'exe:' },
  { id: 'zip', label: 'Archives', token: 'zip:' }
] as const

export const SIZE_PRESET_OPTIONS = [
  { id: '' as const, label: 'Any size' },
  { id: 'empty' as const, label: 'Empty (0 bytes)', token: 'empty:' },
  { id: 'tiny' as const, label: 'Tiny (<10 KB)', token: 'size:tiny' },
  { id: 'small' as const, label: 'Small (10 KB–100 KB)', token: 'size:small' },
  { id: 'medium' as const, label: 'Medium (100 KB–1 MB)', token: 'size:medium' },
  { id: 'large' as const, label: 'Large (1 MB–128 MB)', token: 'size:large' },
  { id: 'huge' as const, label: 'Huge (>128 MB)', token: 'size:huge' },
  { id: 'custom' as const, label: 'Custom…' }
]

export const DATE_MODIFIED_OPTIONS = [
  { id: '' as const, label: 'Any date' },
  { id: 'today' as const, label: 'Modified today', token: 'dm:today' },
  { id: 'yesterday' as const, label: 'Modified yesterday', token: 'dm:yesterday' },
  { id: 'thisweek' as const, label: 'Modified this week', token: 'dm:thisweek' },
  { id: 'thismonth' as const, label: 'Modified this month', token: 'dm:thismonth' },
  { id: 'custom' as const, label: 'Custom…' }
]

export const DUPE_OPTIONS = [
  { id: '' as const, label: 'No duplicate filter' },
  { id: 'name' as const, label: 'Duplicate file names', token: 'dupe:' },
  { id: 'size' as const, label: 'Duplicate sizes', token: 'sizedupe:' },
  { id: 'namepart' as const, label: 'Similar name parts', token: 'namepartdupe:' }
]

export const ATTRIBUTE_OPTIONS = [
  { id: 'h' as const, label: 'Hidden' },
  { id: 's' as const, label: 'System' },
  { id: 'r' as const, label: 'Read-only' },
  { id: 'a' as const, label: 'Archive' }
]

export function sanitizePowerSearchState(raw: unknown): PowerSearchState {
  const parsed = powerSearchStateSchema.safeParse(raw)
  return parsed.success ? { ...defaultPowerSearchState(), ...parsed.data } : defaultPowerSearchState()
}

export function defaultPowerSearchState(): PowerSearchState {
  return {
    terms: '',
    exclude: '',
    excludeExtensions: '',
    itemKind: 'any',
    types: [],
    sizePreset: '',
    sizeCustom: '',
    dateModified: '',
    dateCustom: '',
    extensions: '',
    inFolder: '',
    parentName: '',
    pathContains: '',
    pathPrefix: '',
    startsWith: '',
    endsWith: '',
    attributes: [],
    emptyOnly: false,
    content: '',
    noteText: '',
    noteStatus: '',
    hasNote: false,
    openTodos: false,
    dupe: '',
    childName: '',
    depth: ''
  }
}

function quoteToken(raw: string): string {
  const s = raw.trim()
  if (!s) return ''
  if (/[\s|<>!"']/.test(s)) return `"${s.replace(/"/g, '\\"')}"`
  return s
}

function pushParts(out: string[], part: string | undefined): void {
  const p = part?.trim()
  if (p) out.push(p)
}

/** Build an Everything-style query from visual builder state. */
export function buildSearchQuery(state: PowerSearchState): string {
  const out: string[] = []

  if (state.itemKind === 'file') out.push('file:')
  else if (state.itemKind === 'folder') out.push('folder:')

  for (const id of state.types) {
    const macro = TYPE_MACRO_OPTIONS.find((m) => m.id === id)
    if (macro) out.push(macro.token)
  }

  for (const word of state.terms.trim().split(/\s+/).filter(Boolean)) {
    out.push(quoteToken(word))
  }

  for (const word of state.exclude.trim().split(/\s+/).filter(Boolean)) {
    out.push(`!${quoteToken(word)}`)
  }

  if (state.extensions.trim()) {
    const exts = state.extensions
      .split(/[;,]/)
      .map((e) => e.replace(/^\./, '').trim())
      .filter(Boolean)
      .join(';')
    if (exts) out.push(`ext:${exts}`)
  }

  if (state.excludeExtensions.trim()) {
    const exts = state.excludeExtensions
      .split(/[;,]/)
      .map((e) => e.replace(/^\./, '').trim())
      .filter(Boolean)
      .join(';')
    if (exts) out.push(`!ext:${exts}`)
  }

  if (state.sizePreset === 'custom' && state.sizeCustom.trim()) {
    const raw = state.sizeCustom.trim()
    out.push(raw.startsWith('size:') ? raw : `size:${raw}`)
  } else if (state.sizePreset === 'empty') out.push('empty:')
  else if (state.sizePreset) {
    const preset = SIZE_PRESET_OPTIONS.find((o) => o.id === state.sizePreset)
    if (preset && 'token' in preset && preset.token) out.push(preset.token)
  }

  if (state.dateModified === 'custom' && state.dateCustom.trim()) {
    const raw = state.dateCustom.trim()
    out.push(raw.startsWith('dm:') ? raw : `dm:${raw}`)
  } else if (state.dateModified) {
    const preset = DATE_MODIFIED_OPTIONS.find((o) => o.id === state.dateModified)
    if (preset && 'token' in preset && preset.token) out.push(preset.token)
  }

  pushParts(out, state.inFolder ? `infolder:${quoteToken(state.inFolder)}` : '')
  pushParts(out, state.parentName ? `parent:${quoteToken(state.parentName)}` : '')
  pushParts(out, state.pathContains ? `path:${quoteToken(state.pathContains)}` : '')
  if (state.pathPrefix.trim()) {
    let p = state.pathPrefix.trim()
    if (/^[a-zA-Z]:$/i.test(p)) p += '\\'
    out.push(quoteToken(p))
  }
  pushParts(out, state.startsWith ? `startwith:${quoteToken(state.startsWith)}` : '')
  pushParts(out, state.endsWith ? `endwith:${quoteToken(state.endsWith)}` : '')

  if (state.attributes.length > 0) out.push(`attrib:${state.attributes.join('')}`)

  if (state.emptyOnly) out.push('empty:')

  if (state.content.trim()) {
    out.push(`content:${quoteToken(state.content)}`)
  }

  if (state.noteText.trim()) {
    out.push(`note:${quoteToken(state.noteText)}`)
  } else if (state.hasNote) {
    out.push('hasnote:')
  }
  if (state.noteStatus.trim()) {
    out.push(`notestatus:${quoteToken(state.noteStatus)}`)
  }
  if (state.openTodos) {
    out.push('todo:')
  }

  if (state.dupe) {
    const d = DUPE_OPTIONS.find((o) => o.id === state.dupe)
    if (d && 'token' in d && d.token) out.push(d.token)
  }

  pushParts(out, state.childName ? `child:${quoteToken(state.childName)}` : '')
  if (state.depth.trim()) {
    const raw = state.depth.trim()
    out.push(raw.startsWith('depth:') ? raw : `depth:${raw}`)
  }

  return out.join(' ').trim()
}
