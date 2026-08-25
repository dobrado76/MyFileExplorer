# Slideshow / image categorizer

**Status:** Gated chrome. Master switch: Settings → **Slideshow** → **Enable slideshow UI** (`slideshowFeaturesEnabled`). The Slideshow settings section is always listed; when the switch is **off**, toolbar buttons and folder **Start Slideshow** stay hidden (settings remain editable).

When the gate is **off**, the app must not show slideshow toolbar buttons, folder context items, overlay, or related chrome (settings section stays visible).

When **on**:

- Settings → **Slideshow**: delay (`0` = as fast as decode/display allows; no upper cap), order, ascending, loop, **draw caption** (Caption ADS poster), invalid-images folder
- Toolbar: Start (folder/cache walk), Cache toggle, and (when cache on) Add / Save / Load / Clear image list. **Cache toggle + image list persist** in `settings.json` across app restarts (cleared only via Clear, or overwritten by Load/walk-while-cached).
- Folder context menu: **Start Slideshow**. **Stop** cancels an in-flight image-list build so a cancelled walk cannot later replace the playlist. Folder walks collect paths from directory listings; `stat` / decode runs only when Settings order is **size** or **dimensions**. When the toolbar view filter is **on** (eye hiding Hidden items), the walk skips Windows Hidden files/folders and view-filter pattern matches — same as the file list — so a Hidden `!Thumbnails` sibling is not included. Turn the eye **off** to include them. Virtual delete/categorize marks indexes skipped in a module-scope playlist (not Zustand) so advances stay O(1) even at 100k paths. While playing, the explorer file grid unmounts and listing/cache path arrays are parked out of reactive state so play speed does not depend on folder size (start/build time still does). Frame advance uses `preview:getDisplayUrl` (media URL only).
- **Categorizer map** — **Mapping Manager…** (Settings → Slideshow); Import/Export `.map` files there. Rows persist in `settings.slideshow.categorizerMap` (included in Settings → About → Export/Import). Deleting an exported file does not clear mappings.

Fullscreen image only — no overlay toolbar/status/close chrome (window title bar, click, or Esc/Space/Enter stop). Images use contain fit across the full client area. Mouse cursor auto-hides after 2s idle (reappears on move / click / wheel).

**Draw caption:** when Settings → Slideshow → **Draw caption** is on, a file with NTFS ADS `Caption` (JSON array of `{ Caption, Descriptor, Sentence }`) is shown as a demotivational-style poster: the photo (or latest `VER_n` tip) sits in the framed rectangle; one array entry is picked at random each preview / slideshow display. Border and title colors are hashed from the **full Caption ADS stream text** (before the random pick) so every display of that file shares one accent color. Missing or invalid ADS falls back to the photo plus a filename overlay.

Double-buffered display with V-Sync swaps (not a setting):

1. Keep the current frame painted on the front buffer.
2. Decode the next image into the back buffer (`Image.decode`).
3. Swap front/back on a double `requestAnimationFrame` tick so the change aligns with the display refresh — no black flash / tearing.
4. Prefetch/warm-decode the following image while the current one is shown.
5. Preview/decode failures: **remove** the path from the active list and the persisted image-list cache, and **move** the file into Settings → Slideshow → **Invalid images folder** (rename on conflict). Autoplay continues with the rest. If that folder is unset, the path is still dropped from the list/cache and a notice asks you to set the folder. If nothing displayable remains, the slideshow stops. `.tif` / `.tiff` / `.tga` / `.hdr` (Radiance) are rasterized before display so Chromium can paint them — do not treat a successful raster as invalid. Non-Radiance `.hdr` cannot be painted and is treated as unloadable.

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
| Delete | Virtual delete (O(1) skip in the in-memory list; commit on stop) |
| Undo | Undo last buffer action |
| Edit image… | Same in-app editor as Tab / context **Edit image…** |
| Reveal in Explorer | Exit slideshow (commit), open parent folder in a **new tab**, select the file |
| Exit slideshow | Stop and commit buffer |

## Keyboard (during slideshow)

| Keys | Auto mode | Manual mode |
| ---- | --------- | ----------- |
| Esc, Space, click | Stop (commit buffer) | Stop (commit buffer) |
| Enter | Interrupt → manual | Resume autoplay |
| Tab | Open in-app image editor (same as context **Edit image…**); interrupt → manual. After Save, frame reloads | Same |
| Home / End | Interrupt → first / last | First / last |
| ← ↑ PageUp | Interrupt → previous | Previous (wraps when Loop is on) |
| → ↓ PageDown | Interrupt → next | Next (wraps when Loop is on) |
| Mouse wheel | Interrupt → prev/next (same sense as ↑/↓) | Prev/next |
| Map delete keys | Interrupt → virtual delete + advance | Virtual delete + advance |
| Map folder keys | Interrupt → virtual categorize + advance | Virtual categorize + advance |
| `\ |` (key under Backspace / above Enter) | Interrupt → undo last buffer action | Undo last buffer action |
| Any other key | Interrupt → manual | — |

### Manual crop (numpad)

Interrupt autoplay first (any nav key, wheel, etc.), then:

| Keys | Not in crop mode | Crop mode |
| ---- | ---------------- | --------- |
| **Numpad0**, **Enter** | Resume autoplay | Save crop to disk (single encode from pristine `$DATA`) and exit crop |
| **Numpad5**, **Esc** | — | Abandon crop (no save) and exit crop |
| **Numpad2** | Enter crop + trim bottom 5% | +5% bottom (height) |
| **Numpad8** | Enter crop + trim top 5% | +5% top |
| **Numpad4** | Enter crop + trim left 5% | +5% left |
| **Numpad6** | Enter crop + trim right 5% | +5% right |
| **Shift** held | 2.5% step | 2.5% step |
| **Ctrl** held | 1% step | 1% step |
| **Shift+Ctrl** | 0.5% step | 0.5% step |
| **← ↑ PageUp**, **→ ↓ PageDown**, **Home**, **End** | Normal navigation | Save crop (if any) and go prev / next / first / last |
| **Backspace** | — | Discard crop and go **previous** |
| **Delete** | — | Discard crop and go **next** |
| All other keys | Normal manual shortcuts | **Blocked** |

Steps accumulate on the **original** file bytes (not prior saves). Save is skipped when nothing was trimmed. While cropping, click does not stop the slideshow.

Disk changes (trash / move) happen only when stopping, if the action buffer is non-empty.

Import copies a map file into `settings.json` (source of truth). Export writes settings out to a file. Use **Mapping Manager** (Settings → Slideshow) to add, edit, rename, reorder, or remove mappings — edits persist automatically. `categorizerMapPath` is only a last Import/Export dialog hint.


One absolute path per line; `#` comments and blanks skipped. The in-app Cache toggle and current image list also persist under `settings.slideshow.cacheActive` / `settings.slideshow.imageListCache` (userData).
