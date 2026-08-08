# MyFileExplorer

**v0.2.0** — Windows desktop file manager (Electron + React).

A highly functional Explorer-style app: tabs, persisted views, curated context menu, rich previews (including AI image generation metadata when present), standard file operations with progress/cancel, optional indexed search, drag-out to other apps, and in-app video preview-strip generation.

|          |                                                                                                 |
| -------- | ----------------------------------------------------------------------------------------------- |
| Platform | Windows 10/11 (primary)                                                                         |
| Stack    | Electron · electron-vite · React 19 · TypeScript · Zustand · Zod · Sharp · ffmpeg · SQLite (node:sqlite) |
| License  | MIT                                                                                             |

## Highlights

- **Tabs & layouts** — session restore; named workspace layouts; per-folder view overrides
- **Views** — icon sizes through Details; Windows shell icons; image/PSD thumbs; animated video strips from `!VIDTHUMB_CACHE`
- **Video previews** — context menu can generate missing strips (this folder or all subfolders) or regenerate; 20 frames sampled evenly via bundled ffmpeg
- **File ops** — cut/copy/paste, DnD (including **drag-out** to Photoshop / mail / chat), Recycle Bin delete with **in-app Recycle Bin** view (restore / empty), undo/redo; status-bar progress + **Cancel**
- **Preview** — images (edit in Filerobot), video/audio, PDF, Office-ish text, SafeTensors / A1111 / Comfy metadata when present
- **Search** — opt-in indexed roots (FTS5) plus honest live-walk fallback; results use the **normal file view**
- **Integration** — CLI `--reveal` / `--open` and `mfe://` for “Reveal in MyFileExplorer” from other apps

## Quick start

```bash
npm install
npm run dev        # launch with HMR (same %APPDATA%\MyFileExplorer settings as installed)
npm run check      # typecheck + lint + tests
npm run dist       # bump patch, wipe old Setup*.exe in dist/ (+ Updates folder), build installer
npm run dist:nobump  # rebuild without bumping version
npm run build:win  # build only (no bump / no clean)

```

---

## Start here

1. **[PLAN.md](PLAN.md)** — canonical project plan
2. **[docs/README.md](docs/README.md)** — documentation index
3. **[docs/IMPLEMENTATION_PLAN.md](docs/IMPLEMENTATION_PLAN.md)** — build phases
4. **[CHANGELOG.md](CHANGELOG.md)** — full history
5. **[RELEASE_NOTES.md](RELEASE_NOTES.md)** — v0.2.0 summary

Open **this folder** as the workspace. Everything needed to implement lives here.

---

## Goals

- Feel familiar like File Explorer without cloning every rarely used feature
- Fast, clear previews with type-specific metadata panels
- Multi-tab browsing with session restore
- Customizable theme (dark / light / custom) and UI font
- Dramatic search speed for folders you mark for indexing

## Non-goals (v1)

Full Explorer parity, shell-extension hosting, cloud-provider shells, macOS/Linux-first support.

---

## Scripts

| Script              | Purpose                              |
| ------------------- | ------------------------------------ |
| `npm run dev`       | Electron + HMR                       |
| `npm run check`     | typecheck + lint + test              |
| `npm run test`      | Vitest unit tests                    |
| `npm run build`     | electron-vite production build       |
| `npm run dist` | Bump patch version, delete prior Setup*.exe in `dist/` (and Settings → Updates folder), build Windows installer |
| `npm run dist:nobump` | Same as dist without version bump |
| `npm run build:win` | Windows installer only (no bump / no clean) |

App state lives in `%APPDATA%\MyFileExplorer` (same for `npm run dev` and installed builds — see D17).

---

## Documentation

See [docs/README.md](docs/README.md).
