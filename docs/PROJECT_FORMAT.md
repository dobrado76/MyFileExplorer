# Project / app data format

**Version:** 0.3.0

MyFileExplorer browses the **real filesystem**. App-owned state lives only under Electron **`userData`** — always **`%APPDATA%\MyFileExplorer`** for both `npm run dev` and packaged installs (D17). Optional overrides: `MFE_USER_DATA`, or `MFE_ISOLATED_USER_DATA=1` for a repo-local `.dev-user-data/`.

Do **not** write app sidecars into arbitrary user folders being browsed. NSIS must not delete this folder on uninstall (`deleteAppDataOnUninstall: false`).

---

## Layout

```
%APPDATA%/MyFileExplorer/
  settings.json          # theme, font, behavior, search excludes
  session.json           # tabs, active tab, splitter sizes, preview collapsed
  window-state.json      # x, y, width, height, maximized
  search-index.sqlite    # FTS index + indexed roots registry
  thumbs/                # thumbnail cache files
  image-originals/       # pristine copies before in-app image edits (D27)
  shell-icons/           # Windows shell icon cache
  logs/                  # optional main log files
```

Folder name is locked to `MyFileExplorer` (not the npm package name) so dev and install stay aligned.

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
  "foldersFirst": true,
  "defaultNewTabPath": "",
  "confirmPermanentDeleteAlways": false,
  "previewVisibleDefault": true,
  "textPreviewMaxBytes": 1048576,
  "vidThumbFrameMs": 300,
  "hideNameExtensions": ["lnk"],
  "searchExcludeDirNames": ["node_modules", ".git", ".hg", ".svn", "Thumbs.db"],
  "layouts": [],
  "folderViews": [],
  "indexedRoots": []
}
```

Notes:

- `theme`: `"dark" | "light" | "custom"`
- `vidThumbFrameMs`: delay between `!VIDTHUMB_CACHE` strip frames in icon views (50–2000, default 300). Strips themselves live next to videos as a sibling hidden `!VIDTHUMB_CACHE` folder (not under `userData` — D26 external convention / optional in-app generate).
- `hideNameExtensions`: extensions (no leading dot) whose “.ext” is omitted from file-view/search **labels** only (default `["lnk"]`). Does not hide files from the listing; rename/tooltips still use the real name.
- `layouts`: named workspace snapshots (D25) — `{ id, name, updatedAt, activeTabIndex, splitters, tabs: [{ path, title, viewMode, sort, rootPath, treeExpanded }] }`. Cap 50. Applying replaces the live session tabs.
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
  }
}
```

- `title: null` → UI shows basename of `path`
- `treeExpanded` — absolute folder paths (and drive roots) that were expanded in that tab’s tree; restored on launch (capped; see schema). Missing field → `[]`.
- `rootPath` — when set, tab is scoped to that folder as tree root
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

SQLite file `search-index.sqlite`:

- `roots(id, path, added_at, last_indexed_at, status)`
- `files(id, root_id, path, name, ext, size, mtime_ms, …)`
- `files_fts` — FTS5 on name (and optionally relative path)

Schema details: [SEARCH.md](SEARCH.md).

---

## Migrations

When persisted shapes change: add idempotent `scripts/migrate-*.ts` (or in-app version bump migrate on load). Prefer Zod defaults for new optional fields; use migrations for renames/removals.
