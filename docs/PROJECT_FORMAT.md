# Project / app data format

**Version:** 0.6.x

MyFileExplorer browses the **real filesystem**. App-owned state lives only under Electron **`userData`** — always **`%APPDATA%\MyFileExplorer`** for both `npm run dev` and packaged installs (D17). Optional overrides: `MFE_USER_DATA`, or `MFE_ISOLATED_USER_DATA=1` for a repo-local `.dev-user-data/`.

Do **not** write app sidecars into arbitrary user folders being browsed. NSIS must not delete this folder on uninstall (`deleteAppDataOnUninstall: false`).

---

## Layout

```
%APPDATA%/MyFileExplorer/
  settings.json          # theme, font, behavior, search excludes, named layouts, …
  session.json           # tabs, active tab, splitter sizes, preview collapsed
  window-state.json      # x, y, width, height, maximized (not included in Settings export)
  network-hosts.json     # remembered LAN hosts (included in Settings export envelope)
  search-index.sqlite    # FTS index + indexed roots registry
  thumbs/                # thumbnail cache files
  image-originals/       # legacy D27 backups (migrated to VER_* ADS on ready; may be empty)
  shell-icons/           # Windows shell icon cache
  logs/                  # optional main log files
```

**Settings export / import (D45):** Settings → About writes a portable JSON envelope (`format: "myfileexplorer-settings"`) with the **full** `settingsSchema` document (dialog bounds nulled) plus `networkHosts`. **Any new preference must be added to `settingsSchema` (or a nested object already under it)** so it round-trips — there is no separate export allowlist. It does **not** include `window-state.json` or live `session.json` (open tabs). Import replaces `settings.json` (and hosts when present). A raw `settings.json` file is also accepted.

Folder name is locked to `MyFileExplorer` (not the npm package name) so dev and install stay aligned.

**Image edit versions (D27)** live on the image file as NTFS ADS — not under `userData` after migration:

| Stream | Role |
|--------|------|
| `$DATA` | Pristine original (unchanged after first in-app save) |
| `VER_1` … `VER_4` | Successive edits; higher = newer |
| `VER_COUNT` | Decimal text count `1`…`4` |

Compress-to-ZIP (7za) typically **omits** ADS — version history is not inside the `.zip`.

Slideshow **Cache** toggle + image path list live in `settings.json` (`slideshow.cacheActive`, `slideshow.imageListCache`, capped at 100 000 paths). Categorizer mappings live in `settings.slideshow.categorizerMap` (Import copies a file in; path is not the source of truth). Optional `slideshow.invalidImagesDir` receives files that fail preview/decode during slideshow. Compiled lists: `slideshow.compiledFileListsFolder`, `compiledListEntries`, `compiledPlaylistIndex`; window geometry `settings.compiledListsWindowBounds`. On disk under the compiled root: `{Name}/*.dat` (body = source folders; ADS Index/Count after Update Lists), `{Name}/*.txt` (body expand at play; no Index), `!!Lists/last.txt` (resume), and user-saved `!!Lists/*.txt` composites. ADS Manager geometry is `settings.adsManagerBounds` (`{ x, y, width, height }` or `null` for centered defaults).

---

## `settings.json` (shape)

```json
{
  "version": 1,
  "theme": "dark",
  "customTheme": {
    "bg": "#12141a",
    "bgElevated": "#1a1d26",
    "border": "#2a2f3a",
    "text": "#e8eaef",
    "textDim": "#9aa3b2",
    "accent": "#3b82f6"
  },
  "fontFamily": "Segoe UI",
  "fontSizePx": 13,
  "iconSizePx": 20,
  "foldersFirst": true,
  "itemCheckboxes": false,
  "defaultNewTabPath": "",
  "confirmPermanentDeleteAlways": false,
  "previewVisibleDefault": true,
  "textPreviewMaxBytes": 1048576,
  "vidThumbFrameMs": 300,
  "hideNameExtensions": ["lnk"],
  "searchExcludeDirNames": ["node_modules", ".git", ".hg", ".svn", "Thumbs.db"],
  "searchIndexedOnly": false,
  "layouts": [],
  "folderViews": [],
  "indexedRoots": []
}
```

Notes:

