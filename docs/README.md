# MyFileExplorer documentation

**Status:** v0.1.0 implemented (Phases 0–9). Docs describe the shipped behavior; locked choices are in [DECISIONS.md](DECISIONS.md) (through D28).

Hub for product and engineering docs. Product entry: [../README.md](../README.md). Canonical plan: [../PLAN.md](../PLAN.md). Release notes: [../CHANGELOG.md](../CHANGELOG.md).

---

## Reading order

**New agent / implementer**

1. [../PLAN.md](../PLAN.md)
2. [PRODUCT_SPEC.md](PRODUCT_SPEC.md)
3. [DECISIONS.md](DECISIONS.md)
4. [ARCHITECTURE.md](ARCHITECTURE.md)
5. [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md)
6. Domain docs as needed: PREVIEW, SEARCH, IPC_CONTRACT, UI_DESIGN, PROJECT_FORMAT, SECURITY, INTEGRATION

---

## Index

| Doc                                              | Topic                                 |
| ------------------------------------------------ | ------------------------------------- |
| [PRODUCT_SPEC.md](PRODUCT_SPEC.md)               | Features & UX requirements            |
| [ARCHITECTURE.md](ARCHITECTURE.md)               | Electron processes, layout, ownership |
| [PROJECT_FORMAT.md](PROJECT_FORMAT.md)           | `userData` files & schemas            |
| [IPC_CONTRACT.md](IPC_CONTRACT.md)               | Typed IPC channels                    |
| [DECISIONS.md](DECISIONS.md)                     | Locked decisions D1…D28               |
| [UI_DESIGN.md](UI_DESIGN.md)                     | Layout, tabs, themes, menus           |
| [PREVIEW.md](PREVIEW.md)                         | Preview pane, gen metadata, video strips |
| [SEARCH.md](SEARCH.md)                           | Indexing & search                     |
| [SECURITY.md](SECURITY.md)                       | Path guards & destructive ops         |
| [INTEGRATION.md](INTEGRATION.md)                 | CLI / `mfe://` open from other apps   |
| [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md) | Phased implementation                 |

---

## Recent behavior (v0.1.x)

| Area | Spec |
| ---- | ---- |
| Video icon strips | D26 — read/play `!VIDTHUMB_CACHE`; generate missing (folder or recursive) / regenerate via context menu + ffmpeg |
| File-op progress | D28 — status bar bar for copy/move/trash/delete/video-preview generation (`op-progress`) |
| Image editor | D27 — Filerobot; originals under `userData` |
| Recycle Bin | D7 — `SHFileOperation` + `FOF_ALLOWUNDO` (not Electron `shell.trashItem`) |
| External open | D19 — `--reveal` / `--open` / `mfe://` |
