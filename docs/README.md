# MyFileExplorer documentation

**Status:** **v0.8.0** shipped; **v0.8.2** development adds **D51** local scripts + optional AI (see [CHANGELOG.md](../CHANGELOG.md) Unreleased). Product release notes: [../RELEASE_NOTES.md](../RELEASE_NOTES.md). Locked choices: [DECISIONS.md](DECISIONS.md) (through **D51**). Experimental Linux: [LINUX.md](LINUX.md).

Hub for product and engineering docs. Product entry: [../README.md](../README.md). Canonical plan: [../PLAN.md](../PLAN.md). Full history: [../CHANGELOG.md](../CHANGELOG.md).

---

## Reading order

**New agent / implementer**

1. [../PLAN.md](../PLAN.md)
2. [PRODUCT_SPEC.md](PRODUCT_SPEC.md) · [ADVANTAGES.md](ADVANTAGES.md) (shareable vs Explorer)
3. [DECISIONS.md](DECISIONS.md)
4. [ARCHITECTURE.md](ARCHITECTURE.md)
5. [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md)
6. Domain docs as needed: PREVIEW, SEARCH, NETWORKS, REMOTE_FTP, MEDIA_METADATA, SCRIPTS, IPC_CONTRACT, UI_DESIGN, PROJECT_FORMAT, SECURITY, INTEGRATION, SLIDESHOW, ADS
7. Deferred notes only when relevant — [FUTURE_IDEAS.md](FUTURE_IDEAS.md) is a parking lot, not current work

---

## Index

| Doc                                              | Topic                                 |
| ------------------------------------------------ | ------------------------------------- |
| [PRODUCT_SPEC.md](PRODUCT_SPEC.md)               | Features & UX requirements            |
| [ADVANTAGES.md](ADVANTAGES.md)                   | Advantages vs classic Windows Explorer |
| [BUILD.md](BUILD.md)                             | Local build + tagged GitHub Releases   |
| [LINUX.md](LINUX.md)                             | Experimental Linux AppImage / Wayland helpers |
| [ARCHITECTURE.md](ARCHITECTURE.md)               | Electron processes, layout, ownership |
| [PROJECT_FORMAT.md](PROJECT_FORMAT.md)           | `userData` files & schemas            |
| [IPC_CONTRACT.md](IPC_CONTRACT.md)               | Typed IPC channels                    |
| [DECISIONS.md](DECISIONS.md)                     | Locked decisions D1…D51               |
| [UI_DESIGN.md](UI_DESIGN.md)                     | Layout, tabs, themes, menus           |
| [PREVIEW.md](PREVIEW.md)                         | Preview pane, gen metadata, video strips |
| [PREVIEW_EXTENSIONS.md](PREVIEW_EXTENSIONS.md)   | All preview-supported file extensions ([samples/preview-extensions/](../samples/preview-extensions/)) |
| [SEARCH.md](SEARCH.md)                           | Everything-parity indexing & search   |
| [NETWORKS.md](NETWORKS.md)                       | Network neighborhood & mapped drives (D44) |
| [SECURITY.md](SECURITY.md)                       | Path guards & destructive ops         |
| [INTEGRATION.md](INTEGRATION.md)                 | CLI / `mfe://` open from other apps   |
| [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md) | Phased implementation                 |
| [REMOTE_FTP.md](REMOTE_FTP.md)                   | FTP/FTPS/SFTP remotes (D46)           |
| [SLIDESHOW.md](SLIDESHOW.md)                     | Gated slideshow / categorizer (D37) / compiled lists (D39) |
| [ADS.md](ADS.md)                                 | NTFS Alternate Data Streams (D38) |
| [MEDIA_METADATA.md](MEDIA_METADATA.md)           | Opt-in movie/TV metadata (D50) |
| [SCRIPTS.md](SCRIPTS.md)                         | Local scripts + optional AI (D51) |
| [FUTURE_IDEAS.md](FUTURE_IDEAS.md)               | Optional later candidates (not scheduled) |

---

## Unreleased since v0.8.0 (v0.8.2 development)

