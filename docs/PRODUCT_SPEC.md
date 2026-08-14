# Product specification

**Version:** 0.7.0
**App:** MyFileExplorer

Windows-first desktop file manager: Explorer-familiar core, curated UX, rich previews, tabs, persistence, Everything-inspired opt-in search (D34). Linux AppImage helpers exist for contributors only — not a support matrix ([LINUX.md](LINUX.md)).

---

## Personas & jobs

| Job                     | Outcome                                                            |
| ----------------------- | ------------------------------------------------------------------ |
| Browse many folders     | Open several tabs; restore them next launch (offline volumes wait) |
| Inspect AI images       | See prompt / parameters / workflow fields in preview when embedded |
| Routine file ops        | Create, rename, cut/copy/paste, DnD, delete; Ctrl+Z / Ctrl+Y undo  |
| Find files fast | Opt-in folder/drive index; Everything-inspired query (D34)          |
| Comfortable UI          | Dark/light/custom theme; font family & size                        |

---

## Shell layout

```
┌─ Tab bar (reorder, rename, icon, close, new) ───────────────────┐
├─ New · Undo/Cut/Copy… | Layout 1|2|4 Search · Filter Preview Layouts Settings ─┤
├─ Pane grid (1 / side-by-side / 2×2) ──────────── Preview (opt) ─┤
│  each pane: Nav + Breadcrumb + View | Tree | Files              │
└─────────────────────────────────────────────────────────────────┘
└─ Status: selection count, free space optional ──────────────────┘
```

- **Multi-pane views (D31):** toolbar control selects **1**, **2** (side-by-side), or **4** (2×2). Each pane is a mini-explorer (own tree + files + Back/Forward/Up/breadcrumb/view). Drag a tab onto a pane to show it there (one tab → one pane). Empty panes show a drop target. Toolbar search, keyboard nav, and **one shared preview** follow the **focused** pane; each tab keeps its own search results so you can drag hits onto another pane.
- Preview pane **collapsible**; collapsed state + widths persisted.
- Pane split ratios persisted in session.
- **Quick access** — Desktop, Downloads, Documents, Pictures by default (not a lone Home entry). Manage in Settings → Quick access (add/remove/reorder/reset) or pin/unpin from the context menu / drop on the Quick access header; persisted in settings.
- **Drives** — live mounted letters (incl. mapped network drives). Right-click the section header for **Map / Disconnect network drive** (native Windows dialogs).
- **Network** (D44) — below Drives when LAN discovery is running or hosts were found. Expand a computer → SMB shares (async; does not block folder listing). Open UNC like Explorer; Map / Disconnect / Refresh on the Network header. Tunables in **Settings → Network** (auto vs manual rediscovery + interval). Full detail: [NETWORKS.md](NETWORKS.md).

---

## Tabs

| Requirement      | Detail                                                                                     |
| ---------------- | ------------------------------------------------------------------------------------------ |
| Multiple folders | One path + view state per tab                                                              |
| Persist          | Tabs + active index restored on launch                                                     |
| Title            | Default = current folder name; user may **rename** tab (custom title sticky until cleared) |
| Icon             | Optional **Lucide** icon + color on the tab (right-click → Set icon); session/layouts (D32) |
| Context menu     | Right-click tab: **Duplicate**, **Rename**, **Set/Change icon**, **Close**                 |
| Reorder          | Drag tabs to reorder; order persisted                                                      |
| Drop files       | Drag files onto a tab to **move/copy into that tab’s folder** (Ctrl=copy); use tabs as sort bins |
| Close            | Middle-click / close button / context menu; confirm if that tab has an in-progress destructive op (rare) |
| New tab          | Clone current path or open profile default (This PC / home — Settings); **Duplicate** copies path/view/title/icon |
| Named layouts    | Save/load the whole tab set + chrome as a named workspace (see Settings → Layouts)         |
| Drop onto pane   | Drag a tab onto a multi-view pane to assign it (moves if already in another pane)          |

Per-tab state to persist: `path`, `history` (back/forward stacks), `viewMode`, `sort`, `selection` (paths), `scrollOffset`, custom `title` (nullable), `icon` (nullable Lucide name + color), `treeExpanded` (folder-tree expand/collapse paths).

**Named layouts (D25):** user can save the current workspace (all tabs’ paths/titles/icons/view/sort/rootPath/treeExpanded + tree/preview splitter chrome + multi-view `viewLayout`, pane tab assignments, and **pane split ratios**) under a name (“AI training”, “Book editing”, …), apply it later (replaces open tabs), update, rename, or remove. Toolbar Layouts menu for quick switch; Settings → Layouts for management. Orthogonal to per-folder view overrides.

