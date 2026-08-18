# Implementation plan

**Version:** 0.8.0 (implemented)

Work through phases in order unless a dependency allows parallelizing UI polish. Check off in PRs / commits as you go.

Canonical overview: [../PLAN.md](../PLAN.md).

---

## Phase 0 — Scaffold

- [x] electron-vite TypeScript React setup in this repo root
- [x] Path aliases `@shared`, `@main`, `@renderer`
- [x] ESLint, Prettier, Vitest, `npm run check`
- [x] electron-builder win target stub
- [x] `window.myFileExplorer` preload + `Result` helper
- [x] App id `com.myfileexplorer.app` / productName `MyFileExplorer`; shared userData `%APPDATA%\MyFileExplorer` for dev + install (D17)

**Exit:** `npm run dev` opens a blank shell window. ✅

---

## Phase 1 — Filesystem list + protocol

- [x] `fs:list` / `fs:stat` with Zod + path guards
- [x] Custom media protocol (`mfe-media://`) allowlist
- [x] Renderer: show entries for a folder
- [x] Refresh / F5

**Exit:** browse one folder’s names safely. ✅

---

## Phase 2 — Three-pane chrome

- [x] Tree (lazy expand) | file view | preview
- [x] Splitters + persist widths via `session`
- [x] Breadcrumb + Up
- [x] Collapse preview

**Exit:** navigate folders by tree/double-click/breadcrumb. ✅

---

## Phase 3 — Tabs + session

- [x] Tab bar: new, close, activate
- [x] Per-tab path + history back/forward
- [x] Persist/restore `session.json`
- [x] Rename tab (double-click) + drag reorder

**Exit:** restart app; tabs return. ✅

---

## Phase 4 — View modes

- [x] Large/medium/small/extra-large icons with thumbs (`thumbs:get` + Sharp)
- [x] List + Details + sort
- [x] Virtualization (`@tanstack/react-virtual`)
- [x] Folders-first setting

**Exit:** switch views; thumbs appear for images. ✅

---

## Phase 5 — File operations

- [x] New folder / new file
- [x] Rename (F2)
- [x] Cut/copy/paste + conflict prompts (batch policy, D18)
- [x] Drag-drop move/copy (D11) + OS export via `startDrag` when leaving the window
- [x] Trash + permanent delete (D7)
- [x] Undo/redo for trash, move, copy, rename, new (Ctrl+Z/Y, D23)
- [x] Open / Show in system Explorer
- [x] Curated context menu

**Exit:** daily file management without Explorer. ✅

---

## Phase 6 — Preview + gen metadata

- [x] `preview:get` pipeline (cached by path+mtime+size)
- [x] Image/text/binary/directory previews
- [x] A1111 parameters parse + Comfy JSON chunks ([PREVIEW.md](PREVIEW.md))
- [x] Field list UI with copy

**Exit:** select an A1111 PNG; see prompt in preview. ✅

---

## Phase 7 — Theme & font

- [x] Dark / light / custom token editor
- [x] Font family + size
- [x] Live apply + persist settings

**Exit:** theme survives restart. ✅

---

## Phase 8 — Search index

- [x] SQLite schema (`node:sqlite`, D16) + add/remove roots (parent-covers-child)
- [x] Indexer + progress events
- [x] FTS query UI (FTS5 with LIKE fallback)
- [x] Live-walk fallback with banner (D15)

**Exit:** indexed folder finds files quickly by name. ✅

---

## Phase 9 — Polish & package