| Area | Spec |
| ---- | ---- |
| Local scripts (D51) | Runner + library + optional AI generate (never sends files) — [SCRIPTS.md](SCRIPTS.md) |
| Media metadata (D50) | Opt-in Plex / TMDB / OMDb cards on the file or folder (NTFS streams). Show poster on the show folder; episode files keep VIDTHUMB + episode JSON (`SxxExx` tiles). Change cover; consolidate Subs; watched / genre toolbar; CD-split movie folders; internet **Which title?** only on remakes; API-limit dialog — [MEDIA_METADATA.md](MEDIA_METADATA.md) |
| Delete a tab root | Always confirm; warns that scoped tabs will close |
| Details horizontal scroll | Scrollbar at the **bottom** of the file pane; header and rows move together |
| Collapse all | Toolbar button next to Select all; collapses the current tab’s folder tree only |

## Recent behavior (v0.8.x)

| Area | Spec |
| ---- | ---- |
| Drive free space | Status bar `N GB free of M GB (P%)`; tree **Drives** header → pies for every volume; mapped letters included; offline / empty media do not stall the list |
| Detached preview | **Open preview window** peer window; Zen mode; bounds remembered (stripped on settings export) — [PREVIEW.md](PREVIEW.md) |
| Calendar / email | `.ics` / `.ical` agenda; `.eml` headers + body (no remote images) — [PREVIEW_EXTENSIONS.md](PREVIEW_EXTENSIONS.md) |
| NAS listing cache | D49 — session-only last listing for UNC / mapped / remotes; paint then revalidate — [NETWORKS.md](NETWORKS.md) |
| More previews | 3D (`.obj` / `.fbx` / `.3ds`), `.hdr`, Unity / VS text, `.uvw`, subtitles, `.divx`; fixtures in [`samples/preview-extensions/`](../samples/preview-extensions/) |
| Power Search designs | Name and reload a complex search (params stored; target chosen each run) |
| Tab chrome | Default Lucide tab icons; Settings → Appearance show icons / equal-width tabs |
| Folder statistics toggle | Settings → Behavior — hide calculated Size / Files / Folders columns |
| Large folders | Details meta only for on-screen rows; Select All no longer rescans 200k listings |

## Recent behavior (v0.7.x)

| Area | Spec |
| ---- | ---- |
| Power Search | Visual query builder (toolbar) → Everything-style query string; exclude extensions via `!ext:` |
| Per-tab search | Search is a tab history location (Back/Forward); switching tabs does not clear; delete/move prunes hits |
| Query `!` / names | `!` is NOT after whitespace or `!ext:`; `!!name` is literal; plain queries match names only |
| Bulk file ops | Continue-then-review (D18) — no mid-pass prompts; Keep most recent; same-folder paste auto-renames; rename clashes use the same review |
| PowerPoint preview | `.pptx` approximate slides (text + package images); `.ppt` text-only — [PREVIEW.md](PREVIEW.md) |
| Search progress | Live-walk streams results; status bar + banner show folder progress and running counts |
| Folder statistics | Depth-first **Calculate Statistics** on full subtrees; Shift+skip tagged trees; columns Files / Total Files / Folders / Total Folders — [ADS.md](ADS.md) |
| Slideshow crop | Numpad edge trim during slideshow; compiled-lists window relays crop keys |
| Draw caption | NTFS Caption ADS poster in slideshow / preview / viewer when enabled |
| Nested custom context menus | `\` in custom command labels builds submenus |
| Tab bar | Chrome-like shrink + overflow scroll |
| Settings About | Updates + Export/Import + GitHub help link |

## Recent behavior (v0.6.x)

| Area | Spec |
| ---- | ---- |
| Experimental Linux packaging | AppImage + Wayland helpers; Win32 APIs lazy-load; not a support matrix — [LINUX.md](LINUX.md) |
| Remote repositories | D46 — opt-in FTP/FTPS/SFTP; toolbar + tree; stage Open/preview; FTP ops serialized — [REMOTE_FTP.md](REMOTE_FTP.md) |
| Network neighborhood / mapped drives | D44 / D3 — discovery, UNC, reconnect without Explorer — [NETWORKS.md](NETWORKS.md) |
| Settings export / import | D45 — portable prefs + Network hosts + remote connection metadata + **full context-menu customization** (no passwords / window geometry) |
| Context menu Discover / layout | D41 — HKCR verb scan (persist + tick to enable); Built-in drag order & separators; Custom files/folders |
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
