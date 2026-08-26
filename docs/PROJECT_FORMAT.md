# Project / app data format

**Version:** 0.12.0

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
  media-scratch/         # session temp (D7; emptied on start/quit; cap 20)
  *-scratch/             # remote-scratch, remote-transfer-scratch — session temp
  *-preview/             # chm / pptx / psd / raster — session temp
  video-remux/           # session temp (D33)
  image-originals/       # legacy D27 backups (migrated to VER_* ADS on ready; may be empty)
  shell-icons/           # Windows shell icon cache
  tab-icons/             # D54 custom tab icons (cover-cropped 128px PNG)
  quick-launch/          # D63 custom Quick Launch icons (cover-cropped 128px PNG)
  Templates/             # D57 new-file template copies (catalog in settings.templates)
  logs/                  # optional main log files
  scripts/               # D51 library.json + managed/*.ps1|py|… (not browsed folders)
  git-scratch/           # D64 commit -F messages + HEAD blobs for external diff (session wipe)
  ai-secrets.json        # D51 API keys via safeStorage (never exported)
```

**Settings export / import (D45):** Settings → About writes a portable JSON envelope (`format: "myfileexplorer-settings"`) with the **full** `settingsSchema` document (dialog bounds nulled) plus `networkHosts`, `remoteConnections` (no passwords), and `scripts` (library source, no AI keys). **Any new preference must be added to `settingsSchema` (or a nested object already under it)** so it round-trips — there is no separate export allowlist. It does **not** include `window-state.json` or live `session.json` (open tabs). Import replaces `settings.json` (and sidecars when present). A raw `settings.json` file is also accepted.

Folder name is locked to `MyFileExplorer` (not the npm package name) so dev and install stay aligned.

**Image edit versions (D27)** live on the image file as NTFS ADS — not under `userData` after migration:

| Stream | Role |
|--------|------|
| `$DATA` | Pristine original (unchanged after first in-app save) |
| `VER_1` … `VER_4` | Successive edits; higher = newer |
| `VER_COUNT` | Decimal text count `1`…`4` |

Compress-to-ZIP (7za) typically **omits** ADS — version history is not inside the `.zip`.

Slideshow **Cache** toggle + image path list live in `settings.json` (`slideshow.cacheActive`, `slideshow.imageListCache`, capped at 100 000 paths). Categorizer mappings live in `settings.slideshow.categorizerMap` (Import copies a file in; path is not the source of truth). Optional `slideshow.invalidImagesDir` receives files that fail preview/decode during slideshow. ADS Manager geometry is `settings.adsManagerBounds` (`{ x, y, width, height }` or `null` for centered defaults).

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
  "pasteNonFileClipboard": true,
  "defaultNewTabPath": "",
  "confirmPermanentDeleteAlways": false,
  "previewVisibleDefault": true,
  "textPreviewMaxBytes": 2097152,
  "vidThumbFrameMs": 300,
  "hideNameExtensions": ["lnk"],
  "searchExcludeDirNames": ["node_modules", ".git", ".hg", ".svn", "Thumbs.db"],
  "searchIndexedOnly": false,
  "layouts": [],
  "templates": [],
  "folderViews": [],
  "indexedRoots": []
}
```

Notes:

