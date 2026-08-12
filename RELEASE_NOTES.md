# MyFileExplorer v0.6.3 — release notes

**Date:** 2026-08-12  
**Tag:** `v0.6.3` (package **0.6.3**)  
**Previous product baseline:** [v0.6.0](CHANGELOG.md#060---2026-08-12) · earlier: [v0.5.0](CHANGELOG.md#050---2026-08-11)

Sixth product line (**v0.6**). This tag ships the completed 0.6 series: Network & settings export from **0.6.0**, plus **opt-in remotes (D46)**, **context-menu Discover + layout (D41)**, and **experimental Linux packaging**.

Full detail: [CHANGELOG.md](CHANGELOG.md). Network: [docs/NETWORKS.md](docs/NETWORKS.md). Remotes: [docs/REMOTE_FTP.md](docs/REMOTE_FTP.md). Why switch from Explorer: [docs/ADVANTAGES.md](docs/ADVANTAGES.md). Linux (experimental): [docs/LINUX.md](docs/LINUX.md).

---

## Highlights

### Network neighborhood & mapped drives (D44 / D3) — since 0.6.0
- Tree **Network** section: remembered hosts paint immediately; async discovery (~20s budget) without blocking browse.
- Settings → **Network**: Automatic (default every **5** minutes) or Manual rediscovery; Discover now; Map / Disconnect.
- Disconnected **mapped letters** stay under Drives; click reconnects in-app (no need to open Explorer first).
- UNC `\\server` / shares; Map / Disconnect via native WNet dialogs.

### Settings export / import (D45)
Settings → About → **Export…** / **Import…** — portable JSON of **all** preferences, including:
- Theme, named layouts, folder views, slideshow
- **Full context-menu customization** (built-in hide/order/separators, Discover catalog + enabled verbs, Custom files/folders commands)
- Network discovery prefs + remembered hosts
- Remote connection **metadata** (no passwords)

Excludes main-window and dialog geometry. Open tabs unchanged (apply a named layout to restore a workspace). Re-enter remote passwords after import.

### Context menu Discover + layout (D41)
- **Discover** — scan static HKCR shell verbs (no COM shell extensions); results persist; tick to enable.
- Enabled Discover verbs appear on the live menu and as tinted, orderable rows under **Built-in** (enable/disable stays on Discover).
- **Built-in** — one-line rows, whole-row drag reorder, add/remove separators; order applies to the right-click menu.
- Hand-edited **Custom (files)** / **Custom (folders)** remain for Photoshop / VLC-style commands.

### Opt-in remote repositories (D46)
- Settings master switch (default **off**); FTP / FTPS / SFTP.
- Toolbar + tree section; `mfe-remote://` browse; upload/download; Open/preview via local scratch.
- FTP ops serialized per connection; Connect / Open busy dialogs.
- Spec: [docs/REMOTE_FTP.md](docs/REMOTE_FTP.md).

### Explorer-parity polish
- **Open Command Line here** — Terminal / PowerShell / cmd; **Shift+click** = Administrator (UAC).
- Context **Add** submenu uses the same shell type icons as toolbar **+ New**.
- Breadcrumb collapses middle segments only when the trail overflows.

### Experimental Linux packaging
- AppImage + Wayland-oriented helpers — contributor convenience only; **Windows remains primary**. See [docs/LINUX.md](docs/LINUX.md).

---

## Install

1. Run `MyFileExplorer Setup 0.6.3.exe` (or your Updates-folder / GitHub Release installer).
2. Settings live in `%APPDATA%\MyFileExplorer` (unchanged — reinstall does not wipe them).
3. Before a wipe / new PC: **Settings → About → Export…** so context menu, remotes metadata, and Network hosts come back with **Import…**.

## Upgrade notes

- Fully quit and relaunch after upgrade.
- If you used Discover before the Program Files path fix, **Rescan** once so truncated executables refresh.
- Remotes stay off until you enable them in Settings; re-enter passwords after import.
- Mapped-drive reconnect no longer depends on `WNetRestoreConnectionW` (often absent on current Windows).
