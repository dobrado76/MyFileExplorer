# Changelog

All notable changes to MyFileExplorer are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

User-facing summary for the latest release: [RELEASE_NOTES.md](RELEASE_NOTES.md).

## [Unreleased]

## [0.10.0] - 2026-08-21

Tenth product release: **D52 NTFS USN journal manager** from Drive Properties, plus a stability pass on scripts, copy/move progress, preview, slideshow, and Details ADS. See [RELEASE_NOTES.md](RELEASE_NOTES.md).

### Added

- **NTFS USN journal manager** (D52) — Drive Properties **USN…** (win32) shows journal status, size, and recent records. Enable / resize (UAC when needed), first-time Enable writes then deletes a unique `testing USN *.txt` so Recent shows Create + Delete immediately. **Delete journal…** / Clear warn that Windows walks the whole volume (can take minutes to hours; cannot be cancelled). Deleting… badge + elapsed time; VeraCrypt / virtual NTFS treated as normal NTFS.
- **Settings search** — filter the Settings tree/pages from the Settings window.
- **Preview word wrap** — header button on text / Markdown / HTML source (remembered; off by default).

### Changed

- **Mix folders and files in media libraries** is **off** on a first install. When on, it applies only in icon/thumbnail views — List and Details still follow Settings → Behavior → Folders first.
- **AI script names** — generate/modify ask for a Title Case display label (spaces OK). The on-disk file remains `managed/<id>.<ext>`.
- **Python 2.x is not supported** — docs and Settings → Scripting and AI say so explicitly (PATH `python` on another PC is often 2.7).
- **External file** — ticking it hides the Script Manager editor (path + Browse only). Save records the path and no longer writes over the file.
- **Modify with AI** — carries name, description, recursive, and target into the generate dialog. **Modify** uses Task when Modify instruction is empty. Save keeps existing parameters and category.
- **Generate / Modify AI window** — wider default (same class as Script Manager: drag, resize, maximize). Empty provider replies now say why (token limit, filter, refusal) instead of a blank “empty completion”.
- **Script name clashes** — a new or renamed script whose display name is already in the library is saved as `Name (2)`, `Name (3)`, … The existing list is never sent to AI.
- **Generate / Modify AI** — Name and Description are not asked up front (the model overwrote them). They appear after a result so you can tweak before Save.
- **Dry run / Run** — Close returns to Script Manager or Generate instead of dismissing the whole script flow.
- **Copy / move / delete progress** — the status bar shows the full current path (ellipsis from the left so the folder and name stay visible). Hover still shows the complete path. Counts **files**, not top-level folders (one folder with 100k items no longer sticks at “1 of 1”).
- **Properties** — moveable / resizable (persisted). Drive Properties hide file Attributes; capacity is size / bytes / percent columns. **USN…** sits next to Windows Properties….
- **Slideshow crop** — numpad steps halved (5% / 2.5% / 1% / 0.5%).

### Fixed

- **Ask AI to fix** — decode the returned JSON (`source`, `language: "Python"`, …) into the script editor instead of pasting the metadata envelope into the code block.
- **Copy folder into another drive** — the dest folder appears in the tree as soon as it exists (same as the file list), not only when the copy finishes.
- **Import script** — Script Manager Import accepts `.ps1` / `.py` / `.cmd` / `.sh` as well as `.mfescript`.
- **Script Manager list** — the open script is highlighted (the old `--hover` token was undefined, so the selected row looked the same as the others).
- **Script Manager Revert** — grayed out until an AI modify leaves a previous version (the button was already disabled; `.btn` had no disabled style).
- **Details ADS / meta columns** — visible rows fill without needing a mouse-wheel scroll (short listings and newly scrolled-in rows).
- **Start Slideshow** — no longer a long stall before the first frame on large folders.
- **List refresh after a script** — folder listing updates when a script creates or deletes files.
- **Back / mouse back** — keeps scroll position and focus.
- **USN Enable** — unelevated create offers Retry as administrator; delete-in-progress is shown as Deleting… instead of a generic “Could not create”.

## [0.9.0] - 2026-08-19

Ninth product release: **D51 local scripts** (opt-in) turn the file manager into a universal runner (PowerShell / Python / cmd / bash) with optional AI that never sees your files, plus **D50 media metadata** and a large polish pass. See [RELEASE_NOTES.md](RELEASE_NOTES.md).

### Added

- **Script run window** — the output dialog is movable and resizable; size and position persist (`scriptRunnerBounds`). The log pane grows with the window so long reports stay on screen.
- **Script Manager window** — movable and resizable; **Maximize** persists with size/position (`scriptManagerBounds`). Maximized puts Min selection / Parameters / Dependencies in a second column so the editor is taller.
- **Script Manager tooltips** — every field label and button explains scope, CLI flags, AI privacy, and run vs dry-run. Generate and Run dialogs have the same hover help.
- **Script editor highlighting** — Script Manager and Generate color PowerShell, Python, cmd, and bash with the same highlight.js theme as preview.
- **AI generate wait** — Generate / Modify / Ask AI to Fix show a modal overlay with an indeterminate bar and “This may take some time” (elapsed seconds), not the status bar.
- **Drives header (This PC)** — right-click **Drives** for **Computer Manager** (Windows Computer Management), **Device Manager**, **Control Panel**, and **Properties** (same This PC sheet as Explorer). These open the real system windows.
- **Local scripts** (D51) — **opt-in** (Settings → Scripting and AI → Enable scripting, off by default). Then toolbar **Scripts** / context **Scripts**. Run PowerShell, Python, cmd, or bash against the current folder or selection with live output and Stop. Saved scripts live under app data and rerun with no AI. Optional **Enable AI** on the same page (OpenAI-compatible, including LM Studio): generate or modify a script from a task description — **files and paths are never sent**. Guide: [docs/SCRIPTS.md](docs/SCRIPTS.md).
- **Media metadata** (opt-in, off by default) — Settings → Media Metadata. When enabled, the context menu can extract movie/TV info and covers from a local Plex Media Server or download them (TMDB / OMDb), store them as NTFS streams on the file or folder, and show a title/cover above the preview. Click the cover to view the full stored image. **Change cover** (context menu or preview) lists Plex + TMDB posters for that title, **largest resolution first**, with pixel size on each tile. Preview cover height is Settings → Media Metadata → Cover art size (56–240 px, default 120). Extract/Download fill missing items only; Update refreshes all and extracts gaps from Plex. Folders walk every video inside. Writing metadata marks the containing folder with a `media_metadata_container` stream so that folder’s toolbar can filter **Watched / Unwatched** and **Genre**. **Mark as Watched** (toggles to Unwatched) is on the Media Metadata menu and on the preview when metadata exists. **Consolidate subtitles** copies the first English subtitle from a `Subs` / `Subtitles` tree next to each video and sends those folders to the Recycle Bin. TMDB/OMDb daily or burst limits stop the batch and show a dialog. Guide: [docs/MEDIA_METADATA.md](docs/MEDIA_METADATA.md).
- **Collapse all** — toolbar button next to Select all closes every expanded folder-tree branch on the **current tab** (This PC default). The file list stays on the current folder; other tabs are unchanged.
- **`.flv` video** — treated as video for Media Metadata, search `video:`, icon strips, and preview (remux to MP4 when codecs allow, same as MKV).