- [x] Keyboard map from PRODUCT_SPEC
- [x] Status bar details (+ file-op / video-preview progress, D28)
- [x] Window state restore
- [x] Properties dialog
- [x] Video strip generate (missing / recursive missing / regenerate, D26)
- [x] Context menu viewport clamp (main + submenus)
- [x] `npm run build:win` smoke (NSIS installer builds)
- [x] First CHANGELOG release notes (0.1.0)
- [x] v0.2.0 release notes ([RELEASE_NOTES.md](../RELEASE_NOTES.md), CHANGELOG)
- [x] v0.3.0 release notes + README / ADVANTAGES / docs alignment
- [x] v0.4.0 release notes + README / ADVANTAGES / SEARCH / docs alignment
- [x] v0.5.0 release notes + README / ADVANTAGES / SLIDESHOW / ADS / docs alignment
- [x] v0.6.0 Network (D44) + settings export (D45) + NETWORKS.md / docs alignment
- [x] v0.6.3 remotes (D46) + context-menu Discover/layout (D41) + experimental Linux AppImage helpers; Windows remains primary; RELEASE_NOTES / docs tag-ready
- [x] v0.7.0 Power Search + continue-then-review bulk ops + per-tab search + PowerPoint slides + folder statistics depth-first + slideshow crop + search progress UX + tab/splitter polish; RELEASE_NOTES / docs aligned to **0.7.0** for tag `v0.7.0`
- [x] v0.8.0 drive free space + detached preview + `.ics`/`.eml` + D49 listing cache + preview-type / large-folder polish; RELEASE_NOTES / docs aligned to **0.8.0** for tag `v0.8.0`

---

## Testing expectations (ongoing)

| Area                  | Tests                                                             |
| --------------------- | ----------------------------------------------------------------- |
| Path guards           | `src/tests/pathGuards.test.ts` — protocol allowlist, `..` escapes |
| A1111 parser          | `src/tests/a1111.test.ts`, `src/tests/pngText.test.ts`            |
| Query builder / Everything parser | `src/tests/queryBuilder.test.ts`, `src/tests/everythingQuery.test.ts` |
| Session migrate       | `src/tests/sessionSchema.test.ts`                                 |
| Result envelope       | `src/tests/result.test.ts`                                        |
| Renderer path helpers | `src/tests/rendererPaths.test.ts`                                 |
| Video thumb naming    | `src/tests/vidThumbCache.test.ts`, `src/tests/vidThumbSample.test.ts` |

---

## Phase 10 — Everything-parity search (D34)

- [x] Spec rewrite ([SEARCH.md](SEARCH.md), D34)
- [x] Hybrid roots schema (`folder` \| `volume`) + folder FS-watch incremental
- [x] NTFS volume index (USN enum bootstrap + journal monitor; walk fallback)
- [x] Everything-like query parser + as-you-type + match toggles
- [x] Advanced functions (`attrib:`, `dupe*`, `child*`, `depth:`)
- [x] Unindexed `content:` search + honesty banner
- [x] Saved filters / bookmarks
- [x] Optional localhost HTTP query API

**Exit:** opt-in drive index + rich query language without mandatory whole-disk indexing.

---

## Phase 11 candidates (not started)

- Marquee selection
- Ctrl+click / middle-click tree or folder → new tab
- Comfy workflow node summary
- PDF first-page raster (optional; PDF uses Chromium iframe)
- [x] Cancel in-flight multi-file ops / video-preview generation
- [x] Type-ahead select in file view
- [x] Inline audio/video playback

Longer-horizon optional ideas (clipboard paste, templates, closed tabs, automator, …) are **not** Phase 11 and are **not scheduled**: [FUTURE_IDEAS.md](FUTURE_IDEAS.md).

---

## Definition of done (v0.1.0 product)

All Phase 0–8 exits green; Phase 9 packaging works; PRODUCT_SPEC acceptance checklist mostly checked. ✅

## Definition of done (v0.2.0 product)

v0.1.0 plus: search-as-file-view (D29), OS drag-out (D11), reliable Recycle Bin / media handles (D7), file-op Cancel (D28), tree DnD, faster move/trash; README / CHANGELOG / RELEASE_NOTES / docs aligned to 0.2.0. ✅

## Definition of done (v0.3.0 product)

