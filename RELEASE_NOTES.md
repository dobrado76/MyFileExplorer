# MyFileExplorer v0.11.0 — release notes

**Date:** 2026-08-24  
**Tag:** `v0.11.0` (package **0.11.0**)  
**Previous product baseline:** [v0.10.0](CHANGELOG.md#0100---2026-08-21)

Eleventh product release (**v0.11**): the daily-workflow wave (**D53–D62**). Reopen a tab you closed, paste a screenshot as a file, drop a template into the folder, group Quick access, create a link, save a view preset, and pin a note or icon on the item itself — without writing sidecars into the folder you browse.

Full detail: [CHANGELOG.md](CHANGELOG.md). Notes / icons streams: [docs/ADS.md](docs/ADS.md). Search operators: [docs/SEARCH.md](docs/SEARCH.md). Why switch from Explorer: [docs/ADVANTAGES.md](docs/ADVANTAGES.md).

---

## Highlights

### Reopen closed tabs (D55)

`Ctrl+Shift+T`, tab-bar **Reopen closed tab**, or **Recently closed**. Last 25 tabs persist across relaunch (path, view, icon, search query). **Clear recently closed** empties the stack. Search *results* are not restored — re-run the query.

### Smart clipboard paste (D56)

When the clipboard is an image, text, a single URL, or HTML (not files), Paste creates a file in the current folder. **Paste Special** picks format or name. Settings → Behavior can turn this off. A URL becomes a `.url` shortcut — the page is never downloaded.

### New-file templates (D57)

New / Add → **From Template** copies a file from the app Templates folder. **Manage Templates…** sets a pretty name (menu label and default filename), reorders with ↑↓, replaces the input file, duplicates, and deletes. Cap 40. Stored under app data, not in the folder you browse.

### Grouped Quick access (D58)

Name groups in Settings, color them, collapse them in the tree. Drop a folder onto a group to pin it there. Flat pin lists from earlier versions still load.

### Create link (D59)

File Tools → **Create link…** — symbolic link, hard link (same volume), or junction. Directory symlinks may need Developer Mode.

### View presets (D60)

The pane view-presets control saves and reapplies view mode, sort, and Details columns. Path and selection do not jump. If the folder already has a customization, Apply updates that override instead of creating a new one.

### Attached notes (D61)

Right-click **Note…** — text, optional status, small checklist — on the file or folder (NTFS stream `mfe_note`). Preview shows it. Details can add **Note** / **Status** / **Has note** / **Checklist** (items separated by `; `, checked items struck through). Power Search: **Note**, **Note status**, **Has a note**, **Open checklist items** (`note:` / `notestatus:` / `hasnote:` / `todo:`). Search only *reads* the stream. Writes restore host Created / Access / Write / Change.

### Item icons (D62)

Right-click **Set icon…** — Lucide glyph, custom image, or tint the Windows icon. One source at a time (not stacked). Distinct from File Tools **Change Icon…** (`desktop.ini` / `Folder.ico`). Same timestamp rule as notes.

### Also since 0.10

- **Custom tab icons** (D54) — cover-crop a PNG/JPG/ICO; icon-only tabs hug the image.
- **Copy timestamps** (D53) — copy / cross-volume move keeps source Created and Modified.
- **Search Show hidden** (off by default); `attrib:h` still finds Hidden items.
- **Stream-value Details columns** — tick streams found in the current folder.
- **3-pane layout** and a **per-pane** folder-tree toggle.
- Empty Recycle Bin uses the Windows API; USN Recent can elevate; NSIS pack is reliable again.

---

## Install

1. Run `MyFileExplorer-0.11.0.exe` (GitHub Release or your Updates folder).
2. Settings stay in `%APPDATA%\MyFileExplorer`.
3. Before a PC swap: **Settings → About → Export…** (includes the script library and templates catalog; AI keys stay on the machine).

## Upgrade notes

- Fully quit and relaunch (notes, icons, templates, and search operators are main-process IPC — HMR is not enough).
- Existing Quick access pins stay ungrouped until you create groups.
- Notes and item icons need **local NTFS**. Hidden on remotes and in Recycle Bin. No extra files appear in the browsed folder.
- Scripts and Media Metadata stay **off** until you enable them (same as 0.9 / 0.10).
- Re-enter remote passwords after settings import if you use remotes.
