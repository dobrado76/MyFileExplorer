# Locked decisions

**Version:** 0.0.0 (spec)

Change only with an explicit decision update. Prefer amending this table over silent drift.

| ID  | Decision                                                                                                                                                    | Why                                                                     |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| D1  | **Windows-first** Electron desktop app; other OS later if ever                                                                                              | Matches Explorer replacement use case                                   |
| D2  | **All app state in Electron `userData`** — never write MyFileExplorer sidecars into browsed folders                                                         | User folders stay clean; backup/app reset is clear                      |
| D3  | **Tabs** are the primary navigation unit; restore session on launch. Unreachable paths (unmounted / encrypted drives) stay open as **Offline** and auto-retry until available — never drop session tabs just because a volume is offline | Multi-folder workflows; reboot + late-mounted volumes must not lose tabs |
| D4  | **Curated context menu** — short allowlist, not Explorer’s full verb dump                                                                                   | Speed and clarity                                                       |
| D5  | Preview shows **A1111 / ComfyUI metadata when parseable** from common embeddings (PNG tEXt/iTXt etc.); omit rows if absent                                  | Core user need for AI image libraries                                   |
| D6  | Search acceleration via **opt-in indexed roots** + **SQLite FTS5** under userData                                                                           | Fast search where it matters; no mandatory whole-disk index             |
| D7  | **Del** → Windows Recycle Bin via `SHFileOperation` + `FOF_ALLOWUNDO` (not Electron `shell.trashItem`); refuse Del on volumes that cannot recycle. **Shift+Del** → permanent unlink with confirm when multi-select or directories | Spec-accurate recycle; avoid silent permanent deletes                   |
| D8  | Themes = **CSS variables**; modes dark / light / custom token map; font family + size persisted                                                             | Comfort without theme-engine bloat                                      |
| D9  | **Typed preload IPC** + **Zod** validation; Result `{ ok, value \| error }` envelope                                                                        | Same reliability pattern as modern Electron apps                        |
| D10 | Thumbnails cached under userData keyed by **path + mtime + size**                                                                                           | Correct invalidation without hashing file bytes                         |
| D11 | Drag-drop: **Windows Explorer modifier conventions** (Ctrl=copy, default move same volume, etc.)                                                            | Muscle memory                                                           |
| D12 | Renderer has **no Node integration**; filesystem only through main                                                                                          | Security                                                                |
| D13 | Default tab title = **folder name**; custom title optional and sticky until cleared                                                                         | Renamed tabs for long-lived workspaces                                  |
| D14 | Preview pane and splitter sizes are **session chrome** (persist in `session.json`)                                                                          | Restore layout                                                          |
| D15 | Unindexed search is allowed but must show **progress + cancel** and never claim indexed speed                                                               | Honest UX                                                               |
| D16 | Search DB uses Node's built-in **`node:sqlite`** (Electron ≥ 35) instead of `better-sqlite3`; FTS5 detected at runtime with **LIKE fallback**               | No native rebuild toolchain required; same schema either way            |
| D17 | **`userData` is always `%APPDATA%\MyFileExplorer`** for both `npm run dev` and installed builds. Optional `MFE_ISOLATED_USER_DATA=1` → repo `.dev-user-data/`; `MFE_USER_DATA` overrides the path. One-time migrate from legacy `.dev-user-data` / `my-file-explorer` when those profile files are newer | Same prefs while developing and after install; reinstall must not feel like a reset |
| D18 | Transfer conflicts: `fs:checkConflicts` returns compare details (size/dates/dims). Dialog shows **side-by-side** incoming vs existing (image thumbs when applicable). User may decide **per file** or apply **Skip all / Keep both all / Replace all**; non-conflicting sources always transfer | Informed Replace/Skip/Rename without guessing from names alone |
| D19 | **Single-instance** app; CLI `--reveal`/`--open` and `mfe://` protocol forward into the running process as a tab (file → parent + selection) | Lets other apps replace “Reveal in Explorer” without spawning Explorer |
| D20 | Quick access defaults to **Desktop / Downloads / Documents / Pictures** (not Home alone); user can pin/unpin folders; state in settings | Home-only was wasted space; Explorer-familiar shortcuts |
| D21 | File/folder **icons come from the Windows shell** via `SHGetFileInfo` (koffi) on win32, with `app.getFileIcon` fallback; cached under userData. Content thumbs stay for images/PSD. Folder cache keys include `desktop.ini` mtime so Dropbox/custom folder icons refresh | Explorer-accurate special folders + desktop.ini; Electron’s API alone collapses most folders to one glyph |
| D22 | **Per-folder view overrides** in settings (`folderViews`): view mode, sort, Details columns; optional **recursive** scope. Exact match wins, else longest recursive ancestor. Does not lock the tab — non-matching paths keep the tab’s baseline view + global columns | AI libraries and media folders need different layouts without sticky tab modes |
| D23 | **In-app undo/redo** (Ctrl+Z / Ctrl+Y) for trash, move, copy, rename, and new file/folder. Stack is session-memory only (max 30). Trash undo restores via Recycle Bin; permanent delete is not undoable | Explorer muscle memory; no dependency on system-wide Explorer undo |
| D24 | Per-tab **folder-tree expand/collapse** persists in `session.json` as `treeExpanded` (path list, capped). With path, selection, scroll, view/sort, and chrome splitters, relaunch restores the same workspace view | Exact “leave and come back” continuity |

---

## Deferred (not v1 decisions)

- Archive browsing as virtual folders
- Plugin system for third-party context verbs
- Cloud provider namespace integration
