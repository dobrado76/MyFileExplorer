# Product specification

**Version:** 0.15.0
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
├─ Pane grid (1 / 2 / 3 / 2×2) ─────────────────── Preview (opt) ─┤
│  each pane: Nav + Breadcrumb + View | Tree | Files              │
└─────────────────────────────────────────────────────────────────┘
└─ Status: selection count, free space optional ──────────────────┘
```

- **Multi-pane views (D31):** toolbar control selects **1**, **2** (side-by-side), **3** (wide top + two bottom), or **4** (2×2). Each pane is a mini-explorer (own tree + files + Back/Forward/Up/breadcrumb/view). The folder-tree toggle lives on that pane’s toolbar so you can hide one tree in a split. Drag a tab onto a pane to show it there (one tab → one pane). Empty panes show a drop target. Toolbar search, keyboard nav, and **one shared preview** follow the **focused** pane; each tab keeps its own search results so you can drag hits onto another pane.
- Preview pane **collapsible**; collapsed state + widths persisted.
- Pane split ratios persisted in session.
- **Quick access** — Desktop, Downloads, Documents, Pictures by default (not a lone Home entry). Optional **named groups** (D58). Manage in Settings → Quick access (add/remove/reorder/reset, groups) or pin/unpin from the context menu / drop on the Quick access header or a group; persisted in settings.
- **Recycle Bin placement** — Settings → Appearance **Recycle Bin** (`recycleBinPlacement`: `none` | `tree` | `toolbar` | `both`, default `both`). Tree row after drive letters (labeled); optional icon-only tab-bar button. Opens the in-app bin. Drives header context still has Open / Empty.
- **Quick Launch (D63)** — toolbar pins for user-picked programs (name, path, optional args). Each pin shows **icon**, **label**, or **both**. Icon is the program glyph, a Lucide/Phosphor/Tabler + color, or a custom image. Settings → Quick Launch adds / edits / removes (no toolbar +; strip hidden when empty). Click launches; right-click Open file location / Remove; drop an `.exe` / shortcut on the strip to add when it is visible. Cap 24.
- **Git-aware browsing (D64)** — **opt-in** (off by default). Settings → Git. System `git` CLI; overlays, folder indicators, Details Git status column, active-pane toolbar, context **Git >**. Not a full Git GUI; distinct from D27 image Version Control. [GIT.md](GIT.md).
- **Drives** — live mounted letters (incl. mapped network drives). Click the **Drives** header for an all-volumes preview (pie charts) and status-bar free space. Click a letter for that volume’s free/total in the status bar (and a pie when nothing else is selected). Right-click the section header for **Computer Manager** (Windows Computer Management), **Device Manager**, **Control Panel**, **Open / Empty Recycle Bin**, **Map / Disconnect network drive**, and **Properties** (This PC) — native Windows windows where applicable; Recycle Bin stays in-app.
- **Network** (D44) — below Drives when LAN discovery is running or hosts were found. Expand a computer → SMB shares (async; does not block folder listing). Open UNC like Explorer; Map / Disconnect / Refresh on the Network header. Tunables in **Settings → Network** (auto vs manual rediscovery + interval). Full detail: [NETWORKS.md](NETWORKS.md).

---

## Tabs

| Requirement      | Detail                                                                                     |
| ---------------- | ------------------------------------------------------------------------------------------ |
| Multiple folders | One path + view state per tab                                                              |
| Persist          | Tabs + active index restored on launch                                                     |
| Title            | Default = current folder name; user may **rename** tab (custom title sticky until cleared) |
| Icon             | Optional **Lucide / Phosphor / Tabler** icon + color (optional `pack`, default Lucide), or a **custom** .png/.jpg/.ico (cover-cropped square). Right-click → Set icon → Custom icon… for image, label on/off, and size. Icon-only tabs use tight chrome so they work as categorizer drop bins. Session/layouts (D32 / D54) |
| Context menu     | Right-click tab: **Duplicate**, **Rename**, **Set/Change icon**, **Close**, **Reopen closed tab** / **Recently closed** / **Clear recently closed** |
| Reopen           | `Ctrl+Shift+T` restores the last closed tab (stack in `session.json`, cap 25). **Clear recently closed** empties the stack (persisted). Empty tab-bar context has the same items (D55) |
| Reorder          | Drag tabs to reorder; order persisted                                                      |
| Drop files       | Drag files onto a tab to **move/copy into that tab’s folder** (Ctrl=copy); use tabs as sort bins |
| Close            | Middle-click / close button / context menu; confirm if that tab has an in-progress destructive op (rare) |
| New tab          | Clone current path or open profile default (This PC / home — Settings); **Duplicate** copies path/view/title/icon |
| Named layouts    | Save/load the whole tab set + chrome as a named workspace (see Settings → Layouts)         |
| Drop onto pane   | Drag a tab onto a multi-view pane to assign it (moves if already in another pane)          |

Per-tab state to persist: `path`, `history` (back/forward stacks), `viewMode`, `sort`, `selection` (paths), `scrollOffset`, custom `title` (nullable), `icon` (nullable glyph `{ name, color, pack? }` or custom `{ kind: 'custom', id, showLabel, sizePx }`), `treeExpanded` (folder-tree expand/collapse paths).

**Named layouts (D25):** user can save the current workspace (all tabs’ paths/titles/icons/view/sort/rootPath/treeExpanded + tree/preview splitter chrome + multi-view `viewLayout`, pane tab assignments, **pane split ratios**, and the paired-folders compare filter when relevant) under a name (“AI training”, “Book editing”, backup/sync pairs, …), apply it later (replaces open tabs), update, rename, or remove. Toolbar Layouts menu for quick switch; Settings → Layouts for management. Orthogonal to per-folder view overrides.

---

## Navigation

- Interactive **breadcrumb** (click segment to jump; `…` overflow menu only when the trail does not fit). **Click empty address area** (or Ctrl+L) to type a path
- Address bar **Recent locations** dropdown from the tab’s history: **current on top**, then prior folders in Back order (newest previous first — same sequence as Back, Back, …); Forward entries follow when present
- **Back / Forward / Up**
- Address entry: paste/type absolute path or `C:\…` / UNC `\\server\share\…` / Windows `%VAR%` (e.g. `%LOCALAPPDATA%`) and Enter
- Folder tree: expand/collapse, select opens in **current** tab (Ctrl+click or middle-click → new tab — v1 nice-to-have; document as Phase 10 if deferred). Toolbar **Collapse all** (next to Select all) collapses every opened branch on the **current tab** only — same as a fresh This PC / Computer tree. Does not change the file list or other tabs.

---

## View modes

| Mode              | Behavior                                                    |
| ----------------- | ----------------------------------------------------------- |
| Extra large icons only, no filename | Like Extra large; hide the filename for items that show a content preview (image/PSD thumb, video strip, or a movie/show folder cover). Episode files still show `SxxExx` when stored, otherwise the filename (tooltip is always the filename). Other folders and files without a preview keep their names |
| Extra large icons | Image/PSD content thumbs; videos use `!VIDTHUMB_CACHE` strip animation when present (generate via context menu — D26); otherwise Windows shell icons |
| Large icons       | Same                                                        |
| Medium icons      | Same                                                        |
| Small icons       | Same                                                        |
| List / Details    | Compact name + Windows shell icon (or D62 Lucide / Phosphor / Tabler / custom / tinted overlay when set) |
| Details           | Columns: Name (pinned) + show/hide catalog via header right-click. Groups: File (modified/created/type/size/ext/**Alternate streams**, **Note** / **Status** / **Has note** / **Checklist**), Stream values (streams found in the current folder + **...** to type a name), Image (dimensions, width/height, bit depth, color space, orientation, alpha, format), Audio/video (duration, bit rate, sample rate, channels, codec, container, frame rate, media size), Tags (title/artist/album/…), Generation (A1111 seed/model/steps/sampler/CFG/size/prompts). Resizable, reorderable; layout persisted in settings. Media and ADS columns fill asynchronously (ADS lists non-empty stream names for files **and** folders when that column is visible — not on every `fs:list`). Stream-value columns show one named stream’s text preview. Context **Note…** / **Set icon…** (D61 / D62, NTFS). Context menu **Alternate streams…** opens a manager to list/add/edit/delete/import/export streams (D38). |

- Sort by any visible column (incl. media once values load); asc/desc; folders-first toggle in Settings (default on).
- Virtualize grids/lists for large directories.
- **Images:** double-click / Enter opens an in-app full-size viewer (navigate siblings with arrow keys). Preview **Edit** opens Filerobot (D27). **Open with default app** (context menu) uses the system association for external editors.
- **Customize this folder** (context menu on folder / empty pane): save current view mode, sort, and Details columns for that path — **this folder only** or **this folder and subfolders**. Exact entry wins over the longest recursive ancestor; other folders keep the tab’s baseline view + global columns. Live view/sort/column edits while a customization applies update that owning entry. Manage in Settings → Folder views.

---

## File operations

| Op                 | Behavior                                                                                                                                         |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| New folder         | Inline rename or dialog                                                                                                                          |
| New file           | Type picker (e.g. `.txt`, `.md`, `.json`, empty custom ext). Creates a unique stub then inline rename (same name-clash review as F2). **Other…** uses the typed name via that same rename path when the name already exists. **From Template** copies a user template; the catalog pretty name is the menu label and default filename stem (D57). **GitHub Repository** (menu item below From Template, not inside it) clones into a new folder (name + URL dialog; no rename mode) |
| Rename             | F2 / context; or **Explorer two-click rename**: click to select, pause past the double-click interval, click the **name** again → rename starts immediately. Fast double-click still opens / expands. Inline: Enter commits; Escape cancels; click-away / blur **commits**. A name that already exists opens the same D18 review as copy/move (Skip / Keep both `name (2).ext` / Replace / Keep most recent) |
| Power Rename       | Context **Power Rename…** (one or more selected files/folders): search/replace with optional regex or DOS `*`/`?` wildcards, match-all, case sensitivity, apply to filename and/or extension; collapsible **Advanced options** (case, remove, add, numbering, dates, filters, …); live preview with per-item checkboxes; Apply via rename; dialog Undo + session undo stack. Does **not** recurse into selected folders (D40). Guide: [POWER_RENAME.md](POWER_RENAME.md) |
| Scripts            | **Opt-in** (off by default). Settings → Scripting and AI → Enable scripting. Then: universal runner (PowerShell / **Python 3 only — not 2.x** / cmd / bash) on the current folder, selection, or **global** (no folder/selection; each global script is a toolbar button, hidden when none exist), live output, Stop. Saved library under `userData` becomes context **Scripts >** verbs. Optional AI generate/modify (never sends files). [SCRIPTS.md](SCRIPTS.md) (D51) |
| Git                | **Opt-in** (off by default). Settings → Git. Status overlays / toolbar / context Stage·Commit·Pull·Push. System `git` only; no credential storage. [GIT.md](GIT.md) (D64) |
| Cut / Copy / Paste | Internal clipboard + OS file paths. Non-file clipboard creates a file (D56; Settings → Behavior). **Paste Special** for format/name. Never auto-download a URL. |
| Drag-drop          | Default **move** within same volume; **copy** with Ctrl (Windows convention). Cross-volume drag = copy unless Shift forces move (match Explorer). **Right-button drag** → Copy here / Move here / **Create shortcuts here** menu on drop (`.lnk` via WScript). **Left-drag** moves/copies onto folders in-app; dragging out of the window uses `webContents.startDrag` (CF_HDROP) for other apps |
| Delete             | **Del** → Recycle Bin (`SHFileOperation` + `FOF_ALLOWUNDO` on Windows). Per-item failures continue; leftovers open the end-of-op review (D18). Optional tab-bar icon and/or tree row (Settings → Appearance **Recycle Bin**) open bin contents in the file view (Restore / Empty / permanent delete) — not system Explorer. Right-click the button or tree row for **Open** / **Empty Recycle Bin** (Empty confirms without opening the view first). **Drive roots** (`C:\`) are never deleted — Del / Shift+Del / context Delete are ignored with no message. Deleting a folder that is the **scoped root of any open tab** always confirms (Cancel / Delete) and warns those tabs will close; after a successful delete the affected tabs close (a replacement tab opens if that would leave none) |
| Permanent delete   | **Shift+Del** → unlink; **confirm** if more than one item or any directory. Same continue-then-review as trash when some items fail |
| Compress / Extract | Context **Compress to ZIP file** (bundled 7za, streamed) / **Extract All…** — sibling `.zip` or folder (Explorer naming); progress + Cancel (D30) |
| Progress           | Any file op the user waits on (>~1 s) shows status-bar feedback (D28): determinate when units/bytes advance, otherwise indeterminate busy          |
| Open               | Double-click / Enter → `shell.openPath`; folders navigate in-tab                                                                                 |
| Reveal             | “Show in system Explorer” via `shell.showItemInFolder`                                                                                           |
| Properties         | Detached OS window (peer of the shell — not modal, not parent-bound) with useful detail: type, location, dates; **attributes** on files/folders only (not drives). Files show size; folders calculate recursive size + contains; **drives show capacity / used / free** with a usage bar. **Multi-select → one combined sheet** (sums size/contains; no Attributes / Windows Properties / USN). **Shift+Properties → one window per path** (soft cap 32). Size/position persist. **Windows Properties…** opens Explorer’s own property sheet for Security / Sharing / etc. (not reimplemented in-app). **Drive Properties only (win32):** **USN…** opens the NTFS USN journal manager in that window (status / enable / resize / recent records / clear / disable). First-time Enable writes then deletes a `testing USN *.txt` on that volume so Recent immediately shows Create + Delete — D52 |

Copy / move / trash / delete **continue** through every item that does not need a decision. Conflicts, locks, and other per-item failures queue for one **review** at the end, grouped by similar kind, with apply-to-similar (Skip / Keep both / Replace / **Keep most recent** / Retry). Name conflicts still use side-by-side compare (thumbs for images; size/dates/type). **Replace** merges folder→folder into the existing destination (keeps folder ADS); overwrites files.  **In use** rows list locking processes (Restart Manager) with **End task** / Locate / Refresh, then Retry (D65). Same-folder copy-paste auto Keep both (`name (2).ext`) with no dialog, then selects the new copies. Disk-full / destination-gone stops remaining work to that destination but still opens review. After a local **copy** (and a **move** that copies across volumes), Created and Modified on the destination match the source (D53).

---

## Context menu (curated)

**Show only** (adjust during implementation, keep short):

- Open
- Open in new tab
- Open as root in new tab (scoped tab: folder becomes the tree root, navigation stays inside). Deleting that folder from any tab always confirms first and closes the tabs that used it as root.
- Pin to Quick access / Unpin from Quick access (folders)
- Cut / Copy / Paste
- Rename
- Power Rename… (search/replace + advanced panels with preview; files and folders in selection only)
- Scripts (only when Settings → Scripting and AI → Enable scripting; saved local scripts + Generate / Manage; each global script is a toolbar button; D51)
- User-defined commands (Settings → Context menu — separate lists for files vs folders; e.g. Edit in Photoshop, Play in VLC)
- Delete / Delete permanently
- Compress to ZIP file (single file, folder, or multi-select — sibling `.zip` like Explorer)
- Extract All… (on `.zip` selection — sibling folder named after the archive)
- Add → Folder / Text / Markdown / JSON / CSV / JS / TS / Python / HTML / CSS / PowerShell / Batch / From Template / GitHub Repository / **Virtual Folder** / Other…
- Copy path / Copy name
- Show in system Explorer
- Video previews → Generate missing / Generate missing (all subfolders) / Regenerate all (folder / empty pane); Generate video preview (selected videos)
- Media Metadata (only when Settings → Media Metadata is enabled, and only on folders or video files) → Extract from Plex / Download from Internet / Update / Clear / Consolidate subtitles / **Edit metadata…** / Change cover / Mark as Watched (toggles to Unwatched). Full guide: [MEDIA_METADATA.md](MEDIA_METADATA.md).
- Metadata set… / Metadata… (only when Settings → Metadata → Enable user metadata). Guide: [USER_METADATA.md](USER_METADATA.md).
- **Calculate Statistics** (local NTFS folders and volume roots) — depth-first tag subtree with size/counts + `FolderStatsPreview` for the preview space map (D66). On a **drive root**, compiles from each root folder’s ADS (retagging only untagged children) plus root files. After tagging, **propagates** into ancestors that already have stats (child + sibling ADS, no deep re-walk). **Shift+click** skips already-complete tags. Guide: [ADS.md](ADS.md).
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
- Text / code / Markdown / HTML source: **Word wrap** toggle in the preview header (remembered).
- Inline video/audio playback in-pane for common containers (see PREVIEW.md); MKV remuxed via ffmpeg when practical; **`.avi` / `.divx` / `.rmvb` / `.rm`** use thumb-strip + open with default app (no in-pane player).
- Office docs: Word, PowerPoint (`.pptx` approximate slide layout + images; `.ppt` best-effort text), spreadsheets, RTF — see PREVIEW.md.
- Windows shortcuts (`.lnk`): target path, arguments, start-in folder, comment, icon, hotkey; open shortcut or target.
- ZIP archives (`.zip`): nested contents tree in the preview pane + Extract All… (not zip-as-folder navigation).
- Other archives (`.7z`, `.rar`, `.tar`, `.tar.gz`, `.tgz`): same contents tree, list-only (no Extract All).
- Unity packages (`.unitypackage`): same contents tree (Unity `Assets/…` paths); list-only — no Extract All (import via Unity).
- Compiled HTML Help (`.chm`): Contents TOC + sandboxed topic HTML in the preview pane (D35).
- 3D meshes (`.obj` / `.fbx` / `.3ds`): WebGL orbit preview in-pane (D48).
- **Media metadata** (D50, opt-in): when enabled and a file/folder has stored streams, preview shows a fixed title + portrait cover above the video. With no file selected, the current show/movie folder keeps its card. Movie/TV fields and extracted file metadata share **Media** / **File** tabs under the player when both exist. Click the cover for a fullscreen view of the stored image. See [MEDIA_METADATA.md](MEDIA_METADATA.md).
- **User-defined metadata** (D70, opt-in): when enabled and the cwd resolves to a metadata set, preview shows a pinned Metadata editor; Details may show `showAsColumn` fields. See [USER_METADATA.md](USER_METADATA.md).
- **Folder statistics + space map** (D66): when Calculate Statistics has tagged a folder (or volume root), preview shows the rich card and WinDirStat-style space map (ADS read-only). Volume roots keep the free-space pie and add the map below. See [PREVIEW.md](PREVIEW.md), [ADS.md](ADS.md).
- **Virtual Folders** (D67): selecting a `.mfevirtual` file shows a Virtual Folder preview (counts / sample locations), not raw JSON. Opening navigates into the collection. See [VIRTUAL_FOLDERS.md](VIRTUAL_FOLDERS.md).
- **Virtual Folder OS projection** (D68, Windows, opt-in): Settings → Behavior; requires [WinFsp](https://winfsp.dev/) + projection service from GitHub Releases. See [VIRTUAL_FOLDER_PROJECTION.md](VIRTUAL_FOLDER_PROJECTION.md).
- **Git repository root** (D64, opt-in): repo-root selection shows **Git | Folder** tabs (**Git** = commit history by default; **Folder** = normal directory / stats card). See [GIT.md](GIT.md).

See [SEARCH.md](SEARCH.md).

- Search box: **as-you-type** (debounced) + Enter; scope = current folder (recursive) or “indexed roots only”.
- Toolbar **Power Search…** — visual query builder synced with the search box (Everything-style operators, including note / status / open checklist / user metadata). Named **saved searches** in the dialog (params only; target folder vs indexed is chosen when you run).
- **Folder roots** and optional **volume roots** (NTFS USN when available); Settings lists kind/monitor/status.
- Everything-inspired query language + Match path/case/whole-word/regex toggles; macros (`pic:`, …); optional `content:` (slow).
- Unindexed scope: best-effort walk with **streaming** partial results, progress in status bar + banner, cancel; never pretend to be instant (D15).
- Results use Details with a temporary **Folder** column (sortable; search-only, not saved); context **Open File Path** / **Open File in new tab** open locations in-app.
- Search is a **tab history location** (D29): Back/Forward restore folder or search (and the file-list scroll for that folder); each tab keeps its own query/results; switching tabs does not clear. Delete / move prunes those hits (and children of a removed folder).
- Saved **filters** / **bookmarks**; optional localhost HTTP search API (Advanced).

---

## Settings

The Settings dialog has a search box (filters as you type, no Search button) that narrows the section list and hides controls that do not match the keyword.

| Area         | Fields                                                                             |
| ------------ | ---------------------------------------------------------------------------------- |
| Appearance   | Theme dark / light / custom; font family; font size; icon size; **equal-width tabs** (`tabEqualWidth`, default off); **show tab icons** (`showTabIcons`, default on); **pin control to hide the folder tree** (`treePinToggle`, default on — off uses a per-pane toolbar button, flipped preview-panel icon); **Recycle Bin** (`recycleBinPlacement`: none / tree / toolbar / both, default both) |
| Behavior     | Default new-tab path; folders-first; **item check boxes** (`itemCheckboxes`, default off) — Explorer-style selection checkboxes in the file view; video thumb frame delay (`vidThumbFrameMs`); confirm permanent delete always on/off; **hide extensions in names** (`hideNameExtensions`, default `lnk`) — display-only, does not filter files; **Show folder statistics** (`showFolderStatistics`, default on); **Folder space map max files** (`folderStatsTreemapMaxLeaves`, default 50000, 100–50000) — N largest files kept in the Calculate Statistics space map (D66); skip-path list for Calculate failures |
| Preview      | Show preview by default; **autoplay media in preview** (`previewVideoAutoplay`, default off); text preview max bytes; word wrap |
| Context menu | **Built-in** show/hide + drag order/separators (includes tinted enabled Discover rows); **Discover** (scan static Windows shell verbs — persist catalog, tick to enable, Rescan keeps ticks); custom external commands for **files** and **folders** (separate lists): label (`\` for nested submenu), program path (`%ENV%` ok), args (`{path}` / `{paths}` / `{dir}` / `{name}`), extension match or all files; ordered; presets (Photoshop / VLC / VS Code / Notepad++). (D4 / D41) |
| Quick access | Manage tree shortcuts                                                              |
| Quick Launch | Toolbar apps: add / name / path / arguments / show (icon, label, both) / icon (app, glyph pack, custom) / order (D63) |
| Layouts      | Named workspaces: save current tabs/chrome, apply, update, rename, remove (D25)    |
| Folder views | List of per-folder view overrides (scope Folder/Tree, summary, go to, remove)      |
| View filter  | When on: hide Windows Hidden items and pattern matches from listings, tree and search (`*\name`, absolute `D:\a\b`, `*`/`?`). **View-only** for patterns; Hidden attribute toggled in Properties. Toolbar eye toggle; status bar shows hidden count |
| Search       | Folder + volume roots; monitor mode; reindex; excludes; match toggles; filters/bookmarks; persist **indexed** toggle |
| Network      | Discovery **auto** / **manual**; auto refresh interval (1–60 min, default 5); Discover now; Map / Disconnect network drive (D44) |
| Media Metadata | **Enable** (off by default). Preview **cover art size** (56–240 px tall, default 120). **Show season/episode and title on icon tiles** (default on). **Mix folders and files in media libraries** (off by default — Folders first; on = one A–Z list in icon/thumbnail views of a container folder; List/Details follow Behavior → Folders first). Plex URL / token / data folder; TMDB and OMDb API keys; preferred internet source. **Edit metadata…** plus card/preview icon actions; Watched/Genre filters persist per library folder. Context menu and covers stay hidden until enabled (D50). Guide: [MEDIA_METADATA.md](MEDIA_METADATA.md) |
| Metadata | **Enable user metadata** (off by default). Sets / fields / folder bindings / Metadata pack. Context **Metadata set…** / **Metadata…**, preview editor, Details columns, and Power Search `meta.<key>:` stay hidden until enabled (D70). Guide: [USER_METADATA.md](USER_METADATA.md) |
| Git | **Enable Git integration** (off by default). Executable / Test. Overlays, folder indicators, toolbar, status column, ahead/behind, ignored, refresh debounce, large-repo threshold, external diff tool. Guide: [GIT.md](GIT.md) (D64) |
| Scripting and AI | **Enable scripting** (off by default — hides toolbar Scripts and context Scripts). Interpreter path overrides. Nested **Enable AI** (off = no outbound AI HTTP). OpenAI-compatible providers (base URL, model, key in `safeStorage`). Test / Refresh models; model fields are dropdowns from `GET /v1/models` (cached). Privacy: never send paths/listings/contents. Guide: [SCRIPTS.md](SCRIPTS.md) (D51) |
| Advanced     | Clear shell-icon + thumb cache; **disable hardware acceleration** (restart; frees GPU VRAM for training); optional localhost search HTTP API |
| About        | App version; GitHub repository link; **Updates source** / Check / **What's new** (GitHub release notes) / Update; **Export / import settings** (D45) — portable JSON of all prefs including **context-menu customization** (built-in hide/order, Discover catalog + enabled, Custom commands), slideshow categorizer map, remembered Network hosts + remote connection metadata (not passwords / window/dialog geometry) |

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
| Ctrl+F          | Power Search          |
| Ctrl+Shift+F    | Focus toolbar search  |
| Ctrl+E          | Edit image (single editable image selected; otherwise ignored) |
| Ctrl+Shift+P    | Toggle preview        |
| F5 / Ctrl+R | Refresh current folder(s), drives, tree, and Network discovery |

---

## Acceptance highlights (v1)

- [ ] Launch restores previous tabs and active folder
- [ ] Splitter positions and tree / preview collapsed state restore
- [ ] Del trashes; Shift+Del permanently deletes with confirm rules
- [ ] DnD move vs copy respects modifiers
- [ ] Lengthy copy/move/delete shows status-bar progress
- [ ] Video preview strips generate from context menu (missing / recursive / regenerate)
- [ ] PNG with A1111/Comfy metadata shows prompt fields in preview when parseable
- [ ] Indexed folder search returns results without full-tree walk
- [ ] Theme + font changes apply live and persist
- [ ] CLI `--reveal` / `mfe://` opens the path in a tab
- [x] Experimental shell redirect (D72): Settings → Windows integration enables per-user Directory verb redirect with backup/restore
- [x] Edit media metadata (D50): dialog from context / preview / card hover; manual source when no card yet
- [x] Media library Watched/Genre filters persist per folder (`mediaMetadata.libraryFilters`)
