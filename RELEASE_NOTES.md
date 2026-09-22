# MyFileExplorer v0.20.0 — release notes

**Date:** 2026-09-23  
**Tag:** `v0.20.0` (package **0.20.0**)  
**Previous product baseline:** [v0.19.0](CHANGELOG.md#0190---2026-09-20)

Twentieth product release (**v0.20**): Explorer-accurate name sort and rename typing, search that keeps your view and stays editable after leaving via the address bar, Image Edit crop/resize polish, and named layouts that remember every explorer window.

Full detail: [CHANGELOG.md](CHANGELOG.md). Layouts / windows: [docs/DECISIONS.md](docs/DECISIONS.md) **D25** / **D73** · search: [docs/SEARCH.md](docs/SEARCH.md) · image edit: [docs/PREVIEW.md](docs/PREVIEW.md). Why switch from Explorer: [docs/ADVANTAGES.md](docs/ADVANTAGES.md).

---

## Highlights

### Explorer-accurate names and rename

Name sort uses Windows `StrCmpLogicalW` (digit runs as numbers; `002` before `02` before `2`). While renaming, Del and Backspace edit the text; releasing a selection drag outside the name box no longer ends rename.

### Search keeps the view — and the search box

Results stay in thumbnails, icons, list, or Details (no forced Details). Leaving a search via the breadcrumb cancels any in-flight walk so the toolbar search field stays editable.

### Image Edit: crop and resize that behave

Crop handles no longer jump back mid-drag when the rest of the app re-renders. Locked resize Width/Height follow the current (cropped) aspect ratio. Entering Crop or Remove after any in-session change bakes the working canvas first. Image thumbs refresh when tip ADS edits change without touching `$DATA`.

### Layouts across every window

A named layout stores each explorer window’s tabs plus position, size, and maximized state. Applying it restores that set and closes extra windows.

---

## Install

1. Run `MyFileExplorer-0.20.0.exe` (GitHub Release or your Updates folder).
2. Settings stay in `%APPDATA%\MyFileExplorer`.
3. Before a PC swap, use **Settings → About → Export…**.
4. **Optional OS projection:** install [WinFsp](https://winfsp.dev/), then `MfeVirtualFolderService-win-x64.zip` from the same Release.
5. **Shell redirect:** after install, use **Settings → Windows integration** (experimental).

## Upgrade notes

- Fully quit and relaunch; IPC/preload changes require a cold start.
- Named layouts saved before this release still restore the main window only until you **Update** / re-save them with secondary windows open.
- User Metadata, shell redirect, Git, Scripts, Media Metadata, and Ask AI remain opt-in.
- Notes, item icons, folder statistics, user metadata, and ADS-preserving workflows require local NTFS.
