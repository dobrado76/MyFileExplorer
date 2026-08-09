# MyFileExplorer

**v0.3.0** — A Windows file manager that feels like Explorer… until you notice you never want to go back.

Built for people who live in folders all day: media libraries, project trees, AI image dumps, downloads that need sorting. Tabs that survive a reboot. Previews that actually tell you something. Search that doesn’t lie about being fast. Drag a file into Photoshop and it just works.

| | |
| --- | --- |
| **Platform** | Windows 10 / 11 |
| **Stack** | Electron · React 19 · TypeScript · Zustand · Zod · Sharp · ffmpeg · SQLite |
| **License** | MIT |

---

## Why not just use File Explorer?

Explorer is fine until it isn’t — one window per rabbit hole, a preview pane that shrugs, a context menu longer than your shopping list, and search that either indexes the universe or crawls like molasses.

MyFileExplorer keeps the muscle memory (Del → Recycle Bin, Ctrl = copy, shell icons, right-drag menus) and adds the stuff power users actually want. Full list: **[docs/ADVANTAGES.md](docs/ADVANTAGES.md)**.

---

## Highlights

**Workspace that sticks**
- Multi-tab browsing with session restore — paths, views, selection, scroll, tree expand
- Named layouts (“AI training”, “client project”) you can switch in one click
- Drop files onto a tab to sort into that folder
- Offline tabs wait for encrypted / network drives instead of vanishing

**See what you’re looking at**
- Rich preview pane: images, video/audio, PDF, Office-ish text, `.lnk` targets, SafeTensors
- **A1111 / ComfyUI generation metadata** when it’s embedded (prompts, seed, model, …)
- In-app image editor with Revert-to-original (backup stays in AppData, not next to your files)
- Animated video icon strips from `!VIDTHUMB_CACHE` — generate missing frames in-app

**Move files without the drama**
- Status-bar progress + **Cancel** on long copy/move/trash/delete
- Side-by-side conflict compare (thumbs, size, dates)
- In-app Recycle Bin (restore / empty) — never forced into system Explorer
- Undo / redo for the ops you expect (Ctrl+Z / Ctrl+Y)
- Drag out to other apps; right-drag for Copy / Move / **Create shortcuts here**

**Find things on purpose**
- Opt-in indexed roots (fast FTS) + honest live-walk with progress when you didn’t index
- Search hits use the **same** file view as a normal folder
- Built to stay smooth in folders with tens of thousands of files

**Comfort**
- Dark / light / custom theme, font size, curated context menu
- Per-folder view overrides, view filters, Details columns for media & generation fields
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

1. Install via `MyFileExplorer Setup 0.3.0.exe` (or build with `npm run dist:nobump`).
2. Open a few folders as tabs. Rename a tab. Save a layout.
3. Select an AI-generated PNG — check the preview for prompt / model fields.
4. Right-drag a `.exe` or folder onto another directory → **Create shortcuts here**.
5. Hit the Recycle Bin on the tab bar — restore something without opening Explorer.

More depth: [docs/PRODUCT_SPEC.md](docs/PRODUCT_SPEC.md) · [docs/ADVANTAGES.md](docs/ADVANTAGES.md) · [RELEASE_NOTES.md](RELEASE_NOTES.md)

---

## Documentation

| Doc | What it’s for |
| --- | --- |
| **[PLAN.md](PLAN.md)** | Canonical project plan |
| **[docs/README.md](docs/README.md)** | Doc index & reading order |
| **[docs/ADVANTAGES.md](docs/ADVANTAGES.md)** | vs classic Windows Explorer |
| **[docs/PRODUCT_SPEC.md](docs/PRODUCT_SPEC.md)** | Features & UX requirements |
| **[docs/DECISIONS.md](docs/DECISIONS.md)** | Locked choices D1–D29 |
| **[CHANGELOG.md](CHANGELOG.md)** | Full history |
| **[RELEASE_NOTES.md](RELEASE_NOTES.md)** | v0.3.0 summary |

---

## Goals

- Feel familiar like File Explorer without cloning every rarely used feature
- Fast, clear previews with type-specific (and AI) metadata
- Multi-tab browsing with real session restore
- Customizable theme and UI font
- Dramatic search speed for folders you choose to index

## Non-goals (still)

Full Explorer parity, shell-extension hosting, cloud-provider shells, macOS/Linux-first support.

---

## Scripts

| Script | Purpose |
| --- | --- |
| `npm run dev` | Electron + HMR |
| `npm run check` | typecheck + lint + test |
| `npm run test` | Vitest |
| `npm run build` | Production electron-vite build |
| `npm run dist` | Bump patch, prune old Setup*.exe, build Windows installer |
| `npm run dist:nobump` | Installer without version bump |
| `npm run build:win` | Windows installer only |

---

Open **this folder** as the workspace. Everything needed to build and ship lives here.
