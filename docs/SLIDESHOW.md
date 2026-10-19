# Slideshow / image categorizer

**Status:** Gated chrome. Master switch: Settings → **Slideshow** → **Enable slideshow UI** (`slideshowFeaturesEnabled`). The Slideshow settings section is always listed; when the switch is **off**, toolbar buttons and folder **Start Slideshow** stay hidden (settings remain editable).

When the gate is **off**, the app must not show slideshow toolbar buttons, folder context items, overlay, or related chrome (settings section stays visible).

When **on**:

- Settings → **Slideshow**: delay (`0` = as fast as decode/display allows; no upper cap), order, ascending, loop, **Include subfolders** (`slideshow.recursive`, default on — off = selected folder only), **Camera looks** (off until you turn them on — [below](#camera-looks)), **draw caption** (Caption ADS poster), invalid-images folder
- Toolbar: Start (folder/cache walk), Cache toggle, and (when cache on) Add / Save / Load / Clear image list. **Cache toggle + image list persist** in `settings.json` across app restarts (cleared only via Clear, or overwritten by Load/walk-while-cached).
- Folder context menu: **Start Slideshow**. **Stop** cancels an in-flight image-list build so a cancelled walk cannot later replace the playlist. Folder walks collect paths from directory listings and, when **Include subfolders** is on, descend into child folders; when it is off, only the selected folder’s images are included. `stat` / decode runs only when Settings order is **size** or **dimensions**. When the toolbar view filter is **on** (eye hiding Hidden items), the walk skips Windows Hidden files/folders and view-filter pattern matches — same as the file list — so a Hidden `!Thumbnails` sibling is not included. Turn the eye **off** to include them. Virtual delete/categorize marks indexes skipped in a module-scope playlist (not Zustand) so advances stay O(1) even at 100k paths. While playing, the explorer file grid unmounts and listing/cache path arrays are parked out of reactive state so play speed does not depend on folder size (start/build time still does). Frame advance uses `preview:getDisplayUrl` (media URL only).
- **Categorizer map** — **Mapping Manager…** (Settings → Slideshow); Import/Export `.map` files there. Rows persist in `settings.slideshow.categorizerMap` (included in Settings → About → Export/Import). Deleting an exported file does not clear mappings.

Fullscreen image only — no overlay toolbar/status/close chrome (window title bar, click, or Esc/Space/Enter stop). Images use contain fit across the full client area. Mouse cursor auto-hides after 2s idle (reappears on move / click / wheel).

**Draw caption:** when Settings → Slideshow → **Draw caption** is on, a file with NTFS ADS `Caption` (JSON array of `{ Caption, Descriptor, Sentence }`) is shown as a demotivational-style poster: the photo (or latest `VER_n` tip) sits in the framed rectangle; one array entry is picked at random each preview / slideshow display. Border and title colors are hashed from the **full Caption ADS stream text** (before the random pick) so every display of that file shares one accent color. Missing or invalid ADS falls back to the photo plus a filename overlay. A caption poster is shown as-is: camera looks do not run on that frame.

## Camera looks

Optional treatments painted over the slideshow photo (grain, white balance, blur, and similar). The file on disk is not changed. Decision: [DECISIONS.md](DECISIONS.md) **D76**.

**Off until you turn it on.** Settings → Slideshow → **Camera looks** starts off on a new install, and stays off in any settings file that never saved the switch as on. Turning it off does not clear the effects you checked, the frequency, or the path filter.

Two things have to be true before a slide changes:

1. **Camera looks** is on.
2. **Frequency** is above 0%. Frequency lives in **Camera looks…** (0 / 35 / 70 / 100 shortcuts, or the slider). 0% leaves every slide as the plain photo even when the switch is on.

The same place in the playlist always gets the same look and the same rolled values. Stepping forward and back does not re-roll. Changing the frequency, which effects are checked, the master switch, or the path filter can change which slides are treated.

**Path filter** (Settings → Slideshow, and again in the Camera looks window). Empty means every photo.

- `AI` — the path must contain those letters, anywhere (`AIart`, a file named `AI.png`, or a folder named `AI` all match). Matching ignores case. `/` and `\` are the same.
- `\AI\` — the path must contain a folder named `AI` (the photo’s parent, or any folder above it). A file named `AI.png` and a folder named `AIart` do not match.

A photo that misses the filter stays plain. The window still previews the effect and notes **Slideshow skips this photo.** when the opened file would be skipped. Other slides keep the look their own playlist index already rolled.

**Camera looks…** is a floating window. The effect list is on the left (checkbox = included in the random pool; click the row to edit that effect). The photo is on the left of the split; sliders and, for a custom look, the shader are on the right. Drag the divider to give the photo more room. Position, size, and that split are remembered on this PC and left out of Settings export. **Browse…** picks the preview photo. The window always shows the effect you selected, including while the slideshow switch is off. **Reset** restores that effect’s slider defaults. It does not rename sliders or change their min/max.

Crop mode shows the plain photo. A caption poster does too.

Built-in looks: DSLR natural, Fine grain, High ISO, Amateur white balance, Temperature, Point-and-shoot, Disposable camera, Direct flash, 1980s print, Slide film, Instant print, Faded snapshot, Early phone camera, Lens fringing, Dusty lens, Handshake blur, Available light. Each has its own sliders.

**Temperature** rolls one value per slide between **Coldest** and **Warmest**. −1 is cold, 0 is the original color, 1 is warm. The preview shows the rolled value (for example `+0.12 warm`).

**Dusty lens** rolls how many specks appear between its count sliders, and has a visibility slider.

**Custom looks.** Add one from the bottom of the list (up to 24). The name is a label. A new custom starts with one slider, `amount`, from 0 to 1, default 1. **Add slider** goes up to 8. The slider name is the variable in the shader. Set min, max, and the default **Reset** uses. Remove a slider you are not using.

The code box is only this function:

```glsl
vec3 apply(vec2 p, vec3 col, float seed) {
  return col;
}
```

`p` runs from 0 to 1 across the photo. `col` is the pixel color. `seed` is stable for that playlist index. The wrapper already provides `tap(uv)`, `grain()`, `spin(p, radians)`, `luma(col)`, `hash21(p)`, and `uTexel` (one pixel in `p` space). Each slider name is injected as `uniform float`. A custom is eligible for the slideshow roll only when its checkbox is on and the body contains `vec3 apply`. If the body fails to compile, that slide stays the plain photo.

Write it as WebGL1 / GLSL ES 1.00: `texture2D` is already inside `tap`; do not use `continue`; do not write a loop whose trip count can change; do not reuse wrapper names (`p`, `col`, `seed`, `grain`, `mix`, `float`, `cast`, `tap`, `luma`, `hash21`, `spin`, `uTexel`, or anything starting with `gl_`).

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
| Delete | Virtual delete (taken out of the in-memory list immediately; the file is trashed only when the slideshow stops) |
| Undo | Undo last buffer action |
| Copy image | Current slide as a bitmap on the OS clipboard (paste into other apps); uses latest in-app edit tip when present |
| Edit image… | Same in-app editor as Tab / context **Edit image…** |
| Reveal in Explorer | Exit slideshow (commit), open parent folder in a **new tab**, select the file |
| Exit slideshow | Stop and commit buffer |

## Keyboard (during slideshow)

| Keys | Auto mode | Manual mode |
| ---- | --------- | ----------- |
| Esc, Space, click | Stop (commit buffer) | Stop (commit buffer) |
| Enter | Interrupt → manual | Resume autoplay |
| Tab | Open in-app image editor (same as context **Edit image…**); interrupt → manual. After Save, frame reloads | Same |
| Home / End | Interrupt → opening image / last | Opening image / last |
| ← ↑ PageUp | Interrupt → previous | Previous (wraps when Loop is on) |
| → ↓ PageDown | Interrupt → next | Next (wraps when Loop is on) |
| Mouse wheel | Interrupt → prev/next (same sense as ↑/↓) | Prev/next |
| Alt | Toggle full path in the window title bar (persisted) | Same |
| Map delete keys | Interrupt → virtual delete + advance | Virtual delete + advance |
| Map folder keys | Interrupt → virtual categorize + advance | Virtual categorize + advance |
| `\ |` (key under Backspace / above Enter) | Interrupt → undo last buffer action | Undo last buffer action |
| Any other key | Interrupt → manual | — |

Compiled playback starts on the first image. **Home** returns to that same image (or the next image still in the list if it was removed). **Delete** and categorize keys drop the current image from the list immediately, so **Up** / **PageUp** do not show it again. **Undo** (`\`) puts it back. The file is trashed or moved only when the slideshow stops.

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
