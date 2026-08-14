# Advantages over classic Windows File Explorer

**App:** MyFileExplorer · **Version:** 0.7.0

MyFileExplorer keeps Explorer muscle memory (tabs-like browsing intent, Del → Recycle Bin, Ctrl/Shift drag modifiers, shell icons, right-drag Copy/Move/Create shortcuts) while adding workflows Explorer does poorly or not at all. This is not a claim of full shell parity — see [PRODUCT_SPEC.md](PRODUCT_SPEC.md) non-goals and [DECISIONS.md](DECISIONS.md).

## Inspiration

Features are deliberately patterned after tools people already trust — then folded into one local file manager:

| Inspiration | What we borrow |
| ----------- | -------------- |
| **[Everything](https://www.voidtools.com/)** (voidtools) | Instant, operator-rich search over an opt-in index (folder roots + optional NTFS USN volume index), as-you-type, match toggles, filters/bookmarks — without forcing whole-disk indexing. |
| **[Q-Dir](https://www.softwareok.com/?seite=Freeware/Q-Dir)** (Quad Explorer) | **1 / 2 / 4** panes in one window — side-by-side or 2×2 mini-explorers, drag tabs into panes, shared preview follows focus. |
| **ACDSee** | Fullscreen **slideshow / categorizer** workflow: timed or manual advance, keyboard categorize/delete buffer, compiled file lists for large libraries, image-list cache. |
| **MS Paint** (and simple editors like it) | Fast **in-app image edit** for everyday crop / rotate / resize / annotate — open from preview, context menu, or Ctrl+E; versions as NTFS ADS on the file (`VER_*`), not a sidecar in your folder. |
| **[PowerToys PowerRename](https://learn.microsoft.com/en-us/windows/powertoys/powerrename)** | In-app **Power Rename** dialog: search/replace, regex, match-all, case options, apply to name/extension, live preview with checkboxes — without installing PowerToys. |

Other Explorer-adjacent muscle memory stays intentional (Del → Recycle Bin, drag modifiers, shell icons). Search depth: [SEARCH.md](SEARCH.md). Slideshow: [SLIDESHOW.md](SLIDESHOW.md). Image editor: [PREVIEW.md](PREVIEW.md) (D27).

---

## Workspace & navigation

| Advantage | Why it beats Explorer |
| --------- | --------------------- |
| **Everything-inspired search** | Opt-in folder + drive (NTFS USN) index, as-you-type, operators (`size:`, `ext:`, `pic:`, …), **Power Search** visual builder, match toggles, content scan, filters/bookmarks, optional localhost API — without mandatory whole-disk indexing. |
| **True multi-tab browsing** with full session restore | Tabs keep path, view mode, sort, selection, scroll, custom title, and tree expand state. Relaunch restores the workspace instead of a single window/folder. |
| **Named workspace layouts** | Save/apply whole tab sets + chrome (“AI training”, “Book editing”, …). Switch task contexts without rebuilding windows by hand. |
| **Q-Dir-style multi-pane (1 / 2 / 4)** | Side-by-side or 2×2 mini-explorers in one window; drag tabs into panes; shared preview follows focus. |
| **Scoped tabs** (“Open as root in new tab”) | A folder becomes the tree root; navigation stays inside that subtree — useful for large drives and project roots. |
| **Offline tabs that wait** | Unmounted / encrypted / network paths stay open as Offline and auto-retry. Disconnected **mapped letters** stay under Drives and reconnect on open (no Explorer required). Ejected USB volumes disappear immediately. |
| **Network neighborhood** | Async LAN discovery under the tree (never blocks browsing); remembered hosts on next launch; Settings → Network auto/manual rediscovery; Map / Disconnect via Windows dialogs. Details: [NETWORKS.md](NETWORKS.md). |
| **Opt-in FTP / FTPS / SFTP remotes** | Bookmark hosts, browse, upload/download, and open/preview via local scratch — without leaving the file manager. Not Explorer parity over the wire. Details: [REMOTE_FTP.md](REMOTE_FTP.md). |
| **Portable settings backup** | Export / import full preferences — theme, named layouts, **context-menu customization**, network hosts, remote connection metadata, … — without window position. Move to a new PC or survive an OS reinstall in one file. |
| **Per-folder view overrides** | Pin Extra large / Details columns / sort for one folder or a whole tree (exact path wins over recursive ancestors). Media libraries and code trees can look different without sticky global modes. |
| **Tabs as drop bins** | Drag files onto a tab to move/copy into that tab’s folder — use tabs as sort categories. |
| **Configurable Quick access** | Default Desktop / Downloads / Documents / Pictures; pin, unpin, reorder, reset in Settings — not a fixed Home-centric strip. |

---

## Preview & media

| Advantage | Why it beats Explorer |
| --------- | --------------------- |
| **Always-on rich preview pane** | Type-aware preview beside the list (toggle/width persisted). Explorer’s preview is weaker and often disabled or pane-starved. |
| **AI image generation metadata** | Parses A1111 / Forge / ComfyUI (and related) embeddings when present — prompts, seed, model, steps, etc. in the preview. Explorer shows none of this. |
| **In-app image editor (Paint-like)** | Crop / rotate / finetune / filters / annotate (Filerobot) — everyday edits without leaving the file manager. Saves tip ADS on NTFS (`VER_*`); `$DATA` stays original. **Version Control** submenu: commit / revert / preview versions; Drop from the preview banner. Entry: preview button, context menu, **Ctrl+E**. |
| **ACDSee-inspired slideshow** | Gated fullscreen slideshow + categorizer map (keyboard folder/delete buffer, commit on stop), image-list cache, and compiled file lists for huge libraries — Explorer has no equivalent. |
| **In-app image viewer** | Full-size view with sibling navigation; no forced hand-off to Photos for quick review. |
| **PSD preview & thumbs** | Rasterized Photoshop previews for browsing (when Maximize Compatibility embeds exist). |
| **Inline audio / video / PDF / Office-ish text** | Play or read in-pane for common types (byte-range video); Word/spreadsheet/RTF best-effort text; **`.pptx` approximate slides** (text + package images); `.ppt` text-only; shortcuts show target + open shortcut or target. |
| **HTML / Markdown Preview · Raw** | Rendered HTML (sanitized) and GFM Markdown by default, with a one-click jump to syntax-highlighted source. |
| **Executable / archives / CHM / fonts** | PE VERSIONINFO + shell icon; ZIP / 7z / RAR / TAR(.GZ) / Unity / APK / MSI / ISO / IMG contents trees (+ APK/MSI metadata); `.ttf` sample preview; `.chm` TOC + sandboxed topic viewer. |
| **Animated video icon strips** | Reads `!VIDTHUMB_CACHE` 20-frame strips in icon views; can **generate missing** (folder or recursive) or regenerate via bundled ffmpeg — browse video libraries by content, not generic glyphs. |

---

## Search & large libraries

| Advantage | Why it beats Explorer |
| --------- | --------------------- |
| **Everything-inspired search (D34)** | Opt-in folder roots + optional **Index this drive** (NTFS USN when available). As-you-type, match toggles, operators (`size:`, `ext:`, `pic:`, `path:`, …), **Power Search…** dialog, saved filters/bookmarks, optional localhost API — without mandatory whole-disk indexing. |
| **Search progress honesty** | Live walks stream partial results; status bar and banner show folder progress while searching — not a stuck `0 results` during long crawls. |
| **Honest unindexed / content search** | Live walk with progress + cancel; `content:` scans with an honesty banner — never pretends to be instant when it isn’t. |
| **Search results = normal file view** | Same icons/list/details, multi-select, preview, DnD, and context menu as a folder — not a stripped results list. Search is a **tab location** (Back/Forward); delete/move drops stale hits instead of leaving Explorer-style ghosts. |
| **Large folders stay usable** | Virtualized lists, fast Win32 directory listing, and careful watch/scroll behavior — tens of thousands of files without the freezes Explorer often hits. |
| **View filter** | Hide Hidden items and pattern matches (`*\name`, globs, absolute paths) from list, tree, and search — view-only declutter without deleting anything. |

---

## File operations & reliability

| Advantage | Why it beats Explorer |
| --------- | --------------------- |
| **Status-bar progress + Cancel** | Copy / move / trash / delete / rename / video-preview generation show clear progress; Cancel stops between items (and mid large-file copy). |
| **Continue-then-review bulk ops** | Copy / move / trash / delete keep going through every auto-ok item. One review at the end groups similar issues (already exist, in use, access denied, …) with apply-to-similar — including **Keep most recent**. Name conflicts still get side-by-side compare (size/dates/thumbs). No mid-copy “do this for all” stall. |
| **In-app Recycle Bin** | List, restore, empty, and permanently delete bin items in the normal file view — never forced into system Explorer. |
| **Windows Properties… when you need it** | In-app Properties covers size / dates / capacity; one click opens Explorer’s sheet for Security, Sharing, and other shell tabs. |
| **Session undo / redo** | Ctrl+Z / Ctrl+Y for trash, move, copy, rename, Power Rename, new file/folder (including Recycle restore) without depending on Explorer’s undo stack. |
| **In-app Power Rename** | Search/replace (literal or regex) across a selection with live preview and per-item include — no PowerToys shell extension required. |
| **Custom context commands** | Settings → Context menu: hide/reorder built-ins; **Discover** static shell verbs (tick to enable + order under Built-in); add “Edit in Photoshop”, “Play in VLC”, etc. for files and/or folders — without dumping every Explorer shell verb. All of it exports with settings (D45). |
| **Safer media handling** | Preview never uses `file://` on browsed paths; small media is buffered, large non-AV uses userData scratch, AV uses byte-range streaming so `<video>` actually plays. |
| **Drag-out to other apps** | Left-drag exports real paths (CF_HDROP) to Photoshop, mail, chat, etc., while in-app folder drops and right-drag menus still work. |
| **Compress / Extract ZIP** | Context menu packs a file, folder, or multi-selection into a sibling `.zip`, and **Extract All…** unpacks archives into a sibling folder — progress + Cancel, zip-slip safe. |
| **ZIP contents preview** | Select a `.zip` and see an expand/collapse file tree in the preview pane (inspect before extract) — Explorer’s preview rarely shows a useful archive tree. |
| **Unity package preview** | Select a `.unitypackage` and see the packaged `Assets/…` tree (GUID folders mapped via `pathname`) without extracting. |
| **CHM help preview** | Select a `.chm` for Contents + topic HTML in the preview pane (decompile under userData; no scripts in the iframe). |

---

## UI clarity & comfort

| Advantage | Why it beats Explorer |
| --------- | --------------------- |
| **Curated context menu** | Short allowlist of useful verbs — no Send to / Share / Git overlays. Optional **Discover** scans static Windows shell verbs; tick to enable and order them with built-ins (never auto-dumps Explorer). **Open Command Line here** opens a real Terminal/PowerShell window; **Shift+click** = Administrator. |
| **File Tools** | **Copy To…** / **Move To…** with an in-app target folder picker (multi-select); **Change Icon…** for a folder via `desktop.ini` + `Folder.ico`. |
| **Themes & typography** | Dark / light / custom CSS tokens; font family and size persisted. |
| **Details column catalog for media & generation** | Image, A/V, tags, and generation columns beyond Explorer’s usual set; layouts persist. |
| **NTFS Alternate Data Streams (D38)** | Opt-in **Alternate streams** column plus a manager to list/edit/delete/import/export streams — without scanning ADS on every folder list. |
| **Hide extensions in names (display-only)** | e.g. hide `.lnk` in the list without filtering files away. |
| **“Extra large icons only”** | Content thumbs without filename clutter when a preview exists. |
| **Disable hardware acceleration** | Settings option to free GPU VRAM (e.g. while training) — Explorer has no such control. |
| **No junk written into browsed folders** | App state, icon/thumb caches, image originals, and search DB live under `%APPDATA%\MyFileExplorer` only (video strips use an existing `!VIDTHUMB_CACHE` convention when you generate them). |

---

## Integration

| Advantage | Why it beats Explorer |
| --------- | --------------------- |
| **`mfe://` + CLI `--reveal` / `--open`** | Other apps can “Reveal in MyFileExplorer” into the running single-instance process (file → parent folder + selection). |
| **Same profile for dev and installed** | `%APPDATA%\MyFileExplorer` for both — reinstall / day-to-day use doesn’t feel like a settings reset. |

---

## What we deliberately do *not* chase

Full ribbon/Libraries/cloud-provider shell parity, hosting arbitrary shell extensions, zip-as-folder deep UX, and replacing the system file dialogs. Those stay non-goals so the product stays fast and curated — see [PLAN.md](../PLAN.md) and [PRODUCT_SPEC.md](PRODUCT_SPEC.md).

---

## Related docs

- [PRODUCT_SPEC.md](PRODUCT_SPEC.md) — full requirements  
- [DECISIONS.md](DECISIONS.md) — locked choices (through D46)  
- [PREVIEW.md](PREVIEW.md) — preview & generation metadata  
- [SEARCH.md](SEARCH.md) — indexing / Everything-inspired search  
- [NETWORKS.md](NETWORKS.md) — Network neighborhood & mapped drives  
- [REMOTE_FTP.md](REMOTE_FTP.md) — opt-in FTP/FTPS/SFTP remotes  
- [SLIDESHOW.md](SLIDESHOW.md) — ACDSee-inspired slideshow / categorizer  
- [ADS.md](ADS.md) — NTFS Alternate Data Streams  
- [../README.md](../README.md) — product overview  
