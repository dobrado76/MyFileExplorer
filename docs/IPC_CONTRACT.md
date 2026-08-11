# IPC contract

**Version:** 0.5.0

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
| `fs:createShortcuts` | `{ sources[], destinationDir }`                  | `{ created: string[] }` — Windows `.lnk` (right-drag) |
| `fs:compressToZip`   | `{ paths[] }`                                    | `{ zipPath }` — sibling `.zip` (Compress to ZIP file) |
| `fs:extractZip`      | `{ paths[] }` (`.zip` files)                     | `{ extractedDirs[] }` — sibling folders (Extract All…) |
| `fs:trash`           | `{ paths[] }`                                    | `{ trashed: string[] }`                       |
| `fs:restoreFromTrash`| `{ paths[] }` (original full paths)              | `{ restored[], missing[] }` (Recycle Bin)     |
| `fs:listRecycleBin`  | —                                                | `{ items[], truncated? }`                     |
| `fs:emptyRecycleBin` | —                                                | `{ emptied: true }`                           |
| `fs:deleteFromRecycleBin` | `{ paths[] }` (original full paths)         | `{ deleted[], missing[] }`                    |
| `fs:deletePermanent` | `{ paths[] }`                                    | `{ deleted: string[] }`                       |
| `fs:cancelOp`        | —                                                | `{ cancelled: boolean }` — stop in-flight copy/move/trash/delete/vid-thumbs |
| `fs:exists`          | `{ path }`                                       | `{ exists: boolean }`                         |
| `fs:watch`           | `{ path }`                                       | `{ watching: true }` (main tracks per window) |
| `fs:unwatch`         | `{ path }`                                       | `{ ok: true }`                                |
| `fs:listDrives`      | —                                                | `{ drives: { path, label, volumeName }[] }`   |
| `fs:setVolumeLabel`  | `{ path, name }` (drive root; `name` '' clears)  | `{ path, volumeName }`                         |
| `fs:saveEditedImage` | `{ path, dataBase64 }`                           | `{ path, preservedOriginal, versionCount }` — tip ADS (D27) |
| `fs:imageEditState`  | `{ path }`                                       | `{ versionCount, tipVer, hasVersions }`       |
| `fs:hasImageOriginal`| `{ path }`                                       | `{ hasOriginal }` — deprecated alias of `hasVersions` |
| `fs:revertImageOriginal` | `{ path }`                                   | `{ path, reverted }` — drop all `VER_*`       |
| `fs:dropImageVersion` | `{ path, ver }`                                 | `{ path, versionCount }` — drop + renumber    |
| `fs:commitImageVersion` | `{ path }`                                    | `{ path, committed }` — tip → `$DATA`         |
| `fs:readImageForEdit` | `{ path, ads? }`                                | `{ dataBase64, mime }` (editor load; tip default) |
| `fs:saveEditedImageAs` | `{ dataBase64, defaultPath }`                  | `{ path, cancelled }` — no version history    |

`conflictPolicy`: `'fail' (default) | 'replace' | 'skip' | 'rename'` — applied to the whole batch (D18). Renderer prechecks with `fs:checkConflicts` and prompts once.

`DirEntry`: `{ name, path, kind: 'file'|'dir'|'symlink', size, mtimeMs, ext, isHidden }`.

### `shell.*`

| Channel                     | Purpose                         |
| --------------------------- | ------------------------------- |
| `shell:openPath`            | OS default open                 |
| `shell:showItemInFolder`    | System Explorer select          |
| `shell:showProperties`      | Open Explorer’s property sheet (`ShellExecute` “properties” verb) |
| `shell:openRecycleBin`      | Legacy: open Windows Recycle Bin in Explorer (prefer in-app view) |
| `shell:clipboardWriteFiles` | Cut/copy file list for OS paste |
| `shell:clipboardReadFiles`  | Read file list if present       |
| `shell:startDrag`           | Sync: `webContents.startDrag` with absolute paths (OS export while a drag is active) |
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
| `preview:get` | `{ path, ads? }` → `PreviewModel` — optional `ads` (`null` = `$DATA`, `"VER_k"` = stream; omit = tip) (see [PREVIEW.md](PREVIEW.md)) |
| `preview:ensurePlayable` | `{ path }` → `{ mediaUrl }` — remux MKV/AVI/… to MP4 under userData for `<video>`; `mediaUrl` null on failure |

### `search.*`

| Channel             | Purpose                           |
| ------------------- | --------------------------------- |
| `search:query`      | `{ query, scope, match* }` → results (Everything-style query, D34) |
| `search:addRoot`    | Mark folder for indexing          |
| `search:addVolume`  | Index drive (NTFS USN when possible) |
| `search:removeRoot` | Unmark + drop rows                |
| `search:reindex`    | `{ rootPath? }`                   |
| `search:listRoots`  | Indexed roots + kind/monitor/status |
| `search:cancel`     | Cancel active query/index job     |

### `thumbs.*`

| Channel      | Purpose                                           |
| ------------ | ------------------------------------------------- |
| `thumbs:get` | `{ path, size }` → `{ url, frames? }` — image/PSD thumb URL, or video strip frame URLs from `!VIDTHUMB_CACHE` (D26); `url` null when unavailable |
| `thumbs:generateVidCache` | `{ paths[], mode: 'missing' \| 'all', recursive? }` → `{ generated, skipped, failed[] }` — write 20 evenly sampled JPEG frames into sibling `!VIDTHUMB_CACHE` (folders = videos in that folder; `recursive` walks subfolders) |