---

## Navigation

- Interactive **breadcrumb** (click segment to jump; `…` overflow menu only when the trail does not fit). **Click empty address area** (or Ctrl+L) to type a path
- Address bar **Recent locations** dropdown from the tab’s history: **current on top**, then prior folders in Back order (newest previous first — same sequence as Back, Back, …); Forward entries follow when present
- **Back / Forward / Up**
- Address entry: paste/type absolute path or `C:\…` / UNC `\\server\share\…` / Windows `%VAR%` (e.g. `%LOCALAPPDATA%`) and Enter
- Folder tree: expand/collapse, select opens in **current** tab (Ctrl+click or middle-click → new tab — v1 nice-to-have; document as Phase 10 if deferred)

---

## View modes

| Mode              | Behavior                                                    |
| ----------------- | ----------------------------------------------------------- |
| Extra large icons only, no filename | Like Extra large; hide the filename for files that show a content preview (image/PSD thumb or video strip). Folders and files without a preview keep their names |
| Extra large icons | Image/PSD content thumbs; videos use `!VIDTHUMB_CACHE` strip animation when present (generate via context menu — D26); otherwise Windows shell icons |
| Large icons       | Same                                                        |
| Medium icons      | Same                                                        |
| Small icons       | Same                                                        |
| List / Details    | Compact name + Windows shell icon                           |
| Details           | Columns: Name (pinned) + show/hide catalog via header right-click. Groups: File (modified/created/type/size/ext/**Alternate streams**), Image (dimensions, width/height, bit depth, color space, orientation, alpha, format), Audio/video (duration, bit rate, sample rate, channels, codec, container, frame rate, media size), Tags (title/artist/album/…), Generation (A1111 seed/model/steps/sampler/CFG/size/prompts). Resizable, reorderable; layout persisted in settings. Media and ADS columns fill asynchronously (ADS lists non-empty stream names for files **and** folders when that column is visible — not on every `fs:list`). Context menu **Alternate streams…** opens a manager to list/add/edit/delete/import/export streams (D38). |

- Sort by any visible column (incl. media once values load); asc/desc; folders-first toggle in Settings (default on).
- Virtualize grids/lists for large directories.
- **Images:** double-click / Enter opens an in-app full-size viewer (navigate siblings with arrow keys). Preview **Edit** opens Filerobot (D27). **Open with default app** (context menu) uses the system association for external editors.
- **Customize this folder** (context menu on folder / empty pane): save current view mode, sort, and Details columns for that path — **this folder only** or **this folder and subfolders**. Exact entry wins over the longest recursive ancestor; other folders keep the tab’s baseline view + global columns. Live view/sort/column edits while a customization applies update that owning entry. Manage in Settings → Folder views.

---

## File operations

| Op                 | Behavior                                                                                                                                         |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| New folder         | Inline rename or dialog                                                                                                                          |
| New file           | Type picker (e.g. `.txt`, `.md`, `.json`, empty custom ext)                                                                                      |
| Rename             | F2 / context; or **Explorer two-click rename**: click to select, pause past the double-click interval, click the **name** again → rename starts immediately. Fast double-click still opens / expands. Inline: Enter commits; Escape cancels; click-away / blur **commits** |
| Power Rename       | Context **Power Rename…** (one or more selected files/folders): search/replace with optional regex, match-all, case sensitivity, apply to filename and/or extension; live preview with per-item checkboxes; Apply via rename; dialog Undo + session undo stack. Does **not** recurse into selected folders (D40) |
| Cut / Copy / Paste | Internal clipboard + OS clipboard of file paths where practical                                                                                  |
| Drag-drop          | Default **move** within same volume; **copy** with Ctrl (Windows convention). Cross-volume drag = copy unless Shift forces move (match Explorer). **Right-button drag** → Copy here / Move here / **Create shortcuts here** menu on drop (`.lnk` via WScript). **Left-drag** moves/copies onto folders in-app; dragging out of the window uses `webContents.startDrag` (CF_HDROP) for other apps |
| Delete             | **Del** → Recycle Bin (`SHFileOperation` + `FOF_ALLOWUNDO` on Windows). Tab-bar **Recycle Bin** opens bin contents in the file view (Restore / Empty / permanent delete) — not system Explorer |
| Permanent delete   | **Shift+Del** → unlink; **confirm** if more than one item or any directory                                                                       |
| Compress / Extract | Context **Compress to ZIP file** (bundled 7za, streamed) / **Extract All…** — sibling `.zip` or folder (Explorer naming); progress + Cancel (D30) |
| Progress           | Any file op the user waits on (>~1 s) shows status-bar feedback (D28): determinate when units/bytes advance, otherwise indeterminate busy          |
| Open               | Double-click / Enter → `shell.openPath`; folders navigate in-tab                                                                                 |
| Reveal             | “Show in system Explorer” via `shell.showItemInFolder`                                                                                           |
| Properties         | App dialog with useful detail: type, location, dates, attributes; files show size; folders calculate recursive size + contains; **drives show capacity / used / free** with a usage bar. **Windows Properties…** (bottom-left) opens Explorer’s own property sheet for Security / Sharing / etc. (not reimplemented in-app) |

Conflicts (paste/name exists): side-by-side compare (thumbs for images; size/dates/type for all) then Replace / Skip / Keep both (rename), per file or apply to all. **Same-folder copy-paste** skips the dialog and auto Keep both (`name (2).ext`), selecting the new copies.

---

## Context menu (curated)

**Show only** (adjust during implementation, keep short):

- Open
- Open in new tab
- Open as root in new tab (scoped tab: folder becomes the tree root, navigation stays inside)
- Pin to Quick access / Unpin from Quick access (folders)
- Cut / Copy / Paste
- Rename
- Power Rename… (search/replace with preview; files and folders in selection only)
- User-defined commands (Settings → Context menu — separate lists for files vs folders; e.g. Edit in Photoshop, Play in VLC)
- Delete / Delete permanently
- Compress to ZIP file (single file, folder, or multi-select — sibling `.zip` like Explorer)
- Extract All… (on `.zip` selection — sibling folder named after the archive)
- Add → Folder / Text / Markdown / JSON / CSV / JS / TS / Python / HTML / CSS / PowerShell / Batch / Other…
- Copy path / Copy name
- Show in system Explorer
- Video previews → Generate missing / Generate missing (all subfolders) / Regenerate all (folder / empty pane); Generate video preview (selected videos)
- Hide from view → All instances (`*\name`) / Only this instance (adds to the view filter)
- Add folder to search index / Remove from index; **Index this drive** on drive roots (D34)
- Properties

**Do not** dump every Explorer verb (Send to, Share, Git overlays, 20+ third-party entries).

---

## Preview pane

See [PREVIEW.md](PREVIEW.md).

- Toggle show/hide; remember width.
- Selection: preview the **most recently selected** item (keyboard/mouse focus); when multi-select, still show that file’s rich preview and a “N selected” badge (not a blank summary).
- Type-specific fields; for images, parse embedded generation metadata when present.
- Markdown (`.md`) and HTML (`.html` / `.htm`): rendered Preview by default with a **Preview / Raw** toggle.
- Inline video/audio playback in-pane for common containers (see PREVIEW.md); MKV remuxed via ffmpeg when practical; **`.avi`** uses thumb-strip + open with default app (no in-pane player).
- Office docs: Word, PowerPoint (`.pptx` approximate slide layout + images; `.ppt` best-effort text), spreadsheets, RTF — see PREVIEW.md.
- Windows shortcuts (`.lnk`): target path, arguments, start-in folder, comment, icon, hotkey; open shortcut or target.
- ZIP archives (`.zip`): nested contents tree in the preview pane + Extract All… (not zip-as-folder navigation).
- Other archives (`.7z`, `.rar`, `.tar`, `.tar.gz`, `.tgz`): same contents tree, list-only (no Extract All).
- Unity packages (`.unitypackage`): same contents tree (Unity `Assets/…` paths); list-only — no Extract All (import via Unity).
- Compiled HTML Help (`.chm`): Contents TOC + sandboxed topic HTML in the preview pane (D35).

---

## Search

See [SEARCH.md](SEARCH.md).

- Search box: **as-you-type** (debounced) + Enter; scope = current folder (recursive) or “indexed roots only”.
- Toolbar **Power Search…** — visual query builder synced with the search box (Everything-style operators).
- **Folder roots** and optional **volume roots** (NTFS USN when available); Settings lists kind/monitor/status.
- Everything-inspired query language + Match path/case/whole-word/regex toggles; macros (`pic:`, …); optional `content:` (slow).
- Unindexed scope: best-effort walk with **streaming** partial results, progress in status bar + banner, cancel; never pretend to be instant (D15).
- Results use Details with a temporary **Folder** column (sortable; search-only, not saved); context **Open File Path** / **Open File in new tab** open locations in-app.
- Saved **filters** / **bookmarks**; optional localhost HTTP search API (Advanced).

---

## Settings

| Area         | Fields                                                                             |
| ------------ | ---------------------------------------------------------------------------------- |
| Appearance   | Theme dark / light / custom; font family; font size                                |
| Behavior     | Default new-tab path; folders-first; **item check boxes** (`itemCheckboxes`, default off) — Explorer-style selection checkboxes in the file view; video thumb frame delay (`vidThumbFrameMs`); **autoplay media in preview** (`previewVideoAutoplay`, default off); confirm permanent delete always on/off; **hide extensions in names** (`hideNameExtensions`, default `lnk`) — display-only, does not filter files |
| Context menu | **Built-in** show/hide + drag order/separators (includes tinted enabled Discover rows); **Discover** (scan static Windows shell verbs — persist catalog, tick to enable, Rescan keeps ticks); custom external commands for **files** and **folders** (separate lists): label (`\` for nested submenu), program path (`%ENV%` ok), args (`{path}` / `{paths}` / `{dir}` / `{name}`), extension match or all files; ordered; presets (Photoshop / VLC / VS Code / Notepad++). (D4 / D41) |
| Quick access | Manage tree shortcuts                                                              |
| Layouts      | Named workspaces: save current tabs/chrome, apply, update, rename, remove (D25)    |
| Folder views | List of per-folder view overrides (scope Folder/Tree, summary, go to, remove)      |
| View filter  | When on: hide Windows Hidden items and pattern matches from listings, tree and search (`*\name`, absolute `D:\a\b`, `*`/`?`). **View-only** for patterns; Hidden attribute toggled in Properties. Toolbar eye toggle; status bar shows hidden count |
| Preview      | Show preview by default; max preview bytes for text                                |
| Search       | Folder + volume roots; monitor mode; reindex; excludes; match toggles; filters/bookmarks; persist **indexed** toggle |
| Network      | Discovery **auto** / **manual**; auto refresh interval (1–60 min, default 5); Discover now; Map / Disconnect network drive (D44) |
| Advanced     | Clear shell-icon + thumb cache; **disable hardware acceleration** (restart; frees GPU VRAM for training); optional localhost search HTTP API |
| About        | App version; GitHub repository link; **Updates source** / Check / Update; **Export / import settings** (D45) — portable JSON of all prefs including **context-menu customization** (built-in hide/order, Discover catalog + enabled, Custom commands), slideshow categorizer map, remembered Network hosts + remote connection metadata (not passwords / window/dialog geometry) |

---

## Keyboard (minimum)

| Key             | Action                |
| --------------- | --------------------- |
| Backspace       | Up (when not editing) |
| Alt+← / →       | Back / Forward (focused pane) |
| Mouse Back / Forward | Back / Forward (focused pane) |
| Ctrl + mouse wheel | Font size (9–28 px) |
| Ctrl+T / W      | New tab / Close tab   |
| Ctrl+Tab        | Next tab              |
| F2              | Rename                |
| Ctrl+C/X/V      | Copy / Cut / Paste    |
| Del / Shift+Del | Trash / Permanent     |
| ↑↓ / ←→         | Move focus in file view (grid uses all four) |
| ←↑↓→ (folder tree focused) | Explorer nav pane: ↑↓ move selection; ← collapse / parent; → expand / first child |
| Home / End      | First / last item     |
| Shift+Home/End  | Select from cursor to first / last |
| Shift+arrows    | Extend selection      |
| PageUp / PageDown | Page through file view |
| Ctrl+F          | Focus search          |
| Ctrl+E          | Edit image (single editable image selected; otherwise ignored) |
| Ctrl+Shift+P    | Toggle preview        |
| F5 / Ctrl+R | Refresh current folder(s), drives, tree, and Network discovery |

---

## Acceptance highlights (v1)

- [ ] Launch restores previous tabs and active folder
- [ ] Splitter positions and preview collapsed state restore
- [ ] Del trashes; Shift+Del permanently deletes with confirm rules
- [ ] DnD move vs copy respects modifiers
- [ ] Lengthy copy/move/delete shows status-bar progress
- [ ] Video preview strips generate from context menu (missing / recursive / regenerate)
- [ ] PNG with A1111/Comfy metadata shows prompt fields in preview when parseable
- [ ] Indexed folder search returns results without full-tree walk
- [ ] Theme + font changes apply live and persist
- [ ] CLI `--reveal` / `mfe://` opens the path in a tab
