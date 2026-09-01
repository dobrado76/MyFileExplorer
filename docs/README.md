# MyFileExplorer documentation

**Status:** **v0.14.0** — **D68** Virtual Folder OS projection (Windows / WinFsp); **D67** Virtual Folders (`.mfevirtual`); **D66** WinDirStat-style folder space map + **D65** lock owners; **D64** Git / **D63** Quick Launch remain. Product release notes: [../RELEASE_NOTES.md](../RELEASE_NOTES.md). Locked choices: [DECISIONS.md](DECISIONS.md) (through **D71**). Experimental Linux: [LINUX.md](LINUX.md). Licence: [../LICENSING.md](../LICENSING.md) (**GPL-3.0-only**).

Hub for product and engineering docs. Product entry: [../README.md](../README.md). Locked decisions: [DECISIONS.md](DECISIONS.md). Full history: [../CHANGELOG.md](../CHANGELOG.md).

---

## Reading order

**New agent / implementer**

1. [PRODUCT_SPEC.md](PRODUCT_SPEC.md) · [ADVANTAGES.md](ADVANTAGES.md) (vs Explorer + workbench) · [BUSINESS_UVP.md](BUSINESS_UVP.md) (org UVP)
2. [DECISIONS.md](DECISIONS.md)
3. [ARCHITECTURE.md](ARCHITECTURE.md)
4. Domain docs as needed: PREVIEW, SEARCH, NETWORKS, REMOTE_FTP, MEDIA_METADATA, USER_METADATA, SCRIPTS, GIT, VIRTUAL_FOLDERS, IPC_CONTRACT, UI_DESIGN, PROJECT_FORMAT, SECURITY, INTEGRATION, SLIDESHOW, ADS
5. Remaining open deferrals live under [DECISIONS.md](DECISIONS.md) **Deferred** (the old `FUTURE_IDEAS.md` parking lot was cleared — those candidates shipped as D51 / D55–D62)

---

## Index

| Doc                                              | Topic                                 |
| ------------------------------------------------ | ------------------------------------- |
| [PRODUCT_SPEC.md](PRODUCT_SPEC.md)               | Features & UX requirements            |
| [BUSINESS_UVP.md](BUSINESS_UVP.md)               | Business UVP — semantic file workbench for organizations |
| [ADVANTAGES.md](ADVANTAGES.md)                   | Advantages vs Explorer + workbench / Virtual Folders framing |
| [BUILD.md](BUILD.md)                             | Local build + tagged GitHub Releases   |
| [LINUX.md](LINUX.md)                             | Experimental Linux AppImage / Wayland helpers |
| [ARCHITECTURE.md](ARCHITECTURE.md)               | Electron processes, layout, ownership |
| [PROJECT_FORMAT.md](PROJECT_FORMAT.md)           | `userData` files & schemas            |
| [IPC_CONTRACT.md](IPC_CONTRACT.md)               | Typed IPC channels                    |
| [DECISIONS.md](DECISIONS.md)                     | Locked decisions D1…D71               |
| [UI_DESIGN.md](UI_DESIGN.md)                     | Layout, tabs, themes, menus           |
| [PREVIEW.md](PREVIEW.md)                         | Preview pane, gen metadata, video strips |
| [FOLDER_STATISTICS.md](FOLDER_STATISTICS.md)     | Calculate Statistics + Space usage map (D66); plain vs Shift+click |
| [PAIRED_FOLDERS.md](PAIRED_FOLDERS.md)           | Dual-pane paired folders — compare / sync rail (D69) |
| [PREVIEW_EXTENSIONS.md](PREVIEW_EXTENSIONS.md)   | All preview-supported file extensions ([samples/preview-extensions/](../samples/preview-extensions/)) |
| [VIRTUAL_FOLDERS.md](VIRTUAL_FOLDERS.md)         | Virtual Folders — `.mfevirtual` folder-like collections (D67) |
| [VIRTUAL_FOLDER_PROJECTION.md](VIRTUAL_FOLDER_PROJECTION.md) | Optional WinFsp OS projection (D68, Windows) — install WinFsp + release zip |
| [SEARCH.md](SEARCH.md)                           | Everything-parity indexing & search   |
| [NETWORKS.md](NETWORKS.md)                       | Network neighborhood & mapped drives (D44) |
| [SECURITY.md](SECURITY.md)                       | Path guards & destructive ops         |
| [INTEGRATION.md](INTEGRATION.md)                 | CLI / `mfe://` open from other apps   |
| [REMOTE_FTP.md](REMOTE_FTP.md)                   | FTP/FTPS/SFTP remotes (D46)           |
| [SLIDESHOW.md](SLIDESHOW.md)                     | Gated slideshow / categorizer (D37) |
| [ADS.md](ADS.md)                                 | NTFS Alternate Data Streams (D38) + folder statistics (D66) |
| [USER_METADATA.md](USER_METADATA.md)             | Opt-in user-defined structured metadata (D70, off by default) |
| [MEDIA_METADATA.md](MEDIA_METADATA.md)           | Opt-in movie/TV metadata (D50) |
| [SCRIPTS.md](SCRIPTS.md)                         | Universal script runner, use cases, and examples (D51) |
| [GIT.md](GIT.md)                                 | Optional Git-aware browsing / lightweight client (D64) |
| [../LICENSING.md](../LICENSING.md)               | GPL-3.0-only |
| [../TRADEMARK.md](../TRADEMARK.md)               | MyFileExplorer name / logo policy |

