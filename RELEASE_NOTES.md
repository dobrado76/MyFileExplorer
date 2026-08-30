# MyFileExplorer v0.14.0 — release notes

**Date:** 2026-08-30  
**Tag:** `v0.14.0` (package **0.14.0**)  
**Previous product baseline:** [v0.13.0](CHANGELOG.md#0130---2026-08-28)

Fourteenth product release (**v0.14**): **Virtual Folders** (`.mfevirtual`, **D67**) and optional **OS projection** on Windows (**D68** / WinFsp), plus folder-stats and Git preview polish carried from the unreleased line.

Full detail: [CHANGELOG.md](CHANGELOG.md). Virtual Folders: [docs/VIRTUAL_FOLDERS.md](docs/VIRTUAL_FOLDERS.md) · projection: [docs/VIRTUAL_FOLDER_PROJECTION.md](docs/VIRTUAL_FOLDER_PROJECTION.md). Why switch from Explorer: [docs/ADVANTAGES.md](docs/ADVANTAGES.md).

---

## Highlights

### Virtual Folders (D67)

Portable **`.mfevirtual`** JSON collections of path references — not copies, not one physical directory.

- Open as a first-class folder location (`Tab.path` = the document file)
- Nested Virtual Folders are **embedded groups** inside the same JSON
- New → Virtual Folder; drop/paste adds references; Del removes membership
- Extract an embedded group to a real folder (spawns a new `.mfevirtual`); absorb a document back into another collection (move deletes the source file after unproject)
- Manual sort + Location column; dedicated preview

### OS projection (D68, Windows, optional)

When enabled, Explorer and other apps see the same collection at a sibling folder: `Name.mfevirtual` → `Name\`.

1. Install **[WinFsp](https://winfsp.dev/)** (required; not bundled).
2. Download **`MfeVirtualFolderService-win-x64.zip`** from this GitHub Release, unzip somewhere permanent, run **`Install-ProjectionService.ps1`**.
3. In MyFileExplorer: **Settings → Behavior → Virtual Folder OS projection**.

Guide: [docs/VIRTUAL_FOLDER_PROJECTION.md](docs/VIRTUAL_FOLDER_PROJECTION.md). Local disk only in v1.

### Also in this release

- Calculate Statistics **Skip folder** no longer stalls the walk
- Drive / parent folder statistics rollup; Git repo-root preview **Git | Folder** tabs
- `.asf` treated as video across preview, search, and media metadata

---

## Install

1. Run `MyFileExplorer-0.14.0.exe` (GitHub Release or your Updates folder).
2. Settings stay in `%APPDATA%\MyFileExplorer`.
3. Before a PC swap: **Settings → About → Export…** (includes the script library and templates catalog; AI keys stay on the machine).
4. **Optional OS projection:** install [WinFsp](https://winfsp.dev/), then the `MfeVirtualFolderService-win-x64.zip` from the same Release (see Highlights above).

## Upgrade notes

- Fully quit and relaunch (IPC / preload changes need a cold start).
- Virtual Folder OS projection stays **off** until you enable it and install WinFsp + the service.
- **Git**, Scripts, and Media Metadata stay **off** until you enable them.
- Notes, item icons, and folder statistics streams need **local NTFS**.
