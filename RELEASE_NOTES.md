# MyFileExplorer v0.19.0 — release notes

**Date:** 2026-09-20  
**Tag:** `v0.19.0` (package **0.19.0**)  
**Previous product baseline:** [v0.18.0](CHANGELOG.md#0180---2026-09-14)

Nineteenth product release (**v0.19**): extra explorer windows on another monitor, Power Search filters for created / accessed dates and NTFS streams, and a slideshow that can stay in one folder.

Full detail: [CHANGELOG.md](CHANGELOG.md). Windows: [docs/DECISIONS.md](docs/DECISIONS.md) **D73** · search: [docs/SEARCH.md](docs/SEARCH.md) · slideshow: [docs/SLIDESHOW.md](docs/SLIDESHOW.md). Why switch from Explorer: [docs/ADVANTAGES.md](docs/ADVANTAGES.md).

---

## Highlights

### Detachable explorer windows

Tab menu **Move to new window** opens another shell of the same app (its own monitor, same settings). **Merge into main window** sends those tabs back. Closing that window asks **Merge**, **Close tabs**, or Cancel. **Reopen closed window** restores the last closed one. Dragging a tab off the bar is not in this version. Closing the main window folds extra windows back in with no extra prompt.

### Power Search dates and ADS

The builder uses tabs. **Date** covers created, modified, and last accessed (`dc:` / `dm:` / `da:`, alias `dateaccessed:`). **Metadata** covers ADS streams (`stream:`, `hasstream:`) and user metadata. Missing created or accessed times do not fall back to modified time.

### Slideshow: one folder or the tree

Settings → Slideshow → **Include subfolders** stays on, so Start Slideshow still walks child folders. Turn it off to use only the folder you selected.

---

## Install

1. Run `MyFileExplorer-0.19.0.exe` (GitHub Release or your Updates folder).
2. Settings stay in `%APPDATA%\MyFileExplorer`.
3. Before a PC swap, use **Settings → About → Export…**.
4. **Optional OS projection:** install [WinFsp](https://winfsp.dev/), then `MfeVirtualFolderService-win-x64.zip` from the same Release.
5. **Shell redirect:** after install, use **Settings → Windows integration** (experimental).

## Upgrade notes

- Fully quit and relaunch; IPC/preload changes require a cold start.
- **Include subfolders** is on by default, so existing slideshow walks stay recursive until you turn it off.
- Created and last-accessed Power Search need a **reindex** of existing roots. Until then those times are missing and the date filters match nothing for them.
- Re-run **Calculate Statistics** if you want `.ts` / `.mts` sizes reclassified (small TypeScript vs large MPEG-TS).
- User Metadata, shell redirect, Git, Scripts, Media Metadata, and Ask AI remain opt-in.
- Notes, item icons, folder statistics, user metadata, and ADS-preserving workflows require local NTFS.
