# MyFileExplorer — project plan

**This file is the canonical plan for this repo.** Open this folder as its own workspace. Do not depend on any other project or external chat plans.

Status: **v0.7.0** — Phases 0–10 shipped; **Power Search**; folder statistics depth-first; slideshow crop + draw caption; nested custom context submenus; Network (D44/D3); settings export/import (D45); remotes (D46); context-menu Discover + layout (D41); slideshow / categorizer + compiled lists (D37/D39); NTFS ADS (D38); Everything-parity search (D34). Experimental Linux AppImage helpers — Windows remains primary ([docs/LINUX.md](docs/LINUX.md)). See [RELEASE_NOTES.md](RELEASE_NOTES.md) and [CHANGELOG.md](CHANGELOG.md).

---

## What we are building

A Windows-first **Electron + React** file manager: a highly functional Explorer-style shell with a **streamlined context menu**, **rich previews** (including A1111 / ComfyUI generation metadata when present), **tabs**, **persisted session/UI**, standard file ops with **status-bar progress**, **Everything-inspired opt-in search** (folder + optional drive index), optional **video preview-strip generation** into `!VIDTHUMB_CACHE`, and **NTFS Alternate Data Streams** tooling (opt-in Details column + manager — D38).

## Stack (locked)

| Layer            | Choice                                                     |
| ---------------- | ---------------------------------------------------------- |
| Shell            | Electron + electron-vite                                   |
| UI               | React 19 + TypeScript (strict, `noUncheckedIndexedAccess`) |
| State (renderer) | Zustand                                                    |
| Validation       | Zod on IPC / settings                                      |
| Tests / quality  | Vitest, ESLint (0 warnings), Prettier                      |
| Thumbs           | Sharp (images/PSD); video strips via `!VIDTHUMB_CACHE` + ffmpeg |
| Search index     | SQLite + FTS5 under Electron `userData`; optional NTFS USN |
| Delete           | Recycle Bin via `SHFileOperation` + `FOF_ALLOWUNDO` (D7); Shift+Del permanent |

## Non-goals (v1)

- Full Windows Explorer parity (ribbon clone, Libraries UX, shell-extension hosting, zip-as-folder deep UX)
- Replacing OS file dialogs system-wide
- macOS / Linux as primary targets (Linux packaging helpers are experimental only — [docs/LINUX.md](docs/LINUX.md))
- Remote FTP/SFTP as a must-have (optional bonus only — [docs/REMOTE_FTP.md](docs/REMOTE_FTP.md); opt-in D46)

## Doc map

| Doc                                                        | Read when                     |
| ---------------------------------------------------------- | ----------------------------- |
| [README.md](README.md)                                     | Overview                      |
| [docs/README.md](docs/README.md)                           | Reading order                 |
| [docs/PRODUCT_SPEC.md](docs/PRODUCT_SPEC.md)               | What the product must do      |
| [docs/ADVANTAGES.md](docs/ADVANTAGES.md)                   | Advantages vs classic Explorer |
| [docs/BUILD.md](docs/BUILD.md)                             | Local build + tagged GitHub Releases |
| [docs/LINUX.md](docs/LINUX.md)                             | Experimental Linux AppImage / Wayland |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)               | Process model & layout        |
| [docs/DECISIONS.md](docs/DECISIONS.md)                     | Locked product/tech decisions |
| [docs/IPC_CONTRACT.md](docs/IPC_CONTRACT.md)               | Main ↔ renderer API           |
| [docs/PROJECT_FORMAT.md](docs/PROJECT_FORMAT.md)           | On-disk `userData` layout     |
| [docs/UI_DESIGN.md](docs/UI_DESIGN.md)                     | Chrome & themes               |
| [docs/PREVIEW.md](docs/PREVIEW.md)                         | Preview + gen metadata        |
| [docs/SEARCH.md](docs/SEARCH.md)                           | Indexing & search             |
| [docs/SECURITY.md](docs/SECURITY.md)                       | Path guards & deletes         |
| [docs/INTEGRATION.md](docs/INTEGRATION.md)                 | CLI / `mfe://` from other apps |
| [docs/IMPLEMENTATION_PLAN.md](docs/IMPLEMENTATION_PLAN.md) | Phased build order            |
| [docs/REMOTE_FTP.md](docs/REMOTE_FTP.md)                   | Opt-in FTP/FTPS/SFTP remotes (D46) |
| [docs/SLIDESHOW.md](docs/SLIDESHOW.md)                     | Gated slideshow / categorizer (D37) |
| [docs/NETWORKS.md](docs/NETWORKS.md)                       | Network neighborhood & mapped drives (D44) |
| [docs/ADS.md](docs/ADS.md)                                 | NTFS Alternate Data Streams (D38) |
| [CHANGELOG.md](CHANGELOG.md)                               | Shipped changes               |
| [RELEASE_NOTES.md](RELEASE_NOTES.md)                       | Latest release summary        |

## Immediate next work

1. Tag **`v0.7.0`** and publish the GitHub Release (CI attaches Setup.exe) — see [docs/BUILD.md](docs/BUILD.md)
2. Manual acceptance pass: Power Search, folder statistics Shift+skip, slideshow crop, search progress on large folders
3. Phase 11 candidates: Ctrl+click tree → new tab, Comfy node summary, PDF first-page raster
4. Soak-test v0.7.0; gather friend feedback (Linux remains contributor-only)

## Agent rules

See [.cursor/rules/project.mdc](.cursor/rules/project.mdc). This project is standalone.
