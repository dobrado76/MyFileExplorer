# MyFileExplorer v0.4.0 — release notes

**Date:** 2026-08-09  
**Previous:** [v0.3.0](CHANGELOG.md#030---2026-08-09) (plus 0.3.x patches)

Fourth product release. Focus: **Everything-inspired search** (hybrid folder + drive index, rich query language, as-you-type), preview depth (HTML/Markdown/Unity/executables/video), and Explorer-parity polish (multi-pane layouts, tab icons, drag cancel, Windows Properties).

Full detail: [CHANGELOG.md](CHANGELOG.md). Why switch from Explorer: [docs/ADVANTAGES.md](docs/ADVANTAGES.md). Search reference: [docs/SEARCH.md](docs/SEARCH.md).

---

## Highlights

### Everything-parity search (D34)
Opt-in **folder roots** and optional **Index this drive** (NTFS USN when available, walk fallback). As-you-type search, Match path / case / whole word / regex in a clean options menu, operators and macros (`size:`, `ext:`, `pic:`, `path:`, …), unindexed `content:` with an honesty banner, saved filters & bookmarks, optional localhost HTTP API. Results still use the normal file view (D29).

### Richer previews
- **HTML / Markdown** — rendered Preview by default with a **Preview / Raw** toggle  
- **Unity `.unitypackage`** — Assets tree (list-only)  
- **Executables** — VERSIONINFO details + real shell icon  
- **Video** — byte-range media; MKV remux when practical; AVI strip-only + Open  
- **`.wlt` / `.ffs_gui`**, batch / VBScript / `.ps` syntax highlighting  

### Workspace & Explorer parity
- Multi-pane **1 / 2 / 4** views with layout persistence (D31)  
- Tab icons + tab context menu (D32)  
- Recent locations in Back order; opposite-button drag cancel  
- **Windows Properties…** from the in-app Properties dialog  

### Settings
Larger Settings window; search index whitelist + exclude blacklist as compact lists.

---

## Install

1. Run `MyFileExplorer Setup 0.4.0.exe` (or your updates-folder installer).
2. Settings live in `%APPDATA%\MyFileExplorer` (unchanged from 0.3.x — reinstall does not wipe them).

## Upgrade notes

- Fully quit and relaunch after upgrade (search index schema migrates on first launch; new settings keys get defaults).
- Reindex large roots after upgrade if you want USN/watch monitors attached to existing folder roots.
- Search bookmarks/filters are empty until you add them under Settings → Search.
