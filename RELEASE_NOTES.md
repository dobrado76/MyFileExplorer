# MyFileExplorer v0.2.0 — release notes

**Date:** 2026-08-06  
**Previous:** [v0.1.0](CHANGELOG.md#010---2026-08-01)

Second product release after the initial Phases 0–9 ship. Focus: Explorer-replacement reliability (Recycle Bin, locks, speed), search that uses the normal file view, drag-out to other apps, and clearer progress/cancel for long file ops.

Full detail: [CHANGELOG.md](CHANGELOG.md).

---

## Highlights

### Drag files into other apps
Left-drag now hands real paths to Windows (`webContents.startDrag` / CF_HDROP). Drop into Photoshop, mail attach, AI chat, Explorer, etc. On Windows, that OS drag takes over the gesture — use **right-drag** (Copy/Move menu) or cut/paste for rearranging inside the app.

### Search results = normal file view (D29)
Hits appear in the same list/details/thumbnails UI as a folder (multi-select, preview, DnD, context menu), with a banner and path under each name. Ctrl+A selects search hits. Globs and unindexed live-walk matching are fixed.

### Recycle Bin & delete reliability (D7)
Del prefers a fast sync recycle path; preview/media no longer keep browsed files open (`mfe-media` buffers or copies to userData scratch). Directory watches suspend during trash. Clear errors when a volume cannot recycle.

### Faster move & delete
Same-volume moves skip the pre-walk that only existed to count progress units. Trash avoids mandatory sleeps on the happy path.

### File-op progress & Cancel (D28)
Status bar: fixed progress bar → title → counts → name → **Cancel**. Cancel stops between items (and mid large-file copy). Indeterminate busy after ~1 s when an op is still running.

### Tree & right-drag
Folders drag from the tree (LMB/RMB); volume roots stay non-draggable. Right-drag uses pointer capture + ghost and opens Copy/Move/Cancel on drop.

### Also in this release
In-app image editor (Filerobot), video preview-strip generation, named layouts, richer Details columns / shell icons, undo/redo, offline tabs, hide-extensions setting, shortcut preview, and many Explorer-parity fixes (rename, refresh, properties attributes, keyboard selection, etc.) — see the changelog.

---

## Install

1. Run `MyFileExplorer Setup 0.2.0.exe` (or your updates-folder installer).
2. Settings live in `%APPDATA%\MyFileExplorer` (unchanged from 0.1; reinstall does not wipe them).

## Upgrade notes

- No settings migration beyond what 0.1 already did (shared AppData profile).
- If drag-out seems missing after upgrade, fully quit and relaunch (preload/main change).
