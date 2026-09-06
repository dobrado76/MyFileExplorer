# MyFileExplorer v0.16.0 — release notes

**Date:** 2026-09-06  
**Tag:** `v0.16.0` (package **0.16.0**)  
**Previous product baseline:** [v0.15.0](CHANGELOG.md#0150---2026-09-02)

Sixteenth product release (**v0.16**): **Power Rename Advanced** options, **multi-pack icon picker** (Lucide / Phosphor / Tabler), and a polished **User Metadata** experience (dedicated manager, Binary field labels, stable preview, child-folder bindings).

Full detail: [CHANGELOG.md](CHANGELOG.md). Power Rename: [docs/POWER_RENAME.md](docs/POWER_RENAME.md) · user metadata: [docs/USER_METADATA.md](docs/USER_METADATA.md). Why switch from Explorer: [docs/ADVANTAGES.md](docs/ADVANTAGES.md).

---

## Highlights

### Power Rename Advanced options (D40)

Collapsible Bulk Rename Utility–style panels behind the simple Search / Replace strip: Name, Case, Remove, Move/Copy, Add, Auto date, Append folder, Numbering, Extension, Selection filter. Apply works with advanced-only transforms (empty Search). DOS `*` / `?` wildcards when regex is off. Remove From/To clamps so **To** never goes below **From**.

Guide: [docs/POWER_RENAME.md](docs/POWER_RENAME.md).

### Multi-pack glyph picker

Tabs, per-item icons, Quick Launch, and Scripts share one Glyph picker with **Lucide**, **Phosphor** (Regular), and **Tabler**. Existing Lucide-only data keeps working; item ADS `kind` stays `'lucide'`.

### User Metadata polish (D70)

- Floating **Metadata manager** (set tabs + Assignments / Pack); Settings → Metadata stays a thin enable + summary panel
- Optional toolbar button for the manager
- **Binary** fields with configurable true/false labels (Yes/No, True/False, Todo/Done, …)
- Non-recursive (“this folder only”) bindings cover **direct child folders** as list items without applying inside those children
- Preview Metadata block stays mounted across selection; Details columns refresh correctly after edits

Guide: [docs/USER_METADATA.md](docs/USER_METADATA.md).

### Also in this release

- Nested context submenus portaled (no clipped flyouts)
- Preview autoplay preference moved to Settings → Preview
- Media Metadata Clear confirms scope; Recycle Bin Restore reliability; Virtual Folder tree / preview polish; search vs folder view restore; Back after rename on NAS

---

## Install

1. Run `MyFileExplorer-0.16.0.exe` (GitHub Release or your Updates folder).
2. Settings stay in `%APPDATA%\MyFileExplorer`.
3. Before a PC swap: **Settings → About → Export…** (script library, templates catalog, and media-library filter prefs included; AI keys and shell-redirect state stay on the machine).
4. **Optional OS projection:** install [WinFsp](https://winfsp.dev/), then `MfeVirtualFolderService-win-x64.zip` from the same Release.
5. **Shell redirect:** after install, **Settings → Windows integration** (experimental). The installer ships `MfeShellLauncher.exe` beside the main app.

## Upgrade notes

- Fully quit and relaunch (IPC / preload changes need a cold start).
- **User Metadata**, shell redirect, Git, Scripts, and Media Metadata stay **off** until you enable them.
- Boolean metadata fields remain stored as JSON `true`/`false`; only display labels are configurable.
- Notes, item icons, folder statistics, and user metadata streams need **local NTFS**.
