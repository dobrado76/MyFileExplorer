# MyFileExplorer v0.6.0 — release notes

**Date:** 2026-08-12  
**Previous:** [v0.5.0](CHANGELOG.md#050---2026-08-11) (plus 0.5.x patches through 0.5.10)

> Current package line is still **0.6.x** (e.g. 0.6.3). Post-0.6.0 patches — including **experimental Linux packaging** — are tracked under [CHANGELOG Unreleased](CHANGELOG.md#unreleased). This document is the **v0.6.0** product-release summary.

Sixth product release. Focus: **Network neighborhood & mapped drives** (D44 / D3), **portable settings export/import** (D45), and Explorer-parity polish (Open Command Line, context Add icons).

Full detail: [CHANGELOG.md](CHANGELOG.md). Network: [docs/Networks.md](docs/Networks.md). Why switch from Explorer: [docs/ADVANTAGES.md](docs/ADVANTAGES.md). Linux (experimental): [docs/LINUX.md](docs/LINUX.md).

---

## Highlights

### Network neighborhood & mapped drives (D44 / D3)
- Tree **Network** section: remembered hosts paint immediately; async discovery (~20s budget) without blocking browse.
- Settings → **Network**: Automatic (default every **5** minutes) or Manual rediscovery; Discover now; Map / Disconnect.
- Disconnected **mapped letters** stay under Drives; click reconnects via `WNetAddConnection2W` (no need to open Explorer first).
- UNC `\\server` / shares; Map / Disconnect via native WNet dialogs.

### Settings export / import (D45)
Settings → Advanced → **Export…** / **Import…** — portable JSON of all preferences (theme, named layouts, folder views, slideshow, context menu, network discovery, remembered hosts, …). Excludes main-window and dialog geometry. Open tabs unchanged (apply a named layout to restore a workspace).

### Explorer-parity polish
- **Open Command Line here** on folders (tree / list / empty pane) — visible Windows Terminal / PowerShell / cmd; **Shift+click** = Administrator (UAC).
- Context **Add** submenu uses the same shell type icons as toolbar **+ New**.
- Export/import action card wraps so Import is never clipped.

---

## Install

1. Run `MyFileExplorer Setup 0.6.0.exe` (or your updates-folder installer).
2. Settings live in `%APPDATA%\MyFileExplorer` (unchanged — reinstall does not wipe them).

## Upgrade notes

- Fully quit and relaunch after upgrade (new `networkDiscovery` settings get Zod defaults: auto / 5 minutes).
- Export a settings backup before major machine moves (D45).
- Mapped-drive reconnect no longer depends on `WNetRestoreConnectionW` (often absent on current Windows).
