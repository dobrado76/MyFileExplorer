# Architecture

**Version:** 0.7.x

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

Main watches **visible pane directories** (and usually their **parents**) via `fs.watch` (250 ms debounce). Broadcast `fs-changed` so the renderer soft-refreshes matching listings and reloads that folder’s children in the tree. Mute briefly after in-app mutations / during `fs:list` (post-list mute is shorter for small folders) to avoid selection jumps and list→watch→list loops.

**Size tiers** (re-list cost, not `fs.watch` itself):

| Entries | Watch | Soft-reload min gap |
| ------- | ----- | ------------------- |
| &lt; 1 000 | Active dir + parent | ~400 ms |
| 1 000–7 999 | Active dir + parent | ~4 s |
| ≥ 8 000 | Parent only (detect folder gone/renamed); no watch-driven soft re-list | F5 / navigate |

Trash/move **suspend** closes all `ReadDirectoryChanges` handles; the renderer **re-arms** visible panes afterward (including in-folder deletes that prune without a full re-list). Watcher `error` emits `fs-watch-lost` so the renderer can re-arm. **Refresh (F5)** always reloads the listing and every tree folder already loaded for the tab.

**Remote listing memory (D49):** the renderer keeps a session-only LRU of the last listing for **UNC**, **mapped remote letters**, and **`mfe-remote://`** (about 24 folders; listings over 20 000 entries are not stored). Navigating back paints that snapshot immediately, then `fs:list` revalidates in the background. Local NTFS is never cached. The snapshot is dropped on F5, in-app mutations, and `fs-changed` for that folder. Nothing is written to disk.

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
