# MyFileExplorer — project plan

**This file is the canonical plan for this repo.** Open this folder as its own workspace. Do not depend on any other project or external chat plans.

Status: **v0.4.0** — Phases 0–9 shipped; Everything-parity search (D34); multi-pane / tab icons; rich preview depth. See [RELEASE_NOTES.md](RELEASE_NOTES.md) and [CHANGELOG.md](CHANGELOG.md).

---

## What we are building

A Windows-first **Electron + React** file manager: a highly functional Explorer-style shell with a **streamlined context menu**, **rich previews** (including A1111 / ComfyUI generation metadata when present), **tabs**, **persisted session/UI**, standard file ops with **status-bar progress**, **Everything-inspired opt-in search** (folder + optional drive index), and optional **video preview-strip generation** into `!VIDTHUMB_CACHE`.

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
- macOS / Linux as primary targets

## Doc map

| Doc                                                        | Read when                     |
| ---------------------------------------------------------- | ----------------------------- |
| [README.md](README.md)                                     | Overview                      |
| [docs/README.md](docs/README.md)                           | Reading order                 |
| [docs/PRODUCT_SPEC.md](docs/PRODUCT_SPEC.md)               | What the product must do      |
| [docs/ADVANTAGES.md](docs/ADVANTAGES.md)                   | Advantages vs classic Explorer |
| [docs/BUILD.md](docs/BUILD.md)                             | Local build + CI installer artifacts |
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
| [CHANGELOG.md](CHANGELOG.md)                               | Shipped changes               |
| [RELEASE_NOTES.md](RELEASE_NOTES.md)                       | Latest release summary        |

## Immediate next work

1. Manual acceptance pass against the PRODUCT_SPEC checklist (esp. search / D34)
2. Phase 10 candidates: Ctrl+click tree → new tab, Comfy node summary, PDF first-page raster
3. Share / soak-test v0.4.0; gather friend feedback

## Agent rules

See [.cursor/rules/project.mdc](.cursor/rules/project.mdc). This project is standalone.