---

## Recent behavior (v0.14.0)

| Area | Spec |
| ---- | ---- |
| Virtual Folders (D67) | `.mfevirtual` portable folder-like collections; Tab.path = document file; Del = remove ref; extract/absorb; Manual sort + Location column — [VIRTUAL_FOLDERS.md](VIRTUAL_FOLDERS.md) |
| OS projection (D68) | Optional WinFsp sibling mount; Settings → Behavior; install WinFsp + release zip — [VIRTUAL_FOLDER_PROJECTION.md](VIRTUAL_FOLDER_PROJECTION.md) |

## Recent behavior (v0.13.0)

| Area | Spec |
| ---- | ---- |
| Folder space map (D66) | After **Calculate Statistics**, non–Git-root folder preview: categories, largest/recent, WinDirStat-style nested treemap; **Other N · size** on the Space usage heading. Plain vs **Shift+click** (skip tagged) — [FOLDER_STATISTICS.md](FOLDER_STATISTICS.md) |
| Paired folders (D69) | Side-by-side layout centre rail: directional copy, compare projection, reviewed sync plans — [PAIRED_FOLDERS.md](PAIRED_FOLDERS.md) |
| Lock owners (D65) | Busy file-op review lists processes + End task / Locate / Refresh |
| File op plan | Hold **Ctrl** on copy/move/paste/delete → plan dialog with Dry run |
| Git polish | Changes dialog, commit detail, file history, clone, gitignore, repo-root toolbar / commit menu — [GIT.md](GIT.md) |
| Tree hide control | Appearance pin vs per-pane toolbar button |

## Recent behavior (v0.12.0)

| Area | Spec |
| ---- | ---- |
| Git-aware browsing (D64) | **Opt-in** Settings → Git. Overlays / folder indicators / Details Git status / toolbar Commit·Pull·Push / context Git. Select **repo root** → **Git \| Folder** preview tabs (history by default). System `git` only — [GIT.md](GIT.md) |
| Quick Launch (D63) | Toolbar pins (icon / label / both). Settings manage; strip hidden when empty. |
| Global scripts | Each Global script is its own toolbar button (face matches Quick Launch). |
| Recycle Bin placement | Appearance: none / tree / toolbar / both (default both). |
| Explorer clipboard | Native CF_HDROP + DropEffect both ways (Cut → move). |
| Search / slideshow polish | Show hidden vs view filter; `!Name` literal; slideshow respects eye; Alt title path. |

## Recent behavior (v0.11.0)

| Area | Spec |
| ---- | ---- |
| Reopen closed tabs (D55) | `Ctrl+Shift+T` / tab-bar **Recently closed** (cap 25). **Clear recently closed** empties the stack. Search results are not restored. |
| Smart clipboard paste (D56) | Image / text / URL / HTML → new file. **Paste Special**. Settings → Behavior can disable. URL becomes `.url` — never downloaded. |
| New-file templates (D57) | New / Add → **From Template**. Manage Templates: pretty name, ↑↓, replace, duplicate. Catalog + files under `userData`. |
| Grouped Quick access (D58) | Named, colored, collapsible groups in the tree. Flat lists from earlier versions still load. |
| Create link (D59) | File Tools → **Create link…** — symlink / hard link / junction. |
| View presets (D60) | Pane view-presets control saves mode / sort / Details columns. Apply patches an existing folder override; never creates one. |
| Attached notes (D61) | Context **Note…** → `mfe_note` ADS. Preview + Details Note / Status / Has note / Checklist. Power Search `note:` / `notestatus:` / `hasnote:` / `todo:`. Writes restore host times — [ADS.md](ADS.md). |
| Media metadata (D50) | Opt-in Plex / TMDB / OMDb; covers and watched — [MEDIA_METADATA.md](MEDIA_METADATA.md). |
| Item icons (D62) | Context **Set icon…** — Lucide / custom PNG / shell+tint. Distinct from File Tools **Change Icon…**. Host times unchanged. |
| Copy timestamps (D53) | Copy / cross-volume move keeps source Created and Modified. |
| Custom tab icons (D54) | Cover-crop PNG/JPG/ICO; icon-only tabs hug the image. |

