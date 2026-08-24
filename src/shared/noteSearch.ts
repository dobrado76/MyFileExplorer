import type { ItemNote } from './schemas/itemAds'

export type NoteSearchFilter = {
  hasNote: boolean
  excludeHasNote: boolean
  noteText: string | null
  noteStatus: string | null
  openTodo: boolean
  openTodoNeedle: string | null
}

export function itemNoteIsPresent(note: ItemNote | null | undefined): boolean {
  if (!note) return false
  return Boolean(
    note.text.trim() ||
      note.status?.trim() ||
      note.checklist?.some((c) => c.text.trim())
  )
}

export type NoteChecklistColumnItem = { text: string; done: boolean }

export function itemNoteChecklistItems(
  note: ItemNote | null | undefined
): NoteChecklistColumnItem[] {
  return (note?.checklist ?? [])
    .map((c) => ({ text: c.text.trim(), done: c.done }))
    .filter((c) => c.text.length > 0)
}

/** Compact JSON for the Details Checklist column (parse in the renderer for strike). */
export function encodeNoteChecklistColumn(items: NoteChecklistColumnItem[]): string {
  if (items.length === 0) return ''
  return JSON.stringify(items.map((i) => ({ t: i.text, d: i.done })))
}

export function parseNoteChecklistColumn(raw: string): NoteChecklistColumnItem[] {
  const s = raw.trim()
  if (!s) return []
  try {
    const v = JSON.parse(s) as unknown
    if (!Array.isArray(v)) return []
    const out: NoteChecklistColumnItem[] = []
    for (const row of v) {
      if (!row || typeof row !== 'object') continue
      const t = typeof (row as { t?: unknown }).t === 'string' ? (row as { t: string }).t.trim() : ''
      if (!t) continue
      out.push({ text: t, done: (row as { d?: unknown }).d === true })
    }
    return out
  } catch {
    return s
      .split(';')
      .map((t) => t.trim())
      .filter(Boolean)
      .map((text) => ({ text, done: false }))
  }
}

export function noteChecklistPlainText(items: NoteChecklistColumnItem[]): string {
  return items.map((i) => i.text).join('; ')
}

export function itemNoteOpenTodos(note: ItemNote | null | undefined): string[] {
  return (note?.checklist ?? [])
    .filter((c) => !c.done && c.text.trim())
    .map((c) => c.text.trim())
}

export function itemNoteSearchHaystack(note: ItemNote): string {
  const parts = [note.text, note.status ?? '', ...(note.checklist ?? []).map((c) => c.text)]
  return parts.join('\n').toLowerCase()
}

export function noteFilterActive(f: NoteSearchFilter | null | undefined): boolean {
  if (!f) return false
  return Boolean(
    f.hasNote ||
      f.excludeHasNote ||
      f.noteText ||
      f.noteStatus ||
      f.openTodo
  )
}

export function noteRecordMatches(note: ItemNote | null, f: NoteSearchFilter): boolean {
  const present = itemNoteIsPresent(note)
  if (f.hasNote && !present) return false
  if (f.excludeHasNote && present) return false
  if (f.noteText) {
    if (!note || !itemNoteSearchHaystack(note).includes(f.noteText.toLowerCase())) return false
  }
  if (f.noteStatus) {
    if (!(note?.status ?? '').toLowerCase().includes(f.noteStatus.toLowerCase())) return false
  }
  if (f.openTodo) {
    const open = itemNoteOpenTodos(note)
    if (open.length === 0) return false
    if (f.openTodoNeedle) {
      const n = f.openTodoNeedle.toLowerCase()
      if (!open.some((t) => t.toLowerCase().includes(n))) return false
    }
  }
  return true
}
