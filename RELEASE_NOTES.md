# MyFileExplorer v0.17.0 — release notes

**Date:** 2026-09-09  
**Tag:** `v0.17.0` (package **0.17.0**)  
**Previous product baseline:** [v0.16.0](CHANGELOG.md#0160---2026-09-06)

Seventeenth product release (**v0.17**): keep video playing while you browse, use the optional mpv-backed rich preview, organize local AI chats, work with substantially richer user-defined metadata, and run safer paired-folder/file operations.

Full detail: [CHANGELOG.md](CHANGELOG.md). Paired folders: [docs/PAIRED_FOLDERS.md](docs/PAIRED_FOLDERS.md) · user metadata: [docs/USER_METADATA.md](docs/USER_METADATA.md) · preview: [docs/PREVIEW.md](docs/PREVIEW.md). Why switch from Explorer: [docs/ADVANTAGES.md](docs/ADVANTAGES.md).

---

## Highlights

### Now Playing and richer video preview

- **Keep playing** moves the current video into a sticky Now Playing window that does not follow file selection, leaving the docked preview free for browsing.
- Optional **Rich player (mpv)** handles MKV, WMV, AVI, and other containers that Chromium cannot play directly. It remains off by default.
- Standard MP4/M4V/WebM/MOV playback stays in Chromium; unsupported media gets a clear **Open with default app** fallback without ffmpeg remux/transcode locks.
- Detached preview and external-player behavior are more predictable, including responsive wide-window layout and safer overlay z-order.

### Ask AI chat

The new Ask AI window provides Markdown conversations organized in editable local folders. Chats can be nested, renamed, deleted, and dragged between folders. Media Metadata can seed a chat from title metadata only—never file contents or paths. Scripting and AI must be enabled.

Guide: [docs/AI_CHAT.md](docs/AI_CHAT.md).

### Expanded User Metadata (D70)

- Catalog Undo, Hygiene orphan recovery, and Pack Preview/Apply with conflict-safe dry runs
- Required/default values, width hints, icon badges, and reordered Choice/Icon tag options
- Bulk Leave/Set/Clear, in-column editing, metadata Copy/Paste, and in-folder facets
- Link fields, multi-icon tags, script manifests, and set-first Power Search selection

Existing `mfe_meta` values remain on the selected NTFS files/folders; no browsed-folder sidecar database is introduced.

Guide: [docs/USER_METADATA.md](docs/USER_METADATA.md).

### Media library improvements

- Details columns for title, year, kind, watched, genres, episodes, people, ratings, synopsis, and other stored Media Metadata
- Watched eye badges on media cards
- Marking a show or season watched/unwatched also updates episode files that already have metadata
- Cleaner compact preview titles from stored movie/episode metadata

### Safer synchronization and replacement

- Paired-folder conflict choices now execute the named side/direction, validate both comparison snapshots immediately before execution, and count only confirmed operation outcomes.
- Folder merge Replace stages incoming and existing items instead of deleting the destination first. Failed rollback retains and reports recovery data.
- Large/verified and fresh-directory copies preserve named NTFS alternate streams when requested.
- The preview protocol checks resolved realpaths only, preventing allowlisted symlinks from escaping approved roots.

### Also in this release

- Image Edit re-attaches A1111/ComfyUI generation metadata after Save, Save as, and slideshow crop.
- User Metadata catalog parsing keeps valid fields when one definition is invalid.
- Ask AI splitters no longer snap back after release.

---

## Install

1. Run `MyFileExplorer-0.17.0.exe` (GitHub Release or your Updates folder).
2. Settings stay in `%APPDATA%\MyFileExplorer`.
3. Before a PC swap, use **Settings → About → Export…**.
4. **Optional OS projection:** install [WinFsp](https://winfsp.dev/), then `MfeVirtualFolderService-win-x64.zip` from the same Release.
5. **Shell redirect:** after install, use **Settings → Windows integration** (experimental).

## Upgrade notes

- Fully quit and relaunch; IPC/preload changes require a cold start.
- **Rich player (mpv)** remains opt-in under Settings → Preview.
- **Ask AI** requires Scripting and AI to be enabled; it does not send files or paths.
- User Metadata, shell redirect, Git, Scripts, and Media Metadata remain opt-in.
- Notes, item icons, folder statistics, user metadata, and ADS-preserving workflows require local NTFS.
