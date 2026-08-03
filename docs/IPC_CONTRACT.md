# IPC contract

**Version:** 0.0.0 (spec)

Preload exposes `window.myFileExplorer`. Channel names are stable strings in `src/shared/ipc/contract.ts`.

All invoke handlers return `Result<T>` (see [ARCHITECTURE.md](ARCHITECTURE.md)).

---

## Namespaces

### `fs.*`

| Channel              | Request                                          | Response                                      |
| -------------------- | ------------------------------------------------ | --------------------------------------------- |
| `fs:list`            | `{ path, includeHidden? }`                       | `{ path, entries: DirEntry[] }`               |
| `fs:stat`            | `{ path }`                                       | `StatResult`                                  |
| `fs:mkdir`           | `{ parent, name }`                               | `{ path }`                                    |
| `fs:createFile`      | `{ parent, name }`                               | `{ path }`                                    |
| `fs:rename`          | `{ path, newName }`                              | `{ path }`                                    |
| `fs:copy`            | `{ sources[], destinationDir, conflictPolicy? }` | `{ copied: string[], skipped: string[] }`     |
| `fs:move`            | `{ sources[], destinationDir, conflictPolicy? }` | `{ moved, moves: {from,to}[], skipped }`      |
| `fs:relocate`        | `{ pairs: { from, to }[] }`                      | `{ moved: string[] }` (exact destinations)    |
| `fs:checkConflicts`  | `{ sources[], destinationDir }`                  | `{ conflicts[], items[] }` (name + both sides’ stats/dims) |
| `fs:trash`           | `{ paths[] }`                                    | `{ trashed: string[] }`                       |
| `fs:restoreFromTrash`| `{ paths[] }` (original full paths)              | `{ restored[], missing[] }` (Recycle Bin)     |
| `fs:deletePermanent` | `{ paths[] }`                                    | `{ deleted: string[] }`                       |
| `fs:exists`          | `{ path }`                                       | `{ exists: boolean }`                         |
| `fs:watch`           | `{ path }`                                       | `{ watching: true }` (main tracks per window) |
| `fs:unwatch`         | `{ path }`                                       | `{ ok: true }`                                |
| `fs:listDrives`      | —                                                | `{ drives: { path, label }[] }`               |
| `fs:saveEditedImage` | `{ path, dataBase64 }`                           | `{ path, preservedOriginal }` (D27)           |
| `fs:hasImageOriginal`| `{ path }`                                       | `{ hasOriginal }`                             |
| `fs:revertImageOriginal` | `{ path }`                                   | `{ path, reverted }`                          |
| `fs:readImageForEdit` | `{ path }`                                      | `{ dataBase64, mime }` (editor load)          |
| `fs:saveEditedImageAs` | `{ dataBase64, defaultPath }`                  | `{ path, cancelled }` — no original backup    |

`conflictPolicy`: `'fail' (default) | 'replace' | 'skip' | 'rename'` — applied to the whole batch (D18). Renderer prechecks with `fs:checkConflicts` and prompts once.

`DirEntry`: `{ name, path, kind: 'file'|'dir'|'symlink', size, mtimeMs, ext, isHidden }`.

### `shell.*`

| Channel                     | Purpose                         |
| --------------------------- | ------------------------------- |
| `shell:openPath`            | OS default open                 |
| `shell:showItemInFolder`    | System Explorer select          |
| `shell:openRecycleBin`      | Open Windows Recycle Bin in Explorer |
| `shell:clipboardWriteFiles` | Cut/copy file list for OS paste |
| `shell:clipboardReadFiles`  | Read file list if present       |
| `shell:openExternal`        | http(s) only if ever needed     |

### `session.*`

| Channel       | Purpose                               |
| ------------- | ------------------------------------- |
| `session:get` | Load `session.json`                   |
| `session:set` | Replace/patch session (Zod-validated) |

### `settings.*`

| Channel                    | Purpose         |
| -------------------------- | --------------- |
| `settings:get`             | Full settings   |
| `settings:set`             | Patch settings  |
| `settings:clearThumbCache` | Wipe thumbs dir |

### `preview.*`

| Channel       | Purpose                                                    |
| ------------- | ---------------------------------------------------------- |
| `preview:get` | `{ path }` → `PreviewModel` (see [PREVIEW.md](PREVIEW.md)) |

### `search.*`

| Channel             | Purpose                           |
| ------------------- | --------------------------------- |
| `search:query`      | `{ query, scope }` → results page |
| `search:addRoot`    | Mark folder for indexing          |
| `search:removeRoot` | Unmark + drop rows                |
| `search:reindex`    | `{ rootPath? }`                   |
| `search:listRoots`  | Indexed roots + status            |
| `search:cancel`     | Cancel active query/index job     |

### `thumbs.*`

| Channel      | Purpose                                           |
| ------------ | ------------------------------------------------- |
| `thumbs:get` | `{ path, size }` → `{ url, frames? }` — image/PSD thumb URL, or video strip frame URLs from `!VIDTHUMB_CACHE` (D26); `url` null when unavailable |
| `thumbs:generateVidCache` | `{ paths[], mode: 'missing' \| 'all', recursive? }` → `{ generated, skipped, failed[] }` — write 20 evenly sampled JPEG frames into sibling `!VIDTHUMB_CACHE` (folders = videos in that folder; `recursive` walks subfolders) |

### `app.*`

| Channel          | Purpose                                 |
| ---------------- | --------------------------------------- |
| `app:getPath`    | special paths (userData, home, desktop) |
| `app:pickFolder` | native folder dialog                    |
| `app:pickFiles`  | native open dialog if needed            |

---

## Events (main → renderer)

Broadcast on `mfe-event` (or per-channel `webContents.send`):

| Event                     | Payload                                       |
| ------------------------- | --------------------------------------------- |
| `fs-changed`              | `{ path, reason }`                            |
| `search-progress`         | `{ phase, current?, total?, message? }`       |
| `index-progress`          | `{ rootPath, processed, total? }`             |
| `op-progress`             | `{ opId, kind, done, total, current?, label?, phase }` — `kind`: copy/move/trash/delete/relocate/vid-thumbs |
| `session-external-change` | rare: multi-window later                      |

---

## Preload surface (sketch)

```ts
window.myFileExplorer = {
  fs: { list, stat, mkdir, createFile, rename, copy, move, trash, deletePermanent, … },
  shell: { openPath, showItemInFolder, … },
  session: { get, set },
  settings: { get, set, clearThumbCache },
  preview: { get },
  search: { query, addRoot, removeRoot, reindex, listRoots, cancel },
  thumbs: { get, generateVidCache },
  app: { getPath, pickFolder, ready, … },
  onEvent: (handler) => unsubscribe
}
```

`onEvent` receives `fs-changed`, `search-progress`, `index-progress`, `op-progress`, `external-open`.