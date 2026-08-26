# IPC contract

**Version:** 0.12.0

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
| `fs:rename`          | `{ path, newName, conflictPolicy? }`             | `{ path }`                                    |
| `fs:copy`            | `{ sources[], destinationDir, conflictPolicy? }` | `{ copied[], skipped[], issues: OpIssue[], aborted? }` |
| `fs:move`            | `{ sources[], destinationDir, conflictPolicy? }` | `{ moved[], moves[], skipped[], issues: OpIssue[], aborted? }` |
| `fs:resolveIssues`   | `{ op: copy\|move\|trash\|delete\|rename, destinationDir?, items: { source, dest?, decision, sourceMtimeMs?, destMtimeMs? }[] }` | `{ copied[], moved[], moves[], trashed[], deleted[], skipped, issues[] }` |
| `fs:relocate`        | `{ pairs: { from, to }[] }`                      | `{ moved: string[] }` (exact destinations)    |
| `fs:checkConflicts`  | `{ sources[], destinationDir }`                  | `{ conflicts[], items[] }` (name + both sides’ stats/dims) |
| `fs:createShortcuts` | `{ sources[], destinationDir }`                  | `{ created: string[] }` — Windows `.lnk` (right-drag) |
| `fs:createLink`      | `{ type, source, destDir, name? }`               | `{ path }` — symlink / hard / junction (D59) |
| `fs:compressToZip`   | `{ paths[] }`                                    | `{ zipPath }` — sibling `.zip` (Compress to ZIP file) |
| `fs:extractZip`      | `{ paths[] }` (`.zip` files)                     | `{ extractedDirs[] }` — sibling folders (Extract All…) |
| `fs:trash`           | `{ paths[] }`                                    | `{ trashed[], issues: OpIssue[], aborted? }`  |
| `fs:restoreFromTrash`| `{ paths[] }` (`recyclePath` or original path)   | `{ restored[], missing[] }` (Recycle Bin)     |
| `fs:listRecycleBin`  | —                                                | `{ items[], truncated? }`                     |
| `fs:emptyRecycleBin` | —                                                | `{ emptied: true }`                           |
| `fs:deleteFromRecycleBin` | `{ paths[] }` (`recyclePath` or original)   | `{ deleted[], missing[] }`                    |
| `fs:deletePermanent` | `{ paths[] }`                                    | `{ deleted[], issues: OpIssue[], aborted? }`  |
| `fs:cancelOp`        | —                                                | `{ cancelled: boolean }` — stop in-flight copy/move/trash/delete/vid-thumbs |
| `fs:exists`          | `{ path }`                                       | `{ exists: boolean }`                         |
| `fs:watch`           | `{ path }`                                       | `{ watching: true }` (main tracks per window) |
| `fs:unwatch`         | `{ path }`                                       | `{ ok: true }`                                |
| `fs:listDrives`      | —                                                | `{ drives: { path, label, volumeName, driveType?, totalBytes?, freeBytes? }[] }`   |
| `fs:setVolumeLabel`  | `{ path, name }` (drive root; `name` '' clears)  | `{ path, volumeName }`                         |
| `fs:saveEditedImage` | `{ path, dataBase64 }`                           | `{ path, preservedOriginal, versionCount }` — tip ADS (D27) |
| `fs:imageEditState`  | `{ path }`                                       | `{ versionCount, tipVer, hasVersions }`       |
| `fs:hasImageOriginal`| `{ path }`                                       | `{ hasOriginal }` — deprecated alias of `hasVersions` |
| `fs:revertImageOriginal` | `{ path }`                                   | `{ path, reverted }` — drop all `VER_*`       |
| `fs:dropImageVersion` | `{ path, ver }`                                 | `{ path, versionCount }` — drop + renumber    |
| `fs:commitImageVersion` | `{ path }`                                    | `{ path, committed }` — tip → `$DATA`         |
| `fs:readImageForEdit` | `{ path, ads? }`                                | `{ dataBase64, mime }` (editor load; tip default) |
| `fs:saveEditedImageAs` | `{ dataBase64, defaultPath }`                  | `{ path, cancelled }` — no version history    |