- `theme`: `"dark" | "light" | "custom"`
- `vidThumbFrameMs`: delay between `!VIDTHUMB_CACHE` strip frames in icon views (50–2000, default 300). Strips themselves live next to videos as a sibling hidden `!VIDTHUMB_CACHE` folder (not under `userData` — D26 external convention / optional in-app generate).
- `previewVideoAutoplay`: when true, preview `<video>` / `<audio>` start automatically on select (default `false`).
- `hideNameExtensions`: extensions (no leading dot) whose “.ext” is omitted from file-view/search **labels** only (default `["lnk"]`). Does not hide files from the listing; rename/tooltips still use the real name.
- `searchIndexedOnly`: toolbar **indexed** search toggle (default `false` = current folder walk; `true` = indexed roots only)
- `layouts`: named workspace snapshots (D25) — `{ id, name, updatedAt, activeTabIndex, splitters, viewLayout, paneTabIndexes, paneSplitCols, paneSplitRows, tabs: [{ path, title, icon, viewMode, sort, rootPath, treeExpanded }] }`. Cap 50. Applying replaces the live session tabs. `paneTabIndexes` are indices into `tabs` (or null). `icon` is `{ name, color }` or `null` (D32).
- `folderViews`: per-folder view overrides (D22); orthogonal to layouts
- `indexedRoots`: absolute paths marked for indexing (also stored/mirrored in SQLite for query joins)
- `defaultNewTabPath`: empty → This PC / known folder of choice at implement time

---

## `session.json` (shape)

```json
{
  "version": 1,
  "activeTabId": "tab_…",
  "tabs": [
    {
      "id": "tab_…",
      "path": "D:\\Art\\Refs",
      "title": null,
      "icon": { "name": "FolderOpen", "color": "#60a5fa" },
      "viewMode": "largeIcons",
      "sort": { "key": "name", "dir": "asc" },
      "historyBack": [],
      "historyForward": [],
      "selectedPaths": [],
      "scrollOffset": 0,
      "rootPath": null,
      "treeExpanded": ["C:\\", "C:\\Users"]
    }
  ],
  "splitters": {
    "treeWidthPx": 240,
    "previewWidthPx": 320,
    "treeCollapsed": false,
    "previewCollapsed": false
  },
  "viewLayout": 1,
  "paneTabIds": ["tab_…"],
  "focusedPaneIndex": 0,
  "paneSplitCols": 0.5,
  "paneSplitRows": 0.5
}
```

- `title: null` → UI shows basename of `path`
- `icon` — optional Lucide tab glyph `{ name: PascalCase, color: "#rrggbb" }` or `null` (D32). Missing field → `null`.
- `treeExpanded` — absolute folder paths (and drive roots) that were expanded in that tab’s tree; restored on launch (capped; see schema). Missing field → `[]`.
- `rootPath` — when set, tab is scoped to that folder as tree root
- `viewLayout` — `1` | `2` | `4` multi-pane mode (D31); `paneTabIds` length matches (null = empty drop target)
- `paneSplitCols` / `paneSplitRows` — fraction for column/row splitters in multi-pane (0–1)
- Write debounced on change; flush on `before-quit`

---

## `window-state.json`

```json
{
  "x": 100,
  "y": 80,
  "width": 1400,
  "height": 900,
  "isMaximized": false
}
```

---

## Thumbnail cache

- Path: `thumbs/{hash}.jpg` (or `.webp`)
- Key material: normalized absolute path + `mtimeMs` + `size`
- Invalidate when key mismatches
- Settings action: wipe `thumbs/`

---

## Search database

SQLite file `search-index.sqlite` (D34):

- `roots(id, path, kind, volume, monitor, usn_*, added_at, last_indexed_at, status)`
- `files(id, root_id, path, name, ext, size, mtime_ms, is_dir, attrs, …)`
- `files_fts` — optional FTS5; queries primarily use LIKE + Everything predicates

Settings extras: `searchMatchPath` / `searchMatchCase` / `searchWholeWord` / `searchRegex`, `searchFilters[]`, `searchBookmarks[]`, `searchHttpEnabled` / `searchHttpPort` / `searchHttpToken`.

Schema details: [SEARCH.md](SEARCH.md).

---

## Migrations

When persisted shapes change: add idempotent `scripts/migrate-*.ts` (or in-app version bump migrate on load). Prefer Zod defaults for new optional fields; use migrations for renames/removals.