v0.2.0 plus: right-drag **Create shortcuts here**, drag edge auto-scroll, in-app Recycle Bin view, tab drop-bins, large-folder performance, shell-icon folder cache fix, recycle undo restore; README / CHANGELOG / RELEASE_NOTES / ADVANTAGES / docs aligned to 0.3.0. ✅

## Definition of done (v0.4.0 product)

v0.3.0 plus: Everything-parity search (D34), multi-pane (D31), tab icons (D32), in-pane video (D33), HTML/Markdown/Unity/PE previews, Windows Properties…, drag/recent polish; README / CHANGELOG / RELEASE_NOTES / ADVANTAGES / SEARCH / docs aligned to 0.4.0. ✅

## Definition of done (v0.5.0 product)

v0.4.0 plus: slideshow / categorizer (D37), compiled file lists (D39), NTFS ADS (D38), CHM (D35) / font (D36) / broader archive previews, 7za ZIP compress, empty-pane Open Computer / Browse; README / CHANGELOG / RELEASE_NOTES / ADVANTAGES / SLIDESHOW / ADS / docs aligned to 0.5.0. ✅

## Definition of done (v0.6.0 product)

v0.5.0 plus: Network neighborhood & mapped-drive reconnect (D44/D3), Settings export/import (D45), Open Command Line (Shift=Admin), docs/NETWORKS.md; README / CHANGELOG / RELEASE_NOTES / ADVANTAGES / DECISIONS aligned to 0.6.0 (through D45). ✅

## Definition of done (v0.6.3 / v0.6 line complete)

v0.6.0 plus: opt-in Remote repositories (D46); context-menu Discover + built-in layout (D41); experimental Linux AppImage / Wayland helpers ([LINUX.md](LINUX.md)); lazy Win32 koffi loads; Windows `dist` host guard; settings export covers full context-menu customization; docs / RELEASE_NOTES aligned to **0.6.3** for tag `v0.6.3`. ✅

## Definition of done (v0.7.0 product)

v0.6.3 plus: Power Search visual builder; continue-then-review copy/move/trash/delete (D18); per-tab search + prune stale hits (D29); PowerPoint slide preview; folder statistics depth-first subtree tagging + Shift+skip; slideshow manual crop + draw caption; nested custom context submenus; search live-walk progress/streaming; tab bar overflow scroll; multi-pane splitter fix; Settings About tab; README / CHANGELOG / RELEASE_NOTES / SEARCH / SLIDESHOW / docs aligned to **0.7.0** for tag `v0.7.0`. ✅

## Definition of done (v0.8.0 product)

v0.7.0 plus: drive free space (status bar + Drives pies, mapped + offline); detached preview window + Zen; `.ics` / `.ical` / `.eml` preview; D49 session listing cache for NAS/UNC; 3D / HDR / Unity / VS / subtitle / `.uvw` preview; Power Search saved designs; tab icon defaults; large-folder interactivity; README / CHANGELOG / RELEASE_NOTES / PREVIEW_EXTENSIONS / docs aligned to **0.8.0** for tag `v0.8.0`. ✅

---

## Phase — Multi-view panes (D31)

- [x] Session `viewLayout` 1 | 2 | 4 + `paneTabIds` + focus + pane split ratios
- [x] Per-pane mini-explorer (tree + files + nav); shared preview
- [x] Layout selector; tab drag-assign; auto-fill from open tabs
- [x] Named layouts snapshot multi-view fields

**Exit:** side-by-side / 2×2 with independent folders; restart restores pane layout.

---

## Phase — Local scripts + optional AI (D51)

- [x] Script runner IPC (`script:run` / cancel / detect), argv contract, temp manifests
- [x] Script library + manager + context **Scripts** submenu
- [x] Settings → AI (OpenAI-compatible, `safeStorage` keys)
- [x] Generate / modify / review-before-run (never send files)
- [x] Dry-run, deps copy-command, Ask AI to Fix confirm, `.mfescript` import/export

**Exit:** hand-written script runs with no AI; generate → save → context-menu rerun with zero AI calls. See [SCRIPTS.md](SCRIPTS.md).
