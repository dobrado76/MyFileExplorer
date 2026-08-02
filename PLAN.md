# MyFileExplorer — project plan

**This file is the canonical plan for this repo.** Open this folder as its own workspace. Do not depend on any other project or external chat plans.

Status: **v0.1.0 implemented** — Phases 0–9 of [docs/IMPLEMENTATION_PLAN.md](docs/IMPLEMENTATION_PLAN.md) are built and passing `npm run check`. See [CHANGELOG.md](CHANGELOG.md) for what shipped.

---

## What we are building

A Windows-first **Electron + React** file manager: a highly functional Explorer-style shell with a **streamlined context menu**, **rich previews** (including A1111 / ComfyUI generation metadata when present), **tabs**, **persisted session/UI**, standard file ops, and **opt-in folder search indexing**.

## Stack (locked)

| Layer            | Choice                                                     |
| ---------------- | ---------------------------------------------------------- |
| Shell            | Electron + electron-vite                                   |
| UI               | React 19 + TypeScript (strict, `noUncheckedIndexedAccess`) |
| State (renderer) | Zustand                                                    |
| Validation       | Zod on IPC / settings                                      |
| Tests / quality  | Vitest, ESLint (0 warnings), Prettier                      |
| Thumbs           | Sharp                                                      |
| Search index     | SQLite + FTS5 under Electron `userData`                    |
| Delete           | `shell.trashItem` (Recycle Bin); Shift+Del permanent       |

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
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)               | Process model & layout        |
| [docs/DECISIONS.md](docs/DECISIONS.md)                     | Locked product/tech decisions |
| [docs/IPC_CONTRACT.md](docs/IPC_CONTRACT.md)               | Main ↔ renderer API           |
| [docs/PROJECT_FORMAT.md](docs/PROJECT_FORMAT.md)           | On-disk `userData` layout     |
| [docs/UI_DESIGN.md](docs/UI_DESIGN.md)                     | Chrome & themes               |
| [docs/PREVIEW.md](docs/PREVIEW.md)                         | Preview + gen metadata        |
| [docs/SEARCH.md](docs/SEARCH.md)                           | Indexing & search             |
| [docs/SECURITY.md](docs/SECURITY.md)                       | Path guards & deletes         |
| [docs/IMPLEMENTATION_PLAN.md](docs/IMPLEMENTATION_PLAN.md) | Phased build order            |

## Immediate next work

1. Manual acceptance pass against the PRODUCT_SPEC checklist
2. Phase 10 candidates: marquee selection, type-ahead, Ctrl+click tree → new tab, Comfy node summary, inline media playback

## Agent rules

See [.cursor/rules/project.mdc](.cursor/rules/project.mdc). This project is standalone.