`conflictPolicy`: `'fail' (default) | 'replace' | 'skip' | 'rename'` — applied to the whole batch (copy/move) or a single `fs:rename`. Default `fail` **queues** name conflicts as `OpIssue` (`kind: name_conflict`) and continues the rest (D18); inline rename throws `conflict` so the renderer can open the same review. `fs:checkConflicts` accepts optional `targets[]` (same length as `sources`) so rename compare cards use the intended new path, not `dest+basename(source)`. `decision` on `fs:resolveIssues`: `'replace' | 'skip' | 'rename' | 'keep_newer' | 'retry'`. `keep_newer` keeps the newer mtime (equal → keep both). `OpIssue`: `{ kind, code, source, dest?, message, sourceMtimeMs?, destMtimeMs?, lockers? }` — `lockers` is `{ pid, name, exePath? }[]` on busy issues (D65). `aborted`: `'cancelled' | 'fatal'` when the pass stopped early; queued issues are still returned.

| `fs:findLockers`     | `{ path }`                                       | `{ lockers: { pid, name, exePath? }[] }` — Restart Manager + CIM (D65) |
| `fs:endProcess`      | `{ pid }`                                        | `{ ended: true }` — `taskkill /T /F` after UI confirm; refuses protected hosts (D65) |

`DirEntry`: `{ name, path, kind: 'file'|'dir'|'symlink', size, mtimeMs, ext, isHidden }`.

### `shell.*`

| Channel                     | Purpose                         |
| --------------------------- | ------------------------------- |
| `shell:openPath`            | OS default open                 |
| `shell:showItemInFolder`    | System Explorer select          |
| `shell:openCommandLine`     | Open cmd or PowerShell (Settings `commandLineShell`) in folder; `elevated` = UAC |
| `shell:showProperties`      | Open Explorer’s property sheet (`ShellExecute` “properties” verb) |
| `shell:openWindowsTool`     | Allowlisted This PC tools: Computer Management, Device Manager, Control Panel, This PC Properties |
| `shell:openRecycleBin`      | Legacy: open Windows Recycle Bin in Explorer (prefer in-app view) |
| `shell:clipboardWriteFiles` | Cut/copy file list for OS paste |
| `shell:clipboardReadFiles`  | Read file list if present       |
| `shell:clipboardPeek`       | Classify clipboard (files / image / url / html / text / empty) — no bytes (D56) |
| `shell:clipboardWriteFile`  | Write non-file clipboard as a unique-named file in `destDir` (D56) |
| `shell:startDrag`           | Sync: `webContents.startDrag` with absolute paths (OS export while a drag is active) |
| `shell:openExternal`        | http(s) only if ever needed     |

### `session.*`

| Channel       | Purpose                               |
| ------------- | ------------------------------------- |
| `session:get` | Load `session.json`                   |
| `session:set` | Replace/patch session (Zod-validated) |

### `templates.*` (D57)

| Channel | Request | Response |
| ------- | ------- | -------- |
| `templates:import` | — | `{ cancelled: true }` or `{ cancelled: false, template }` — picker copies into `userData/Templates/` and appends `settings.templates` |
| `templates:delete` | `{ id }` | `{ ok: true }` — removes catalog row and the stored file |
| `templates:replace` | `{ id }` | `{ cancelled: true }` or `{ cancelled: false, template }` — picker replaces the stored copy; pretty name stays |
| `templates:duplicate` | `{ id }` | template — copies the stored file, inserts after the original with a unique pretty name |
| `templates:instantiate` | `{ id, destDir }` | `{ path }` — unique-named copy in dest (`name` stem + input extension) |

### `quickLaunch.*` (D63)

