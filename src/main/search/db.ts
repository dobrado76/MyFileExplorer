import path from 'node:path'
import { app } from 'electron'
import { DatabaseSync } from 'node:sqlite'
import { logMain } from '../logging'

let db: DatabaseSync | null = null
let ftsAvailable = false

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
      is_dir INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_files_root ON files(root_id);
  `)
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
