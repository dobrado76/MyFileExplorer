# MyFileExplorer v0.21.0 — release notes

**Date:** 2026-10-19  
**Tag:** `v0.21.0` (package **0.21.0**)  
**Previous product baseline:** [v0.20.0](CHANGELOG.md#0200---2026-09-23)

Twenty-first product release (**v0.21**): slideshow Camera looks that stay off until you turn them on, NTFS Undelete from the toolbar, and a shortcut on a tab that drops the current selection into that folder.

Full detail: [CHANGELOG.md](CHANGELOG.md). Slideshow: [docs/SLIDESHOW.md](docs/SLIDESHOW.md) **D76** · undelete: [docs/UNDELETE.md](docs/UNDELETE.md) **D74** · name sort: [docs/DECISIONS.md](docs/DECISIONS.md) **D75**. Why switch from Explorer: [docs/ADVANTAGES.md](docs/ADVANTAGES.md).

---

## Highlights

### Camera looks on the slideshow

Settings → Slideshow → **Camera looks** is off until you turn it on, so photos you already have stay plain. Raise **Frequency** above 0% and pick effects in **Camera looks…** (grain, white balance, blur, and your own shader). A path filter can limit the effect to one folder, such as `\AI\`. Nothing is written to the file.

### NTFS Undelete

Settings → Appearance → **Show Undelete toolbar button** (off by default) adds an icon next to Recycle Bin. It scans a local NTFS volume for deleted file records and recovers the ones you pick into a folder you choose, keeping their relative parent paths. This is not Recycle Bin Restore.

### Drop a selection into a tab

Right-click a tab → **Set drop shortcut…**. That chord moves or copies the focused pane’s selection into that tab’s current folder. The shortcut is saved on the tab and in named layouts.

### Name order

Explorer’s name order stays the default. Settings → Behavior → **Name sort** can switch to character-by-character order. In a marked media library, thumbnail and icon order is still season then episode.

---

## Install

1. Run `MyFileExplorer-0.21.0.exe` (GitHub Release or your Updates folder).
2. Settings stay in `%APPDATA%\MyFileExplorer`.
3. Before a PC swap, use **Settings → About → Export…**.
4. **Optional OS projection:** install [WinFsp](https://winfsp.dev/), then `MfeVirtualFolderService-win-x64.zip` from the same Release.
5. **Shell redirect:** after install, use **Settings → Windows integration** (experimental).

## Upgrade notes

- Fully quit and relaunch; IPC/preload changes require a cold start.
- Camera looks stay off until you enable them. Frequency still starts at 0%, so turning the switch on alone does not change the show.
- The Undelete toolbar button stays hidden until you turn it on in Settings → Appearance.
- User Metadata, shell redirect, Git, Scripts, Media Metadata, and Ask AI remain opt-in.
- Notes, item icons, folder statistics, user metadata, undelete, and ADS-preserving workflows require local NTFS.
