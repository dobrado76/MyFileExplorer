import { ITEM_NOTE_STREAM, parseItemNote } from '@shared/schemas/itemAds'
import {
  noteFilterActive,
  noteRecordMatches,
  type NoteSearchFilter
} from '@shared/noteSearch'
import { readStreamText, streamExists } from '../fs/adsWin32'
import type { StructuredQuery } from './everythingQuery'

export function noteFilterFromQuery(q: StructuredQuery): NoteSearchFilter | null {
  const f: NoteSearchFilter = {
    hasNote: q.hasNote,
    excludeHasNote: q.excludeHasNote,
    noteText: q.noteText,
    noteStatus: q.noteStatus,
    openTodo: q.openTodo,
    openTodoNeedle: q.openTodoNeedle
  }
  return noteFilterActive(f) ? f : null
}

/** Read-only ADS check. Does not write streams or change host $DATA times. */
export async function pathMatchesNoteFilter(
  filePath: string,
  q: StructuredQuery
): Promise<boolean> {
  const f = noteFilterFromQuery(q)
  if (!f) return true
  if (process.platform !== 'win32') return false
  try {
    if (!streamExists(filePath, ITEM_NOTE_STREAM)) {
      return noteRecordMatches(null, f)
    }
    const note = parseItemNote(await readStreamText(filePath, ITEM_NOTE_STREAM))
    return noteRecordMatches(note, f)
  } catch {
    return noteRecordMatches(null, f)
  }
}

export async function filterItemsByNote<T extends { path: string }>(
  items: T[],
  q: StructuredQuery
): Promise<T[]> {
  if (!noteFilterFromQuery(q)) return items
  const out: T[] = []
  for (const it of items) {
    if (await pathMatchesNoteFilter(it.path, q)) out.push(it)
  }
  return out
}
