# Changelog

All notable changes to MyFileExplorer are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

User-facing summary for the latest release: [RELEASE_NOTES.md](RELEASE_NOTES.md).

## [Unreleased]

## [0.6.3] - 2026-08-12

Completes the **v0.6** product line for tagging (`v0.6.3`): opt-in remotes (D46), context-menu Discover + layout (D41), experimental Linux packaging, and polish on top of **0.6.0** Network / settings export. See [RELEASE_NOTES.md](RELEASE_NOTES.md).

### Added

- **Experimental Linux packaging** — AppImage via `npm run build:linux` / `dist:linux`; Wayland-oriented helpers (`dev:linux`, `run:unpacked`, `run:linux`, `install:linux`). Win32 koffi APIs lazy-load so Linux hosts do not crash on import. Not a supported product matrix — Windows remains primary. See [docs/LINUX.md](docs/LINUX.md).
- **Remote repositories (D46)** — opt-in FTP / FTPS / SFTP connections; Settings master switch (default off); toolbar + tree section; `mfe-remote://` locations; upload/download / mkdir / rename / permanent delete; Connect / Open / folder-nav busy dialogs; Open & preview stage under `userData` scratch then use local handlers. See [docs/REMOTE_FTP.md](docs/REMOTE_FTP.md).
- **Context menu Discover + layout (D41)** — Settings → Context menu → Discover scans static HKCR shell verbs; catalog and enabled ticks persist; tick enables on the live menu and adds a tinted orderable row under Built-in (no checkbox there). Built-in list is one-line (grip | checkbox | name | description) with drag-reorder and add/remove separators (`builtinLayout`). Full context-menu customization round-trips via Settings export/import (D45).

### Changed

- `npm run dist` refuses non-Windows hosts (use `build:linux` on Linux).
- Docs / README / PLAN / BUILD index Linux as experimental under **v0.6.x**.
- **Breadcrumb** collapses middle segments with `…` only when the address trail actually overflows (no fixed max segment count).
- **Settings export** strips `remoteConnectionBounds` with other dialog geometry (D45); Advanced copy calls out context-menu prefs explicitly.
- **Add/Edit remote connection** dialog: solid modal chrome, wider layout, drag/resize + persisted bounds, label|field rows, proper Cancel/Save buttons.

### Fixed

