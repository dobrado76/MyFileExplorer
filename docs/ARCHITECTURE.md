# Architecture

**Version:** 0.3.0

Standalone Electron + React desktop app. Clear process boundaries; **no Node APIs in the renderer**.

---

## Process model

```
Renderer (React + Zustand)
        │  typed preload (contextIsolation + sandbox)
Main (fs, shell, session, settings, preview, search, thumbs)
        │
   Real filesystem  +  Electron userData (app state, index, thumb cache)
```

| Concern                                          | Owner                                                       |
| ------------------------------------------------ | ----------------------------------------------------------- |
| Navigation UI, selection highlight, open dialogs | Renderer Zustand                                            |
| Directory listings, watch, mutations             | Main `fs`                                                   |
| Tabs/session snapshot persistence                | Main `session` (renderer proposes; main validates & writes) |
| Settings / theme                                 | Main `settings`                                             |
| Thumbnail generation & cache                     | Main `thumbs`                                               |
| Preview metadata parse                           | Main `preview`                                              |
| Search index & queries                           | Main `search`                                               |
| OS open / trash / clipboard files                | Main `shell`                                                |

---

## Repository layout (target)

```
src/
├─ main/
│  ├─ ipc/           register handlers
│  ├─ fs/            list, stat, mkdir, rename, copy, move, watch
│  ├─ shell/         openPath, trash, showItemInFolder, clipboard
│  ├─ session/       tabs + UI chrome persistence
│  ├─ settings/      theme, font, behavior
│  ├─ preview/       metadata extractors
│  ├─ search/        indexer + FTS query
│  ├─ thumbs/        sharp cache + `!VIDTHUMB_CACHE` resolve/generate (ffmpeg)
│  ├─ media/         custom protocol
│  ├─ security/      path guards
│  └─ logging/
├─ preload/          window.myFileExplorer
├─ renderer/
│  ├─ components/
│  ├─ screens/       ExplorerShell (primary)
│  ├─ store/
│  └─ styles/
├─ shared/
│  ├─ schemas/       zod
│  └─ ipc/           channel names + types
└─ tests/
docs/
PLAN.md
```

---

## Media protocol

Custom protocol (e.g. `mfe-media://`) serves:

- File bytes for preview (images, text sniffs)
- Thumbnail images from cache
- Audio/video/PDF with **HTTP byte-range** responses (`Accept-Ranges` / `206`) so Chromium media can play and seek

**Allowlist:** only paths that main has approved (currently visible tab roots, explicit preview target, thumb cache dir, and `!VIDTHUMB_CACHE` when video strip frames resolve or are generated). Never arbitrary disk read from renderer-supplied URLs without validation.

---

## Folder watching

Main watches the **active tab’s directory** and its **parent** via `fs.watch` (debounced). Broadcast `fs-changed` so the renderer soft-refreshes the listing and reloads that folder’s children in the tree. Mute briefly after in-app mutations to avoid selection jumps. **Refresh (F5)** always reloads the listing and every tree folder already loaded for the tab.

---

## Error model

IPC returns a Result envelope:

```ts
type Ok<T> = { ok: true; value: T }
type Err = { ok: false; error: { code: string; message: string; remediation?: string } }
type Result<T> = Ok<T> | Err
```

Codes (examples): `not-found`, `not-allowed`, `busy`, `conflict`, `validation`, `cancelled`, `io`.

---

## Concurrency

- Directory list: cancel/supersede stale requests when path changes quickly.
- Search: single active query per window; cancel previous.
- Indexer: background queue; one writer; progress events.
- File ops / video-preview generation: throttled `op-progress` events to the status bar (D28); renderer 1 s busy fallback when main is still silent.
- File ops: serialize destructive ops that touch the same path.

---

## Related

[PROJECT_FORMAT.md](PROJECT_FORMAT.md) · [IPC_CONTRACT.md](IPC_CONTRACT.md) · [SECURITY.md](SECURITY.md)