| Channel | Request | Response |
| ------- | ------- | -------- |
| `quickLaunch:pickProgram` | — | `{ cancelled: true }` or `{ cancelled: false, path, name }` — native picker for `.exe` / `.lnk` / `.url` / `.bat` / `.cmd` / `.msc` |
| `quickLaunch:importIcon` | — | `{ cancelled: true }` or `{ cancelled: false, id, mediaUrl }` — Sharp cover-crop to `userData/quick-launch/{id}.png` |
| `quickLaunch:iconUrl` | `{ id }` | `{ mediaUrl }` — `mfe-media` URL, or `null` if missing |
| `quickLaunch:deleteIcon` | `{ id }` | `{ ok: true }` |
| `quickLaunch:launch` | `{ id }` | `{ launched: true }` — reads the item from settings; `.lnk` via ShellExecute, else `shell:exec` |
| `quickLaunch:reveal` | `{ id }` | `{ shown: true }` — Explorer “Open file location” |

### `tabs.*` (custom icons — D54)

| Channel | Request | Response |
| ------- | ------- | -------- |
| `tabs:importCustomIcon` | — | `{ cancelled: true }` or `{ cancelled: false, id, mediaUrl }` — native picker; Sharp cover-crop to `userData/tab-icons/{id}.png` |
| `tabs:customIconUrl` | `{ id }` | `{ mediaUrl }` — `mfe-media` URL, or `null` if the PNG is missing |

### `settings.*`

| Channel                    | Purpose         |
| -------------------------- | --------------- |
| `settings:get`             | Full settings   |
| `settings:set`             | Patch settings  |
| `settings:clearThumbCache` | Wipe thumbs dir |
| `settings:export`          | Save-dialog portable settings + network hosts (D45) |
| `settings:import`          | Open-dialog replace settings (+ hosts when present) |

### `preview.*`

| Channel       | Purpose                                                    |
| ------------- | ---------------------------------------------------------- |
| `preview:get` | `{ path, ads? }` → `PreviewModel` — optional `ads` (`null` = `$DATA`, `"VER_k"` = stream; omit = tip) (see [PREVIEW.md](PREVIEW.md)) |
| `preview:getDisplayUrl` | `{ path, ads? }` → `{ mediaUrl }` — slideshow/overlay only; no generation parse or full-file Sharp |
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
| `ads:listNamesMany` | `{ paths }` (max 2000) | `{ names }` — unique stream names on those paths (listing scan for stream-value columns) |
| `ads:exists`      | `{ path, name }` | `{ exists }` |
| `ads:readText`    | `{ path, name }` | `{ text }` (UTF-8; NUL/CRLF trim) |
| `ads:writeText`   | `{ path, name, value, writeEmpty? }` | `{ ok: true }` — empty value deletes unless `writeEmpty` |
| `ads:delete`      | `{ path, name }` | `{ deleted }` |
| `ads:readBytes`   | `{ path, name }` | `{ dataBase64 }` (null if missing) |
| `ads:writeBytes`  | `{ path, name, dataBase64 }` | `{ ok: true }` |
| `ads:copy`        | `{ source, dest, ignoreNames? }` | `{ copied }` — copy named streams file↔file or dir↔dir |

### `itemAds.*` (attached notes / item icons — D61 / D62)

Win32/NTFS only; remotes rejected. Writes restore host Creation / Access / Write / Change (`withPreservedHostTimes`). Cap 250 paths per `getMany`.

| Channel | Request | Response |
| ------- | ------- | -------- |
| `itemAds:getMany` | `{ paths[] }` | `Record<path, { note, icon, iconPngBase64 }>` |
| `itemAds:setNote` | `{ path, note \| null }` | `{ ok: true }` — `mfe_note` JSON; empty deletes |
| `itemAds:setIcon` | `{ path, icon \| null, imageBase64? }` | `{ ok: true }` — `mfe_icon` / `mfe_icon_img` |
| `itemAds:importCustomIcon` | `{ path }` | picker + Sharp cover-crop; returns PNG base64 (does not write) |

### `usn.*` (NTFS USN journal — D52)

