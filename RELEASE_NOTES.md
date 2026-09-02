# MyFileExplorer v0.15.0 — release notes

**Date:** 2026-09-02  
**Tag:** `v0.15.0` (package **0.15.0**)  
**Previous product baseline:** [v0.14.0](CHANGELOG.md#0140---2026-08-30)

Fifteenth product release (**v0.15**): **user-defined metadata** (**D70**), **GPL-3.0-only** licensing (**D71**), experimental **Windows shell redirect** (**D72**), richer **media metadata** editing and library filters, plus polish on video thumbs / slideshow.

Full detail: [CHANGELOG.md](CHANGELOG.md). User metadata: [docs/USER_METADATA.md](docs/USER_METADATA.md) · media cards: [docs/MEDIA_METADATA.md](docs/MEDIA_METADATA.md) · shell redirect: [docs/WINDOWS_SHELL_REDIRECT.md](docs/WINDOWS_SHELL_REDIRECT.md) · licensing: [LICENSING.md](LICENSING.md). Why switch from Explorer: [docs/ADVANTAGES.md](docs/ADVANTAGES.md).

---

## Highlights

### User-defined structured metadata (D70, off by default)

Define metadata **sets**, bind them to folders, edit values on files/folders (`mfe_meta` ADS), optional Details columns, and Power Search `meta.<key>:`.

Enable under **Settings → Metadata**. Guide: [docs/USER_METADATA.md](docs/USER_METADATA.md).

### Windows shell redirect (D72, experimental)

Optional per-user redirect of ordinary `Directory` open/explore shell verbs to MyFileExplorer via a small `MfeShellLauncher.exe` (bundled in the installer).

- **Settings → Windows integration** — Enable, Test, Repair, Restore previous folder-opening configuration
- Machine-local registry state (not settings export/import)
- Win+E / taskbar Explorer / direct `explorer.exe` launches stay untouched

Guide: [docs/WINDOWS_SHELL_REDIRECT.md](docs/WINDOWS_SHELL_REDIRECT.md).

### Licence: GPL-3.0-only (D71)

The project is **GPL-3.0-only**, with a separate trademark policy for the MyFileExplorer name and logo. See [LICENSING.md](LICENSING.md) and [TRADEMARK.md](TRADEMARK.md).

### Media metadata polish (D50)

- **Edit metadata…** — fix inaccurate downloaded cards (title, year, cast, genres, synopsis, watched, episode fields) without editing ADS by hand. Preview / card hover / context menu; no stream yet → saves a **manual** card.
- Icon actions on the preview hero (same glyphs as media-card hover; labels in tooltips).
- Media-container tiles: hover download / edit / change cover / watched.
- **Watched** and **Genre** toolbar filters remembered **per library folder** (included in Settings export).

Guide: [docs/MEDIA_METADATA.md](docs/MEDIA_METADATA.md).

### Also in this release

- Slideshow context menu **Copy image** (clipboard bitmap)
- Renaming / same-volume moving a video also renames matching `!VIDTHUMB_CACHE` strip frames
- AI script generation: stronger UTF-8 / CJK path handling guidance

---

## Install

1. Run `MyFileExplorer-0.15.0.exe` (GitHub Release or your Updates folder).
2. Settings stay in `%APPDATA%\MyFileExplorer`.
3. Before a PC swap: **Settings → About → Export…** (script library, templates catalog, and media-library filter prefs included; AI keys and shell-redirect state stay on the machine).
4. **Optional OS projection:** install [WinFsp](https://winfsp.dev/), then `MfeVirtualFolderService-win-x64.zip` from the same Release.
5. **Shell redirect:** after install, **Settings → Windows integration** (experimental). The installer ships `MfeShellLauncher.exe` beside the main app.

## Upgrade notes

- Fully quit and relaunch (IPC / preload / launcher changes need a cold start).
- **User Metadata**, shell redirect, Git, Scripts, and Media Metadata stay **off** until you enable them.
- Licence text and notices are GPL-3.0-only going forward; see [LICENSING.md](LICENSING.md).
- Notes, item icons, folder statistics, and user metadata streams need **local NTFS**.
