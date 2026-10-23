# MyFileExplorer v0.22.0 — release notes

**Date:** 2026-10-23  
**Tag:** `v0.22` (package **0.22.0**)  
**Previous product baseline:** [v0.21.0](CHANGELOG.md#0210---2026-10-19)

Twenty-second product release (**v0.22**): search results stay in the view you already chose, image-editor text works like other shapes, and a folder copy no longer stops because one file could not be written.

Full detail: [CHANGELOG.md](CHANGELOG.md). Search: [docs/SEARCH.md](docs/SEARCH.md) **D29** · image versions: [docs/ADS.md](docs/ADS.md) **D27** · preview editor: [docs/PREVIEW.md](docs/PREVIEW.md).

---

## Highlights

### Search keeps your view

A search no longer forces its own view. Thumbnails, icons, list, and Details stay as they are, including a Details sort such as date. Changing the view during a search writes that choice to the folder, so Clear leaves it in place. Date created uses the file's created time.

### Image editor text

On **Annotate**, draw a text box. It stays selected, with the same move and resize handles as a rectangle. Type in it, including **E**. **Escape** leaves the box and brings the handles back. **Escape** again closes the editor. **Ctrl+S** still saves from the box.

### Undo last edit

When the file has saved versions, **Undo last** in the editor top bar drops only the newest one and reloads the previous picture. The original file stays. The same action is **Undo last edit** on **Version Control**. If the editor still has unsaved changes, it asks first.

### Photoshop opens the file body

A context command that runs Photoshop on one image with versions asks whether to open the original or commit the newest edit into the file first. Commit removes the version history, then Photoshop opens.

### Folder copy keeps going

If one file in a folder cannot be written, the copy continues with the rest of that folder. An `.asar` archive is copied as one file.

---

## Install

1. Run `MyFileExplorer-0.22.0.exe` (GitHub Release or your Updates folder).
2. Settings stay in `%APPDATA%\MyFileExplorer`.
3. Before a PC swap, use **Settings → About → Export…**.
4. **Optional OS projection:** install [WinFsp](https://winfsp.dev/), then `MfeVirtualFolderService-win-x64.zip` from the same Release.
5. **Shell redirect:** after install, use **Settings → Windows integration** (experimental).

## Upgrade notes

- Fully quit and relaunch; IPC/preload changes require a cold start.
- User Metadata, shell redirect, Git, Scripts, Media Metadata, and Ask AI remain opt-in.
- Notes, item icons, folder statistics, user metadata, undelete, and ADS-preserving workflows require local NTFS.
- Image versions stay in NTFS streams on the file. A backup that drops alternate data streams drops those versions.
