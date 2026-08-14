# MyFileExplorer

[![Download Latest Release](https://img.shields.io/github/v/release/dobrado76/MyFileExplorer?label=Download%20Latest%20Executables)](https://github.com/dobrado76/MyFileExplorer/releases/latest)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

**v0.7.0** — A Windows file manager that feels like Explorer… until you notice you never want to go back.

Built for people who live in folders all day: media libraries, project trees, AI image dumps, downloads that need sorting. Tabs that survive a reboot. Previews that actually tell you something. Search that doesn’t lie about being fast. Drag a file into Photoshop and it just works.

| | |
| --- | --- |
| **Platform** | Windows 10 / 11 (primary) · Linux packaging experimental |
| **Stack** | Electron · React 19 · TypeScript · Zustand · Zod · Sharp · ffmpeg · SQLite |
| **License** | MIT |

![MyFileExplorer screenshot](/docs/image/screenshot.png)

---

## Why not just use File Explorer?

Explorer is fine until it isn’t — one window per rabbit hole, a preview pane that shrugs, a context menu longer than your shopping list, and search that either indexes the universe or crawls like molasses.

MyFileExplorer keeps the muscle memory (Del → Recycle Bin, Ctrl = copy, shell icons, right-drag menus) and adds the stuff power users actually want. Full list: **[docs/ADVANTAGES.md](docs/ADVANTAGES.md)**.

---

## Highlights

**Workspace that sticks**
- Multi-tab browsing with session restore — paths, views, selection, scroll, tree expand, tab icons
- Multi-pane layouts (1 / 2 / 4) and named layouts you can switch in one click
- Drop files onto a tab to sort into that folder
- Offline tabs wait for encrypted / network drives instead of vanishing
- **Network neighborhood** + mapped-drive reconnect without opening Explorer — **[docs/NETWORKS.md](docs/NETWORKS.md)**
- Opt-in **FTP / FTPS / SFTP** remotes (deploy/sync) — **[docs/REMOTE_FTP.md](docs/REMOTE_FTP.md)**
- Portable **settings export/import** (theme, layouts, context menu, remotes metadata, Network hosts — everything except window position)

**See what you’re looking at**
- Rich preview pane: images, video/audio, PDF, HTML/Markdown (Preview/Raw), Office-ish text, `.chm` help viewer, archives (ZIP / 7z / RAR / TAR.GZ), `.lnk`, SafeTensors, Unity packages, executables — **[full extension list](docs/PREVIEW_EXTENSIONS.md)**
- **A1111 / ComfyUI generation metadata** when it’s embedded (prompts, seed, model, …)
- In-app image editor with Revert-to-original (versions as NTFS ADS on the file)
- Animated video icon strips from `!VIDTHUMB_CACHE` — generate missing frames in-app

**Move files without the drama**
- Status-bar progress + **Cancel** on long copy/move/trash/delete
- Side-by-side conflict compare (thumbs, size, dates)
- In-app Recycle Bin (restore / empty) — never forced into system Explorer
- Undo / redo for the ops you expect (Ctrl+Z / Ctrl+Y)
- Drag out to other apps; right-drag for Copy / Move / **Create shortcuts here**
- **Open Command Line here** (Shift = Administrator)

**Find things on purpose**
- **Everything-inspired search** — opt-in folder roots + optional drive index (NTFS USN), as-you-type, operators (`size:`, `ext:`, `pic:`, …), **Power Search** visual builder, content scan, filters/bookmarks
- Search hits use the **same** file view as a normal folder
- Built to stay smooth in folders with tens of thousands of files

**Comfort**
- Dark / light / custom theme, font size
- **Curated context menu** — hide/reorder built-ins, Discover static shell verbs, custom file/folder commands (all in settings export)
- Per-folder view overrides, view filters, Details columns for media & generation fields
- Optional gated **slideshow / categorizer** (manual crop, draw caption) and **compiled file lists** for media libraries
- NTFS **Alternate Data Streams** manager + optional Details column; **Calculate Statistics** for folder counts (depth-first subtree tagging)
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
2. Run `MyFileExplorer Setup x.y.z.exe`.
3. Open a few folders as tabs. Rename a tab. Save a layout.
4. Select an AI-generated PNG — check the preview for prompt / model fields.
5. Right-drag a `.exe` or folder onto another directory → **Create shortcuts here**.
6. Hit the Recycle Bin on the tab bar — restore something without opening Explorer.
7. Settings → Search → add a folder root (or Index this drive) → try `ext:png size:>1mb` in the search box.
8. Expand **Network** in the tree; click a disconnected mapped drive and confirm it reconnects in-app.
9. Settings → Context menu → Discover (optional) / Custom — then **About → Export…** so you can restore after a reinstall.
10. (Optional) Settings → Remote repositories → enable, add an SFTP/FTP host, Connect.

Details: [docs/BUILD.md](docs/BUILD.md) · [docs/PRODUCT_SPEC.md](docs/PRODUCT_SPEC.md) · [docs/ADVANTAGES.md](docs/ADVANTAGES.md) · [docs/NETWORKS.md](docs/NETWORKS.md) · [docs/REMOTE_FTP.md](docs/REMOTE_FTP.md) · [RELEASE_NOTES.md](RELEASE_NOTES.md)

---

## Documentation

| Doc | What it’s for |
| --- | --- |
| **[PLAN.md](PLAN.md)** | Canonical project plan |
| **[docs/README.md](docs/README.md)** | Doc index & reading order |
| **[docs/ADVANTAGES.md](docs/ADVANTAGES.md)** | vs classic Windows Explorer |
| **[docs/BUILD.md](docs/BUILD.md)** | Local build + tagged GitHub Releases |
| **[docs/LINUX.md](docs/LINUX.md)** | Experimental Linux AppImage / Wayland helpers |
| **[docs/PRODUCT_SPEC.md](docs/PRODUCT_SPEC.md)** | Features & UX requirements |
| **[docs/DECISIONS.md](docs/DECISIONS.md)** | Locked choices D1–D46 |
| **[docs/NETWORKS.md](docs/NETWORKS.md)** | Network neighborhood & mapped drives |
| **[docs/REMOTE_FTP.md](docs/REMOTE_FTP.md)** | Opt-in FTP/FTPS/SFTP remotes (D46) |
| **[docs/SEARCH.md](docs/SEARCH.md)** | Everything-parity search |
| **[docs/PREVIEW_EXTENSIONS.md](docs/PREVIEW_EXTENSIONS.md)** | Every extension the preview pane handles |
| **[docs/SLIDESHOW.md](docs/SLIDESHOW.md)** | Slideshow / categorizer / compiled lists |
| **[docs/ADS.md](docs/ADS.md)** | NTFS Alternate Data Streams |
| **[CHANGELOG.md](CHANGELOG.md)** | Full history |
| **[RELEASE_NOTES.md](RELEASE_NOTES.md)** | v0.7.0 product-release summary |

---

## Goals

- Feel familiar like File Explorer without cloning every rarely used feature
- Fast, clear previews with type-specific (and AI) metadata
- Multi-tab browsing with real session restore
- Customizable theme and UI font
- Dramatic search speed for folders (and drives) you choose to index — Everything-style queries
- LAN + mapped drives without depending on Explorer for reconnect

## Non-goals (still)

Full Explorer parity, shell-extension hosting, cloud-provider shells, macOS/Linux as primary targets (Linux AppImage helpers are experimental only — [docs/LINUX.md](docs/LINUX.md)). Optional FTP/SFTP remotes are opt-in (D46) — see [docs/REMOTE_FTP.md](docs/REMOTE_FTP.md).

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