## Recent behavior (v0.10.0)

| Area | Spec |
| ---- | ---- |
| NTFS USN journal (D52) | Drive Properties **USN…** — status, enable/resize (UAC), recent records, probe file on first Enable. **Delete journal…** is a full-volume MFT scan (cannot cancel). — [SEARCH.md](SEARCH.md) |
| Settings search | Filter Settings pages from the Settings window |
| Preview word wrap | Text / Markdown / HTML source wrap toggle (off by default) — [PREVIEW.md](PREVIEW.md) |
| Properties | Detached peer OS windows; multi-select = one combined sheet (Shift = separate) |
| Copy/move progress | File counts + left-ellipsis current path |
| Details ADS | On-screen rows fill without a dummy scroll |
| Slideshow | Faster start on large folders; crop steps 5% / 2.5% / 1% / 0.5% |

## Recent behavior (v0.9.0)

| Area | Spec |
| ---- | ---- |
| Universal scripts (D51) | **Opt-in** (Settings → Scripting and AI, off by default). PowerShell / **Python 3** (not 2.x) / cmd / bash on the current folder or selection; saved library; context **Scripts**; optional AI that never sends files — [SCRIPTS.md](SCRIPTS.md) |
| Git-aware browsing (D64) | **Opt-in** (Settings → Git, off by default). Status overlays, toolbar Commit/Pull/Push, context Git actions via system `git` — [GIT.md](GIT.md) |
| Media metadata (D50) | Opt-in Plex / TMDB / OMDb cards on the file or folder (NTFS streams). Show poster on the show folder; episode `SxxExx` tiles; Change cover; consolidate Subs; watched / genre toolbar — [MEDIA_METADATA.md](MEDIA_METADATA.md) |
| This PC tools | Right-click **Drives** → Computer Manager / Device Manager / Control Panel / Recycle Bin / Properties |
| Collapse all | Toolbar button next to Select all; collapses the current tab’s folder tree only |
| Delete a tab root | Always confirm; warns that scoped tabs will close |
| Details horizontal scroll | Scrollbar at the **bottom** of the file pane; header and rows move together |

## Recent behavior (v0.8.x)

| Area | Spec |
| ---- | ---- |
| Drive free space | Status bar `N GB free of M GB (P%)`; tree **Drives** header → pies for every volume; mapped letters included; offline / empty media do not stall the list |
| Detached preview | **Open preview window** peer window; Zen mode; bounds remembered (stripped on settings export) — [PREVIEW.md](PREVIEW.md) |
| Calendar / email | `.ics` / `.ical` agenda; `.eml` headers + body (no remote images) — [PREVIEW_EXTENSIONS.md](PREVIEW_EXTENSIONS.md) |
| NAS listing cache | D49 — session-only last listing for UNC / mapped / remotes; paint then revalidate — [NETWORKS.md](NETWORKS.md) |
| More previews | 3D (`.obj` / `.fbx` / `.3ds`), `.hdr`, Unity / VS text, `.uvw`, subtitles, `.divx`; fixtures in [`samples/preview-extensions/`](../samples/preview-extensions/) |
| Power Search designs | Name and reload a complex search (params stored; target chosen each run) |
| Tab chrome | Default Lucide tab icons; custom image icons (D54) with icon-only tight chrome; Settings → Appearance show icons / equal-width tabs |
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
| Folder statistics | Depth-first **Calculate Statistics**; **Shift+click** skips already-tagged trees — [FOLDER_STATISTICS.md](FOLDER_STATISTICS.md) · streams [ADS.md](ADS.md) |
| Slideshow crop | Numpad edge trim during slideshow |
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
| Open Command Line | Folder context; cmd or PowerShell (Settings); click = current user; Shift = Admin |
| Slideshow / categorizer | D37 — gated chrome; map; cache; invalid-images folder — [SLIDESHOW.md](SLIDESHOW.md) |
| NTFS ADS | D38 — Details column + manager — [ADS.md](ADS.md) |
| Everything-parity search | D34 — hybrid folder + volume index; query language; as-you-type; content; filters/bookmarks; optional HTTP API |
| Multi-pane | D31 — 1 / 2 / 3 / 4 panes + per-pane tree + layout persistence; empty pane Open Computer / Browse |
| Tab icons | D32 — Lucide icon + color; tab context menu |
| In-pane video | D33 — byte-range media; MKV remux; AVI strip-only |
| Richer previews | HTML/Markdown Preview·Raw; Unity; PE; ZIP/7z/RAR/TAR/APK/MSI/ISO; `.chm` (D35); `.ttf` (D36) — [PREVIEW_EXTENSIONS.md](PREVIEW_EXTENSIONS.md) |
| Windows Properties | Shell property sheet from detached Properties window |
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
