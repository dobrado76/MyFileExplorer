# Changelog

All notable changes to MyFileExplorer are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

User-facing summary for the latest release: [RELEASE_NOTES.md](RELEASE_NOTES.md).

## [Unreleased]

### Changed

- **`npm run dist`** — auto-bumps the patch version, removes previous `MyFileExplorer Setup *.exe` from `dist/` (and prunes Settings → Updates folder to the new installer), then builds.

### Fixed

- **Preview while multi-selecting** — pane shows the most recently selected file (so you can Shift-select a range and still see where you stopped), with an “N selected” badge.
- **In-app left-drag** — dragging files onto folders works again (pointer gesture). OS export still works when the drag leaves the window (`startDrag` / CF_HDROP).

### Added

- **Disable hardware acceleration** — Settings → Advanced. Turns off Chromium GPU compositing (restart required) to free VRAM when sharing a GPU with training.
- **ComfyUI / JPEG Comments in preview** — reads Explorer “Comments” (EXIF UserComment / XPComment / JPEG COM) and decomposes A1111-style params (prompt, negative, Steps, Sampler, Schedule type, VAE, Denoising strength, Model, …), not just the raw string.
- **Drop files on tabs** — drag items onto a tab to move/copy into that tab’s folder (Ctrl=copy), so tabs work as sort categories.
- **Filter by generation base model** — Settings → View filter: keep Krea and/or SDXL-family (Pony/Illustrious/SDXL) images; hide SD 1.5 (and other families you uncheck). Uses A1111/Forge `Model` metadata in the file view and search results.
- **In-app Recycle Bin** — tab-bar Recycle Bin opens bin contents in the file view (like search). Restore (Enter / banner / context), Empty Recycle Bin, Del permanently removes from the bin. No longer launches Windows Explorer.

### Changed

- **Recycle Bin Details columns** — Original location (restore destination) and Date deleted, plus Size and Type; sortable headers.

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