### Changed

- **Local Windows dist** — `npm run build:win` / `dist` no longer Authenticode-sign. A local cert used to make every packed exe wait on `signtool` (minutes). GitHub Release builds were already unsigned.
- **AI model picker** — Settings → Scripting and AI and Generate script use a dropdown from `GET /v1/models` (cached on the provider). OpenAI lists hide embeddings/TTS/image models. Long catalogs (OpenRouter) get a filter box.
- **Deleting a tab root** — a folder that is the scoped root of any open tab now always asks for confirmation (Cancel / Delete) and warns that those tabs will be closed. After a successful delete, the affected tabs close (a replacement tab opens if that would leave none).
- **Preview Media / File tabs** — when a file has both stored movie/TV metadata and extracted file fields, they sit in **Media** and **File** tabs under the player (no tabs if only one). Media rows use the same boxed field layout as File; genres stay pills. Ratings use source marks (Plex, IMDb, Rotten Tomatoes, Metacritic, TMDB) instead of `(Plex)` text. Metadata no longer overlays the video still.
- **File metadata density** — short extracted fields (duration, bitrate, sample rate, Yes/No, …) share a line; long values stay full-width.
- **TV show metadata** — show cover + card attach to the show folder (folder icon = poster, shrink-to-fit; XL icons only hides the name). Opening the show in the tree (no file selected) keeps the show card in the preview until you click an episode. Episode preview uses the show cover when the episode has none. Icon/thumbnail episode tiles show `S01E07` when that metadata is stored (season defaults to 1 if Plex omits it), with the episode title centered under the code when one is stored (Settings → Media Metadata → **Show season/episode and title on icon tiles**, on by default; off uses the filename). Details and List keep the filename (tooltip is always the filename). Landscape stills/backdrops are skipped in favor of the next portrait cover. Episode files get episode metadata and keep `!VIDTHUMB_CACHE` thumbs. The library folder (parent of the show folders) is marked as a media container. Movie vs show is detected from names; a dialog asks only when it is unclear. **Download from Internet** also asks **Which title?** when several movies/shows share the exact name and the year does not pick one (Dune 1984 vs 2021). Plex extract does not — it already maps to one library item.

### Fixed

