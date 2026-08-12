# MyFileExplorer documentation

**Status:** v0.6.0. Docs describe the shipped behavior; locked choices are in [DECISIONS.md](DECISIONS.md) (through D45).

Hub for product and engineering docs. Product entry: [../README.md](../README.md). Canonical plan: [../PLAN.md](../PLAN.md). Release notes: [../RELEASE_NOTES.md](../RELEASE_NOTES.md). Full history: [../CHANGELOG.md](../CHANGELOG.md).

---

## Reading order

**New agent / implementer**

1. [../PLAN.md](../PLAN.md)
2. [PRODUCT_SPEC.md](PRODUCT_SPEC.md) · [ADVANTAGES.md](ADVANTAGES.md) (shareable vs Explorer)
3. [DECISIONS.md](DECISIONS.md)
4. [ARCHITECTURE.md](ARCHITECTURE.md)
5. [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md)
6. Domain docs as needed: PREVIEW, SEARCH, NETWORKS, IPC_CONTRACT, UI_DESIGN, PROJECT_FORMAT, SECURITY, INTEGRATION, SLIDESHOW, ADS
7. Deferred / bonus only when relevant: [REMOTE_FTP.md](REMOTE_FTP.md) (not scheduled)

---

## Index

| Doc                                              | Topic                                 |
| ------------------------------------------------ | ------------------------------------- |
| [PRODUCT_SPEC.md](PRODUCT_SPEC.md)               | Features & UX requirements            |
| [ADVANTAGES.md](ADVANTAGES.md)                   | Advantages vs classic Windows Explorer |
| [BUILD.md](BUILD.md)                             | Local build + tagged GitHub Releases   |
| [LINUX.md](LINUX.md)                             | Linux dev/build/run notes             |
| [ARCHITECTURE.md](ARCHITECTURE.md)               | Electron processes, layout, ownership |
| [PROJECT_FORMAT.md](PROJECT_FORMAT.md)           | `userData` files & schemas            |
| [IPC_CONTRACT.md](IPC_CONTRACT.md)               | Typed IPC channels                    |
| [DECISIONS.md](DECISIONS.md)                     | Locked decisions D1…D45               |
| [UI_DESIGN.md](UI_DESIGN.md)                     | Layout, tabs, themes, menus           |
| [PREVIEW.md](PREVIEW.md)                         | Preview pane, gen metadata, video strips |
| [PREVIEW_EXTENSIONS.md](PREVIEW_EXTENSIONS.md)   | All preview-supported file extensions    |
| [SEARCH.md](SEARCH.md)                           | Everything-parity indexing & search   |
| [Networks.md](Networks.md)                       | Network neighborhood & mapped drives (D44) |
| [SECURITY.md](SECURITY.md)                       | Path guards & destructive ops         |
| [INTEGRATION.md](INTEGRATION.md)                 | CLI / `mfe://` open from other apps   |
| [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md) | Phased implementation                 |
| [REMOTE_FTP.md](REMOTE_FTP.md)                   | Deferred bonus: FTP/SFTP remotes (not scheduled) |
| [SLIDESHOW.md](SLIDESHOW.md)                     | Gated slideshow / categorizer (D37) / compiled lists (D39) |
| [ADS.md](ADS.md)                                 | NTFS Alternate Data Streams (D38) |

---

## Recent behavior (v0.6.x)

| Area | Spec |
| ---- | ---- |
| Network neighborhood / mapped drives | D44 / D3 — discovery, UNC, reconnect without Explorer — [Networks.md](Networks.md) |
| Settings export / import | D45 — portable prefs + remembered hosts (no window geometry) |
| Open Command Line | Folder context; Terminal / PS / cmd; Shift = Admin |
| Slideshow / categorizer | D37 — gated chrome; map; cache; invalid-images folder — [SLIDESHOW.md](SLIDESHOW.md) |
| Compiled file lists | D39 — `.dat` Index via Update Lists; `.txt` body expand; virtual playlist |
| NTFS ADS | D38 — Details column + manager — [ADS.md](ADS.md) |
| Everything-parity search | D34 — hybrid folder + volume index; query language; as-you-type; content; filters/bookmarks; optional HTTP API |
| Multi-pane | D31 — 1 / 2 / 4 panes + layout persistence; empty pane Open Computer / Browse |
| Tab icons | D32 — Lucide icon + color; tab context menu |
| In-pane video | D33 — byte-range media; MKV remux; AVI strip-only |
| Richer previews | HTML/Markdown Preview·Raw; Unity; PE; ZIP/7z/RAR/TAR/APK/MSI/ISO; `.chm` (D35); `.ttf` (D36) — [PREVIEW_EXTENSIONS.md](PREVIEW_EXTENSIONS.md) |
| Windows Properties | Shell property sheet from in-app Properties dialog |
| OS drag-out | D11 — left-drag in-app; leave window → `startDrag` / CF_HDROP; right-drag Copy/Move/**Create shortcuts**; opposite-button cancel; edge auto-scroll; tree hover-expand |
| Search results | D29 — normal `FileView` (banner + path under names) |
| Video icon strips | D26 — read/play `!VIDTHUMB_CACHE`; generate missing (folder or recursive) / regenerate |
| File-op progress | D28 — status bar; Cancel (incl. 7za ZIP compress) |
| Image editor | D27 — Filerobot; tip ADS `VER_*` on file |
| Recycle Bin | D7 — in-app bin view |
| Tabs as drop bins | Drag files onto a tab → move/copy into that tab’s folder |
| Large folders | Win32 listing + size-tiered watch / soft-reload + debounced scroll |
| External open | D19 — `--reveal` / `--open` / `mfe://` |
| vs Explorer | [ADVANTAGES.md](ADVANTAGES.md) |