### `icons.*`

| Channel      | Purpose                                           |
| ------------ | ------------------------------------------------- |
| `icons:get`  | `{ path, size, isDir? }` → `{ url }` — Windows shell icon (`SHGetFileInfo`); pass `isDir: true` for folders so they never share the file-extension icon cache |

### `meta.*`

| Channel            | Purpose |
| ------------------ | ------- |
| `meta:getMany`     | `{ paths[], columns[] }` → `{ values: Record<path, EntryColumnValues> }` — async Details columns (image/A/V/tags/generation/**ads**) |
| `meta:invalidate`  | `{ paths[] }` → `{ ok: true }` — drop column-meta cache for paths (e.g. after ADS edits) |

### `ads.*` (NTFS Alternate Data Streams — D38)

Win32/NTFS only; soft-fail empty/false off-platform or on access errors. Paths validated with `requireAbsolute`. Primary `::$DATA` omitted from lists.

| Channel           | Request | Response |
| ----------------- | ------- | -------- |
| `ads:list`        | `{ path }` | `{ streams: { name, size }[] }` |
| `ads:exists`      | `{ path, name }` | `{ exists }` |
| `ads:readText`    | `{ path, name }` | `{ text }` (UTF-8; NUL/CRLF trim) |
| `ads:writeText`   | `{ path, name, value, writeEmpty? }` | `{ ok: true }` — empty value deletes unless `writeEmpty` |
| `ads:delete`      | `{ path, name }` | `{ deleted }` |
| `ads:readBytes`   | `{ path, name }` | `{ dataBase64 }` (null if missing) |
| `ads:writeBytes`  | `{ path, name, dataBase64 }` | `{ ok: true }` |
| `ads:copy`        | `{ source, dest, ignoreNames? }` | `{ copied }` — copy named streams file↔file or dir↔dir |

### `slideshow.*` (compiled lists — D39)

| Channel | Request | Response |
| ------- | ------- | -------- |
| `slideshow:updateCompiledLists` | `{ compiledRoot, entries[] }` | `{ updated, totalFiles, datUpdated, txtUpdated }` — crawl `.dat` source folders; write Index/Count ADS (skips `!!Lists`; `txtUpdated` always 0) |
| `slideshow:validateCompiledLists` | `{ compiledRoot }` | `{ ok, checkedLists, issueCount, issues[] }` — missing folders / nested lists (skips `!!Lists`) |
| `slideshow:relayKey` | `{ key, code, ctrlKey, altKey, shiftKey, metaKey }` | `{ ok }` — Compiled lists window → main slideshow keystroke |
| `slideshow:listCompiledDats` | `{ compiledRoot, entries[] }` | `{ tabs: { name, dats[] }[] }` |
| `slideshow:readDatIndex` | `{ path }` | `{ paths[] }` |
| `slideshow:readLastList` / `writeLastList` | root + lines | resume file `!!Lists/last.txt` |
| `slideshow:readCompositeList` / `writeCompositeList` | `{ path, lines? }` | any `!!Lists/*.txt` |
| `slideshow:lastListUsable` | `{ compiledRoot }` | `{ usable }` |
| `slideshow:expandComposite` | `{ lines, order?, ascending? }` | `{ paths[] }` — flat expand (refuses >500k; debug/legacy) |
| `slideshow:applyCompiledLines` | `{ lines, order, ascending, preferPath?, preferIndex?, rev? }` | `{ total, index, path, truncated }` — builds main virtual playlist; broadcasts meta |
| `slideshow:compiledPathAt` | `{ index }` | `{ path }` — resolve play position |
| `slideshow:clearVirtualPlaylist` | — | clears main virtual session |
| `slideshow:openCompiledListsWindow` / `close…` | — | detached BrowserWindow |
| `slideshow:applyCompiledPlaylist` | `{ paths, preferPath? }` | legacy flat broadcast (prefer `applyCompiledLines`) |

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
| `fs-watch-lost`           | `{ path }` — watcher closed; renderer may re-arm |
| `search-progress`         | `{ phase, current?, total?, message? }`       |
| `index-progress`          | `{ rootPath, processed, total? }`             |
| `op-progress`             | `{ opId, kind, done, total, current?, label?, bytesDone?, bytesTotal?, phase }` — `kind`: copy/move/trash/delete/relocate/vid-thumbs/zip/compile-lists; byte fields for large streaming copies |
| `compiled-playlist-apply` | `{ paths, preferPath? }` — detached lists window → main slideshow |
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
  meta: { getMany, invalidate },
  ads: { list, exists, readText, writeText, delete, readBytes, writeBytes, copy },
  slideshow: { listImages, updateCompiledLists, openCompiledListsWindow, … },
  app: { getPath, pickFolder, ready, … },
  onEvent: (handler) => unsubscribe
}
```

`onEvent` receives `fs-changed`, `fs-watch-lost`, `search-progress`, `index-progress`, `op-progress`, `external-open`, `history-nav` (mouse Back/Forward → tab history).