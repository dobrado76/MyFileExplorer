# Preview pane — supported extensions

**Version:** 0.11.0  
**Source of truth:** extension sets in [`src/main/preview/index.ts`](../src/main/preview/index.ts) (plus CHM / video helpers). Behavior detail: [PREVIEW.md](PREVIEW.md).

**Click-through fixtures:** [`samples/preview-extensions/`](../samples/preview-extensions/) — one small file per supported extension (`npm run samples:preview` to regenerate).

Selecting a file shows a type-appropriate preview above the file details strip. Extensions are matched case-insensitively on the final path segment (no leading dot in the tables below).

Unknown extensions are **not** ignored: main sniffs for text (UTF-8 / UTF-16 LE) and shows a syntax-highlighted text sample when possible; otherwise `kind: 'binary'` (icon + file fields only).

---

## Quick index

| Category | Extensions | Preview kind |
| -------- | ---------- | ------------ |
| [Images](#images) | `png` `jpg` `jpeg` `jfif` `webp` `gif` `bmp` `avif` `tiff` `tif` `tga` `hdr` `svg` `ico` | `image` |
| [Photoshop](#photoshop) | `psd` | `image` (rasterized) |
| [Audio](#audio) | `mp3` `wav` `flac` `ogg` `m4a` `aac` `wma` `opus` | `audio` |
| [Video](#video) | `mp4` `m4v` `webm` `mkv` `mov` `wmv` `mpg` `mpeg` `avi` `divx` `flv` `rmvb` `rm` | `video` |
| [PDF](#pdf) | `pdf` | `pdf` |
| [Markdown](#markdown) | `md` `markdown` | `markdown` |
| [HTML](#html) | `html` `htm` `smi` `sami` | `html` |
| [Spreadsheets](#spreadsheets) | `xls` `xlsx` `xlsm` `xlsb` `ods` `csv` | `spreadsheet` |
| [Word](#word) | `docx` `doc` | `document` |
| [PowerPoint](#powerpoint) | `pptx` `ppt` | `document` |
| [RTF](#rtf) | `rtf` | `rtf` |
| [Text / code](#text--code) | see [full list](#text--code) | `text` |
| [ZIP](#zip-archives) | `zip` | `archive` |
| [7-Zip / RAR / TAR](#7-zip--rar--tar) | `7z` `rar` `tar` `tar.gz` `tgz` | `archive` |
| [APK / MSI](#apk--msi) | `apk` `msi` | `archive` |
| [Disc images](#disc--disk-images) | `iso` `img` | `archive` |
| [Unity](#unity-packages) | `unitypackage` | `archive` |
| [Fonts](#fonts) | `ttf` | `font` |
| [CHM](#compiled-html-help) | `chm` | `chm` |
| [Executables](#executables--libraries) | `exe` `com` `dll` `scr` `ocx` `cpl` `sys` | `executable` |
| [Shortcuts](#windows-shortcuts) | `lnk` | `shortcut` |
| [SafeTensors](#safetensors) | `safetensors` | `binary` + rich fields |
| [UVW maps](#uvw-maps) | `uvw` | `binary` + metadata fields |
| [3D meshes](#3d-meshes) | `obj` `fbx` `3ds` | `model3d` (WebGL; fills pane) |
| [Folders](#folders) | *(directories)* | `directory` |

---

## Images

| Ext | Notes |
| --- | ----- |
| `png` | Display via `mfe-media://`. A1111 / ComfyUI generation metadata when embedded. |
| `jpg` / `jpeg` / `jfif` | Same; EXIF orientation when feasible; A1111-style comments when present. |
| `webp` | Same as JPEG for metadata sniff. |
| `gif` | Animated GIF plays in the image preview. |
| `bmp` | Raster preview. |
| `avif` | Raster preview (Chromium/Sharp support). |
| `tiff` / `tif` | Rasterized to WebP for preview/thumbs/slideshow (Chromium cannot paint TIFF). Cached under `userData/raster-preview/`. |
| `tga` | Decoded in-app (Sharp/libvips cannot sniff TGA), then cached WebP for thumbs/preview/slideshow. |
| `hdr` | Radiance RGBE/XYZE (typical HDRI / skybox). Tonemapped WebP for thumbs/preview/slideshow. Metadata includes layout hint (2:1 → equirectangular). Non-Radiance `.hdr` (e.g. Analyze 7.5) is a metadata card, not an image. **Not** in-app editable. |
| `svg` | Displayed as image; **not** in-app editable. |
| `ico` | Displayed as image; **not** in-app editable. |

**In-app image editor** (Filerobot; Save → `VER_*` ADS / Version Control / Save as…): `png` `jpg` `jpeg` `jfif` `webp` `gif` `bmp` `avif` `tiff` `tif` — not `svg` / `ico` / `psd` / `hdr`.

---

## Photoshop

| Ext | Notes |
| --- | ----- |
| `psd` | Rasterized preview (embedded JPEG preferred, else composite → PNG). Cached under `userData/psd-preview/`. Needs Maximize Compatibility / embedded preview. **PSB** and some color modes unsupported. Not in-app editable. |

---

## Audio

Inline `<audio>` via byte-range `mfe-media://`. Optional autoplay: Settings → Behavior → **Autoplay media in preview**.

Also shows **parsed metadata** (ID3 / Vorbis / etc. via `music-metadata`): duration, bitrate, sample rate, channels, codec/container, title/artist/album, track/disc, genre, year, composers & credits, BPM/key, copyright, ISRC, MusicBrainz IDs, comments/lyrics (truncated), and **embedded cover art** when present. Empty fields omitted.

| Ext | Notes |
| --- | ----- |
| `mp3` | MPEG audio + ID3 tags / cover. |
| `wav` | PCM / common WAV (+ tags when present). |
| `flac` | Lossless + Vorbis comments / picture blocks. |
| `ogg` | Ogg container (Vorbis/Opus depending on Chromium). |
| `m4a` | AAC in MP4 audio (+ iTunes/MP4 atoms). |
| `aac` | Raw / ADTS AAC when Chromium accepts it. |
| `wma` | Best-effort; may need Open with default app. |
| `opus` | Opus audio. |

---

## Video

Inline `<video>` via byte-range `mfe-media://` when Chromium can play the container/codecs. Optional autoplay (same setting as audio).

Also shows **parsed metadata** underneath when present (same `music-metadata` path as audio): duration, bitrate, dimensions/fps when known, codecs/container, title/artist/album and other tags. Empty fields omitted.

| Ext | Behavior |
| --- | -------- |
| `mp4` / `m4v` | Direct play when H.264/AAC (typical). |
| `webm` | Direct play when VP8/VP9/Opus (typical). |
| `mov` | Direct play when codecs allow. |
| `mkv` / `wmv` / `mpg` / `mpeg` / `flv` | Still poster, then remux/transcode to MP4 under `userData/video-remux/` when practical (`preview:ensurePlayable`). |
| `avi` | **Strip-only** — no in-pane player. Animates `!VIDTHUMB_CACHE` frames when present + **Open with default app** (D33). Metadata still listed when parseable. |
| `divx` | Same as AVI (RIFF/AVI container, DivX codec). Strip-only; Chromium cannot play DivX inline. |
| `rmvb` / `rm` | RealMedia. **Strip-only** like AVI — Chromium cannot play RealVideo; `!VIDTHUMB_CACHE` + Open with default app. |

Icon-view video strips (`!VIDTHUMB_CACHE`) are separate from the preview pane; see [PREVIEW.md](PREVIEW.md).

---

## PDF

| Ext | Notes |
| --- | ----- |
| `pdf` | Chromium PDF viewer in an iframe (`mfe-media://`, byte-range). Default `#navpanes=0&zoom=100`. |

---

## Markdown

| Ext | Notes |
| --- | ----- |
| `md` | GFM via `marked`, DOMPurify-sanitized. **Preview / Raw** toggle (default Preview). |
| `markdown` | Same. |

---

## HTML

| Ext | Notes |
| --- | ----- |
| `html` / `htm` | Sanitized document preview (no scripts/iframes/forms). **Preview / Raw** toggle. Relative assets are best-effort only. |
| `smi` / `sami` | SAMI subtitle (HTML-like). Decoded from `charset=` / `lang:kr-KR` / KRCC (typically **EUC-KR**), not assumed UTF-8. Same Preview / Raw toggle. Encoding shown in metadata. |

---

## Spreadsheets

Parsed with SheetJS; preview shows up to 2000 rows × 80 columns × 32 sheets. Sheet tabs + HTML table.

| Ext | Notes |
| --- | ----- |
| `xlsx` / `xlsm` / `xlsb` / `xls` | Office / Excel binary & OOXML. |
| `ods` | OpenDocument spreadsheet. |
| `csv` | Tried as spreadsheet first; falls back to text preview if parse fails. |

(`tsv` is listed under [Text / code](#text--code), not spreadsheet.)

---

## Word

| Ext | Notes |
| --- | ----- |
| `docx` | HTML via Mammoth; sanitized in renderer. |
| `doc` | Legacy → text via `word-extractor`, then simple HTML. |

---

## PowerPoint

| Ext | Notes |
| --- | ----- |
| `pptx` | Approximate slide layout (text + package/master images); notes when present. Charts/SmartArt omitted. |
| `ppt` | Legacy OLE — best-effort text scrape; incomplete vs PowerPoint. |

Same HTML document surface as Word; HTML truncated (~1 MiB).

---

## RTF

| Ext | Notes |
| --- | ----- |
| `rtf` | Lightweight RTF → HTML (not a full layout engine). |

---

## Text / code

UTF-8 / UTF-16 LE sniff; capped sample (`textPreviewMaxBytes`). Syntax highlighting via `highlight.js` when the extension maps to a grammar; otherwise monospace plaintext (lines that are only `#…` styled as comments).

| Ext | Typical highlighting |
| --- | -------------------- |
| `txt` | Plaintext |
| `srt` | SubRip subtitle (index / timestamps / tags) |
| `ics` / `ical` | iCalendar. **Preview** is an event / to-do agenda (name, times, location, repeats); **Raw** is highlighted source. Metadata: calendar name, method, timezone, counts, date range. All-day `DTEND` is exclusive (RFC 5545). |
| `eml` | Saved email (RFC 5322 / MIME). **Preview** shows From / To / Subject / Date, attachment names, and the body (plain text, or sanitized HTML). **Raw** is highlighted source. Remote images / tracking pixels are not loaded. Outlook `.msg` is not this format. |
| `sub` | Text subtitle (MicroDVD / SubViewer) when the file sniffs as UTF-8. CloneCD / VobSub `.sub` stays binary. |
| `smi` / `sami` | See [HTML](#html) — SAMI is HTML-like; encoding is detected (often EUC-KR). |
| `json` | JSON |
| `yaml` / `yml` / `wlt` / `meta` / `mat` / `asset` / `terrainlayer` / `lighting` / `unity` / `prefab` / `controller` / `anim` | YAML (`wlt` treated as YAML; the rest = Unity). Binary `.asset` / `.unity` / `.prefab` / `.controller` / `.anim` still sniff as binary. |
| `shadergraph` | JSON (Unity Shader Graph) |
| `shader` | Unity ShaderLab + HLSL |
| `mtl` | Wavefront material (INI-ish) |
| `xml` / `ffs_gui` / `csproj` | XML (`ffs_gui` FreeFileSync GUI; `csproj` MSBuild) |
| `sln` | Visual Studio solution (custom text: keywords / strings / GUIDs / `#` comments) |
| `vsconfig` | JSON (Visual Studio installer config) |
| `csv` / `tsv` | Plain / tabular text (`csv` prefers spreadsheet — see above) |
| `log` | Plaintext |
| `ini` / `cfg` / `conf` / `toml` | INI / TOML-ish |
| `css` / `scss` / `less` | CSS |
| `js` / `jsx` / `mjs` / `cjs` | JavaScript |
| `ts` / `tsx` | TypeScript |
| `py` | Python (also `.pyi` via highlight map when sniffed as text) |
| `rb` | Ruby |
| `rs` | Rust |
| `go` | Go |
| `java` | Java |
| `c` / `h` / `cpp` / `hpp` / `cs` | C / C++ / C# |
| `php` | PHP |
| `sh` | Shell |
| `ps1` / `psm1` / `psd1` / `ps` | PowerShell |
| `bat` / `cmd` | DOS batch |
| `vbs` / `vbe` | VBScript |
| `sql` | SQL |
| `lua` | Lua |
| `vue` / `svelte` | Component SFCs (best-effort) |
| `gitignore` / `env` / `editorconfig` / `prettierrc` | Dotfile / config plaintext |

---

## ZIP archives

| Ext | Notes |
| --- | ----- |
| `zip` | Contents tree from the **central directory** (no full extract). Expand/collapse; **Extract All…**. Cap ~4000 nodes. Not a navigable virtual folder. |

---

## 7-Zip / RAR / TAR

Same contents-tree UI as ZIP (**list-only** — no Extract All in the preview toolbar).

| Ext | Notes |
| --- | ----- |
| `7z` | Listed via bundled `7za`. |
| `rar` | Listed via WASM UnRAR (`node-unrar-js`). Password / multi-volume may fail. |
| `tar` | Streamed header listing (`tar-stream`). |
| `tar.gz` / `tgz` | Gunzip + tar stream. Detected by compound suffix (not bare `.gz`). |

---

## APK / MSI

Same contents-tree UI as ZIP (**list-only** — no Extract All). Plus practical package metadata.

| Ext | Notes |
| --- | ----- |
| `apk` | ZIP central-directory tree. Package / version / version code from binary `AndroidManifest.xml` when parseable. |
| `msi` | Contents via bundled `7za`. Shell icon + VERSIONINFO fields when present. |

---

## Disc / disk images

Same contents-tree UI (**list-only** — no Extract All). In-app walker (not `7za`): **UDF first**, then ISO9660 / Joliet.

| Ext | Notes |
| --- | ----- |
| `iso` | UDF when present (needed for Windows ISOs); else ISO9660 + Joliet. |
| `img` | Best-effort UDF / ISO9660 (cooked 2048 or raw Mode-1 2352). Non-ISO dumps may show an empty tree + warning. |

Companion `.cue` / `.ccd` already preview as text. A `.sub` next to a disc image is usually CloneCD/VobSub **binary** (icon only). A text MicroDVD/SubViewer `.sub` sniffs as [subtitle text](#text--code).

---

## Fonts

| Ext | Notes |
| --- | ----- |
| `ttf` | Pangram / alphabet sample via `FontFace` (bytes over `mfe-media`, `font/ttf`). Name-table Family / Full name / Version / Copyright. Does not install the font. (D36) |

---

## Unity packages

| Ext | Notes |
| --- | ----- |
| `unitypackage` | Same tree UI; GUID folders mapped via `pathname` → `Assets/…`. List-only — **no Extract All**. |

---

## Compiled HTML Help

| Ext | Notes |
| --- | ----- |
| `chm` | Contents TOC + sandboxed topic HTML. Decompile via Windows `hh.exe` into `userData/chm-preview/`. Topics over `mfe-media://chm/…`. Folders start collapsed. Windows only; &gt;256 MiB skipped. (D35) |

---

## Executables / libraries

| Ext | Notes |
| --- | ----- |
| `exe` | VERSIONINFO fields + shell application icon. |
| `com` | Shell icon; type “MS-DOS application”. VERSIONINFO only if the file is actually PE (rare). |
| `dll` | Same when a version resource exists. |
| `scr` / `ocx` / `cpl` / `sys` | PE with version resource when present. |

---

## Windows shortcuts

| Ext | Notes |
| --- | ----- |
| `lnk` | Target, args, start-in, comment, icon, hotkey; Open shortcut / Open target. |

---

## SafeTensors

| Ext | Notes |
| --- | ----- |
| `safetensors` | Header-only parse (weights never loaded). Subtitle + tensor / training metadata fields. |

---

## UVW maps

| Ext | Notes |
| --- | ----- |
| `uvw` | Autodesk 3ds Max Unwrap UVW save (texture-space verts/faces only — no 3D mesh or texture). Metadata card: format, purpose, UV vertex/face counts when the dump or ISave-chunk layout matches file size, UV range, OLE sniff, real labels only (no float-as-text junk), Unity GUID from a sibling `.uvw.meta`. No UV visualization. |

---

## 3D meshes

WebGL orbit view (`kind: 'model3d'`, D48): drag to rotate, scroll to zoom. The canvas **fills leftover preview-pane height** above the metadata strip (no splitter). Served over `mfe-media` (D7). Files over **96 MiB** skip WebGL and keep metadata only. No animation player.

| Ext | Notes |
| --- | ----- |
| `obj` | Wavefront mesh. Sibling `.mtl` + maps from the model folder or one immediate subfolder. Vertex/triangle counts from a text scan (first 4 MiB) when parseable. |
| `fbx` | Autodesk FBX. Encoding sniffed (ASCII / binary) and shown as a field. |
| `3ds` | 3D Studio mesh. |

Metadata (when present): Format, Preview (`Orbit WebGL view (drag to rotate, scroll to zoom).`), OBJ counts / `mtllib`, FBX encoding. `.mtl` next to an OBJ is a [text](#text--code) preview, not this viewer.

---

## Folders

Directories use `kind: 'directory'` (folder icon + file fields such as child counts when available). Not an “extension,” but part of the preview pane.

---

## What is *not* a dedicated preview

Examples that fall through to text sniff or binary icon unless listed above:

- Archives other than `zip` / `7z` / `rar` / `tar` / `tar.gz` / `tgz` / `unitypackage` / `apk` / `msi` / `iso` / `img` (e.g. `7z.001`, `cab`, lone `.gz`, `.bin`)
- Font formats beyond `ttf` (e.g. `otf`, `woff`, `woff2`)
- `psb` (Photoshop Big)
- Office formats beyond the Word / PowerPoint / spreadsheet / RTF sets (e.g. `odt`, `pages`)
- CloneCD / VobSub binary `.sub` (text MicroDVD `.sub` is listed under [Text / code](#text--code))
- Outlook `.msg` (OLE, not `.eml`), databases, etc.

Use **Open with default app** (or the system help viewer for oversized CHMs) when the in-pane preview is limited.

---

## Related docs

- [PREVIEW.md](PREVIEW.md) — PreviewModel, generation metadata, video strips, performance
- [PRODUCT_SPEC.md](PRODUCT_SPEC.md) — UX requirements for the preview pane
- [DECISIONS.md](DECISIONS.md) — D7 media protocol, D26 strips, D27 image editor, D30 archives, D33 video, D35 CHM, D36 TTF, D48 3D meshes