- **Remote Open** no longer hands `mfe-remote://` to Windows (Store “no app” dialog) — stages then `shell.openPath` on the local copy.
- **Context menu Discover** — unquoted registry commands under `C:\Program Files\…` no longer truncate the executable at the first space (Rescan to refresh cached verbs).
- **Remote preview / properties** use remote size/mtime; preview/media stage through scratch.
- **Remote → local drag/drop** to a drive root (`Z:\`) no longer fails with `EPERM` on `mkdir('Z:\')`.
- **FTP/FTPS concurrency** — serialize all ops per connection (`basic-ftp` one-command-at-a-time); reconnect+retry if a prior race closed the client (SFTP was already fine).
- **Remote move** across local↔remote uses copy-then-delete; conflict checks understand remote names/paths.

## [0.6.0] - 2026-08-12

Sixth product release: Network neighborhood & mapped-drive reconnect, portable settings export/import, Open Command Line (incl. Admin). See [RELEASE_NOTES.md](RELEASE_NOTES.md) and [docs/NETWORKS.md](docs/NETWORKS.md).

### Added

- **Network neighborhood (D44)** — tree Network section; remembered hosts in `network-hosts.json`; async worker discovery (~20s); Settings → Network (auto/manual + interval); Map / Disconnect WNet dialogs; UNC host/share browsing. See [docs/NETWORKS.md](docs/NETWORKS.md).
- **Mapped drive reconnect (D3)** — disconnected mapped letters stay under Drives; open/list restores via `WNetAddConnection2W` / interactive `WNetUseConnectionW`.
- **Settings export / import (D45)** — Advanced → Export… / Import… portable JSON (prefs + remembered network hosts; no window geometry).
- **Open Command Line here** — folder context menu; ShellExecute to Terminal / PowerShell / cmd; **Shift+click** elevated (UAC).
- **Add submenu icons** — same shell probes as toolbar + New.
- **docs/NETWORKS.md** — network feature reference.

### Changed

- Network rediscovery defaults to **every 5 minutes** (configurable) instead of a 90s poll that felt permanently “discovering…”.
- Docs / README / PLAN / ADVANTAGES / DECISIONS aligned to **v0.6.0** (through D45).

### Fixed

- Settings Export/Import action card no longer clips the Import button.
- Command-line launch uses ShellExecute (visible window; WindowsApps `wt.exe` stub-safe).

## [0.5.0] - 2026-08-11

Fifth product release: slideshow / categorizer + compiled lists, NTFS ADS tooling, deeper previews, ZIP/compress and multi-pane polish. See [RELEASE_NOTES.md](RELEASE_NOTES.md).

### Added

- **Slideshow / image categorizer (D37)** — gated chrome; fullscreen player; categorizer map; image-list cache; invalid-images folder. See [docs/SLIDESHOW.md](docs/SLIDESHOW.md).
- **Compiled file lists (D39)** — category `.dat` / `.txt` libraries; Update Lists writes ADS Index/Count on `.dat` only (`|=>` ignored); `.txt` expands from body at play; virtual playlist; Validate Lists; detached lists window.
- **NTFS Alternate Data Streams (D38)** — opt-in Details column, ADS Manager, `ads:*` IPC. See [docs/ADS.md](docs/ADS.md).
- **CHM preview (D35)** — `.chm` Contents TOC + sandboxed topic HTML (Windows `hh.exe` decompile under userData).
- **Font preview (D36)** — `.ttf` sample pangram + name-table metadata in the preview pane.
- **Archive preview breadth** — list-only contents trees for `.7z`, `.rar`, `.tar` / `.tar.gz` / `.tgz`, `.apk`, `.msi`, `.iso` / `.img` (alongside ZIP / Unity).
- **Empty pane actions** — multi-pane empty slots offer **Open Computer** and **Browse…** in addition to drop-a-tab.
- **Tree drag-hover expand** — while dragging, hover a collapsed folder in the tree ~2s to expand it (Explorer parity; D11).

### Changed

- **ZIP compress** — uses bundled **7za** (stream to disk, `%` progress, Cancel kills the helper) instead of in-memory JSZip generate.
- **View layout control** — 1 / 2 / 4 pane switcher is a compact toolbar dropdown.
- **Shell icon extract** — `.exe` / per-file shell icons extract in the background (queued + throttled).
- **Context submenus** — short close delay + hit-bridge so flyouts (e.g. Hide from view) stay reachable across the parent→submenu gap.
- **Docs** — README / PLAN / ADVANTAGES / RELEASE_NOTES / SLIDESHOW / ADS / DECISIONS aligned to v0.5.0 (through D39).

### Fixed

- **File-list / tree rename gesture** — double single-click is two slow clicks on the selected name; a single click no longer starts rename after hover/wait.
- **CHM preview** — locate `hh.exe` at `%SystemRoot%\hh.exe` (and SysWOW64 fallback); TOC encoding for Windows-1252 titles.
- **Update Lists OOM** — no longer builds Index for `.txt` or caches every folder scan in memory; processes one `.dat` at a time.

## [0.4.0] - 2026-08-09

Fourth product release: Everything-parity search, richer previews, multi-pane/tab polish. See [RELEASE_NOTES.md](RELEASE_NOTES.md).

### Added

- **Everything-parity search (D34)** — hybrid folder + optional NTFS volume index; Everything-inspired query language; as-you-type; match toggles; content search; filters/bookmarks; optional localhost HTTP API. See [docs/SEARCH.md](docs/SEARCH.md).
- **Windows Properties…** — Properties dialog bottom-left opens Explorer’s system property sheet (Security, Sharing, …) without reimplementing NTFS UI.
- **Multi-pane layouts (D31)** — 1 / 2 / 4 file panes with layout persistence.
- **Tab icons & tab context menu (D32)** — Lucide icon + color; Duplicate / Rename / Set icon / Close.
- **In-pane video preview (D33)** — byte-range `mfe-media`; MKV remux when practical; AVI strip-only.
- **Executable preview** — `.exe` / `.dll` (and related PE) show Explorer-style version details plus the real shell app icon.
- **HTML preview** — `.html` / `.htm` render sanitized markup by default, with a **Preview / Raw** toggle.
- **Markdown Preview / Raw toggle** — rendered GFM by default; switch to syntax-highlighted source.
- **Unity `.unitypackage` preview** — contents tree of Unity asset paths (`Assets/…`); list-only (no Extract All).
- **Batch / VBScript / `.ps` highlighting** — `.bat`/`.cmd` (DOS batch), `.vbs`, and `.ps` (PowerShell; `.ps1` already worked).
- **`.wlt` / `.ffs_gui` text preview** — treated as YAML and XML (syntax-highlighted).
- **+ New toolbar dropdown** — Explorer-style New menu (folder, common file types, Other…) before Undo / Cut / Copy.
- **Address bar `%VAR%` expansion** — breadcrumb path entry expands Windows env vars (`%LOCALAPPDATA%`, `%USERPROFILE%`, …).
- **Preview autoplay setting** — Settings → Behavior → Autoplay media in preview (`previewVideoAutoplay`, default off).

### Changed

- **Recent locations order** — dropdown lists current folder first, then Back history (newest previous → oldest), matching repeated Back.
- **Drag cancel** — pressing the opposite mouse button cancels an in-progress drag (left↔right), matching Explorer; Escape still works.
- **Single-pane drag highlight** — no full-view drop outline when `viewLayout` is 1 (still highlights in 2/4-pane and on folder targets).
- **ZIP preview** — contents tree no longer skips archives over ~80 MiB; listing reads the central directory only (size irrelevant).
- **Search UX** — match options + type chips in a toolbar dropdown; Settings Search uses whitelist / exclude blacklist lists; larger Settings window.
- **Docs** — SEARCH rewritten for D34; README / PLAN / ADVANTAGES / RELEASE_NOTES aligned to v0.4.0.

## [0.3.0] - 2026-08-09

Third product release: Explorer drag/drop parity, in-app Recycle Bin, large-folder performance, preview polish. See [RELEASE_NOTES.md](RELEASE_NOTES.md).

### Added

- **Create shortcuts here** — right-drag drop menu matches Explorer (Copy / Move / Create shortcuts / Cancel); writes `.lnk` via WScript (D11).
- **Drag edge auto-scroll** — while dragging, hovering near the top/bottom of the file list or folder tree scrolls that pane (D11).
- **In-app Recycle Bin** — tab-bar button lists bin contents in the file view (Restore / Empty / permanent delete). Details columns: Original location, Date deleted, Size, Type. No longer launches Windows Explorer (D7).
- **Drop files on tabs** — drag items onto a tab to move/copy into that tab’s folder (Ctrl=copy).
- **Disable hardware acceleration** — Settings → Advanced (restart required) to free GPU VRAM for training.
- **ComfyUI / JPEG Comments in preview** — reads Explorer “Comments” (EXIF UserComment / XPComment / JPEG COM) and decomposes A1111-style params into preview fields.
- **`npm run dist`** — auto-bumps the patch version, removes previous `MyFileExplorer Setup *.exe` from `dist/` (and prunes Settings → Updates folder), then builds.

### Changed

- **Large-folder performance** — Win32 `FindFirstFile` listing, watch mute/coalesce during list, skip tree re-list of the active folder, debounced scroll persistence, shared view-filter regex cache, pre-sorted listing, shell-icon extension cache (files only).
- **Optimistic delete** — prune listing after in-folder trash without a full re-stat of huge directories.
- **Docs** — README rewrite, ADVANTAGES.md, PLAN / docs / RELEASE_NOTES aligned to v0.3.0.

### Fixed

- **Folder icons** — directories no longer reuse the extensionless-file (`_none`) shell-icon cache slot; tree passes `isDir` on icon requests.
- **Recycle Bin undo** — restore uses shell `Verbs`/`DoIt` so Ctrl+Z after Del actually restores.
- **Preview after delete** — less flash / stuck spinner; sticky previous model until the next loads; optimistic next selection.
- **Shift/Ctrl + drag** — selection updates on press, then drag starts without requiring a second click.
- **Preview while multi-selecting** — shows the most recently selected file with an “N selected” badge.
- **In-app left-drag** — dropping onto folders works again; leave the window → OS `startDrag` / CF_HDROP.

### Removed

- **Generation base-model family filter** — briefly present in 0.2.x nightlies; never belonged in this product (removed before 0.3.0).

## [0.2.0] - 2026-08-06

Second product release: Explorer-replacement reliability, search-as-file-view, OS drag-out, progress/cancel, and post-0.1 polish. See [RELEASE_NOTES.md](RELEASE_NOTES.md).

### Added

- **Hide extensions in names** — Settings → Behavior lists extensions (default `lnk`) whose “.ext” is stripped from file-view/search labels only; files remain listed; rename still uses the full name.
- **Shortcut (.lnk) preview** — shows Target, Arguments, Start in, Comment, icon path, hotkey, and whether the target exists; Open shortcut / Open target actions.
- **Generate video previews** — context menu on folder background / folder / videos: write 20 evenly sampled frames into `!VIDTHUMB_CACHE` (Generate missing, Generate missing for all subfolders, or Regenerate all). Uses bundled ffmpeg; progress in the status bar (D26). Generate missing only skips complete 20-frame strips; partial/interrupted strips are deleted and regenerated.
- **File-op progress bar** — copy, move, Recycle Bin, permanent delete, and video-preview generation show a determinate status-bar progress bar with “N of M” and the current file name (D28). **Cancel** stops in-flight work.
- **In-app image editor** — Edit button on image previews (and context menu) opens Filerobot (crop/adjust/filters/annotate/resize). **Save** keeps a pristine copy under AppData for Revert; **Save as…** writes a new file with no backup (D27).
- **PowerPoint preview** — `.pptx` shows slide text in the preview pane; legacy `.ppt` gets a best-effort text scrape (layout/images not rendered).
- **Extra large icons only, no filename** — new view mode above Extra large icons. Hides the label for files that actually show a content preview (image/PSD or video strip); folders and files without a preview still show their names.
- **Animated video thumbs in icon view** — when a sibling hidden `!VIDTHUMB_CACHE` folder has `{videoName}.thumb_1.jpg`…`thumb_20.jpg`, icon/thumbnail modes loop those frames instead of the plain shell video icon. Frame delay is Settings → Behavior → Video thumbnail frame delay (default 300ms; D26).
- **SafeTensors preview metadata** — `.safetensors` files show a compact summary (type/params/dtype), promoted training fields, and syntax-highlighted JSON for nested leftovers — header-only, no weight load.
- **Named workspace layouts** — save the current tabs and pane chrome under a name; Toolbar Layouts menu; Settings → Layouts (D25).
- **Syntax-highlighted text previews** — common languages in the preview pane (`highlight.js`, theme-aware colors).
- **Conflict compare** — side-by-side Incoming vs Existing on name conflicts; per-file or Skip/Keep both/Replace all.
- **Recycle Bin on the tab bar** — opens the Windows Recycle Bin in system Explorer.
- **Undo / redo** — Ctrl+Z / Ctrl+Y for trash, move, copy, rename, and new file/folder (D23). Permanent delete is not undoable.
- **Manual updates** — Settings → Advanced: Updates folder, Check for update, Install update.
- **In-app image viewer** — full-window viewer for images (fit/actual, sibling arrows); **Open with default app** still uses the system association.
- **Customize this folder** — per-folder (optional recursive) view/sort/columns overrides (D22).
- **Extensive Details columns** — image / A/V / tags / generation fields via `meta:getMany`.
- **Windows shell icons** — `SHGetFileInfo` with `app.getFileIcon` fallback (D21).
- **Useful Quick access** — Desktop / Downloads / Documents / Pictures defaults; pin/unpin (D20).
- **Richer Properties dialog** — drives capacity bar; folder recursive size; editable attributes on Windows.
- **Inline audio/video preview** — `mfe-media://` playback in the preview pane.
- **Global view filter** — hide by pattern; toolbar eye toggle; context **Hide from view**.
- **External open / Reveal** — `--reveal` / `--open` / `mfe://` (D19). See `docs/INTEGRATION.md`.
- **PSD / rich document previews** — PSD thumbs; Markdown, Office-ish, PDF, HTML sanitized.
- **Scoped tabs** — “Open as root in new tab”.
- **Customizable Details columns** — resize/reorder/show-hide; layout in settings.
- **Marquee (box) selection** — rubber-band select across view modes.
- **Drop-target highlight** — folders light up while dragging.
- **App icon** — amber folder + teal compass; `npm run icons`.
- **Context menu → Add** — Folder and common file types with inline rename.
- **OS file drag-out** — left-drag exports real paths to other apps via `webContents.startDrag` (D11).
- **Search as normal file view** — results use `FileView` with banner + paths (D29).

### Changed

- **Tree folder drag-drop** — left- and right-drag folders in the tree; volume roots stay non-draggable.
- **Faster move** — same-volume moves no longer pre-walk the tree only to count progress units; watchers suspend for the batch.
- **Faster Del** — sync recycle first; no mandatory sleeps / PowerShell on the happy path; media hold is two animation frames.
- **Recycle Bin / preview handles** — `mfe-media` never serves browsed paths via `file://` (buffer ≤128 MiB or userData scratch). Thumbs/preview read Buffer then close.
- **File-op status bar** — fixed-width bar first; **Cancel** for copy/move/trash/delete/video-preview.
- **Busy feedback (D28)** — indeterminate after ~1 s if main has not yet reported units; large copies stream byte progress.
- **Docs** — README, PLAN, RELEASE_NOTES, and `docs/*` aligned to v0.2.0 (through D29).

### Fixed

- **Drag files into other apps** — `preventDefault` + sync `startDrag` so drops deliver CF_HDROP (HTML5-only drag showed a ghost but did nothing).
- **Ctrl+A in search** — selects search hits, not the underlying folder listing.
- **Recycle Bin (Del)** — robust trash path + suspended watches; preview no longer blocks recycle.
- **Right-button drag-drop** — pointer-capture ghost; tree drop keeps Copy/Move menu.
- **Search globs** — `*.jpg`, `img_??.png`, bare `.jpg` work; unindexed live-walk is recursive substring match.
- **Del vs Shift+Del** — no false “locked” when permanent delete works; clear refuse when volume cannot recycle.
- **Refresh (F5)** — reloads file list and loaded tree folders; drive list; navigates up if folder gone.
- **Folder rename** — file view vs tree rename source; click-away commits.
- **Context submenu clipping** — flip/shift/scroll to stay on-screen.
- **Image preview layout** — fills pane; compact details strip.
- **Delete/rename while previewing** — no open handles on browsed images.
- **False “locked by PowerShell”** — scanner ignores its own helper process.
- **File ops never fail silently** — Explorer-style modals; Restart Manager + process scan for lockers.
- **Tree rename** — F2 / context Rename in the tree.
- **View filter hides Windows Hidden** — omitted when filter on; dimmed when off.
- **Editable attributes in Properties** — Read-only, Hidden, Archive, System.
- **Full session tree restore** — `treeExpanded` per tab (D24).
- **Per-tab folder tree** — expand state independent per tab.
- **Quick access vs Drives tree** — opening Quick access no longer expands the user profile under Drives.
- **Wider tree / preview panes** — old fixed max widths removed.
- **PDF preview defaults** — `navpanes=0`, 100% zoom.
- **Offline / unmounted drive tabs** — kept after reboot; Offline UI + auto-retry (D3).
- **File view keyboard selection** — Home/End/arrows/Page* with Shift extend (Explorer-like).
- **Select next after delete** — matches Explorer.
- **Shared settings for dev and installed** — `%APPDATA%\MyFileExplorer` for both (D17).
- **Folder tree stale after Add / paste / rename** — parent children reload.

## [0.1.0] - 2026-08-01

First working product build (Phases 0–9 of the implementation plan).

### Added

- **Shell** — tab bar (new / close / activate / rename via double-click / drag reorder / middle-click close), toolbar with Back / Forward / Up / Refresh, interactive breadcrumb with overflow menu and Ctrl+L address editing, status bar with item / selection counts.
- **Three-pane layout** — lazy folder tree (quick access + drives) | virtualized file view | collapsible preview pane; splitter widths and collapsed state persisted in `session.json`.
- **Session restore** — tabs, per-tab history / view mode / sort / selection / scroll offset, active tab, and window bounds restored on launch (`session.json`, `window-state.json` under `userData`).
- **View modes** — extra large / large / medium / small icons with Sharp-generated thumbnails (cached under `userData/thumbs`, keyed by path + mtime + size), plus List and Details with sortable columns; folders-first setting.
- **File operations** — new folder (inline rename), new file with type picker, F2 rename, cut / copy / paste (internal + Windows `CF_HDROP` clipboard), drag-drop with Explorer modifier conventions (Ctrl=copy, Shift=move, same-volume default move), conflict prompts (Replace / Skip / Keep both / Cancel), Del → Recycle Bin, Shift+Del → permanent delete with confirm rules, Open, Show in system Explorer, Properties dialog.
- **Curated context menu** — Open, Open in new tab, Cut / Copy / Paste, Rename, Delete / Delete permanently, New, Copy path / name, Show in system Explorer, Add / Remove search index root, Properties.
- **Preview pane** — image / text / audio / video / PDF / binary / directory models with file fields; PNG `tEXt` / `zTXt` / `iTXt` parsing for A1111/Forge `parameters` (prompt, negative, steps, sampler, CFG, seed, size, model, hash, raw) and ComfyUI `prompt` / `workflow` JSON, all copyable.
- **Search** — opt-in indexed roots (SQLite via `node:sqlite`, FTS5 with LIKE fallback), background indexer with progress and parent-covers-child dedupe, live-walk fallback with progress + cancel; results show in the normal file view (D29) with “Not indexed — slow search” banner.
- **Settings** — dark / light / custom theme (CSS token editor), font family + size, default new-tab path, folders-first, permanent-delete confirmation, preview defaults, text preview byte cap, index root management, exclude dir names, thumbnail cache clearing; all applied live and persisted.
- **Security** — sandboxed renderer (no Node), typed preload bridge, Zod-validated IPC with `Result` envelope, `mfe-media://` protocol restricted to an allowlist (listed dirs, preview targets, thumb cache) with realpath re-checks.
- Tooling: electron-vite, TypeScript strict + `noUncheckedIndexedAccess`, ESLint (0 warnings), Prettier, Vitest (64 tests), electron-builder Windows target.

### Notes

- Dev and packaged builds share `%APPDATA%\MyFileExplorer` for settings/session (optional isolated `.dev-user-data/` via `MFE_ISOLATED_USER_DATA=1`).
- Search uses Node's built-in `node:sqlite` instead of `better-sqlite3` to avoid native rebuilds; FTS5 availability is detected at runtime with a LIKE fallback (see DECISIONS.md D16).

## [Unreleased — specs]

### Added

- Project specification set (`PLAN.md`, `docs/*`)
