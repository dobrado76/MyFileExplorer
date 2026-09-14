# MyFileExplorer v0.18.0 — release notes

**Date:** 2026-09-14  
**Tag:** `v0.18.0` (package **0.18.0**)  
**Previous product baseline:** [v0.17.0](CHANGELOG.md#0170---2026-09-09)

Eighteenth product release (**v0.18**): smoother video handoffs and chrome, named layouts that keep up as you switch, and icon-view / Size-sort fixes that keep large folders responsive.

Full detail: [CHANGELOG.md](CHANGELOG.md). Preview / Now Playing: [docs/PREVIEW.md](docs/PREVIEW.md) · layouts: [docs/DECISIONS.md](docs/DECISIONS.md) **D25** · thumbs: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) · folder Size: [docs/FOLDER_STATISTICS.md](docs/FOLDER_STATISTICS.md). Why switch from Explorer: [docs/ADVANTAGES.md](docs/ADVANTAGES.md).

---

## Highlights

### Rich player and detached video polish

- **Click the video picture** to play/pause (same idea as Chromium’s `<video>`). The OSC bar stays for seeking and volume; the window caption / drag chrome do not toggle pause.
- **Keep playing → Dock** and **pop-out** resume at the real position instead of restarting from 0 (mpv IPC reads `time-pos` correctly; each session uses its own pipe; a stale Now Playing close cannot wipe the next session).
- In **detached preview** and **Now Playing**, the control bar **auto-hides after 3 seconds** of idle pointer activity and returns on move / click / wheel (including over the Rich player overlay). Docked preview keeps controls always visible.

### Named layouts auto-save

Switching layouts from the Layouts menu **overwrites the layout you left** with the live tabs and panes (on by default). **Save as…** still creates a new layout. Settings → Layouts can turn auto-save off; Update still writes without switching. The Settings list order is the menu order (↑↓).

### Faster icon views and correct Size sort

- Fast-scrolling Extra large / Large / Medium / Small icons no longer queues unbounded thumbnail encodes that stall preview. Newest visible tiles win; off-screen waiters are dropped; disk-cache hits skip the Sharp queue.
- After **Calculate Statistics**, Details **Size** sort uses each folder’s calculated `TotalSize`, so ascending/descending matches the displayed TB/GB/MB values (not the listing size of `0`).

---

## Install

1. Run `MyFileExplorer-0.18.0.exe` (GitHub Release or your Updates folder).
2. Settings stay in `%APPDATA%\MyFileExplorer`.
3. Before a PC swap, use **Settings → About → Export…**.
4. **Optional OS projection:** install [WinFsp](https://winfsp.dev/), then `MfeVirtualFolderService-win-x64.zip` from the same Release.
5. **Shell redirect:** after install, use **Settings → Windows integration** (experimental).

## Upgrade notes

- Fully quit and relaunch; IPC/preload changes require a cold start.
- **Rich player (mpv)** remains opt-in under Settings → Preview.
- Layout auto-save is **on** by default; turn it off in Settings → Layouts if you prefer manual Update only.
- User Metadata, shell redirect, Git, Scripts, Media Metadata, and Ask AI remain opt-in.
- Notes, item icons, folder statistics, user metadata, and ADS-preserving workflows require local NTFS.
