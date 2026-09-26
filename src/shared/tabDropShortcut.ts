import { z } from 'zod'

/** How a tab drop shortcut chooses copy vs move. */
export const dropTransferModeSchema = z.enum(['auto', 'move', 'copy']).catch('auto')
export type DropTransferMode = z.infer<typeof dropTransferModeSchema>

/** Normalized chord string (e.g. `Ctrl+1`), or null when unset. */
export const dropShortcutSchema = z.preprocess((raw) => {
  if (raw == null || raw === '') return null
  if (typeof raw !== 'string') return null
  const t = raw.trim()
  return t.length > 0 ? t.slice(0, 64) : null
}, z.string().max(64).nullable().catch(null))

export type DropShortcut = z.infer<typeof dropShortcutSchema>

/** Fields shared by live tabs, session, and named layouts. */
export const tabDropShortcutFieldsSchema = z.object({
  dropShortcut: dropShortcutSchema,
  dropTransfer: dropTransferModeSchema
})

export type ParsedChord = {
  ctrl: boolean
  shift: boolean
  alt: boolean
  /** Display / compare key token (e.g. `1`, `A`, `F5`, `ArrowLeft`). */
  key: string
}

const MODIFIER_KEYS = new Set([
  'control',
  'ctrl',
  'shift',
  'alt',
  'meta',
  'os',
  'altgraph'
])

/**
 * Built-in explorer shell chords (see ExplorerShell onKeyDown).
 * Tab drop shortcuts must not collide with these.
 */
export const RESERVED_APP_CHORDS: readonly string[] = [
  'Ctrl+Shift+T',
  'Ctrl+T',
  'Ctrl+W',
  'Ctrl+Tab',
  'Alt+ArrowLeft',
  'Alt+ArrowRight',
  'Backspace',
  'F5',
  'Ctrl+R',
  'F2',
  'Ctrl+C',
  'Ctrl+X',
  'Ctrl+Shift+V',
  'Ctrl+V',
  'Ctrl+A',
  'Ctrl+Z',
  'Ctrl+Y',
  'Ctrl+Shift+Z',
  'Delete',
  'Shift+Delete',
  'Ctrl+Delete',
  'Ctrl+Shift+Delete',
  'Ctrl+E',
  'Ctrl+Shift+F',
  'Ctrl+F',
  'Ctrl+Shift+P',
  'Ctrl+L',
  'Enter',
  'Escape'
]

const reservedSet = new Set(RESERVED_APP_CHORDS.map((c) => c.toLowerCase()))

/** Map a KeyboardEvent key to a stable token. */
export function keyTokenFromEventKey(key: string): string | null {
  if (!key || MODIFIER_KEYS.has(key.toLowerCase())) return null
  if (key === ' ') return 'Space'
  if (key.length === 1) {
    const ch = key.toUpperCase()
    // Digits / punctuation stay as typed; letters uppercased.
    return /[a-zA-Z]/.test(ch) ? ch : key
  }
  return key
}

export function parseChord(chord: string): ParsedChord | null {
  const parts = chord
    .split('+')
    .map((p) => p.trim())
    .filter(Boolean)
  if (parts.length === 0) return null
  let ctrl = false
  let shift = false
  let alt = false
  let key: string | null = null
  for (const p of parts) {
    const low = p.toLowerCase()
    if (low === 'ctrl' || low === 'control') ctrl = true
    else if (low === 'shift') shift = true
    else if (low === 'alt') alt = true
    else if (low === 'meta' || low === 'cmd' || low === 'win') {
      /* ignore meta as a binding modifier on Windows explorer */
    } else if (key == null) key = keyTokenFromEventKey(p) ?? p
    else return null
  }
  if (!key) return null
  return { ctrl, shift, alt, key }
}

export function formatChord(parts: ParsedChord): string {
  const out: string[] = []
  if (parts.ctrl) out.push('Ctrl')
  if (parts.shift) out.push('Shift')
  if (parts.alt) out.push('Alt')
  out.push(parts.key)
  return out.join('+')
}