Drive-root paths only (`C:\` / `C:`). Soft-fail `unsupported` off win32. Native `DeviceIoControl`; `elevate: true` runs `fsutil usn` via UAC.

| Channel        | Request | Response |
| -------------- | ------- | -------- |
| `usn:query`    | `{ path }` | `{ status, letter, fileSystem, journal, needsElevation }` — `status`: active / absent / deleting / not-ntfs / access-denied / unsupported |
| `usn:enable`   | `{ path, maxBytes, deltaBytes, elevate? }` | query snapshot (create or resize); first-time Enable may include `probeName` after a create+delete test file |
| `usn:disable`  | `{ path, elevate? }` | `{ disabled: true }` |
| `usn:clear`    | `{ path, maxBytes, deltaBytes, elevate? }` | query snapshot (delete + create); may include `probeName` |
| `usn:recent`   | `{ path, limit?, elevate? }` | `{ entries: { usn, name, isDir, reason, timeMs }[], note?, needsElevation? }` |

### `network.*` (LAN neighborhood — D44)

Discovery runs in a worker thread; results arrive on `mfe-event` `network-discovery`. Map/Disconnect open native Windows dialogs.

| Channel | Request | Response |
| ------- | ------- | -------- |
| `network:startDiscovery` | — | `{ generation }` |
| `network:cancelDiscovery` | — | `{ cancelled }` |
| `network:listShares` | `{ server }` | `{ shares: { name, unc, remark? }[] }` — hides `$` shares |
| `network:mapDriveDialog` | — | `{ opened, result }` |
| `network:disconnectDriveDialog` | — | `{ opened, result }` |
| `network:disconnectMappedDrive` | `{ path, force? }` | `{ disconnected, letter, remotePath? }` — cancel + forget persistent map |
| `network:localComputerName` | — | `{ name }` — display name for Settings → Show local computer |

### `slideshow.*`

Folder slideshow / image-list cache (gated by Settings → Slideshow).

| Channel | Request | Response |
| ------- | ------- | -------- |
| `slideshow:listImages` | folder walk request | `{ paths[] }` |
| `slideshow:cancelList` | — | `{ cancelled }` |
| `slideshow:pickOpenFile` / `pickSaveFile` | dialog opts | `{ path }` |
| `slideshow:readTextFile` / `writeTextFile` | `{ path, text? }` | text / `{ ok }` |

### `mediaMetadata.*`

Opt-in D50. Main refuses most channels when `mediaMetadata.enabled` is false. Guide: [MEDIA_METADATA.md](MEDIA_METADATA.md).

| Channel | Request | Response |
| ------- | ------- | -------- |
| `mediaMetadata:extractPlex` | `{ paths[], kindHints?, nameHints? }` | `{ done, failed[], updated[], stoppedReason?, needsKind?, needsName? }` — skip items that already have streams |
| `mediaMetadata:download` | `{ paths[], kindHints?, pickHints?, nameHints? }` | same + `needsPick?` — TMDB / OMDb; `pickHints` is `tmdb:movie:id` / `tmdb:tv:id` / `omdb:tt…` after the title picker |
| `mediaMetadata:refresh` | `{ paths[], kindHints?, pickHints?, nameHints? }` | same — refresh from stored source; missing from Plex |
| `mediaMetadata:clear` | `{ paths[] }` | same |
| `mediaMetadata:get` | `{ path }` | `{ metadata, thumbnailBase64 }` |
| `mediaMetadata:listCovers` | `{ path }` | `{ title, covers[] }` — returns the current cover immediately; more arrive on `cover-list` events |
| `mediaMetadata:setCover` | `{ path, coverId, previewBase64? }` | `{ ok: true }` — preview is a fallback if the cover session is gone |
| `mediaMetadata:setWatched` | `{ paths[], watched }` | `{ updated[] }` |
| `mediaMetadata:folderLibrary` | `{ path }` | `{ isContainer, items: { path, watched, genres[], kind, season?, episode?, title?, showTitle? }[] }` |
| `mediaMetadata:consolidateSubtitles` | `{ paths[] }` | `{ copied, skipped, recycled, failed[] }` — flatten Subs / Subtitles next to videos; Recycle Bin |
| `mediaMetadata:probePlex` | — | `{ installed, running, dataDir, tokenFound, url }` |

`stoppedReason` is set when a TMDB/OMDb quota stops the batch. `needsKind` is a yearless movie-or-show ask. `needsPick` (download / internet refresh only) is a same-title remake list; the renderer retries with `pickHints`, or **Search as…** with a literal `nameHints` string. `needsName` is a title miss; the renderer asks for an edited search string (or a TMDB / IMDb URL) and retries with `nameHints` (not scene-stripped; URLs become pick ids). Progress uses `op-progress` kind `media-metadata`.

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
| `op-progress`             | `{ opId, kind, done, total, current?, label?, bytesDone?, bytesTotal?, phase }` — `kind`: copy/move/trash/delete/relocate/vid-thumbs/zip/media-metadata; byte fields for large streaming copies |
| `cover-list`              | `{ path, done, cover? }` — Change cover tiles as previews load |
| `git-status`              | `{ status: GitRepositoryStatus }` — repo cache update (D64) |
| `session-external-change` | rare: multi-window later                      |

---

## Preload surface (sketch)

```ts
window.myFileExplorer = {
  fs: { list, stat, mkdir, createFile, rename, copy, move, trash, deletePermanent, … },
  shell: { openPath, showItemInFolder, … },
  session: { get, set },
  settings: { get, set, clearThumbCache, exportFile, importFile },
  preview: { get },
  search: { query, addRoot, removeRoot, reindex, listRoots, cancel },
  thumbs: { get, generateVidCache },
  meta: { getMany, invalidate },
  ads: { list, listNamesMany, exists, readText, writeText, delete, readBytes, writeBytes, copy },
  mediaMetadata: { extractPlex, download, refresh, clear, get, listCovers, setCover, setWatched, folderLibrary, consolidateSubtitles, probePlex },
  slideshow: { listImages, pickOpenFile, … },
  git: { detect, test, discover, getStatus, refresh, stage, unstage, discard, commit, fetch, pull, push, listBranches, switchBranch, createBranch, stash, stashPop, showDiff, openTerminal, … },
  app: { getPath, pickFolder, ready, … },
  onEvent: (handler) => unsubscribe
}
```

`onEvent` receives `fs-changed`, `fs-watch-lost`, `search-progress`, `index-progress`, `op-progress`, `external-open`, `history-nav` (mouse Back/Forward → tab history), `network-discovery` (D44), `git-status` (D64).

### `git.*` (D64 — opt-in; no work when Settings → Git is off)

Whitelist only — no arbitrary argv from the renderer. See [GIT.md](GIT.md).

| Channel | Purpose |
| ------- | ------- |
| `git:detect` / `git:test` | Resolve / probe `git.exe` |
| `git:discover` / `git:getStatus` / `git:refresh` / `git:invalidate` | Repo root + porcelain status cache |
| `git:stage` / `git:unstage` / `git:discard` | Path-scoped ops (`--` before paths) |
| `git:ignore` | Append paths to repo-root `.gitignore`; `git rm --cached` when tracked |
| `git:commit` / `git:fetch` / `git:pull` / `git:push` | Repo ops |
| `git:outgoing` | Commits ahead of upstream (Push confirm dialog) |
| `git:listBranches` / `git:switchBranch` / `git:createBranch` | Local branches (`createBranch` may take `startPoint`) |
| `git:createTag` / `git:deleteTag` / `git:checkoutCommit` / `git:mergeCommit` / `git:rebaseOnto` / `git:reset` / `git:cherryPick` / `git:revert` | History ops for repo-root preview (createTag/deleteTag optional remote; non-interactive rebase; reset soft/mixed/hard) |
| `git:stash` / `git:stashPop` | Stash push / pop |
| `git:clone` | Clone URL into `parentDir/folderName` (conflict if exists; Credential Manager / SSH) |
| `git:showDiff` | External diff: HEAD ↔ working tree; or `commit` vs parent; or `commit` vs `otherCommit` (blobs → scratch) |
| `git:log` | Commit history for repo-root preview (`--all`, decorated) |
| `git:showCommit` | Single-commit detail (message + `diff-tree --name-status`) |
| `git:logFile` | File history (`git log --follow`) |
| `git:openTerminal` / `git:relativePaths` / pickers | Helpers |