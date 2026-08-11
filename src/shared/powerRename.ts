/** Power Rename (PowerToys-inspired) — pure basename transforms for preview/apply. */

export type PowerRenameApplyTo = 'full' | 'name' | 'ext'

export type PowerRenameOptions = {
  search: string
  replace: string
  regex: boolean
  matchAll: boolean
  caseSensitive: boolean
  applyTo: PowerRenameApplyTo
}

export type PowerRenameItem = {
  path: string
  /** Basename including extension when present. */
  name: string
}

export type PowerRenamePreviewRow = {
  path: string
  originalName: string
  newName: string
  /** True when newName differs and is a valid non-empty Windows file name. */
  willRename: boolean
  error?: string
}

const INVALID_NAME_CHARS = /[\\/:*?"<>|]/

function splitName(name: string): { stem: string; ext: string } {
  const base = name
  const dot = base.lastIndexOf('.')
  // No extension, or leading-dot names (`.gitignore`) keep whole string as stem.
  if (dot <= 0 || dot === base.length - 1) return { stem: base, ext: '' }
  return { stem: base.slice(0, dot), ext: base.slice(dot) }
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function flagsFor(
  opts: Pick<PowerRenameOptions, 'matchAll' | 'caseSensitive'>
): string {
  let f = ''
  if (opts.matchAll) f += 'g'
  if (!opts.caseSensitive) f += 'i'
  return f
}

/**
 * Apply search/replace to one string segment.
 * Returns `{ text, error }` — error set when regex is invalid.
 */
export function replaceInText(
  text: string,
  opts: Pick<PowerRenameOptions, 'search' | 'replace' | 'regex' | 'matchAll' | 'caseSensitive'>
): { text: string; error?: string } {
  if (opts.search === '') return { text }
  try {
    const pattern = opts.regex ? opts.search : escapeRegExp(opts.search)
    const re = new RegExp(pattern, flagsFor(opts))
    return { text: text.replace(re, opts.replace) }
  } catch (e) {
    return {
      text,
      error: e instanceof Error ? e.message : 'Invalid regular expression'
    }
  }
}

/** Transform a single basename; does not touch directory paths. */
export function transformBasename(name: string, opts: PowerRenameOptions): {
  newName: string
  error?: string
} {
  if (opts.search === '') return { newName: name }

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
      // Extension without leading dot for replace (PowerToys: extension only).
      if (!ext) return { newName: name }
      prefix = stem + '.'
      target = ext.slice(1)
      break
    case 'full':
    default:
      target = name
      break
  }

  const { text, error } = replaceInText(target, opts)
  if (error) return { newName: name, error }

  let newName = prefix + text + suffix
  if (opts.applyTo === 'ext' && text === '') {
    // Empty extension → stem only (no trailing dot).
    newName = stem
  }

  if (!newName.trim()) {
    return { newName: name, error: 'Resulting name is empty' }
  }
  if (INVALID_NAME_CHARS.test(newName) || newName === '.' || newName === '..') {
    return { newName: name, error: 'Invalid characters in name' }
  }
  if (/[. ]$/.test(newName)) {
    return { newName: name, error: 'Name cannot end with a space or period' }
  }

  return { newName }
}

export function previewPowerRename(
  items: PowerRenameItem[],
  opts: PowerRenameOptions
): PowerRenamePreviewRow[] {
  return items.map((item) => {
    const { newName, error } = transformBasename(item.name, opts)
    const willRename = !error && newName !== item.name
    return {
      path: item.path,
      originalName: item.name,
      newName,
      willRename,
      error
    }
  })
}
