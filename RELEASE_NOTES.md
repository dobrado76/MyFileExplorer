# MyFileExplorer v0.8.0 — release notes

**Date:** 2026-08-16  
**Tag:** `v0.8.0` (package **0.8.0**)  
**Previous product baseline:** [v0.7.0](CHANGELOG.md#070---2026-08-14)

Eighth product release (**v0.8**): **drive free space** (status bar + Drives pies), a **detached preview window**, **`.ics` / `.eml` preview**, instant **NAS listing memory**, and a large pass of new preview types plus large-folder performance.

Full detail: [CHANGELOG.md](CHANGELOG.md). Preview types: [docs/PREVIEW_EXTENSIONS.md](docs/PREVIEW_EXTENSIONS.md). Networks: [docs/NETWORKS.md](docs/NETWORKS.md). Why switch from Explorer: [docs/ADVANTAGES.md](docs/ADVANTAGES.md).

---

## Highlights

### Drive free space
- Status bar shows `N GB free of M GB (P%)` for the current volume.
- Click the tree **Drives** header for every volume: pie charts in the preview pane, all letters in the status bar.
- Online **mapped** letters (N: / M: / …) use the same space query as Properties.
- Offline maps, empty CDs, and empty card readers show **Disconnected** / size unknown and cannot stall the rest of the list.

### Detached preview window
- Preview header **Open preview window** opens a peer window with the same live preview.
- Follows the selection even if you collapse the docked pane. Position / size / maximized are remembered (stripped on settings export).
- **Zen mode** hides metadata and fills the window with the visualization.

### Calendar & email preview
- **`.ics` / `.ical`** — event / to-do agenda (Preview) and highlighted source (Raw).
- **`.eml`** — From / To / Subject / Date, attachments, and body (plain or sanitized HTML). Remote images are not loaded. Outlook `.msg` is not this format.

### NAS / UNC folders reopen instantly
- Last listing for a remote folder is kept in memory for the session (~24 folders; huge listings skipped).
- Navigating back paints immediately, then revalidates in the background.
- F5, your own file ops, and a watch event on that folder drop the snapshot. Local disks unchanged; nothing written to disk.

### More preview types
- **3D meshes** — `.obj` / `.fbx` / `.3ds` orbit in WebGL.
- **`.hdr`** — Radiance HDRI tonemapped for thumbs / preview / slideshow.
- **Unity / Visual Studio text** — `.meta` / `.mat` / `.shader` / `.csproj` / `.sln` / … as highlighted text.
- **`.uvw`**, **subtitles** (`.srt` / text `.sub` / SAMI), **`.divx`**.
- Click-through fixtures: [`samples/preview-extensions/`](samples/preview-extensions/) (`npm run samples:preview`).

### Search, tabs, settings
- **Power Search saved designs** — name a complex search and load it later.
- Search **exclude patterns** use the same language as the view filter.
- Default **tab icons** (Computer / drive / folder); Settings → Appearance: show tab icons, equal-width tabs.
- **Show folder statistics** toggle (Behavior) — hide Size / Files / Folders calculated columns when comparing listing speed.
- Settings → About: **Current version** card; Updates is **Folder or URL** on one line.

### Performance & reliability
- Large Details folders stay interactive (column meta only for on-screen rows).
- 200k-file Select All no longer freezes the UI.
- Calculate Statistics skips system / filtered folders and recovers from permission errors.
- Search walk no longer starves preview; `.obj` typing no longer floods then restarts.

---

## Install

1. Run `MyFileExplorer Setup 0.8.0.exe` (GitHub Release or your Updates folder).
2. Settings stay in `%APPDATA%\MyFileExplorer`.
3. Before a PC swap: **Settings → About → Export…**.

## Upgrade notes

- Fully quit and relaunch after upgrade (drive space, listing cache, and preview window are main/renderer — HMR is not enough).
- Re-enter remote passwords after settings import if you use remotes.
- Click **Drives** in the tree to see every volume’s free space, including mapped letters.
