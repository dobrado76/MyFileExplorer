# Changelog

All notable changes to MyFileExplorer are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

- **Docs** — README, PLAN, and `docs/*` updated for video-preview generation (incl. recursive missing), file-op progress (D28), Recycle Bin (D7), and integration entry points.

### Fixed

- **Folder rename in file view** — F2 / Rename on a selected folder no longer fights the tree’s rename field (rename source is tree vs files).
- **Rename click-away commits** — leaving the inline rename field commits the name (Escape still cancels).
- **Context submenu clipping** — submenus flip/shift/scroll to stay inside the window.
- **Image preview uses the pane** — photo fills the space above details (contain/fit); dimensions move into the compact bottom strip; Path and bit-depth rows removed. Details use two columns when wide enough (Type/Size beside Date modified/Date created).
- **Delete/rename while previewing images** — image preview/viewer no longer keeps the source file open on Windows (buffered `mfe-media` responses + briefly detaching media before delete/move/rename), so Del is not blocked by our own preview.
- **False “locked by PowerShell” on delete** — the process scanner no longer reports its own PowerShell helper (the path was on that process’s command line) as the locker.
- **File ops never fail silently** — rename, move, copy, delete (Recycle Bin + permanent), undo/redo, and new file/folder failures always open a modal with an Explorer-style message. Lockers are resolved via Restart Manager plus a process path/command-line scan; when found, the dialog lists process name and PID. Own folder watchers are released before mutating so we don’t lock ourselves out.
- **Tree rename** — F2 and context-menu Rename work on folders in the left tree (inline edit), not only in the file view.
- **View filter hides Windows Hidden** — with the filter on (toolbar eye), items with the Hidden attribute are omitted from the list/tree (not just greyed). Turn the filter off to see them dimmed. Dotfiles are not treated as hidden unless Windows says so.
- **Editable attributes in Properties** — Read-only, Hidden, Archive, and System checkboxes (Windows) so you can change attributes without leaving the app.
- **Full session tree restore** — folder-tree expand/collapse is saved per tab in `session.json` (`treeExpanded`) and restored on relaunch, along with selection and scroll, so the workspace matches what you left.
- **Per-tab folder tree** — expand/collapse state is independent per tab (opening a folder in one tab no longer expands it in others).
- **Quick access no longer drills the drive tree** — opening Downloads (or any Quick access folder / subfolder) selects it under Quick access without expanding `C:\Users\…` in Drives.
- **Wider tree / preview panes** — removed the old 500px / 700px caps; side panes can grow with the window (only limited so the center file view stays usable).
- **PDF preview defaults** — preview iframe opens with no sidebar (`navpanes=0`) and **100%** zoom so text is readable without hunting Chromium PDF controls first.
- **Offline / unmounted drive tabs** — session tabs on encrypted or unmounted volumes are kept after reboot (no longer discarded). The file view shows **Offline**, auto-retries every ~8s (and refreshes the drive list), and recovers when the volume comes back. Manual **Retry now** available.
- **File view keyboard selection** — Home / End, arrows, and PageUp / PageDown move focus; Shift+Home / Shift+End (and Shift+arrows / Shift+Page*) extend the selection from the anchor to that point, like Explorer.
- **Delete uses the Recycle Bin** — Del / context Delete now call Windows `SHFileOperation` with `FOF_ALLOWUNDO` (not Electron `shell.trashItem`, which often skipped the bin). Shift+Del stays permanent. Locations without a Recycle Bin refuse Del with a clear error instead of silently nuking.
- **Select next after delete** — deleting items in the file view selects the next remaining item in the current sort order (or the previous if you deleted the last ones), matching Explorer.
- **Shared settings for dev and installed** — `npm run dev` and the installed app both use `%APPDATA%\MyFileExplorer` (no more separate `.dev-user-data` profile). One-time migration pulls newer `settings.json` / session / window state from legacy folders; Settings → Advanced shows the path. Reinstall leaves AppData alone.
- **Folder tree stale after Add / paste / rename** — creating a folder (or pasting/moving/renaming) now reloads the parent’s children in the tree instead of leaving the tree out of date until a manual expand/refresh.

### Added