export function normalizeChordString(raw: string): string | null {
  const parsed = parseChord(raw)
  return parsed ? formatChord(parsed) : null
}

/** Build a normalized chord from a keydown event, or null for modifier-only presses. */
export function normalizeChordFromEvent(e: {
  key: string
  ctrlKey: boolean
  shiftKey: boolean
  altKey: boolean
  metaKey?: boolean
}): string | null {
  const key = keyTokenFromEventKey(e.key)
  if (!key) return null
  return formatChord({
    ctrl: e.ctrlKey || e.metaKey === true,
    shift: e.shiftKey,
    alt: e.altKey,
    key
  })
}

export function isReservedAppChord(chord: string): boolean {
  const n = normalizeChordString(chord)
  if (!n) return false
  return reservedSet.has(n.toLowerCase())
}

export function chordHasCtrl(chord: string): boolean {
  return parseChord(chord)?.ctrl === true
}

export function chordHasShift(chord: string): boolean {
  return parseChord(chord)?.shift === true
}

/**
 * Whether an event should fire a tab bound to `boundChord`.
 * Required modifiers on the binding must be held; extra Ctrl/Shift are allowed
 * so Auto mode can force copy/move. Never matches when the full event chord is
 * a reserved app shortcut (e.g. key-only `C` must not steal Ctrl+C).
 */
export function eventMatchesTabDropShortcut(
  boundChord: string,
  e: {
    key: string
    ctrlKey: boolean
    shiftKey: boolean
    altKey: boolean
    metaKey?: boolean
  }
): boolean {
  const bound = normalizeChordString(boundChord)
  if (!bound) return false
  const full = normalizeChordFromEvent(e)
  if (!full) return false
  if (isReservedAppChord(full)) return false

  const b = parseChord(bound)
  if (!b) return false
  const key = keyTokenFromEventKey(e.key)
  if (!key || key.toLowerCase() !== b.key.toLowerCase()) return false
  if (b.alt !== e.altKey) return false
  if (b.ctrl && !(e.ctrlKey || e.metaKey === true)) return false
  if (b.shift && !e.shiftKey) return false
  return true
}

export type TabDropShortcutRef = {
  id: string
  title: string | null
  path: string
  dropShortcut: string | null
}

export type ValidateTabDropShortcutResult =
  | { ok: true; chord: string }
  | { ok: false; reason: string }

export function validateTabDropShortcut(
  rawChord: string | null | undefined,
  tabs: TabDropShortcutRef[],
  exceptTabId: string | null
): ValidateTabDropShortcutResult {
  if (rawChord == null || rawChord.trim() === '') {
    return { ok: false, reason: 'Press a key combination' }
  }
  const chord = normalizeChordString(rawChord)
  if (!chord) return { ok: false, reason: 'Invalid shortcut' }
  if (isReservedAppChord(chord)) {
    return { ok: false, reason: `“${chord}” is already used by the app` }
  }
  const lower = chord.toLowerCase()
  for (const t of tabs) {
    if (!t.dropShortcut) continue
    if (exceptTabId && t.id === exceptTabId) continue
    const other = normalizeChordString(t.dropShortcut)
    if (other && other.toLowerCase() === lower) {
      const label = t.title?.trim() || t.path
      return { ok: false, reason: `“${chord}” is used by tab “${label}”` }
    }
  }
  return { ok: true, chord }
}

/** Ctrl/Shift that should force copy/move for Auto mode (not part of the binding). */
export function autoForceModifiers(
  boundChord: string,
  e: { ctrlKey: boolean; shiftKey: boolean; metaKey?: boolean }
): { forceCopy: boolean; forceMove: boolean } {
  const b = parseChord(boundChord)
  const forceCopy = (e.ctrlKey || e.metaKey === true) && !b?.ctrl
  const forceMove = e.shiftKey && !b?.shift
  return { forceCopy, forceMove }
}

export function labelDropTransfer(mode: DropTransferMode): string {
  if (mode === 'move') return 'move'
  if (mode === 'copy') return 'copy'
  return 'auto'
}