- `theme`: `"dark" | "light" | "custom"`
- `vidThumbFrameMs`: delay between `!VIDTHUMB_CACHE` strip frames in icon views (50–2000, default 300). Strips themselves live next to videos as a sibling hidden `!VIDTHUMB_CACHE` folder (not under `userData` — D26 external convention / optional in-app generate).
- `previewVideoAutoplay`: when true, preview `<video>` / `<audio>` start automatically on select (default `false`).
- `hideNameExtensions`: extensions (no leading dot) whose “.ext” is omitted from file-view/search **labels** only (default `["lnk"]`). Does not hide files from the listing; rename/tooltips still use the real name.
- `searchExcludeDirNames`: search/index exclude patterns (view-filter language — folder names, file names, `.tmp` / `*.log`, wildcards, or an absolute path)
- `searchIndexedOnly`: toolbar **indexed** search toggle (default `false` = current folder walk; `true` = indexed roots only)
- `layouts`: named workspace snapshots (D25) — `{ id, name, updatedAt, activeTabIndex, splitters, viewLayout, paneTabIndexes, paneSplitCols, paneSplitRows, tabs: [{ path, title, icon, viewMode, sort, rootPath, treeExpanded }] }`. Cap 50. Applying replaces the live session tabs. `paneTabIndexes` are indices into `tabs` (or null). `icon` is `{ name, color }`, `{ kind: 'custom', id, showLabel, sizePx }` (D54; PNG stays in `tab-icons/`), or `null` (D32).
- `templates`: new-file templates (D57) — `{ id, name, suggestedStem, inputName, sourceFile }` (`name` = menu + default stem; `inputName` = original picked file; stored copy is `Templates/{sourceFile}`). Cap 40. Order in the array is the menu order.
- `quickLaunch`: toolbar apps (D63) — `{ id, name, path, args, show: 'icon' \| 'label' \| 'both', iconKind: 'shell' \| 'custom' \| 'lucide', iconId?, lucideName?, lucideColor }`. Cap 24. Custom PNGs are `quick-launch/{iconId}.png` (not in Settings export).
- `folderViews`: per-folder view overrides (D22); orthogonal to layouts
- `indexedRoots`: absolute paths marked for indexing (also stored/mirrored in SQLite for query joins)
- `defaultNewTabPath`: empty → This PC / known folder of choice at implement time
- `mediaMetadata`: opt-in movie/TV metadata (D50). `{ enabled` (default false), `coverHeightPx` (56–240, default 120), `showEpisodeIconLabels` (default true — icon tiles use `SxxExx` + episode title; false = filename), `mixFilesAndFolders` (default false — Folders first; on = media-container **icon/thumbnail** listings ignore Folders first; List/Details follow Behavior → Folders first), `tmdbApiKey`, `omdbApiKey`, `internetSource` (`tmdb` \| `omdb`), `plexUrl`, `plexToken`, `plexDataDir` }. Streams on the media file/folder: `media_metadata` (JSON, including optional `watched`), `media_metadata_thumbnail` (cover bytes, not on episode files). Folder flag: `media_metadata_container` on the library parent and the title folder — not under `userData`. Guide: [MEDIA_METADATA.md](MEDIA_METADATA.md).
- **Item notes / icons (D61 / D62)** are **not** settings — they live on the file or folder as NTFS ADS `mfe_note` (JSON), `mfe_icon` (JSON), and `mfe_icon_img` (PNG). Host timestamps are restored after every write/delete. Search reads `mfe_note` only. A small `item_notes` catalog in `search-index.sqlite` (userData) speeds indexed `todo:` / `hasnote:` after a note is saved. Not under browsed folders.
- `scripts` / `ai`: D51 — `scripts.enabled` (default **false**, hides Scripts chrome), runner overrides, first-run ack + OpenAI-compatible provider metadata (no API keys). Geometry: `scriptManagerBounds`, `scriptGenerateBounds`, `scriptRunnerBounds` (stripped on export). Guide: [SCRIPTS.md](SCRIPTS.md).
- `git`: D64 — `{ enabled` (default **false**), `executablePath`, overlay/toolbar/column toggles, `showIgnored`, `refreshDebounceMs`, large-repo threshold, `diffTool` / `externalClient` templates, … }. Temps under `userData/git-scratch`. Guide: [GIT.md](GIT.md).

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
  "paneSplitRows": 0.5,
  "closedTabs": []
}
```

- `title: null` → UI shows basename of `path`
- `icon` — optional Lucide `{ name: PascalCase, color: "#rrggbb" }`, custom `{ kind: "custom", id, showLabel, sizePx }` (D54; image is `userData/tab-icons/{id}.png`), or `null` (D32). Missing / invalid field → `null`.
- `treeExpanded` — absolute folder paths (and drive roots) that were expanded in that tab’s tree; restored on launch (capped; see schema). Missing field → `[]`.
- `rootPath` — when set, tab is scoped to that folder as tree root
- `viewLayout` — `1` | `2` | `3` | `4` multi-pane mode (D31); `paneTabIds` length matches (null = empty drop target)
- `paneTreeCollapsed` — per-pane folder-tree hidden flags (length matches `viewLayout`)
- `paneSplitCols` / `paneSplitRows` — fraction for column/row splitters in multi-pane (0–1)
- `closedTabs` — last-closed-first stack (D55, cap 25): `{ tab: TabState, paneIndex }`. Missing → `[]`.
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

## Session temp (`*-scratch` / `*-preview` / `*-remux`)

Any directory directly under `userData` whose name ends in **`-scratch`**, **`-preview`**, or **`-remux`** is wiped on start, on quit, and when Settings clears caches. These are rebuildable preview/staging copies (D7) — not settings, scripts, thumbs, or tab icons. Known today: `media-scratch`, `remote-scratch`, `remote-transfer-scratch`, `chm-preview`, `pptx-preview`, `psd-preview`, `raster-preview`, `video-remux`. `git-scratch` (D64) follows the same wipe rule when named `*-scratch`.

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
