# Preview pane — supported extensions

**Version:** 0.4.x  
**Source of truth:** extension sets in [`src/main/preview/index.ts`](../src/main/preview/index.ts) (plus CHM / video helpers). Behavior detail: [PREVIEW.md](PREVIEW.md).

Selecting a file shows a type-appropriate preview above the file details strip. Extensions are matched case-insensitively on the final path segment (no leading dot in the tables below).

Unknown extensions are **not** ignored: main sniffs for text (UTF-8 / UTF-16 LE) and shows a syntax-highlighted text sample when possible; otherwise `kind: 'binary'` (icon + file fields only).

---

## Quick index

| Category | Extensions | Preview kind |
| -------- | ---------- | ------------ |
| [Images](#images) | `png` `jpg` `jpeg` `webp` `gif` `bmp` `avif` `tiff` `tif` `svg` `ico` | `image` |
| [Photoshop](#photoshop) | `psd` | `image` (rasterized) |
| [Audio](#audio) | `mp3` `wav` `flac` `ogg` `m4a` `aac` `wma` `opus` | `audio` |
| [Video](#video) | `mp4` `m4v` `webm` `mkv` `mov` `wmv` `mpg` `mpeg` `avi` | `video` |
| [PDF](#pdf) | `pdf` | `pdf` |
| [Markdown](#markdown) | `md` `markdown` | `markdown` |
| [HTML](#html) | `html` `htm` | `html` |
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
| [Folders](#folders) | *(directories)* | `directory` |

---

## Images

| Ext | Notes |
| --- | ----- |
| `png` | Display via `mfe-media://`. A1111 / ComfyUI generation metadata when embedded. |
| `jpg` / `jpeg` | Same; EXIF orientation when feasible; A1111-style comments when present. |
| `webp` | Same as JPEG for metadata sniff. |
| `gif` | Animated GIF plays in the image preview. |
| `bmp` | Raster preview. |
| `avif` | Raster preview (Chromium/Sharp support). |
| `tiff` / `tif` | Raster preview. |
| `svg` | Displayed as image; **not** in-app editable. |
| `ico` | Displayed as image; **not** in-app editable. |

**In-app image editor** (Filerobot; Save / Revert / Save as…): `png` `jpg` `jpeg` `webp` `gif` `bmp` `avif` `tiff` `tif` — not `svg` / `ico` / `psd`.

---

## Photoshop

| Ext | Notes |
| --- | ----- |
| `psd` | Rasterized preview (embedded JPEG preferred, else composite → PNG). Cached under `userData/psd-preview/`. Needs Maximize Compatibility / embedded preview. **PSB** and some color modes unsupported. Not in-app editable. |

---

## Audio

Inline `<audio>` via byte-range `mfe-media://`. Optional autoplay: Settings → Behavior → **Autoplay media in preview**.

| Ext | Notes |
| --- | ----- |
| `mp3` | MPEG audio. |
| `wav` | PCM / common WAV. |
| `flac` | Lossless. |
| `ogg` | Ogg container (Vorbis/Opus depending on Chromium). |
| `m4a` | AAC in MP4 audio. |
| `aac` | Raw / ADTS AAC when Chromium accepts it. |
| `wma` | Best-effort; may need Open with default app. |
| `opus` | Opus audio. |

---

## Video

Inline `<video>` via byte-range `mfe-media://` when Chromium can play the container/codecs. Optional autoplay (same setting as audio).

| Ext | Behavior |
| --- | -------- |
| `mp4` / `m4v` | Direct play when H.264/AAC (typical). |
| `webm` | Direct play when VP8/VP9/Opus (typical). |
| `mov` | Direct play when codecs allow. |
| `mkv` / `wmv` / `mpg` / `mpeg` | Still poster, then remux/transcode to MP4 under `userData/video-remux/` when practical (`preview:ensurePlayable`). |
| `avi` | **Strip-only** — no in-pane player. Animates `!VIDTHUMB_CACHE` frames when present + **Open with default app** (D33). |

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

---

## Spreadsheets

Parsed with SheetJS; rows/cols/sheets capped for UI. Sheet tabs + HTML table.

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
| `pptx` | Slide text extract (DrawingML); images/charts omitted. |
| `ppt` | Legacy OLE — best-effort text scrape; incomplete vs PowerPoint. |

Same HTML document surface as Word; HTML truncated (~200 KB).

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
| `json` | JSON |
| `yaml` / `yml` / `wlt` | YAML (`wlt` treated as YAML) |
| `xml` / `ffs_gui` | XML (`ffs_gui` FreeFileSync GUI) |
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

Companion `.cue` / `.ccd` already preview as text; `.sub` stays binary.

---

## Fonts

| Ext | Notes |
| --- | ----- |
| `ttf` | Pangram / alphabet sample via `@font-face` (`mfe-media`, `font/ttf`). Name-table Family / Full name / Version / Copyright. Does not install the font. (D36) |

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

## Folders

Directories use `kind: 'directory'` (folder icon + file fields such as child counts when available). Not an “extension,” but part of the preview pane.

---

## What is *not* a dedicated preview

Examples that fall through to text sniff or binary icon unless listed above:

- Archives other than `zip` / `7z` / `rar` / `tar` / `tar.gz` / `tgz` / `unitypackage` / `apk` / `msi` / `iso` / `img` (e.g. `7z.001`, `cab`, lone `.gz`, `.bin`)
- Font formats beyond `ttf` (e.g. `otf`, `woff`, `woff2`)
- `psb` (Photoshop Big)
- Office formats beyond the Word / PowerPoint / spreadsheet / RTF sets (e.g. `odt`, `pages`)
- CloneCD `.sub` / email / databases, etc.

Use **Open with default app** (or the system help viewer for oversized CHMs) when the in-pane preview is limited.

---

## Related docs

- [PREVIEW.md](PREVIEW.md) — PreviewModel, generation metadata, video strips, performance
- [PRODUCT_SPEC.md](PRODUCT_SPEC.md) — UX requirements for the preview pane
- [DECISIONS.md](DECISIONS.md) — D7 media protocol, D26 strips, D27 image editor, D30 archives, D33 video, D35 CHM, D36 TTF
