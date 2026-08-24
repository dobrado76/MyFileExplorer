import type { ItemNote } from '@shared/schemas/itemAds'
import {
  itemNoteIsPresent,
  itemNoteOpenTodos,
  itemNoteSearchHaystack
} from '@shared/noteSearch'
import { searchDb } from './db'
import type { DatabaseSync } from 'node:sqlite'

function ensureNoteTable(database: DatabaseSync): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS item_notes (
      path TEXT PRIMARY KEY,
      haystack TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT '',
      open_todo INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_item_notes_open ON item_notes(open_todo);
  `)
}

/** Catalog a note in the search DB (userData only — never writes ADS). */
export function upsertNoteIndex(filePath: string, note: ItemNote | null): void {
  try {
    const db = searchDb()
    ensureNoteTable(db)
    if (!note || !itemNoteIsPresent(note)) {
      db.prepare('DELETE FROM item_notes WHERE path = ?').run(filePath)
      return
    }
    db.prepare(
      `INSERT INTO item_notes(path, haystack, status, open_todo) VALUES (?, ?, ?, ?)
       ON CONFLICT(path) DO UPDATE SET
         haystack = excluded.haystack,
         status = excluded.status,
         open_todo = excluded.open_todo`
    ).run(
      filePath,
      itemNoteSearchHaystack(note),
      (note?.status ?? '').trim(),
      itemNoteOpenTodos(note).length > 0 ? 1 : 0
    )
  } catch {
    /* search index is optional */
  }
}

export function noteIndexReady(): boolean {
  try {
    const db = searchDb()
    ensureNoteTable(db)
    return true
  } catch {
    return false
  }
}
