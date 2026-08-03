# Implementation plan

**Version:** 0.1.0 (implemented)

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
- [x] Drag-drop move/copy (D11)
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

---

## Testing expectations (ongoing)

| Area                  | Tests                                                             |
| --------------------- | ----------------------------------------------------------------- |
| Path guards           | `src/tests/pathGuards.test.ts` — protocol allowlist, `..` escapes |
| A1111 parser          | `src/tests/a1111.test.ts`, `src/tests/pngText.test.ts`            |
| FTS query builder     | `src/tests/queryBuilder.test.ts`                                  |
| Session migrate       | `src/tests/sessionSchema.test.ts`                                 |
| Result envelope       | `src/tests/result.test.ts`                                        |
| Renderer path helpers | `src/tests/rendererPaths.test.ts`                                 |
| Video thumb naming    | `src/tests/vidThumbCache.test.ts`, `src/tests/vidThumbSample.test.ts` |

---

## Phase 10 candidates (not started)

- Marquee selection
- Ctrl+click / middle-click tree or folder → new tab
- Comfy workflow node summary
- ~~Type-ahead select in file view~~ (done)
- ~~Inline audio/video playback~~ (done), PDF first-page raster (still optional; PDF uses Chromium iframe)
- FS-watch-triggered reindex of indexed roots
- Cancel in-flight multi-file ops / video-preview generation

---

## Definition of done (v0.1.0 product)

All Phase 0–8 exits green; Phase 9 packaging works; PRODUCT_SPEC acceptance checklist mostly checked. ✅
