# MyFileExplorer v0.7.0 — release notes

**Date:** 2026-08-14  
**Tag:** `v0.7.0` (package **0.7.0**)  
**Previous product baseline:** [v0.6.3](CHANGELOG.md#063---2026-08-12) · earlier: [v0.6.0](CHANGELOG.md#060---2026-08-12)

Seventh product release (**v0.7**): **Power Search**, deeper **folder statistics**, **slideshow crop**, richer **context-menu** nesting, and a large polish pass on search progress, tabs, splitters, and settings layout.

Full detail: [CHANGELOG.md](CHANGELOG.md). Search: [docs/SEARCH.md](docs/SEARCH.md). Slideshow: [docs/SLIDESHOW.md](docs/SLIDESHOW.md). Why switch from Explorer: [docs/ADVANTAGES.md](docs/ADVANTAGES.md).

---

## Highlights

### Power Search
- Toolbar **Power Search…** opens a visual query builder that maps to the same Everything-style language as the search box (`ext:`, `size:`, `dm:`, macros, exclude extensions, …).
- Live query preview; syncs with the toolbar search field; saved filters remain available from Settings → Search.

### Search progress & fixes
- Large folder / drive searches stream results while walking; status bar and banner show folder progress and “N found so far” instead of a stuck `0 results`.
- **Exclude extension** in Power Search works via `!ext:` (not mistaken for a name/path negation).
- Settings → Search **filters** and **bookmarks** Add UI works again.

### Folder statistics
- **Calculate Statistics** (folder context menu) walks the **entire subtree** depth-first — every subfolder gets immediate + rolled-up NTFS ADS streams (not only the root).
- Details columns renamed to **Files**, **Total Files**, **Folders**, **Total Folders**; no 250k cap; failures show an explicit alert with path + error.
- **Shift+click** skips already-tagged subtrees for faster incremental passes.

### Slideshow
- **Manual crop** during slideshow: numpad **2 / 4 / 6 / 8** trim edges (Shift/Ctrl for finer steps); **Enter** / Numpad **0** saves; **Esc** / Numpad **5** cancels.
- **Draw caption** — NTFS `Caption` ADS poster framing in slideshow, preview, and image viewer (when enabled in Settings).
- Compact Slideshow settings layout; categorizer **Import/Export** lives in **Mapping Manager** only (map still in global Settings export/import).

### Context menu & workspace
- Custom command labels use `\` to build **nested submenus** (e.g. `My Tools \ Option 1`).
- Full context-menu customization from v0.6.x: Discover, built-in reorder/separators, custom file/folder commands (`.bat` / `.cmd` launch fixed).
- **Tab bar** — Chrome-like width: tabs size to the widest label, equal-shrink to a minimum, then ◀ ▶ overflow scroll.
- **Multi-pane splitters** — 2- and 4-pane dividers resize and persist again.
- **Settings → About** — Updates source, Export/Import, and GitHub help link; modal **Close** + title-bar ✕.

### Carried from late 0.6.x (if you skipped nightlies)
- Opt-in **remote repositories** (FTP/FTPS/SFTP), **Network** neighborhood, portable settings export/import, experimental Linux AppImage helpers — see [v0.6.3 notes](CHANGELOG.md#063---2026-08-12).

---

## Install

1. Run `MyFileExplorer Setup 0.7.0.exe` (GitHub Release or your Updates folder).
2. Settings stay in `%APPDATA%\MyFileExplorer`.
3. Before a PC swap: **Settings → About → Export…** (includes categorizer map, context menu, remotes metadata, Network hosts).

## Upgrade notes

- Fully quit and relaunch after upgrade.
- Re-enter remote passwords after settings import if you use remotes.
- If you relied on categorizer map **Import/Export** from Settings → Slideshow, use **Mapping Manager…** instead (global export still includes the map).