- **Thumbnail folder icons** — with Media Metadata on, icon/thumbnail view asked for a cover then fell back to a **file** glyph. List and Details were fine. Folders with a dot in the name (e.g. `UE_5.7`) still got a real folder icon; `Program Files` / `Windows` did not.
- **ADS host times** — writing or deleting an alternate stream (media metadata, folder stats, ADS Manager) restores NTFS ChangeTime as well as Date modified. The old `utimes` restore left ChangeTime at now, so sync tools recopied the whole video. Read-only rips are handled. Already-bumped files stay bumped.
- **AI generate on GPT-5 / o-series** — those models reject `max_tokens`; the request now uses `max_completion_tokens` (and retries if a provider wants the other field).
- **Delete on a drive** — Del / Shift+Del / context Delete on a volume root (`C:\`) do nothing (no prompt, no error).
- **Rename name clash** — F2 / Power Rename no longer only toast “already exists”. The same review as copy/move offers Skip, Keep both (`name (2).ext`), Replace, and Keep most recent. **New → Other…** creates a stub and renames to the typed name so a clash uses that review too.
- **Rename focus** — finishing a slow rename (NAS) no longer jumps selection or scroll back to that file if you have already started renaming or selected something else.
- **Change cover apply** — **Use this cover** no longer fails with “Cover list expired” when the in-memory session is gone (reload / remount). Each tile keeps a recoverable source, and the preview already on the tile is a fallback. Plex’s small 154×231 tiles also fall back if the full poster URL does not download. Apply errors appear in the dialog.
- **Search as URL** — on a miss (or **Search as…** from **Which title?**), paste a TMDB movie/TV page or an IMDb title URL to fetch that id instead of searching. Extract from Plex then uses the internet for that item.
- **Which title?** — **Search as…** opens the same name box as a miss. That typed name is sent as-is (scene tags like `season` / `complete` are not stripped).
- **Change cover** — the dialog opens at a fixed size and shows the current poster immediately. Plex / TMDB previews stream in as they load so you can pick before the list is finished.
- **Rename scroll** — after any rename (F2, context menu, new file/folder, or the folder tree), the list (and tree) stay on that entry in its new sort position.
- **Media search name** — when Plex or the internet finds no title, a dialog offers the filename in a **Search as** box so you can drop extra sort numbers (e.g. the second `5` in `Babylon 5 - 5 - A Call to Arms`) or add a year and retry. Cancel skips that item.
- **Media cover tiles** — Extract from Plex / Download from Internet / Change cover refresh the file or folder poster in place. Tiles used to keep the old strip or folder icon until you left the folder and came back.
- **Back scroll** — Back / Forward restore the file-list scroll position for that folder (it used to jump to the top).
- **Rename flash** — Enter keeps the new name on the tile immediately. The old name only comes back if the rename fails (network re-list no longer paints the previous name first).
- **`.rmvb` / `.rm` video** — treated as video for Media Metadata, search `video:`, icon strips, and strip-only preview (same as AVI — Chromium cannot play RealVideo).
- **Media library sort** — Settings → Media Metadata → **Mix folders and files in media libraries** (off by default). When on, icon/thumbnail views of a `media_metadata_container` folder sort tiles in one A–Z list (List and Details follow Behavior → Folders first).
- **Plex covers on extract** — Extract copies the same local Plex posters Change cover lists (largest portrait). A movie in a mixed folder is no longer treated as an episode (that skipped the poster). Extract / Download run again when the title is stored but the cover is missing.
- **CD-split movies** — a folder whose videos are `[Part 1]` / `[Part 2]` (or `CD1` / `Disc 1`) is the movie. Metadata and the cover go on the folder, not each part. TV shows are unchanged.
- **Media name parsing** — rip tags and the release group after the last hyphen (`Dexter.S02E01.BDRip.x265-ION265`) are no longer treated as part of the show title (TMDB was searching “Dexter -ION265”). Hyphenated titles like `Spider-Man` are unchanged.
- **Details horizontal scroll** — the scrollbar sits at the bottom of the file pane and moves the header and rows together (it used to sit under the column titles and only slide the header).
- **Plex extract speed** — local library SQLite is queried first (no `/library/all` scan per file), posters come from the on-disk bundle before HTTP, episodes skip cover downloads, and extract runs several items at once.
- **Library-folder extract** — Extract / Download on `Series` (or any library folder) writes each show/movie folder cover first, then episode metadata. Title folders are no longer skipped as “too many children”.
- **Plex media covers** — extract uses Plex’s own thumb URL (and photo transcode), does not send the Plex token to CDN hosts, maps `localhost` to `127.0.0.1`, and reads the poster from the on-disk Metadata bundle (`{hash[0]}/{hash.slice(1)}.bundle`) when the server is not running. Re-run **Update** on items that already have text metadata but an empty poster.
- **GitHub Release attach** — CI looked for `MyFileExplorer Setup *.exe` after the installer was renamed to `MyFileExplorer-x.y.z.exe`, so the tag build produced an installer and then failed to attach it.

## [0.8.0] - 2026-08-16

Eighth product release: drive free space, detached preview, calendar/email preview, session listing cache for NAS, and a large preview-type + polish pass. See [RELEASE_NOTES.md](RELEASE_NOTES.md).

### Added

- **Preview extension samples** — `samples/preview-extensions/` has one small file per preview-supported extension (including `.ics` / `.ical` / `.eml`). Regenerate with `npm run samples:preview`.
- **`.ics` / `.ical` preview** — iCalendar files show an event / to-do agenda (Preview) and highlighted source (Raw), plus calendar name, timezone, counts, and date range.
- **`.eml` preview** — saved email shows From / To / Subject / Date, attachment names, and the body (plain text or sanitized HTML). Raw is the highlighted source. Remote images are not loaded. Outlook `.msg` is not supported.
- **Drive free space** — opening a drive shows `N GB free of M GB (P%)` in the status bar. Click the tree **Drives** header for every volume (pies in the preview; offline letters as Disconnected). Online mapped letters are included; a short timeout keeps a dead letter from hiding the rest.
- **Show folder statistics** — Settings → Behavior toggle (on by default). Off hides calculated folder sizes in the Size column and the Files / Folders columns, and skips those ADS reads so you can compare listing performance. Calculate Statistics still works.
- **Detached preview window** — preview pane header **Open preview window** opens a peer window with the same live preview. It follows the selection independently of collapsing the docked pane; position/size/maximized are remembered (stripped on settings export).
- **Search exclude patterns** — Settings → Search index uses the same pattern language as View filter (folders, file names, extensions, wildcards, or a path), not folder names only.
- **Update download progress** — Settings → About shows a determinate bar (bytes + percent) while the GitHub installer downloads.
- **Default tab icons** — new tabs get a Lucide icon: Computer / unscoped (`Monitor`, blue), drive as root (`HardDrive`, gray), folder as root (`Folder`, yellow). Change or clear from the tab menu.
- **Equal-width tabs** — Settings → Appearance toggle. Off (default): each tab is only as wide as its title. On: every tab matches the widest label (previous behavior).
- **Show tab icons** — Settings → Appearance toggle (default on). Off hides every tab icon without clearing the ones you set.
- **Power Search saved designs** — name a complex search and load/run it later. Params (builder + match flags) are stored; target (current folder vs indexed) is chosen each run.
- **Unity `.meta` / `.mat` / `.asset` preview** — treated as YAML (text `.asset`; binary still shows as binary).
- **Unity text preview** — `.terrainlayer` / `.lighting` / `.unity` / `.prefab` / `.controller` / `.anim` as YAML, `.shadergraph` as JSON, `.shader` as ShaderLab + HLSL, `.mtl` as material text. Binary `.unity` / `.prefab` / `.controller` / `.anim` still sniff as binary.
- **3D mesh preview** — `.obj` / `.fbx` / `.3ds` orbit in WebGL (drag / scroll). Canvas fills leftover pane height above metadata. OBJ vertex counts; FBX ASCII/binary sniff. Files over 96 MiB skip the viewer.
- **Visual Studio preview** — `.csproj` as XML, `.sln` as solution text, `.vsconfig` as JSON.
- **`.uvw` preview** — 3ds Max Unwrap UVW metadata (format / purpose, UV vertex/face counts when the layout checks out, UV range, OLE sniff, Unity `.meta` GUID). Float-as-text junk is omitted. Not a UV visualization.
- **`.hdr` preview** — Radiance RGBE/XYZE (HDRI / skybox) tonemapped for thumbs, preview, and slideshow. Layout hint when 2:1 equirectangular. Non-Radiance `.hdr` shows metadata only.
- **Subtitle preview** — `.srt` (SubRip) as highlighted text. `.sub` is the same when it sniffs as text (MicroDVD / SubViewer); CloneCD/VobSub binary `.sub` stays binary. `.smi` / `.sami` (SAMI, HTML-like) decode EUC-KR / charset= instead of assuming UTF-8.
- **`.divx` video** — treated like `.avi` (strip-only preview + `video:` search / thumb cache).

### Changed

- **Settings → About** — current version is its own card; Updates copy no longer repeats it. Card titles have a bit more space above the body text.
- **NAS / UNC / mapped / remote folders reopen instantly** — the last listing is kept in memory for the session (about 24 folders; huge listings are skipped). Navigating back paints it immediately, then the folder revalidates in the background. F5, your own file ops, and a watch event on that folder drop the snapshot. Local disks are unchanged; nothing is written to disk.
- **Detached preview window Zen mode** — header toggle hides metadata / details and fills the window with the visualization (image, text, player, …). State is remembered (`previewWindowZen`).
- **Detached preview window first size** — if no saved bounds exist yet, the pop-out opens at 90% of the primary work area (centered). Later opens still restore the last size/position.
- **Larger in-pane previews** — text/code/Markdown/HTML honor Settings → Preview max bytes (default 2 MiB; the old extra 64 KiB display cut is gone). Spreadsheets show 2000×80×32; Word/RTF ~1 MiB; PowerPoint up to 80 slides.

### Fixed

- **Drives free space with an offline letter** — a disconnected map, empty CD, or empty card reader no longer stalls `listDrives`, which left the tree and preview with no drive info at all. Other volumes still show size; offline letters show `Disconnected`.
- **Mapped drive free space** — online network letters (M: / N: / …) show free/total in the Drives preview and status bar, same `statfs` path as Properties. Disconnected maps stay `Disconnected` and are not queried.
- **Large folders stay interactive** — Details no longer requests column metadata for every file because Size is visible. Meta (folder totals, image/media columns) loads only for on-screen rows. The Size column still uses each file’s listing size.
- **200k-file folders no longer freeze the UI** — the Aug 15 Select All toggle re-scanned the entire listing on every store update (thumbs, progress, notices). Detection is now `selected.length === listing.length`. Huge listings also skip a second full sort after load.
- **Calculate Statistics** — skips Windows system folders (`$RECYCLE.BIN`, System attribute, …) and, when the view filter is on, Hidden folders and view-filter matches, so a permission denied on Recycle Bin no longer aborts the walk. File sizes come from `FindFirstFile` (no per-file open); ADS streams are written one at a time so a large tree no longer hits “too many open files.” A half-written tagged folder (e.g. after a previous abort) is retagged instead of failing the whole run with “Incomplete statistics.” Permission/write errors show the **full path**, **Windows Properties** (Explorer’s sheet), **Retry** (resumes the same root, skipping folders already tagged), **Skip folder** (omit that path and resume), and **Skip all** (keep going: tag what works, skip and remember the rest; Settings → Behavior).
- **Detached preview window + video** — playing a video no longer blanks the pop-out for later files. While that window is open, `<video>` / `<audio>` play only there (the docked pane keeps metadata / poster).
- **GitHub Check for update** — GitHub stores the NSIS installer as `MyFileExplorer.Setup.0.x.y.exe` (dots instead of spaces). Check could still see the release via the tag, then Update refused it as “no version in its name.” Both dotted and `Setup 0.x.y` names are accepted now.
- **Search `.obj` floods then restarts** — a lone `.` is ignored (it matches every dotted name). Debounce is 500 ms so typing `.obj` is usually one walk; further letters narrow the current hits instead of starting over.
- **Preview during search** — the live walk was starving `preview:get` (stat every file, push the full hit list on every match). It now yields the main thread often and streams progress at most every 250 ms.
- **3D mesh preview 403** — Three.js stripped `?p=` from `mfe-media://local/?p=…`, so FBX/OBJ/3DS fetched `mfe-media://local/` and got Forbidden.
- **TrueType preview sample** — `.ttf` pangram failed for every file because CSP `font-src` blocked `mfe-media:`. Fonts now load as fetched bytes into `FontFace`.
- **Search results stay gone after delete** — deleting a hit during an in-progress scan no longer lets the next progress snapshot put it back.
- **Drive as root** — opening a volume (`Z:\`) as a tab root no longer blocks navigating into folders on that drive.
- **TIFF / TGA preview** — Chromium cannot display raw `.tif`/`.tiff`/`.tga`; they are rasterized for thumbs, preview, and slideshow so valid files are not sent to the Invalid images folder.

## [0.7.0] - 2026-08-14

Seventh product release: Power Search, continue-then-review bulk file ops, per-tab search, PowerPoint slide preview, folder-statistics depth-first tagging, slideshow crop, nested custom context submenus, and search/tab/splitter polish. See [RELEASE_NOTES.md](RELEASE_NOTES.md).

### Added

- **Power Search** — toolbar dialog with visual fields for scope, match, name/text, type, attributes, size, dates, location, and advanced options; builds an Everything-style query string synced with the search box.
- **Continue-then-review bulk ops** — copy / move / trash / delete finish every auto-ok item, then one review groups similar issues (already exist, in use, access denied, …) with apply-to-similar, including **Keep most recent**. No mid-pass “do this for all” stall. Same-folder copy-paste still auto Keep both.
- **PowerPoint slide preview** — `.pptx` shows approximate slide layout (text + images from the package, not the low-res Office thumbnail). `.ppt` stays best-effort text.
- **Slideshow manual crop** — numpad 2/4/6/8 trims edges (Shift/Ctrl for finer steps); Enter/Numpad0 saves or resumes autoplay; Esc/Numpad5 cancels crop.
- **Nested custom context submenus** — `\` in Settings → Context menu → Custom (files/folders) labels groups commands into nested flyouts (e.g. `My Tools \ Option 1`).
- **Settings → About** tab — Updates source, Export/Import, and GitHub repository link for online help (moved from Advanced).
- **Checkbox multi-selection** in the file view (toggle rows without clearing the rest of the selection).

### Changed

- **Search is a tab location** — starting a search pushes the folder; opening a folder from results pushes the search; Back/Forward restore either. Each tab keeps its own query/results; switching tabs or focusing another pane does not clear. Session persists query + scope (not rows).
- **Delete / move from search results** drops those hits (and children of a removed folder) immediately — no stale Explorer-style rows.
- **Everything `!` NOT** applies after whitespace or as `!ext:`. A leading `!!` is a literal name (`!!Thumbs.db` finds that file).
- **`.jfif`** is treated as JPEG everywhere (thumbs, preview, editor, slideshow, `pic:`).
- **`git push`** runs `npm run check` locally (same as CI) via a hook installed on `npm install`. Skip only with `git push --no-verify`.
- **Folder statistics columns** — Details column labels are now **Files**, **Total Files**, **Folders**, **Total Folders** (ADS stream names unchanged). **Calculate Statistics** now depth-first tags **every subfolder** with immediate + rolled-up ADS streams (not only the selected root). **Shift+click** skips subtrees that already have valid TotalSize ADS.
- **Calculate Statistics** — no 250k entry cap; walks complete trees. Scan or ADS write failures show an explicit alert dialog with the path and error (same as other FS operations).
- **Search (live walk / index)** — results stream during folder walks; status bar shows in-progress state; banner shows current folder and “N found so far”; index queries show “Querying index…”.
- **Power Search exclude extension** — maps to `!ext:` (not a mistaken name/path negation).
- **Categorizer map Import/Export** — removed from Settings → Slideshow; file Import/Export remains in **Mapping Manager** (map still round-trips via Settings → About → Export/Import).
- **Slideshow settings layout** — compact one-line Delay/Order rows; Ascending + Loop on the Order row; horizontal rule before Categorizer map.
- **Settings dialog** — footer button is **Close** (was Done); title bar has a standard **✕** close control (all shared modals).
- **Tab bar** — tabs size to the widest label (instead of stretching to fill the bar), then equal-shrink toward a minimum (~90px) and overflow with ◀ ▶ controls; active tab scrolls into view; mouse wheel scrolls the strip horizontally.
- **Draw caption** — when enabled, images with an NTFS `Caption` ADS are framed as a poster (photo in the box; random JSON entry; border/titles hashed from the caption text) in slideshow, preview, and the image viewer; otherwise the filename overlay remains.
- **Scoped tabs** — tree no longer shows a section header that repeats the root folder name (e.g. “DROPBOX” above “Dropbox”).

### Fixed

- **Basic file search** — plain queries (including names with dots like `report.pdf`) no longer return unrelated folders and files. Unknown `word:value` tokens are not treated as search operators; if parsing would apply no name filter, the raw query is used as a name substring match.
- **Slideshow Stop** cancels an in-flight image-list build so a cancelled walk does not later replace the playlist.
- **Image-edit thumbs** refresh after an ADS save (listing mtime is unchanged, so the thumb cache is invalidated explicitly).
- **Multi-pane splitters** — 2- and 4-pane column/row dividers resize and persist again (flex equal-share and a stale drag ratio had made them feel stuck at 50%).
- **Context menu submenus** — flyout stayed hidden after hovering away and back (placement `ready` reset without reopening).
- **Custom context commands** — `.bat` / `.cmd` launch via `cmd.exe` (Node `spawn` on the script alone caused `EINVAL` on Windows). Arguments also accept `%1` / `%*` as aliases for `{path}` / `{paths}`.
- **Search settings** — saved filters and bookmarks **Add** UI visible again.
- **Breadcrumb** — middle segments no longer collapse with `…` when horizontal space is sufficient.
- **Slideshow compiled-lists crop** — Ctrl+numpad crop keys work when the lists window has focus; modifier keys captured before async decode.
- **Linux path normalization** — path helpers detect OS for separator handling (experimental Linux builds).

## [0.6.3] - 2026-08-12

Completes the **v0.6** product line for tagging (`v0.6.3`): opt-in remotes (D46), context-menu Discover + layout (D41), experimental Linux packaging, and polish on top of **0.6.0** Network / settings export. See [RELEASE_NOTES.md](RELEASE_NOTES.md).

### Added

- **Experimental Linux packaging** — AppImage via `npm run build:linux` / `dist:linux`; Wayland-oriented helpers (`dev:linux`, `run:unpacked`, `run:linux`, `install:linux`). Win32 koffi APIs lazy-load so Linux hosts do not crash on import. Not a supported product matrix — Windows remains primary. See [docs/LINUX.md](docs/LINUX.md).
- **Remote repositories (D46)** — opt-in FTP / FTPS / SFTP connections; Settings master switch (default off); toolbar + tree section; `mfe-remote://` locations; upload/download / mkdir / rename / permanent delete; Connect / Open / folder-nav busy dialogs; Open & preview stage under `userData` scratch then use local handlers. See [docs/REMOTE_FTP.md](docs/REMOTE_FTP.md).
- **Context menu Discover + layout (D41)** — Settings → Context menu → Discover scans static HKCR shell verbs; catalog and enabled ticks persist; tick enables on the live menu and adds a tinted orderable row under Built-in (no checkbox there). Built-in list is one-line (grip | checkbox | name | description) with drag-reorder and add/remove separators (`builtinLayout`). Full context-menu customization round-trips via Settings export/import (D45).

### Changed

- `npm run dist` refuses non-Windows hosts (use `build:linux` on Linux).
- Docs / README / PLAN / BUILD index Linux as experimental under **v0.6.x**.
- **Breadcrumb** collapses middle segments with `…` only when the address trail actually overflows (no fixed max segment count).
- **Settings export** strips `remoteConnectionBounds` with other dialog geometry (D45); Advanced copy calls out context-menu prefs explicitly.
- **Add/Edit remote connection** dialog: solid modal chrome, wider layout, drag/resize + persisted bounds, label|field rows, proper Cancel/Save buttons.

### Fixed

- **Remote Open** no longer hands `mfe-remote://` to Windows (Store “no app” dialog) — stages then `shell.openPath` on the local copy.
- **Context menu Discover** — unquoted registry commands under `C:\Program Files\…` no longer truncate the executable at the first space (Rescan to refresh cached verbs).
- **Remote preview / properties** use remote size/mtime; preview/media stage through scratch.
- **Remote → local drag/drop** to a drive root (`Z:\`) no longer fails with `EPERM` on `mkdir('Z:\')`.
- **FTP/FTPS concurrency** — serialize all ops per connection (`basic-ftp` one-command-at-a-time); reconnect+retry if a prior race closed the client (SFTP was already fine).
- **Remote move** across local↔remote uses copy-then-delete; conflict checks understand remote names/paths.

## [0.6.0] - 2026-08-12

Sixth product release: Network neighborhood & mapped-drive reconnect, portable settings export/import, Open Command Line (incl. Admin). See [RELEASE_NOTES.md](RELEASE_NOTES.md) and [docs/NETWORKS.md](docs/NETWORKS.md).

### Added

- **Network neighborhood (D44)** — tree Network section; remembered hosts in `network-hosts.json`; async worker discovery (~20s); Settings → Network (auto/manual + interval); Map / Disconnect WNet dialogs; UNC host/share browsing. See [docs/NETWORKS.md](docs/NETWORKS.md).
- **Mapped drive reconnect (D3)** — disconnected mapped letters stay under Drives; open/list restores via `WNetAddConnection2W` / interactive `WNetUseConnectionW`.
- **Settings export / import (D45)** — Advanced → Export… / Import… portable JSON (prefs + remembered network hosts; no window geometry).
- **Open Command Line here** — folder context menu; ShellExecute to Terminal / PowerShell / cmd; **Shift+click** elevated (UAC).
- **Add submenu icons** — same shell probes as toolbar + New.
- **docs/NETWORKS.md** — network feature reference.

### Changed

- Network rediscovery defaults to **every 5 minutes** (configurable) instead of a 90s poll that felt permanently “discovering…”.
- Docs / README / PLAN / ADVANTAGES / DECISIONS aligned to **v0.6.0** (through D45).

### Fixed

- Settings Export/Import action card no longer clips the Import button.
- Command-line launch uses ShellExecute (visible window; WindowsApps `wt.exe` stub-safe).

## [0.5.0] - 2026-08-11

Fifth product release: slideshow / categorizer + compiled lists, NTFS ADS tooling, deeper previews, ZIP/compress and multi-pane polish. See [RELEASE_NOTES.md](RELEASE_NOTES.md).

### Added

- **Slideshow / image categorizer (D37)** — gated chrome; fullscreen player; categorizer map; image-list cache; invalid-images folder. See [docs/SLIDESHOW.md](docs/SLIDESHOW.md).
- **Compiled file lists (D39)** — category `.dat` / `.txt` libraries; Update Lists writes ADS Index/Count on `.dat` only (`|=>` ignored); `.txt` expands from body at play; virtual playlist; Validate Lists; detached lists window.
- **NTFS Alternate Data Streams (D38)** — opt-in Details column, ADS Manager, `ads:*` IPC. See [docs/ADS.md](docs/ADS.md).
- **CHM preview (D35)** — `.chm` Contents TOC + sandboxed topic HTML (Windows `hh.exe` decompile under userData).
- **Font preview (D36)** — `.ttf` sample pangram + name-table metadata in the preview pane.
- **Archive preview breadth** — list-only contents trees for `.7z`, `.rar`, `.tar` / `.tar.gz` / `.tgz`, `.apk`, `.msi`, `.iso` / `.img` (alongside ZIP / Unity).
- **Empty pane actions** — multi-pane empty slots offer **Open Computer** and **Browse…** in addition to drop-a-tab.
- **Tree drag-hover expand** — while dragging, hover a collapsed folder in the tree ~2s to expand it (Explorer parity; D11).

### Changed

- **ZIP compress** — uses bundled **7za** (stream to disk, `%` progress, Cancel kills the helper) instead of in-memory JSZip generate.
- **View layout control** — 1 / 2 / 4 pane switcher is a compact toolbar dropdown.
- **Shell icon extract** — `.exe` / per-file shell icons extract in the background (queued + throttled).
- **Context submenus** — short close delay + hit-bridge so flyouts (e.g. Hide from view) stay reachable across the parent→submenu gap.
- **Docs** — README / PLAN / ADVANTAGES / RELEASE_NOTES / SLIDESHOW / ADS / DECISIONS aligned to v0.5.0 (through D39).

### Fixed

- **File-list / tree rename gesture** — double single-click is two slow clicks on the selected name; a single click no longer starts rename after hover/wait.
- **CHM preview** — locate `hh.exe` at `%SystemRoot%\hh.exe` (and SysWOW64 fallback); TOC encoding for Windows-1252 titles.
- **Update Lists OOM** — no longer builds Index for `.txt` or caches every folder scan in memory; processes one `.dat` at a time.

## [0.4.0] - 2026-08-09

Fourth product release: Everything-parity search, richer previews, multi-pane/tab polish. See [RELEASE_NOTES.md](RELEASE_NOTES.md).

### Added

- **Everything-parity search (D34)** — hybrid folder + optional NTFS volume index; Everything-inspired query language; as-you-type; match toggles; content search; filters/bookmarks; optional localhost HTTP API. See [docs/SEARCH.md](docs/SEARCH.md).
- **Windows Properties…** — Properties dialog bottom-left opens Explorer’s system property sheet (Security, Sharing, …) without reimplementing NTFS UI.
- **Multi-pane layouts (D31)** — 1 / 2 / 4 file panes with layout persistence.
- **Tab icons & tab context menu (D32)** — Lucide icon + color; Duplicate / Rename / Set icon / Close.
- **In-pane video preview (D33)** — byte-range `mfe-media`; MKV remux when practical; AVI strip-only.
- **Executable preview** — `.exe` / `.dll` (and related PE) show Explorer-style version details plus the real shell app icon.
- **HTML preview** — `.html` / `.htm` render sanitized markup by default, with a **Preview / Raw** toggle.
- **Markdown Preview / Raw toggle** — rendered GFM by default; switch to syntax-highlighted source.
- **Unity `.unitypackage` preview** — contents tree of Unity asset paths (`Assets/…`); list-only (no Extract All).
- **Batch / VBScript / `.ps` highlighting** — `.bat`/`.cmd` (DOS batch), `.vbs`, and `.ps` (PowerShell; `.ps1` already worked).
- **`.wlt` / `.ffs_gui` text preview** — treated as YAML and XML (syntax-highlighted).
- **+ New toolbar dropdown** — Explorer-style New menu (folder, common file types, Other…) before Undo / Cut / Copy.
- **Address bar `%VAR%` expansion** — breadcrumb path entry expands Windows env vars (`%LOCALAPPDATA%`, `%USERPROFILE%`, …).
- **Preview autoplay setting** — Settings → Behavior → Autoplay media in preview (`previewVideoAutoplay`, default off).

### Changed

- **Recent locations order** — dropdown lists current folder first, then Back history (newest previous → oldest), matching repeated Back.
- **Drag cancel** — pressing the opposite mouse button cancels an in-progress drag (left↔right), matching Explorer; Escape still works.
- **Single-pane drag highlight** — no full-view drop outline when `viewLayout` is 1 (still highlights in 2/4-pane and on folder targets).
- **ZIP preview** — contents tree no longer skips archives over ~80 MiB; listing reads the central directory only (size irrelevant).
- **Search UX** — match options + type chips in a toolbar dropdown; Settings Search uses whitelist / exclude blacklist lists; larger Settings window.
- **Docs** — SEARCH rewritten for D34; README / PLAN / ADVANTAGES / RELEASE_NOTES aligned to v0.4.0.

## [0.3.0] - 2026-08-09

Third product release: Explorer drag/drop parity, in-app Recycle Bin, large-folder performance, preview polish. See [RELEASE_NOTES.md](RELEASE_NOTES.md).

### Added

- **Create shortcuts here** — right-drag drop menu matches Explorer (Copy / Move / Create shortcuts / Cancel); writes `.lnk` via WScript (D11).
- **Drag edge auto-scroll** — while dragging, hovering near the top/bottom of the file list or folder tree scrolls that pane (D11).
- **In-app Recycle Bin** — tab-bar button lists bin contents in the file view (Restore / Empty / permanent delete). Details columns: Original location, Date deleted, Size, Type. No longer launches Windows Explorer (D7).
- **Drop files on tabs** — drag items onto a tab to move/copy into that tab’s folder (Ctrl=copy).
- **Disable hardware acceleration** — Settings → Advanced (restart required) to free GPU VRAM for training.
- **ComfyUI / JPEG Comments in preview** — reads Explorer “Comments” (EXIF UserComment / XPComment / JPEG COM) and decomposes A1111-style params into preview fields.
- **`npm run dist`** — auto-bumps the patch version, removes previous `MyFileExplorer Setup *.exe` from `dist/` (and prunes Settings → Updates folder), then builds.

### Changed

- **Large-folder performance** — Win32 `FindFirstFile` listing, watch mute/coalesce during list, skip tree re-list of the active folder, debounced scroll persistence, shared view-filter regex cache, pre-sorted listing, shell-icon extension cache (files only).
- **Optimistic delete** — prune listing after in-folder trash without a full re-stat of huge directories.
- **Docs** — README rewrite, ADVANTAGES.md, PLAN / docs / RELEASE_NOTES aligned to v0.3.0.

### Fixed

- **Folder icons** — directories no longer reuse the extensionless-file (`_none`) shell-icon cache slot; tree passes `isDir` on icon requests.
- **Recycle Bin undo** — restore uses shell `Verbs`/`DoIt` so Ctrl+Z after Del actually restores.
- **Preview after delete** — less flash / stuck spinner; sticky previous model until the next loads; optimistic next selection.
- **Shift/Ctrl + drag** — selection updates on press, then drag starts without requiring a second click.
- **Preview while multi-selecting** — shows the most recently selected file with an “N selected” badge.
- **In-app left-drag** — dropping onto folders works again; leave the window → OS `startDrag` / CF_HDROP.

### Removed

- **Generation base-model family filter** — briefly present in 0.2.x nightlies; never belonged in this product (removed before 0.3.0).

## [0.2.0] - 2026-08-06

Second product release: Explorer-replacement reliability, search-as-file-view, OS drag-out, progress/cancel, and post-0.1 polish. See [RELEASE_NOTES.md](RELEASE_NOTES.md).

### Added

- **Hide extensions in names** — Settings → Behavior lists extensions (default `lnk`) whose “.ext” is stripped from file-view/search labels only; files remain listed; rename still uses the full name.
- **Shortcut (.lnk) preview** — shows Target, Arguments, Start in, Comment, icon path, hotkey, and whether the target exists; Open shortcut / Open target actions.
- **Generate video previews** — context menu on folder background / folder / videos: write 20 evenly sampled frames into `!VIDTHUMB_CACHE` (Generate missing, Generate missing for all subfolders, or Regenerate all). Uses bundled ffmpeg; progress in the status bar (D26). Generate missing only skips complete 20-frame strips; partial/interrupted strips are deleted and regenerated.
- **File-op progress bar** — copy, move, Recycle Bin, permanent delete, and video-preview generation show a determinate status-bar progress bar with “N of M” and the current file name (D28). **Cancel** stops in-flight work.
- **In-app image editor** — Edit button on image previews (and context menu) opens Filerobot (crop/adjust/filters/annotate/resize). **Save** keeps a pristine copy under AppData for Revert; **Save as…** writes a new file with no backup (D27).
- **PowerPoint preview** — `.pptx` shows slide text in the preview pane; legacy `.ppt` gets a best-effort text scrape (layout/images not rendered).
- **Extra large icons only, no filename** — new view mode above Extra large icons. Hides the label for files that actually show a content preview (image/PSD or video strip); folders and files without a preview still show their names.
- **Animated video thumbs in icon view** — when a sibling hidden `!VIDTHUMB_CACHE` folder has `{videoName}.thumb_1.jpg`…`thumb_20.jpg`, icon/thumbnail modes loop those frames instead of the plain shell video icon. Frame delay is Settings → Behavior → Video thumbnail frame delay (default 300ms; D26).
- **SafeTensors preview metadata** — `.safetensors` files show a compact summary (type/params/dtype), promoted training fields, and syntax-highlighted JSON for nested leftovers — header-only, no weight load.
- **Named workspace layouts** — save the current tabs and pane chrome under a name; Toolbar Layouts menu; Settings → Layouts (D25).
- **Syntax-highlighted text previews** — common languages in the preview pane (`highlight.js`, theme-aware colors).
- **Conflict compare** — side-by-side Incoming vs Existing on name conflicts; per-file or Skip/Keep both/Replace all.
- **Recycle Bin on the tab bar** — opens the Windows Recycle Bin in system Explorer.
- **Undo / redo** — Ctrl+Z / Ctrl+Y for trash, move, copy, rename, and new file/folder (D23). Permanent delete is not undoable.
- **Manual updates** — Settings → Advanced: Updates folder, Check for update, Install update.
- **In-app image viewer** — full-window viewer for images (fit/actual, sibling arrows); **Open with default app** still uses the system association.
- **Customize this folder** — per-folder (optional recursive) view/sort/columns overrides (D22).
- **Extensive Details columns** — image / A/V / tags / generation fields via `meta:getMany`.
- **Windows shell icons** — `SHGetFileInfo` with `app.getFileIcon` fallback (D21).
- **Useful Quick access** — Desktop / Downloads / Documents / Pictures defaults; pin/unpin (D20).
- **Richer Properties dialog** — drives capacity bar; folder recursive size; editable attributes on Windows.
- **Inline audio/video preview** — `mfe-media://` playback in the preview pane.
- **Global view filter** — hide by pattern; toolbar eye toggle; context **Hide from view**.
- **External open / Reveal** — `--reveal` / `--open` / `mfe://` (D19). See `docs/INTEGRATION.md`.
- **PSD / rich document previews** — PSD thumbs; Markdown, Office-ish, PDF, HTML sanitized.
- **Scoped tabs** — “Open as root in new tab”.
- **Customizable Details columns** — resize/reorder/show-hide; layout in settings.
- **Marquee (box) selection** — rubber-band select across view modes.
- **Drop-target highlight** — folders light up while dragging.
- **App icon** — amber folder + teal compass; `npm run icons`.
- **Context menu → Add** — Folder and common file types with inline rename.
- **OS file drag-out** — left-drag exports real paths to other apps via `webContents.startDrag` (D11).
- **Search as normal file view** — results use `FileView` with banner + paths (D29).

### Changed

- **Tree folder drag-drop** — left- and right-drag folders in the tree; volume roots stay non-draggable.
- **Faster move** — same-volume moves no longer pre-walk the tree only to count progress units; watchers suspend for the batch.
- **Faster Del** — sync recycle first; no mandatory sleeps / PowerShell on the happy path; media hold is two animation frames.
- **Recycle Bin / preview handles** — `mfe-media` never serves browsed paths via `file://` (buffer ≤128 MiB or userData scratch). Thumbs/preview read Buffer then close.
- **File-op status bar** — fixed-width bar first; **Cancel** for copy/move/trash/delete/video-preview.
- **Busy feedback (D28)** — indeterminate after ~1 s if main has not yet reported units; large copies stream byte progress.
- **Docs** — README, PLAN, RELEASE_NOTES, and `docs/*` aligned to v0.2.0 (through D29).

### Fixed

- **Drag files into other apps** — `preventDefault` + sync `startDrag` so drops deliver CF_HDROP (HTML5-only drag showed a ghost but did nothing).
- **Ctrl+A in search** — selects search hits, not the underlying folder listing.
- **Recycle Bin (Del)** — robust trash path + suspended watches; preview no longer blocks recycle.
- **Right-button drag-drop** — pointer-capture ghost; tree drop keeps Copy/Move menu.
- **Search globs** — `*.jpg`, `img_??.png`, bare `.jpg` work; unindexed live-walk is recursive substring match.
- **Del vs Shift+Del** — no false “locked” when permanent delete works; clear refuse when volume cannot recycle.
- **Refresh (F5)** — reloads file list and loaded tree folders; drive list; navigates up if folder gone.
- **Folder rename** — file view vs tree rename source; click-away commits.
- **Context submenu clipping** — flip/shift/scroll to stay on-screen.
- **Image preview layout** — fills pane; compact details strip.
- **Delete/rename while previewing** — no open handles on browsed images.
- **False “locked by PowerShell”** — scanner ignores its own helper process.
- **File ops never fail silently** — Explorer-style modals; Restart Manager + process scan for lockers.
- **Tree rename** — F2 / context Rename in the tree.
- **View filter hides Windows Hidden** — omitted when filter on; dimmed when off.
- **Editable attributes in Properties** — Read-only, Hidden, Archive, System.
- **Full session tree restore** — `treeExpanded` per tab (D24).
- **Per-tab folder tree** — expand state independent per tab.
- **Quick access vs Drives tree** — opening Quick access no longer expands the user profile under Drives.
- **Wider tree / preview panes** — old fixed max widths removed.
- **PDF preview defaults** — `navpanes=0`, 100% zoom.
- **Offline / unmounted drive tabs** — kept after reboot; Offline UI + auto-retry (D3).
- **File view keyboard selection** — Home/End/arrows/Page* with Shift extend (Explorer-like).
- **Select next after delete** — matches Explorer.
- **Shared settings for dev and installed** — `%APPDATA%\MyFileExplorer` for both (D17).
- **Folder tree stale after Add / paste / rename** — parent children reload.

## [0.1.0] - 2026-08-01

First working product build (Phases 0–9 of the implementation plan).

### Added

- **Shell** — tab bar (new / close / activate / rename via double-click / drag reorder / middle-click close), toolbar with Back / Forward / Up / Refresh, interactive breadcrumb with overflow menu and Ctrl+L address editing, status bar with item / selection counts.
- **Three-pane layout** — lazy folder tree (quick access + drives) | virtualized file view | collapsible preview pane; splitter widths and collapsed state persisted in `session.json`.
- **Session restore** — tabs, per-tab history / view mode / sort / selection / scroll offset, active tab, and window bounds restored on launch (`session.json`, `window-state.json` under `userData`).
- **View modes** — extra large / large / medium / small icons with Sharp-generated thumbnails (cached under `userData/thumbs`, keyed by path + mtime + size), plus List and Details with sortable columns; folders-first setting.
- **File operations** — new folder (inline rename), new file with type picker, F2 rename, cut / copy / paste (internal + Windows `CF_HDROP` clipboard), drag-drop with Explorer modifier conventions (Ctrl=copy, Shift=move, same-volume default move), conflict prompts (Replace / Skip / Keep both / Cancel), Del → Recycle Bin, Shift+Del → permanent delete with confirm rules, Open, Show in system Explorer, Properties dialog.
- **Curated context menu** — Open, Open in new tab, Cut / Copy / Paste, Rename, Delete / Delete permanently, New, Copy path / name, Show in system Explorer, Add / Remove search index root, Properties.
- **Preview pane** — image / text / audio / video / PDF / binary / directory models with file fields; PNG `tEXt` / `zTXt` / `iTXt` parsing for A1111/Forge `parameters` (prompt, negative, steps, sampler, CFG, seed, size, model, hash, raw) and ComfyUI `prompt` / `workflow` JSON, all copyable.
- **Search** — opt-in indexed roots (SQLite via `node:sqlite`, FTS5 with LIKE fallback), background indexer with progress and parent-covers-child dedupe, live-walk fallback with progress + cancel; results show in the normal file view (D29) with “Not indexed — slow search” banner.
- **Settings** — dark / light / custom theme (CSS token editor), font family + size, default new-tab path, folders-first, permanent-delete confirmation, preview defaults, text preview byte cap, index root management, exclude dir names, thumbnail cache clearing; all applied live and persisted.
- **Security** — sandboxed renderer (no Node), typed preload bridge, Zod-validated IPC with `Result` envelope, `mfe-media://` protocol restricted to an allowlist (listed dirs, preview targets, thumb cache) with realpath re-checks.
- Tooling: electron-vite, TypeScript strict + `noUncheckedIndexedAccess`, ESLint (0 warnings), Prettier, Vitest (64 tests), electron-builder Windows target.

### Notes

- Dev and packaged builds share `%APPDATA%\MyFileExplorer` for settings/session (optional isolated `.dev-user-data/` via `MFE_ISOLATED_USER_DATA=1`).
- Search uses Node's built-in `node:sqlite` instead of `better-sqlite3` to avoid native rebuilds; FTS5 availability is detected at runtime with a LIKE fallback (see DECISIONS.md D16).

## [Unreleased — specs]

### Added

- Project specification set (`PLAN.md`, `docs/*`)
