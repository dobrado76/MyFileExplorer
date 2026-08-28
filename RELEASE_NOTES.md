# MyFileExplorer v0.13.0 — release notes

**Date:** 2026-08-28  
**Tag:** `v0.13.0` (package **0.13.0**)  
**Previous product baseline:** [v0.12.0](CHANGELOG.md#0120---2026-08-26)

Thirteenth product release (**v0.13**): **WinDirStat-style folder space maps** in the preview pane (**D66**), richer Calculate Statistics payloads, Git history/changes polish, Ctrl+file-op plan, and lock-owner End task (**D65**).

Full detail: [CHANGELOG.md](CHANGELOG.md). Folder stats / ADS: [docs/ADS.md](docs/ADS.md) · [docs/PREVIEW.md](docs/PREVIEW.md). Why switch from Explorer: [docs/ADVANTAGES.md](docs/ADVANTAGES.md).

---

## Highlights

### Folder space map (D66) — WinDirStat inside the file manager

After **Calculate Statistics** on a local NTFS folder, select that folder (not a Git repo root) and the preview pane becomes a **folder statistics card**:

- Summary counts and total size, **Newest content** vs Date modified, calculated age / may-be-stale
- Contents by category (count · bytes · %), top extensions, Largest, Recently modified
- **Space usage** treemap docked at the bottom — nested by folder path, cushion shading, color by extension; remainder as hatched **Other N files**
- Hover outlines containing folders (dark amber); click a tile to reveal; double-click to open
- Stats live in NTFS ADS (`FolderStatsPreview` + integer streams) with **host timestamps preserved** — no sidecars in your folders

Settings → Behavior → **Folder space map max files** (default **50000**, 100–50000). If the ADS JSON would exceed ~16 MB, N is reduced automatically; **Other** is always `total files − tiles shown`. Recalculate with a plain click after changing N (Shift+Calculate may retag once when JSON completeness rules change).

Explorer has no equivalent; you no longer need a separate WinDirStat window for everyday “what’s eating this folder?” questions.

### Git history & changes (D64 polish)

- **Changes** dialog from the toolbar changes summary (stage / unstage / discard / reveal / external diff; optional ignored list)
- **Commit detail** and **File history…** with compare in your configured diff tool
- Repo-root preview toolbar + commit context menu (branch, merge, reset with confirm, tags with optional origin push/delete, …)
- Clone via New → **GitHub Repository**; **Gitignore** from the context menu; ignored **I** overlays always on

### File ops & chrome

- Hold **Ctrl** on copy / move / paste / delete for a **plan** dialog (list, options, **Dry run**, then **Run**)
- **In use** review lists lock owners with **End task** / Locate / Refresh (**D65**)
- Tree pin vs toolbar hide control; custom media cover browse; Quick Launch / Global script per-pin icon size

---

## Install

1. Run `MyFileExplorer-0.13.0.exe` (GitHub Release or your Updates folder).
2. Settings stay in `%APPDATA%\MyFileExplorer`.
3. Before a PC swap: **Settings → About → Export…** (includes the script library and templates catalog; AI keys stay on the machine).

## Upgrade notes

- Fully quit and relaunch (IPC and preview chrome need a cold start after upgrade).
- **Calculate Statistics** again on folders you care about so `FolderStatsPreview` (and the space map) is written. Shift+Calculate may retag once if older tags lacked the JSON stream or used a different max-leaves cap.
- **Git**, Scripts, and Media Metadata stay **off** until you enable them.
- Notes, item icons, and folder statistics streams need **local NTFS**.
