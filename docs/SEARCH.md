# Search & indexing

**Version:** 0.6.x · Decision **D34** (Everything-parity hybrid index)

Two index kinds (both opt-in, under `userData/search-index.sqlite`):

1. **Folder roots** — mark a directory; recursive walk + **debounced FS watch** for incremental upserts
2. **Volume roots** — **Index this drive** on a fixed NTFS volume: MFT/USN bootstrap (`FSCTL_ENUM_USN_DATA`) + **USN journal** monitor when available; otherwise fall back to a full walk (`monitor: walk`)

**Live walk** remains the default when no ready root covers the folder (D15: progress + cancel; never claim indexed speed).

Unchecking **indexed** in the toolbar searches the **current folder recursively** (index accelerates only when covered).

---

## Marking roots

| Action | Where |
|--------|--------|
| **Add folder to search index** | Context menu on a folder; Settings → Search |
| **Index this drive** | Context menu on a drive root (`C:\`); Settings → Search → Add drive |
| Remove / Reindex | Settings → Search; context menu when already indexed |

Nested roots: **parent-covers-child** (same as before). Volume root `D:\` absorbs folder roots under `D:\`.

Exclude directory **names** from crawl (settings): default `node_modules`, `.git`, `.hg`, `.svn`.

Offline volumes: keep rows; mark root `offline` until the volume returns (aligns with D3 tab offline).

---

## Schema

```sql
CREATE TABLE roots (
  id INTEGER PRIMARY KEY,
  path TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL DEFAULT 'folder',   -- 'folder' | 'volume'
  volume TEXT,                           -- e.g. 'D:' when kind=volume
  monitor TEXT NOT NULL DEFAULT 'none',  -- 'none' | 'watch' | 'usn' | 'walk'
  usn_journal_id TEXT,
  usn_next USN INTEGER,                  -- last consumed USN (0 if unused)
  added_at TEXT NOT NULL,
  last_indexed_at TEXT,
  status TEXT NOT NULL                   -- idle | indexing | ready | error | offline
);

CREATE TABLE files (
  id INTEGER PRIMARY KEY,
  root_id INTEGER NOT NULL REFERENCES roots(id) ON DELETE CASCADE,
  path TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  ext TEXT,
  size INTEGER NOT NULL DEFAULT 0,
  mtime_ms INTEGER NOT NULL DEFAULT 0,
  is_dir INTEGER NOT NULL DEFAULT 0,
  attrs INTEGER                          -- Win32 attributes when known
);
-- files_fts FTS5 optional (LIKE remains primary for substring / Everything predicates)
```

---

## Query language (Everything-inspired)

Versioned subset; grows over releases. Parser: `everythingQuery.ts`.

| Feature | Examples |
|---------|----------|
| AND / OR / NOT | `foo bar`, `foo\|bar`, `!tmp`, `!ext:tmp;bak` |
| Phrases / groups | `"my file"`, `<a\|b> c` |
| Modifiers | `case:`, `path:` / `nopath:`, `file:` / `folder:`, `regex:`, `ww:` |
| Functions | `size:>1mb`, `size:large`, `dm:today`, `dc:thisweek`, `ext:jpg;png`, `parent:`, `infolder:`, `startwith:`, `endwith:`, `len:`, `empty:`, `count:` |
| Macros | `pic:`, `video:`, `audio:`, `doc:`, `exe:`, `zip:` |
| Path tokens | `d:`, `d:\folder\` |
| Advanced | `attrib:h`, `dupe:`, `sizedupe:`, `child:`, `childcount:`, `depth:` |
| Content (slow) | `content:`, `utf8content:` — unindexed scan of name/path hits only; hard size/time caps; banner (D15) |

Toolbar toggles (persisted): **Match path**, **Match case**, **Whole word**, **Regex**. Type chips map to macros.

Legacy plain substring + `*`/`?` globs still work when no operators are used.

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
  /** Optional overrides; else settings defaults */
  matchPath?: boolean
  matchCase?: boolean
  wholeWord?: boolean
  regex?: boolean
}
```

Results: `{ path, name, score?, mtimeMs, size, isDir }[]` plus `partial`, `source: 'index' | 'walk'`, optional `contentSlow?: boolean`.

---

## UI

- **As-you-type** debounced search (cancel in-flight); Enter still searches immediately
- Toolbar **indexed** checkbox (`searchIndexedOnly`); Match path / case / ww / regex toggles
- Results in normal **FileView** (D29); Folder column; banner with count / Clear / “Not indexed — slow” / “Content search — slow”
- Settings → Search: roots (kind, monitor, status, file count), Add folder / Add drive, Reindex, excludes, saved **filters** & **bookmarks**
- Optional **localhost HTTP** query API (Settings → Advanced; token; bind 127.0.0.1)

---

## Non-goals (even at kitchen-sink depth)

- Cloning Everything’s standalone tray / multi-window product shell
- Guaranteeing USN on every volume (ReFS / network / removable → folder index or walk)
- Indexing file **contents** into SQLite by default
- Bit-identical Everything.ini / all CLI commands (`about:`, `/quit`, …)
