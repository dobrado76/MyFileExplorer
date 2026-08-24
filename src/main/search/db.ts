import path from 'node:path'
import { app } from 'electron'
import { DatabaseSync } from 'node:sqlite'
import { logMain } from '../logging'

let db: DatabaseSync | null = null
let ftsAvailable = false

function columnExists(database: DatabaseSync, table: string, column: string): boolean {
  const rows = database.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]
  return rows.some((r) => r.name === column)
}

function migrateRoots(database: DatabaseSync): void {
  if (!columnExists(database, 'roots', 'kind')) {
    database.exec(`ALTER TABLE roots ADD COLUMN kind TEXT NOT NULL DEFAULT 'folder'`)
  }
  if (!columnExists(database, 'roots', 'volume')) {
    database.exec(`ALTER TABLE roots ADD COLUMN volume TEXT`)
  }
  if (!columnExists(database, 'roots', 'monitor')) {
    database.exec(`ALTER TABLE roots ADD COLUMN monitor TEXT NOT NULL DEFAULT 'none'`)
  }
  if (!columnExists(database, 'roots', 'usn_journal_id')) {
    database.exec(`ALTER TABLE roots ADD COLUMN usn_journal_id TEXT`)
  }
  if (!columnExists(database, 'roots', 'usn_next')) {
    database.exec(`ALTER TABLE roots ADD COLUMN usn_next INTEGER NOT NULL DEFAULT 0`)
  }
  if (!columnExists(database, 'files', 'attrs')) {
    database.exec(`ALTER TABLE files ADD COLUMN attrs INTEGER`)
  }
  // Folder roots that were never monitored → watch after migration.
  database.exec(`
    UPDATE roots SET monitor = 'watch'
    WHERE kind = 'folder' AND (monitor IS NULL OR monitor = '' OR monitor = 'none')
  `)
}

export function searchDb(): DatabaseSync {
  if (db) return db
  const file = path.join(app.getPath('userData'), 'search-index.sqlite')
  db = new DatabaseSync(file)
  db.exec('PRAGMA journal_mode = WAL')
  db.exec('PRAGMA foreign_keys = ON')
  db.exec(`
    CREATE TABLE IF NOT EXISTS roots (
      id INTEGER PRIMARY KEY,
      path TEXT NOT NULL UNIQUE,
      kind TEXT NOT NULL DEFAULT 'folder',
      volume TEXT,
      monitor TEXT NOT NULL DEFAULT 'none',
      usn_journal_id TEXT,
      usn_next INTEGER NOT NULL DEFAULT 0,
      added_at TEXT NOT NULL,
      last_indexed_at TEXT,
      status TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS files (
      id INTEGER PRIMARY KEY,
      root_id INTEGER NOT NULL REFERENCES roots(id) ON DELETE CASCADE,
      path TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      ext TEXT,
      size INTEGER NOT NULL DEFAULT 0,
      mtime_ms INTEGER NOT NULL DEFAULT 0,
      is_dir INTEGER NOT NULL DEFAULT 0,
      attrs INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_files_root ON files(root_id);
    CREATE INDEX IF NOT EXISTS idx_files_name ON files(name);
    CREATE INDEX IF NOT EXISTS idx_files_ext ON files(ext);
    CREATE INDEX IF NOT EXISTS idx_files_size ON files(size);
    CREATE TABLE IF NOT EXISTS item_notes (
      path TEXT PRIMARY KEY,
      haystack TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT '',
      open_todo INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_item_notes_open ON item_notes(open_todo);
  `)
  migrateRoots(db)
  try {
    db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS files_fts USING fts5(
        name,
        path,
        content='files',
        content_rowid='id'
      );
      CREATE TRIGGER IF NOT EXISTS files_ai AFTER INSERT ON files BEGIN
        INSERT INTO files_fts(rowid, name, path) VALUES (new.id, new.name, new.path);
      END;
      CREATE TRIGGER IF NOT EXISTS files_ad AFTER DELETE ON files BEGIN
        INSERT INTO files_fts(files_fts, rowid, name, path) VALUES ('delete', old.id, old.name, old.path);
      END;
      CREATE TRIGGER IF NOT EXISTS files_au AFTER UPDATE ON files BEGIN
        INSERT INTO files_fts(files_fts, rowid, name, path) VALUES ('delete', old.id, old.name, old.path);
        INSERT INTO files_fts(rowid, name, path) VALUES (new.id, new.name, new.path);
      END;
    `)
    ftsAvailable = true
  } catch (e) {
    ftsAvailable = false
    logMain('warn', `FTS5 unavailable, falling back to LIKE search: ${String(e)}`)
  }
  return db
}

export function isFtsAvailable(): boolean {
  searchDb()
  return ftsAvailable
}

export type RootDbRow = {
  id: number
  path: string
  kind: string
  volume: string | null
  monitor: string
  usn_journal_id: string | null
  usn_next: number
  added_at: string
  last_indexed_at: string | null
  status: string
}
