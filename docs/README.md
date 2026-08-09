# MyFileExplorer documentation

**Status:** v0.3.0. Docs describe the shipped behavior; locked choices are in [DECISIONS.md](DECISIONS.md) (through D30).

Hub for product and engineering docs. Product entry: [../README.md](../README.md). Canonical plan: [../PLAN.md](../PLAN.md). Release notes: [../RELEASE_NOTES.md](../RELEASE_NOTES.md). Full history: [../CHANGELOG.md](../CHANGELOG.md).

---

## Reading order

**New agent / implementer**

1. [../PLAN.md](../PLAN.md)
2. [PRODUCT_SPEC.md](PRODUCT_SPEC.md) · [ADVANTAGES.md](ADVANTAGES.md) (shareable vs Explorer)
3. [DECISIONS.md](DECISIONS.md)
4. [ARCHITECTURE.md](ARCHITECTURE.md)
5. [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md)
6. Domain docs as needed: PREVIEW, SEARCH, IPC_CONTRACT, UI_DESIGN, PROJECT_FORMAT, SECURITY, INTEGRATION

---

## Index

| Doc                                              | Topic                                 |
| ------------------------------------------------ | ------------------------------------- |
| [PRODUCT_SPEC.md](PRODUCT_SPEC.md)               | Features & UX requirements            |
| [ADVANTAGES.md](ADVANTAGES.md)                   | Advantages vs classic Windows Explorer |
| [BUILD.md](BUILD.md)                             | Local build + CI installer artifacts   |
| [ARCHITECTURE.md](ARCHITECTURE.md)               | Electron processes, layout, ownership |
| [PROJECT_FORMAT.md](PROJECT_FORMAT.md)           | `userData` files & schemas            |
| [IPC_CONTRACT.md](IPC_CONTRACT.md)               | Typed IPC channels                    |
| [DECISIONS.md](DECISIONS.md)                     | Locked decisions D1…D30               |
| [UI_DESIGN.md](UI_DESIGN.md)                     | Layout, tabs, themes, menus           |
| [PREVIEW.md](PREVIEW.md)                         | Preview pane, gen metadata, video strips |
| [SEARCH.md](SEARCH.md)                           | Indexing & search                     |
| [SECURITY.md](SECURITY.md)                       | Path guards & destructive ops         |
| [INTEGRATION.md](INTEGRATION.md)                 | CLI / `mfe://` open from other apps   |
| [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md) | Phased implementation                 |

---

## Recent behavior (v0.3.x)

| Area | Spec |
| ---- | ---- |
| OS drag-out | D11 — left-drag in-app; leave window → `startDrag` / CF_HDROP; right-drag Copy/Move/**Create shortcuts** menu; edge auto-scroll |
| Search results | D29 — normal `FileView` (banner + path under names) |
| Video icon strips | D26 — read/play `!VIDTHUMB_CACHE`; generate missing (folder or recursive) / regenerate via context menu + ffmpeg |
| File-op progress | D28 — status bar for copy/move/rename/trash/delete/video-preview; Cancel; indeterminate after 1 s or until units/bytes advance |
| Image editor | D27 — Filerobot; originals under `userData` |
| Recycle Bin | D7 — in-app bin view (list/restore/empty); Details shows Original location + Date deleted |
| Tabs as drop bins | Drag files onto a tab → move/copy into that tab’s folder |
| Large folders | Win32 listing + watch coalesce + debounced scroll — tens of thousands of files stay usable |
| External open | D19 — `--reveal` / `--open` / `mfe://` |
| vs Explorer | [ADVANTAGES.md](ADVANTAGES.md) |