- **Generate video previews** — context menu on folder background / folder / videos: write 20 evenly sampled frames into `!VIDTHUMB_CACHE` (Generate missing, Generate missing for all subfolders, or Regenerate all). Uses bundled ffmpeg; progress in the status bar (D26).
- **File-op progress bar** — copy, move, Recycle Bin, permanent delete, and video-preview generation show a determinate status-bar progress bar with “N of M” and the current file name (D28).
- **In-app image editor** — Edit button on image previews (and context menu) opens Filerobot (crop/adjust/filters/annotate/resize). **Save** keeps a pristine copy under AppData for Revert; **Save as…** writes a new file with no backup (D27).
- **PowerPoint preview** — `.pptx` shows slide text in the preview pane; legacy `.ppt` gets a best-effort text scrape (layout/images not rendered).
- **Extra large icons only, no filename** — new view mode above Extra large icons. Hides the label for files that actually show a content preview (image/PSD or video strip); folders and files without a preview still show their names.
- **Animated video thumbs in icon view** — when a sibling hidden `!VIDTHUMB_CACHE` folder has `{videoName}.thumb_1.jpg`…`thumb_20.jpg`, icon/thumbnail modes loop those frames instead of the plain shell video icon. Frame delay is Settings → Behavior → Video thumbnail frame delay (default 300ms; D26). Strips load lazily near the viewport; frames advance only after decode (no black flash); off-screen cells pause.
- **SafeTensors preview metadata** — `.safetensors` files show a compact summary (type/params/dtype), promoted training fields, and syntax-highlighted JSON for nested leftovers — header-only, no weight load, no redundant raw dump or filler icon.
- **Named workspace layouts** — save the current tabs (paths, titles, view/sort, tree expand, scoped roots) and pane chrome under a name (e.g. AI training, book editing, a project). Toolbar Layouts menu to apply/save; Settings → Layouts to update, rename, or remove. Stored in `settings.json` (D25).
- **Syntax-highlighted text previews** — HTML/XML, JSON, TypeScript/JavaScript, YAML, CSS, and other common languages in the preview pane (`highlight.js`, theme-aware colors).
- **Conflict compare** — on name conflicts while copying/moving, side-by-side Incoming vs Existing (image thumbs, size, dimensions, modified/created, paths). Decide per file or Skip/Keep both/Replace all; newer/larger sides are highlighted.
- **Recycle Bin on the tab bar** — far-right control opens the Windows Recycle Bin in system Explorer.
- **Undo / redo** — Ctrl+Z / Ctrl+Y (or Ctrl+Shift+Z) for delete-to-Recycle-Bin, move, copy, rename, and new file/folder. Context menu shows the action when available. Permanent delete is not undoable. Session-memory stack only (D23).
- **Manual updates** — Settings → Advanced: set an **Updates folder**, **Check for update** (newest `MyFileExplorer Setup x.y.z.exe`), then **Install update** to launch the installer and quit the app.
- **In-app image viewer** — double-click or Enter on images opens a full-window viewer (fit/actual size, ←/→ for siblings in the folder, Esc to close). Context menu **Open with default app** still launches the system association (e.g. Photoshop).
- **Customize this folder** — persist view mode, sort, and Details columns for a folder (context menu: this folder only, or this folder and subfolders). Exact match wins over the longest recursive ancestor; other paths keep the tab’s baseline view. Manage/remove in Settings → Folder views.
- **Extensive Details columns** — header right-click catalog now includes Image (dimensions, width/height, bit depth, color space, orientation, alpha, format), Audio/video (duration, bit rate, sample rate, channels, codec, container, frame rate, media width/height), Tags (title, artist, album, …), and Generation (seed, model, steps, sampler, CFG, size, prompts). Values load asynchronously via `meta:getMany` (Sharp + `music-metadata` + PNG A1111 parse), cached under `userData/column-meta`.
- **Windows shell icons** — tree, list/details, grid fallbacks, and search use real Explorer icons via `SHGetFileInfo` (special folders like Downloads, Dropbox/`desktop.ini` customs, exe/lnk); `app.getFileIcon` is fallback only. Cached under `userData/shell-icons`. Image/PSD content thumbnails unchanged.
- **Useful Quick access** — Desktop, Downloads, Documents, Pictures by default (replaces the lone Home entry). Manage in Settings → Quick access (add, remove, reorder, reset defaults, re-add builtins) or pin/unpin from the context menu / drop on the Quick access header; persisted in settings.
- **Richer Properties dialog** — drives show capacity / used / free with a usage bar (NTFS label & file system when available); folders calculate recursive size and file/folder counts; files show location, created/modified/accessed, and Windows attributes (Read-only, Hidden, System, Archive).
- **Inline audio/video preview** — play common media in the preview pane via `mfe-media://` (`<video>` / `<audio>` with controls). Video: mp4, m4v, webm, mkv, avi, mov, wmv, mpg, mpeg; audio: mp3, wav, flac, ogg, m4a, aac, wma, opus. Unsupported codecs fall back to “Open with default app”.
- **Global view filter** — hide files/folders from the file view, folder tree and search results by pattern (Settings → View filter, one per line). Supports `*` / `?` wildcards, everywhere patterns (`*\node_modules`, bare `Thumbs.db`) and absolute paths (`D:\folder\foldername`); matches hide all descendants; case-insensitive, `/` accepted. Toolbar eye button toggles the filter; status bar and search banner show how many items are hidden. Purely visual — filesystem Hidden attributes are never modified.
- **External open / Reveal** — single-instance lock; other apps can launch `MyFileExplorer.exe --reveal "D:\path\file"` (or `--open`, or `mfe://reveal?path=…`) and the existing window focuses a tab (file → parent folder + selection). See `docs/INTEGRATION.md`.
- **PSD preview** — Photoshop `.psd` shows as an image in the preview pane (and icon thumbs) via `ag-psd` + Sharp: embedded thumbnail when present, otherwise composite image. Cached under `userData`.
- **Rich document previews** — Markdown (`.md`/`.markdown`) rendered with GFM; spreadsheets (`.xls`/`.xlsx`/…) as sheet tabs + table; Word (`.docx` via mammoth, `.doc` via word-extractor); RTF text extraction; PDF embedded via Chromium’s viewer over `mfe-media://`. HTML sanitized with DOMPurify.
- **Scoped tabs ("Open as root in new tab")** — right-click a folder to open it in a new tab where it becomes the tree root: no Quick access/Drives, the breadcrumb starts at that folder, and navigation (Up, breadcrumb, address bar, search results) stays inside it. Persisted per tab in the session.
- **Customizable Details columns** — Explorer-style column management in Details view: drag header edges to resize, drag headers to reorder, right-click the header to show/hide columns (Name pinned; file columns plus image / A/V / tag / generation fields). Directory listings include `birthtimeMs`. Layout persists in settings.
- **Marquee (box) selection** — drag on empty file-view space to rubber-band select; Ctrl/Shift adds to the selection; auto-scrolls at pane edges; works across all view modes including virtualized off-screen rows.
- **Drop-target highlight** — folders light up under the cursor while dragging in the file view and tree; drag state fully clears on cancelled drags.
- **App icon** — distinct icon (amber folder + teal compass star on a navy rounded tile): `resources/icon.png` for the window/taskbar, `build/icon.ico` (256→16 px, PNG-encoded) for the exe and NSIS installer. Regenerate with `npm run icons` (`scripts/make-icons.mjs`, sharp-based; also rounds the master PNG's corners to transparency).
- **Context menu → Hide from view** — submenu on files and folders with “All instances (`*\name`)” and “Only this instance” (absolute path); adds the pattern to the view filter, enables it, and shows a status-bar notice. Works for multi-selections too. Context menu now supports submenus (hover or ArrowRight to open, ArrowLeft/Escape to close).
- **Context menu → Add** — on empty pane or a folder: Folder, common file types (Text, Markdown, JSON, CSV, JS/TS, Python, HTML, CSS, PowerShell, Batch), and Other…; creates with a unique name and starts inline rename.

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
- **Search** — opt-in indexed roots (SQLite via `node:sqlite`, FTS5 with LIKE fallback), background indexer with progress and parent-covers-child dedupe, live-walk fallback with progress + cancel and "Not indexed — slow search" banner, results list replacing the file pane.
- **Settings** — dark / light / custom theme (CSS token editor), font family + size, default new-tab path, folders-first, permanent-delete confirmation, preview defaults, text preview byte cap, index root management, exclude dir names, thumbnail cache clearing; all applied live and persisted.
- **Security** — sandboxed renderer (no Node), typed preload bridge, Zod-validated IPC with `Result` envelope, `mfe-media://` protocol restricted to an allowlist (listed dirs, preview targets, thumb cache) with realpath re-checks.
- Tooling: electron-vite, TypeScript strict + `noUncheckedIndexedAccess`, ESLint (0 warnings), Prettier, Vitest (64 tests), electron-builder Windows target.

### Notes

- Dev and packaged builds share `%APPDATA%\MyFileExplorer` for settings/session (optional isolated `.dev-user-data/` via `MFE_ISOLATED_USER_DATA=1`).
- Search uses Node's built-in `node:sqlite` instead of `better-sqlite3` to avoid native rebuilds; FTS5 availability is detected at runtime with a LIKE fallback (see DECISIONS.md D16).

## [Unreleased — specs]

### Added

- Project specification set (`PLAN.md`, `docs/*`)
