# Slideshow / image categorizer

**Status:** Gated chrome. Master switch: Settings → **Slideshow** → **Enable slideshow UI** (`slideshowFeaturesEnabled`). The Slideshow settings section is always listed; when the switch is **off**, toolbar buttons and folder **Start Slideshow** stay hidden (settings remain editable).

When the gate is **off**, the app must not show slideshow toolbar buttons, folder context items, overlay, or related chrome (settings section stays visible).

When **on**:

- Settings → **Slideshow**: delay (`0` = as fast as decode/display allows; no upper cap), order, ascending, loop, draw caption, invalid-images folder, **Compiled file lists folder** + Update Lists…, Import/Export categorizer map
- Toolbar: Start (folder/cache walk), optional **Compiled lists** button (when compiled folder is set), Cache toggle, and (when cache on) Add / Save / Load / Clear image list. **Cache toggle + image list persist** in `settings.json` across app restarts (cleared only via Clear, or overwritten by Load/walk-while-cached).
- Folder context menu: **Start Slideshow**
- **Categorizer map** rows persist in `settings.slideshow.categorizerMap` (source of truth). Import copies a file into settings; Export writes a copy out. Deleting the original file does not clear mappings.

## Compiled file lists (D39)

Parallel path to folder Start — category folders hold `.dat` / `.txt` lists; **Update Lists** pre-compiles every `.txt` (outside `!!Lists`) into ADS `Index` + `Count` so start does not walk source folders. Composites live under `!!Lists/`.

**Settings**

- `compiledFileListsFolder` — root; empty hides the second toolbar button
- `compiledListEntries` — `{ name, folder }[]` (config UI tabs / category folder names; drag order)
- `compiledPlaylistIndex` — resume index within the expanded playlist
- `compiledListsWindowBounds` — detached lists window geometry

**On disk** (under compiled root):

- `.dat` — body (and ADS Index) = **image full paths**, one per line; Count ADS = n
- `.txt` — body = **folders** (optional `folder|=>count`); **Update Lists** overwrites ADS Index with the expanded jpg/png list (and Count). Slideshow reads Index only (no live scan).
- `!!Lists/` — own tab for selectable `.dat`/`.txt`; **Update Lists** does not recompile here. `last.txt` is resume-only (hidden from the grid); user-saved composites also live here.

**Update Lists** walks the compiled root, skips `!!Lists`, processes **only `.txt`** (not `.dat`), and overwrites Index + Count.

**Second toolbar button:** if `last.txt` has no positive counts → Compiled Lists Config; else reload `last.txt`, expand list×count from Index, resume at `compiledPlaylistIndex`, open detached lists window.

**Detached lists window** (second BrowserWindow): tabs = entry names; grid = `.dat` / `.txt` rows with # / ± / Nb. Files; Load/Save any `!!Lists/*.txt`; `#` / ± / Clear rewrite `last.txt` and **immediately** rebuild the live slideshow playlist (Clear → empty playlist in place). Closing the lists window stops the slideshow, and stopping the slideshow closes the lists window. Overlay controls unchanged.

Fullscreen image only — no overlay toolbar/status/close chrome (window title bar, click, or Esc/Space/Enter stop). Images use contain fit across the full client area. Mouse cursor auto-hides after 2s idle and reappears on move.

Double-buffered display with V-Sync swaps (not a setting):

1. Keep the current frame painted on the front buffer.
2. Decode the next image into the back buffer (`Image.decode`).
3. Swap front/back on a double `requestAnimationFrame` tick so the change aligns with the display refresh — no black flash / tearing.
4. Prefetch/warm-decode the following image while the current one is shown.
5. Preview/decode failures: **remove** the path from the active list and the persisted image-list cache, and **move** the file into Settings → Slideshow → **Invalid images folder** (rename on conflict). Autoplay continues with the rest. If that folder is unset, the path is still dropped from the list/cache and a notice asks you to set the folder. If nothing displayable remains, the slideshow stops.

## Categorizer map file format

Exact line shape (blank lines allowed):

```text
"Name", Keys.KeyToken, "C:\\path\\or\\empty\\"
```

- **Name** — preserved for round-trip; used by a future categorizer UI
- **Keys.Token** — C# `System.Windows.Forms.Keys` name, e.g. `F5`, `O`, `Back`, `OemMinus`, `Oemplus` (normalized on load; saved with that spelling)
- **Path** — destination folder; **empty** `""` means DELETE (virtual, committed on stop)

## Right-click (during slideshow)

| Item | Action |
| ---- | ------ |
| Categorize | Submenu of folder mappings from the categorizer map (virtual move; commit on stop) |
| Delete | Virtual delete (commit on stop) |
| Undo | Undo last buffer action |
| Edit image… | Same in-app editor as Tab / context **Edit image…** |
| Reveal in Explorer | Exit slideshow (commit), open parent folder in a **new tab**, select the file |
| Exit slideshow | Stop and commit buffer |

## Keyboard (during slideshow)

| Keys | Auto mode | Manual mode |
| ---- | --------- | ----------- |
| Esc, Space, Enter, click | Stop (commit buffer) | Stop (commit buffer) |
| Tab | Open in-app image editor (same as context **Edit image…**); interrupt → manual. After Save, frame reloads | Same |
| Any other key | Interrupt → manual | — |
| Map delete keys | — | Virtual delete + advance |
| Map folder keys | — | Virtual categorize + advance |
| `\|` | — | Undo last buffer action |
| Home/End, arrows, PageUp/Down, mouse wheel | — | Navigate (wraps when Loop is on; wheel interrupt→manual like arrows) |
| Numpad | Reserved for crop (later) | Reserved |

Disk changes (trash / move) happen only when stopping, if the action buffer is non-empty.

Import copies a map file into `settings.json` (source of truth). Export writes settings out to a file. Use **Mapping Manager** (Settings → Slideshow) to add, edit, rename, reorder, or remove mappings — edits persist automatically. `categorizerMapPath` is only a last Import/Export dialog hint.


One absolute path per line; `#` comments and blanks skipped. The in-app Cache toggle and current image list also persist under `settings.slideshow.cacheActive` / `settings.slideshow.imageListCache` (userData).
