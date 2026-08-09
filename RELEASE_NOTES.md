# MyFileExplorer v0.3.0 — release notes

**Date:** 2026-08-09  
**Previous:** [v0.2.0](CHANGELOG.md#020---2026-08-06) (plus 0.2.x patches through 0.2.11)

Third product release. Focus: Explorer-parity polish on drag/drop, a real in-app Recycle Bin, large-folder performance, and the little “of course it should do that” fixes you notice after living in the app every day.

Full detail: [CHANGELOG.md](CHANGELOG.md). Why switch from Explorer: [docs/ADVANTAGES.md](docs/ADVANTAGES.md).

---

## Highlights

### Create shortcuts here (right-drag)
Right-button drag now matches Explorer’s drop menu: **Copy here / Move here / Create shortcuts here / Cancel**. Shortcuts are real `.lnk` files (great for `.exe`, `.bat`, folders, anything).

### Drag edge auto-scroll
While dragging, hold near the top or bottom of the file list or folder tree — the pane scrolls, like Explorer.

### In-app Recycle Bin
Tab-bar Recycle Bin opens bin contents in the normal file view. Restore, Empty, or permanently delete — no hop into system Explorer. Details shows Original location + Date deleted. Undo after Del restores for real.

### Tabs as sort bins
Drag files onto a tab to move/copy into that tab’s folder (Ctrl = copy).

### Large folders stay usable
Faster directory listing on Windows, smarter watch/reload behavior, and scroll that doesn’t re-render the whole shell every frame — folders with tens of thousands of files stay responsive.

### Preview & AI metadata
ComfyUI / JPEG Comments (and related EXIF) decompose into proper preview fields, not just a raw blob. Multi-select still previews the file you last focused, with an “N selected” badge.

### Shell icons that stay correct
Folder icons no longer get poisoned by a shared “no extension” file glyph. Tree folders look like folders again (Dropbox / special folders still resolve via the shell).

### Also in this release
- Disable hardware acceleration (Settings → Advanced) to free GPU VRAM
- Shift/Ctrl selection + drag without needing a second click
- Left-drag onto in-app folders reliable again; leave the window → OS drag-out
- `npm run dist` auto patch-bump + prune old Setup*.exe

---

## Install

1. Run `MyFileExplorer Setup 0.3.0.exe` (or your updates-folder installer).
2. Settings live in `%APPDATA%\MyFileExplorer` (unchanged from 0.2.x — reinstall does not wipe them).

## Upgrade notes

- Fully quit and relaunch after upgrade (main/preload changes: shortcuts IPC, icon hint, listing).
- If folder icons still look wrong once, Settings → Advanced → clear shell-icon cache, then restart.
