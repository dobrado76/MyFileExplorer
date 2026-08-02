# Search & indexing

**Version:** 0.0.0 (spec)

Two speeds:

1. **Indexed** — folders the user marks; SQLite FTS5 under userData
2. **Live walk** — anywhere else; slower; progress + cancel required (D15)

---

## Marking folders

- Context menu on a directory: **Add to search index** / **Remove from search index**
- Settings lists indexed roots with status: `idle | indexing | ready | error`
- Nested roots: if user indexes `D:\A` and `D:\A\B`, indexer should dedupe (prefer deepest-only or parent-covers-child — **choose parent-covers-child**: skip adding child if parent already indexed; warn in UI)

Exclude directory **names** from crawl (settings): default `node_modules`, `.git`, `.hg`, `.svn`.

---

## Indexer

- Background job in main
- Walk root recursively; upsert file rows; remove missing paths on reindex
- Triggers: manual Reindex; optional FS watch debounce on indexed roots (Phase 9+)
- Progress events: `index-progress`
- Persistence: `search-index.sqlite` ([PROJECT_FORMAT.md](PROJECT_FORMAT.md))

### Tables (sketch)

```sql
CREATE TABLE roots (
  id INTEGER PRIMARY KEY,
  path TEXT NOT NULL UNIQUE,
  added_at TEXT NOT NULL,
  last_indexed_at TEXT,
  status TEXT NOT NULL
);

CREATE TABLE files (
  id INTEGER PRIMARY KEY,
  root_id INTEGER NOT NULL REFERENCES roots(id) ON DELETE CASCADE,
  path TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  ext TEXT,
  size INTEGER,
  mtime_ms INTEGER
);

CREATE VIRTUAL TABLE files_fts USING fts5(
  name,
  path,
  content='files',
  content_rowid='id'
);
```

(Exact FTS content-sync triggers left to implementation.)

---

## Query API

`search:query`:

```ts
{
  query: string
  scope:
    | { type: 'indexed' }
    | { type: 'folder'; path: string; recursive: boolean; useIndexIfCovered: boolean }
  limit?: number
  offset?: number
}
```

Behavior:

- `indexed`: FTS across all ready roots
- `folder` + `useIndexIfCovered`: if path is under a ready root, query FTS with path prefix filter; else live walk
- Results: `{ path, name, score?, mtimeMs, size }[]` plus `partial: boolean` if cancelled/truncated

---

## UI

- Search box submits on Enter; Escape clears focus
- Results view replaces file pane or shows as overlay list (pick **replace file pane with results list + clear button** for v1)
- Click result → select in containing folder (navigate tab path to parent, select file)
- Banner when results came from live walk: “Not indexed — slow search”

---

## Non-goals (v1)

- Content-inside-file full text (only names/paths)
- Everything-on-all-drives automatic indexing
- Regex engine (simple FTS / substring sufficient)
