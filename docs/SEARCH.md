# Search & indexing

**Version:** 0.3.0

Two speeds:

1. **Indexed** — folders the user marks; SQLite under userData (faster when a ready root covers the folder)
2. **Live walk** — default for anywhere else, and when no index covers the folder; slower; progress + cancel required (D15)

**Index is optional.** Unchecking “indexed” in the toolbar searches the **current folder recursively** via live walk (or via the index only as a speed-up when that folder is under a ready root). Name matching is always case-insensitive **substring** (multi-word = AND), whether indexed or walking — not FTS token-prefix-only.

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

- `indexed`: search all ready roots (substring on `name`); errors clearly if no ready roots — user can uncheck “indexed” to search the current folder without an index
- `folder` + recursive: if `useIndexIfCovered` and a **ready non-empty** root covers the path, query the index with path prefix; otherwise **live walk** all subfolders (D15)
- Name match: case-insensitive **substring** per whitespace token (AND), or shell **globs** (`*.jpg`, `img_??.png`, bare `.jpg` → `*.jpg`) — same for index and walk
- Results: `{ path, name, score?, mtimeMs, size }[]` plus `partial: boolean` if cancelled/truncated

---

## UI

- Search box submits on Enter; Escape clears search (or clears focus when inactive)
- Results appear in the **normal file view** (same list / details / thumbnails, multi-select, preview pane, drag-drop, context menu) — not a separate results list. Full path is shown under each name while search is active
- Banner above the file view: result count, Clear/Cancel, and “Not indexed — slow search” when results came from a live walk
- Double-click / Open a folder navigates there (clears search); opening an image uses search hits as viewer siblings
- Toolbar view-mode and sort controls apply to search results the same as a folder listing

---

## Non-goals (v1)

- Content-inside-file full text (only names/paths)
- Everything-on-all-drives automatic indexing
- Regex engine (simple substring + `*` / `?` globs sufficient)
