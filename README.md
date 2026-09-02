# MyFileExplorer

[![Download Latest Release](https://img.shields.io/github/v/release/dobrado76/MyFileExplorer?label=Download%20Latest%20Executables)](https://github.com/dobrado76/MyFileExplorer/releases/latest)
[![License: GPL-3.0](https://img.shields.io/badge/License-GPL--3.0-blue.svg)](LICENSE)

MyFileExplorer is a local file workbench that turns the filesystem from passive storage into an active workspace. It keeps the familiarity of Windows File Explorer, then adds persistent multi-pane workspaces, deep previews, fast search, Git awareness, rich folder analytics, metadata, automation, and portable Virtual Folders — without requiring you to move your files into a proprietary database or cloud service.

The core idea is simple: files and folders should reveal more of what they are, where they belong, and what you can do with them. A folder can become a media library, a Git workspace, a storage map, or a reusable virtual collection. A file can expose generation metadata, notes, versions, previews, or domain-specific information. Scripts can turn recurring file work into first-class commands. Virtual Folders can bring related files together even when they physically live across different drives, projects, NAS shares, or repositories.

For an individual power user, that means fewer context switches and far less friction. For a team or organization, the same architecture can become a domain-specific file workspace: engineering artifacts, research datasets, media assets, project deliverables, repositories, and internal workflows can be surfaced directly where the files already live. Because MyFileExplorer is open source, those semantics and workflows can be adapted rather than waiting for a general-purpose file manager to support them.

It started as a replacement for Windows File Explorer. It has grown into something broader: a user-extensible semantic layer over the local filesystem. Organizational framing: **[docs/BUSINESS_UVP.md](docs/BUSINESS_UVP.md)**.

| | |
| --- | --- |
| **Platform** | Windows 10 / 11 (primary) · Linux packaging experimental |
| **Stack** | Electron · React 19 · TypeScript · Zustand · Zod · Sharp · ffmpeg · SQLite |
| **License** | **GPL-3.0** — [LICENSING.md](LICENSING.md) · [TRADEMARK.md](TRADEMARK.md) |

![Tabs, details, video thumbs, and a live preview](docs/image/screenshot-workspace.jpg)

![Settings → Context menu — hide, reorder, Discover, custom commands](docs/image/screenshot-context-menu.png)

![Power Search visual query builder](docs/image/screenshot-power-search.png)

![Script Manager — run Python / PowerShell on the folder in front of you](docs/image/screenshot-script-manager.png)

---

## Why not just use File Explorer?

Explorer is fine until it isn’t — one window per rabbit hole, a preview pane that shrugs, a context menu longer than your shopping list, and search that either indexes the universe or crawls like molasses.

MyFileExplorer keeps the muscle memory (Del → Recycle Bin, Ctrl = copy, shell icons, right-drag menus) and adds the stuff power users actually want — plus Virtual Folders, scripts, and a workbench framing for teams. Full list: **[docs/ADVANTAGES.md](docs/ADVANTAGES.md)** · organizational UVP: **[docs/BUSINESS_UVP.md](docs/BUSINESS_UVP.md)**.

---

## Highlights

**Workspace that sticks**
- Multi-tab browsing with session restore — paths, views, selection, scroll, tree expand, tab icons
- **Reopen closed tabs** (`Ctrl+Shift+T` / Recently closed)
- Multi-pane layouts (1 / 2 / 3 / 4) and named layouts you can switch in one click
- **View presets** — save icon size, columns, and sort; apply without jumping folder
- **Quick Launch** — toolbar icons for Photoshop, Visual Studio, and any other program you pin
- Drop files onto a tab to sort into that folder
- Offline tabs wait for encrypted / network drives instead of vanishing
- **NAS / UNC folders reopen instantly** (session listing cache) — **[docs/NETWORKS.md](docs/NETWORKS.md)**
- **Network neighborhood** + mapped-drive reconnect without opening Explorer — **[docs/NETWORKS.md](docs/NETWORKS.md)**
- Opt-in **FTP / FTPS / SFTP** remotes (deploy/sync) — **[docs/REMOTE_FTP.md](docs/REMOTE_FTP.md)**
- Portable **settings export/import** (theme, layouts, context menu, remotes metadata, Network hosts — everything except window position)

**See what you’re looking at**
- Rich preview pane: images (incl. `.jfif` / `.hdr`), video/audio, PDF, HTML/Markdown (Preview/Raw), Office-ish text, **PowerPoint slides** (`.pptx`), **calendar / email** (`.ics` / `.eml`), 3D meshes, `.chm` help viewer, archives (ZIP / 7z / RAR / TAR.GZ), `.lnk`, SafeTensors, Unity packages, executables — **[full extension list](docs/PREVIEW_EXTENSIONS.md)**
- **Detached preview window** (Zen mode) — same live preview in a pop-out
- **A1111 / ComfyUI generation metadata** when it’s embedded (prompts, seed, model, …)
- In-app image editor with Revert-to-original (versions as NTFS ADS on the file)
- Animated video icon strips from `!VIDTHUMB_CACHE` — generate missing frames in-app
- **Drive free space** — status bar + click **Drives** for pies (local and mapped letters)
- **Folder space map** — after **Calculate Statistics**, WinDirStat-style usage treemap in the folder preview (NTFS ADS; no sidecars) — **[docs/FOLDER_STATISTICS.md](docs/FOLDER_STATISTICS.md)** · **[docs/ADS.md](docs/ADS.md)**
- **Paired folders** (2-pane layout) — centre action rail to copy, compare, and review sync plans between the two folders — **[docs/PAIRED_FOLDERS.md](docs/PAIRED_FOLDERS.md)**
- **Movie / TV metadata** (opt-in) — extract from Plex or download (TMDB / OMDb); portrait cover on the show/movie folder; `SxxExx` episode tiles; watched / genre filters; consolidate ripper Subs — **[docs/MEDIA_METADATA.md](docs/MEDIA_METADATA.md)**
- **Attached notes** and **per-item icons** on the file or folder (NTFS) — no sidecar in the directory; Details Checklist column; Power Search `note:` / `todo:`
- **User-defined metadata** (D70, **off by default**) — Settings → Metadata → Enable; define sets, assign folders, edit values on NTFS `mfe_meta`; Details columns + Power Search `meta.<key>:` — **[docs/USER_METADATA.md](docs/USER_METADATA.md)**

**Move files without the drama**
- Status-bar progress + **Cancel** on long copy/move/trash/delete
- **Continue-then-review** — finish every auto-ok item, then one grouped review (Skip / Keep both / Replace / Keep most recent / Retry)
- Side-by-side conflict compare (thumbs, size, dates) when a name already exists
- In-app Recycle Bin (restore / empty) — never forced into system Explorer
- Undo / redo for the ops you expect (Ctrl+Z / Ctrl+Y)
- Drag out to other apps; right-drag for Copy / Move / **Create shortcuts here**
- **Open Command Line here** (cmd or PowerShell from Settings; Shift = Administrator)
- **Paste a screenshot / URL / text** as a new file; **From Template** for stubs you reuse
- **Create link…** — symlink, hard link, or junction
- **Grouped Quick access** — color and collapse pin groups in the tree

**Run anything on the folder in front of you**
- **Universal script runner** (D51, **off by default**) — Settings → Scripting and AI → Enable scripting. Then PowerShell, **Python 3** (not 2.x), cmd, or bash against the current folder, selection, or **global** (its own toolbar button when one exists, no folder needed). Live output, Stop, dry-run. Saved scripts live under app data and show up on the context menu like built-in verbs.
- Optional **AI** (same settings page) writes or repairs source from a task description — **files and paths are never sent**. Later runs are local. Guide: **[docs/SCRIPTS.md](docs/SCRIPTS.md)**
- **Virtual Folders** — portable `.mfevirtual` collections of path references (not copies); optional **OS projection** on Windows so Explorer sees the same tree — **[docs/VIRTUAL_FOLDERS.md](docs/VIRTUAL_FOLDERS.md)** · **[docs/VIRTUAL_FOLDER_PROJECTION.md](docs/VIRTUAL_FOLDER_PROJECTION.md)**
- **Git-aware browsing** (D64, **off by default**) — Settings → Git → Enable for status overlays, toolbar Commit/Pull/Push, and context Git actions. Uses your installed `git`; never stores credentials. Guide: **[docs/GIT.md](docs/GIT.md)**

**Find things on purpose**
- **Everything-inspired search** — opt-in folder roots + optional drive index (NTFS USN), as-you-type, operators (`size:`, `ext:`, `pic:`, …), **Power Search** visual builder, content scan, filters/bookmarks
- Search is a **tab location** (Back/Forward); each tab keeps its own results; delete/move drops stale hits
- Search hits use the **same** file view as a normal folder
- Built to stay smooth in folders with tens of thousands of files

**Comfort**
- Dark / light / custom theme, font size
- **Curated context menu** — hide/reorder built-ins, Discover static shell verbs, custom file/folder commands (all in settings export)
- Per-folder view overrides, view filters, Details columns for media & generation fields
- Optional gated **slideshow / categorizer** (manual crop, draw caption) for media libraries
- NTFS **Alternate Data Streams** manager + optional Details column; **Calculate Statistics** for folder counts **and** a WinDirStat-style space map in preview (D66)
- Drive Properties **USN…** — view / enable / resize the NTFS change journal (delete is a full-volume scan; do not use it casually)
- Optional “disable hardware acceleration” when you need the GPU for training

---

## Quick start

```bash
npm install
npm run dev          # HMR — same %APPDATA%\MyFileExplorer settings as the installed app
npm run check        # typecheck + lint + tests
npm run dist         # bump patch, clean old Setup*.exe, build installer
npm run dist:nobump  # rebuild without bumping version
```

Settings live in `%APPDATA%\MyFileExplorer` for both `npm run dev` and installed builds.

---

## For friends trying the app

The installer is too large to keep in git (>100 MB). Get it from a **GitHub Release** (CI attaches the Setup.exe when a `v*` tag is pushed — no Actions artifacts):

1. Open [Releases](https://github.com/dobrado76/MyFileExplorer/releases/latest) (or the download badge above).
2. Run `MyFileExplorer-x.y.z.exe`.
3. Open a few folders as tabs. Rename a tab. Save a layout.
4. Select an AI-generated PNG — check the preview for prompt / model fields.
5. Right-drag a `.exe` or folder onto another directory → **Create shortcuts here**.
6. Hit the Recycle Bin on the tab bar — restore something without opening Explorer.
7. Settings → Search → add a folder root (or Index this drive) → try `ext:png size:>1mb` in the search box. Start a search, switch tabs, then Back — the search is still there.
8. Paste a large selection into a folder that already has some of those names — the rest copies; one review at the end.
9. **Optional — Virtual Folder OS projection:** install [WinFsp](https://winfsp.dev/), unzip `MfeVirtualFolderService-win-x64.zip` from the same Release, run `Install-ProjectionService.ps1`, then Settings → Behavior → Virtual Folder OS projection. Guide: **[docs/VIRTUAL_FOLDER_PROJECTION.md](docs/VIRTUAL_FOLDER_PROJECTION.md)**.
9. Select a `.pptx` — preview should show real slides, not a blank gray card.
10. Expand **Network** in the tree; click a disconnected mapped drive and confirm it reconnects in-app.
11. Click the tree **Drives** header — pies and free-space % for every volume (including mapped letters).
12. Select a `.ics` or `.eml` — agenda / email preview. Optional: **Open preview window** and try Zen.
13. Settings → Context menu → Discover (optional) / Custom — then **About → Export…** so you can restore after a reinstall.
14. (Optional) Settings → Remote repositories → enable, add an SFTP/FTP host, Connect.
15. (Optional) Settings → Media Metadata → Enable, then right-click a movie/TV folder → Extract from Plex or Download from Internet. Click the preview poster; try **Edit metadata…**, Change cover, Mark as Watched, and the Watched / Genre toolbar (filters stick per library).
16. Close a tab, then `Ctrl+Shift+T` (or tab-bar **Recently closed**) — it comes back.
17. Copy a screenshot, then Paste in a folder — you should get a `.png`. Paste a URL for a `.url` shortcut (the page is not downloaded).
18. Right-click a file → **Note…** — add a line and a checklist item. Confirm the preview and Details **Checklist** column. Power Search → tick **Has a note** or type `todo:`.
19. Right-click → **Set icon…** — pick a Lucide glyph (or tint). Confirm Created / Modified on the file did not change.
20. New / Add → **From Template** (after Manage Templates… imports one). Toolbar view-presets icon → Save current as a preset, then Apply.
21. (Optional / advanced) Settings → Scripting and AI → Enable scripting. Toolbar **Scripts** → New (or Generate with AI…) → write something that lists the current folder → Save → Run. Right-click the folder and confirm it appears under **Scripts**.
22. (Optional / advanced) Drive Properties → **USN…** — Enable on a spare NTFS volume (UAC). Confirm Recent shows the test file Create/Delete. Do **not** Delete journal on a huge library unless you mean a full-volume scan.

Details: [docs/BUILD.md](docs/BUILD.md) · [docs/PRODUCT_SPEC.md](docs/PRODUCT_SPEC.md) · [docs/ADVANTAGES.md](docs/ADVANTAGES.md) · [docs/NETWORKS.md](docs/NETWORKS.md) · [docs/REMOTE_FTP.md](docs/REMOTE_FTP.md) · [docs/MEDIA_METADATA.md](docs/MEDIA_METADATA.md) · [docs/SCRIPTS.md](docs/SCRIPTS.md) · [RELEASE_NOTES.md](RELEASE_NOTES.md)

---

## Documentation

| Doc | What it’s for |
| --- | --- |
| **[docs/README.md](docs/README.md)** | Doc index & reading order |
| **[docs/BUSINESS_UVP.md](docs/BUSINESS_UVP.md)** | Business value proposition — local file workbench for organizations |
| **[docs/ADVANTAGES.md](docs/ADVANTAGES.md)** | vs Explorer + Virtual Folders / workbench framing |
| **[docs/BUILD.md](docs/BUILD.md)** | Local build + tagged GitHub Releases |
| **[docs/LINUX.md](docs/LINUX.md)** | Experimental Linux AppImage / Wayland helpers |
| **[docs/PRODUCT_SPEC.md](docs/PRODUCT_SPEC.md)** | Features & UX requirements |
| **[docs/DECISIONS.md](docs/DECISIONS.md)** | Locked choices D1–D63 |
| **[docs/NETWORKS.md](docs/NETWORKS.md)** | Network neighborhood & mapped drives |
| **[docs/REMOTE_FTP.md](docs/REMOTE_FTP.md)** | Opt-in FTP/FTPS/SFTP remotes (D46) |
| **[docs/SEARCH.md](docs/SEARCH.md)** | Everything-parity search |
| **[docs/PREVIEW_EXTENSIONS.md](docs/PREVIEW_EXTENSIONS.md)** | Every extension the preview pane handles |
| **[docs/FOLDER_STATISTICS.md](docs/FOLDER_STATISTICS.md)** | Calculate Statistics + Space usage map (plain vs Shift) |
| **[docs/PAIRED_FOLDERS.md](docs/PAIRED_FOLDERS.md)** | Dual-pane paired folders — compare & sync (D69) |
| **[samples/preview-extensions/](samples/preview-extensions/)** | One small file per preview extension (`npm run samples:preview`) |
| **[docs/SLIDESHOW.md](docs/SLIDESHOW.md)** | Slideshow / categorizer |
| **[docs/ADS.md](docs/ADS.md)** | NTFS Alternate Data Streams |
| **[docs/MEDIA_METADATA.md](docs/MEDIA_METADATA.md)** | Opt-in movie/TV metadata (D50) |
| **[docs/SCRIPTS.md](docs/SCRIPTS.md)** | Universal script runner — use cases and copy-paste examples (D51) |
| **[CHANGELOG.md](CHANGELOG.md)** | Full history |
| **[RELEASE_NOTES.md](RELEASE_NOTES.md)** | v0.15.0 product-release summary |

---

## Goals

- Feel familiar like File Explorer without cloning every rarely used feature
- Fast, clear previews with type-specific (and AI) metadata
- Multi-tab browsing with real session restore
- Customizable theme and UI font
- Dramatic search speed for folders (and drives) you choose to index — Everything-style queries
- LAN + mapped drives without depending on Explorer for reconnect
- A universal script runner so any folder job can become a saved command (D51)

## Non-goals (still)

Full Explorer parity, shell-extension hosting, cloud-provider shells, macOS/Linux as primary targets (Linux AppImage helpers are experimental only — [docs/LINUX.md](docs/LINUX.md)). Optional FTP/SFTP remotes are opt-in (D46) — see [docs/REMOTE_FTP.md](docs/REMOTE_FTP.md).

---

## Backing up NTFS metadata (ADS)

MyFileExplorer stores a lot of meaning **on the file itself** as NTFS **Alternate Data Streams**: notes, item icons, folder statistics / space maps, media metadata, user-defined metadata (`mfe_meta`), image-edit versions, and more. None of that lives in a proprietary database under `%APPDATA%` for the browsed folder — it travels with the path on NTFS. See [docs/ADS.md](docs/ADS.md).

Most backup and sync tools copy only the main file body. They silently drop ADS. After a “successful” restore you still have the bytes, but notes, covers, stats, and custom metadata are gone.

**[MyFileSync](https://github.com/dobrado76/MyFileSync)** is a separate Windows sync/backup tool built for that gap: it compares and copies alternate streams on NTFS→NTFS (and surfaces stream diffs in the compare grid). If you use MyFileExplorer features that write ADS — or any other ADS-based metadata — prefer MyFileSync (or another ADS-aware tool) when backing up those drives or folder trees.

---

## Scripts

| Script | Purpose |
| --- | --- |
| `npm run dev` | Electron + HMR |
| `npm run check` | typecheck + lint + test — **same command CI runs**; also runs on `git push` |
| `npm run test` | Vitest |
| `npm run build` | Production electron-vite build |
| `npm run dist` | Bump patch, prune old Setup*.exe, build Windows installer (Windows host only) |
| `npm run dist:nobump` | Installer without version bump |
| `npm run build:win` | Windows installer only |
| `npm run build:linux` / `dist:linux` | Experimental Linux AppImage (see [docs/LINUX.md](docs/LINUX.md)) |
| `npm run run:unpacked` / `run:linux` | Launch Linux unpacked binary / AppImage (Linux) |

---

Open **this folder** as the workspace. Everything needed to build and ship lives here.

---

## Contributing

Contributions are welcome. Bug reports, feature ideas, documentation fixes, and pull requests all help.

- Open an [issue](https://github.com/dobrado76/MyFileExplorer/issues) to report a problem or propose a change
- Prefer a focused pull request with a clear description of what changed and why
- Run `npm run check` before opening a PR (same checks as CI)

See [CONTRIBUTING.md](CONTRIBUTING.md) for licence terms and development notes. Product decisions live in [docs/DECISIONS.md](docs/DECISIONS.md).

## Acknowledgements

**[ghiscoding](https://github.com/ghiscoding)** is MyFileExplorer’s primary external user and contributor, helping identify bugs and improve Linux compatibility.

## Licensing

MyFileExplorer is free software under the **GNU General Public License v3.0** ([LICENSE](LICENSE)). Commercial use and redistribution are allowed; distributed modifications must remain under GPLv3 with corresponding source. The **MyFileExplorer** name and logo are trademarks — see [TRADEMARK.md](TRADEMARK.md). Details: [LICENSING.md](LICENSING.md) · [NOTICE](NOTICE) · [AUTHORS](AUTHORS) · [CONTRIBUTING.md](CONTRIBUTING.md).
