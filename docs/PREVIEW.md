# Preview & metadata

**Version:** 0.6.x

The preview pane shows a type-appropriate visualization plus a **metadata field list** that grows based on what can be parsed. Missing fields are omitted (never show empty placeholder rows for AI params).

**Extension catalog:** [PREVIEW_EXTENSIONS.md](PREVIEW_EXTENSIONS.md) — every extension routed by the preview pane, with notes per type.

---

## PreviewModel (IPC)

```ts
type PreviewModel = {
  path: string
  kind:
    | 'image' | 'text' | 'markdown' | 'html' | 'spreadsheet' | 'document' | 'rtf'
    | 'audio' | 'video' | 'pdf' | 'binary' | 'executable' | 'directory' | 'shortcut'
    | 'archive' | 'chm' | 'font' | 'missing'
  mediaUrl?: string // protocol URL for display (images, PDF, fonts, CHM topic, MSI icon)
  textSample?: string // utf-8 sniff / markdown source, truncated
  htmlBody?: string // Word / RTF HTML fragment (renderer sanitizes)
  sheets?: { name: string; rows: string[][] }[] // spreadsheet preview
  archiveTree?: ArchiveTreeNode[] // ZIP / 7z / RAR / TAR / Unity / APK / MSI / ISO / IMG / CHM TOC
  archiveFormat?: 'zip' | 'unitypackage' | '7z' | 'rar' | 'tar' | 'targz' | 'apk' | 'msi' | 'iso' | 'img'
  fields: PreviewField[] // ordered for display
  warnings?: string[] // e.g. "truncated", "parse incomplete"
}

type ArchiveTreeNode = {
  name: string
  path: string // inside-archive path with `/`
  kind: 'file' | 'dir'
  size?: number // uncompressed bytes when known
  children?: ArchiveTreeNode[]
}

type PreviewField = {
  id: string // stable key e.g. "gen.prompt"
  label: string // UI label
  value: string // display string (may be long)
  group?: 'file' | 'image' | 'generation' | 'shortcut' | 'executable' | 'audio' | 'video' | 'other'
  mono?: boolean // use monospace / multiline block
  copyable?: boolean
}
```

---

## Always-on file fields (`group: file`)

When available from `stat`:

- Name
- Type / extension
- Size (human)
- Date modified / created (if available on Windows)
- Read-only / hidden attributes (if cheap)
- Dimensions (images / PSD — shown in the bottom details strip)

Details strip layout: Name (+ Dimensions when present), then a responsive pair — **Type / Size** beside **Date modified / Date created** when the pane is wide enough; stacks on narrow panes. Path is omitted (redundant with Name for browsing).

---

## Images

**Display:** image via protocol URL (respect EXIF orientation when feasible). Uses as much vertical space as possible above the details strip (`object-fit: contain`).

**Edit:** pencil button in the preview header, context menu **Edit image…**, or **Ctrl+E** (single editable image selected; otherwise ignored) opens Filerobot (crop / adjust / finetune / filters / annotate / resize). **On NTFS:** **Save** writes tip ADS `VER_n` (max 4; default stream stays pristine). Context menu **Version Control** (when history exists): Commit / Revert, then **Original** / **Version k** to preview that stream (D27). While previewing a version, the dim banner has **Show current** and **Drop** (tooltips). Slideshow always uses the tip. **On non-NTFS:** Save overwrites the file in place (no version streams — FAT/exFAT have no ADS). **Copy/move to a non-ADS volume:** destination gets the tip edit as the file body (edits kept; original/history dropped). **Save as…** writes a new file via the system save dialog with no version history. Not for SVG/PSD.

**Tradeoffs (NTFS):** Explorer / Open with default app still see the default stream (original) while MFE preview/thumbs/slideshow show the tip. If another app overwrites the default stream while `VER_*` exist, MFE keeps showing the tip until Revert or Commit — no automatic merge. ZIP compress typically drops ADS.

**Image fields:** dimensions in the file details strip. Generation metadata (when present) still appears in the scrollable content area.

### Photoshop (`.psd`)

- Rasterized via `ag-psd` (embedded JPEG thumbnail preferred; else composite `imageData` → PNG with Sharp). No `node-canvas`.
- Cached under `userData/psd-preview/`; also feeds icon thumbs.
- Requires an embedded preview/composite (Photoshop “Maximize Compatibility”). PSB / some color modes unsupported.

### Generation metadata (`group: generation`)

Parse **best-effort**. Support grows over time; v1 targets the formats below.

#### A1111 / Forge-style PNG

Common pattern: PNG `tEXt` / `iTXt` chunk key `parameters` (sometimes `Comment`).

Typical body:

```text
{prompt}
Negative prompt: {negative}
Steps: 20, Sampler: …, CFG scale: 7, Seed: 123, Size: 512x768, Model hash: …, Model: …
```

Extract when present (from PNG `parameters`/`Comment`, or JPEG/WebP EXIF UserComment / XPComment / COM — Explorer’s **Comments** field):

| Field id            | Label                               |
| ------------------- | ----------------------------------- |
| `gen.prompt`        | Prompt                              |
| `gen.negative`      | Negative prompt                     |
| `gen.steps`         | Steps                               |
| `gen.sampler`       | Sampler                             |
| `gen.scheduleType`  | Schedule type                       |
| `gen.cfg`           | CFG scale                           |
| `gen.seed`          | Seed                                |
| `gen.size`          | Size                                |
| `gen.model`         | Model                               |
| `gen.modelHash`     | Model hash                          |
| `gen.vae`           | VAE                                 |
| `gen.denoising`     | Denoising strength                  |
| `gen.setting.*`     | Any other `Key: value` pairs        |
| `gen.rawParameters` | Raw parameters (collapsible / copy) |

Keep raw text if structured parse fails but chunk exists.

#### ComfyUI PNG

Often embeds workflow JSON in `tEXt`/`iTXt` keys such as `prompt` and/or `workflow` (exact keys vary by save path).

Extract when present:

| Field id                | Label                                                    |
| ----------------------- | -------------------------------------------------------- |
| `gen.comfyPromptJson`   | Comfy prompt (JSON)                                      |
| `gen.comfyWorkflowJson` | Comfy workflow (JSON)                                    |
| `gen.comfySummary`      | Short summary if we can derive model/sampler nodes later |

v1: show pretty-printed JSON in monospace (with size cap + “open full in viewer”); deeper node summary is Phase 10+.

#### Other

- JPEG/WebP: EXIF UserComment / XPComment / ImageDescription and JPEG COM markers; if the text looks like A1111 parameters (ComfyUI savers), run the same decomposed parser (prompt, negative, Steps, Sampler, Schedule type, VAE, …)
- `.json` sidecar next to image (`name.json`) — optional later; not required for v1

---

## Text

- UTF-8 / UTF-16 LE sniff; if binary → `kind: 'binary'`
- Show first `textPreviewMaxBytes` chars
- **Syntax highlighting** in the renderer (`highlight.js`, selective grammars) for common types: HTML/XML, JSON, TS/JS, YAML, CSS/SCSS, Python, shell/PowerShell (`.ps1` / `.ps`), batch (`.bat` / `.cmd`), VBScript (`.vbs`), INI/TOML-ish, SQL, C-family, Rust, Go, PHP, Ruby, Lua, etc. Unknown extensions stay monospace plaintext.
- Extensions: `.txt`, `.json`, `.yaml`, `.yml`, `.wlt` (YAML), `.ffs_gui` (XML), `.log`, `.css`, `.js`, `.ts`, … (`.md` / office formats use dedicated kinds below)

---

## Markdown (`.md`, `.markdown`)

- `kind: 'markdown'` with raw `textSample`
- Renderer: GFM via `marked`, sanitized with DOMPurify before inject
- **Preview / Raw** toggle (default Preview); Raw shows syntax-highlighted source

---

## HTML (`.html`, `.htm`)

- `kind: 'html'` with raw `textSample` (same text-preview byte cap as other text)
- Renderer: sanitized HTML inject (DOMPurify; scripts/iframes/forms forbidden)
- **Preview / Raw** toggle (default Preview); Raw shows syntax-highlighted source
- Relative assets / external scripts are not loaded specially — best-effort document preview

---

## Spreadsheet (`.xls`, `.xlsx`, `.xlsm`, `.xlsb`, `.ods`; `.csv` best-effort)

- Parsed in main with SheetJS (`xlsx`); capped rows/cols/sheets for UI
- Renderer: sheet tabs + scrollable HTML table

---

## Word (`.docx`, `.doc`)

- `.docx` → HTML via `mammoth`; `.doc` → plain text via `word-extractor` then simple HTML
- `kind: 'document'`, `htmlBody` sanitized in renderer

---

## PowerPoint (`.pptx`, `.ppt`)

- `.pptx` → slide text HTML via JSZip + DrawingML `<a:t>` extract (`subtitle: PowerPoint`); images/charts omitted
- `.ppt` (legacy OLE) → best-effort UTF-16LE text scrape; incomplete vs native PowerPoint
- Same `kind: 'document'` / HTML preview surface as Word; truncated at ~200 KB of HTML

---

## RTF (`.rtf`)

- Lightweight RTF → text/HTML in main (`kind: 'rtf'`); not a full layout engine
- Renderer reuses the HTML document preview surface

---

## Audio / video

- Inline Chromium `<video>` / `<audio>` via `mfe-media://` (`mediaUrl`) — protocol must answer **byte-range** requests (`206` + `Content-Range`); a plain full-body `200` is not enough for Chromium media
- Video: `.mp4`, `.m4v`, `.webm`, `.mkv`, `.avi`, `.mov`, `.wmv`, `.mpg`, `.mpeg` — player/strip plus parsed tags/format when present (`group: 'video'`; empty fields omitted). Embedded artwork is not used as the video still (frame posters stay separate).
- Audio: `.mp3`, `.wav`, `.flac`, `.ogg`, `.m4a`, `.aac`, `.wma`, `.opus` — player plus parsed tags/format (`group: 'audio'`) and embedded cover when present (`posterUrl`, cached under `userData/audio-covers/`)
- **Async tags:** `preview:get` returns `mediaUrl` / poster / remux hooks without waiting on `music-metadata` (duration scans can read the whole file). Tag fields arrive via `preview:getMediaMeta` in parallel while the player buffers (`mediaMetaPending`)
- Playback depends on Chromium’s codecs (H.264/AAC MP4 and WebM usually work)
- Containers Chromium can’t demux (`.mkv`, `.wmv`, …): still (`posterUrl`) then remux/transcode to MP4 under `userData/video-remux/` (`preview:ensurePlayable`) when practical. Settings → Behavior: **Autoplay media in preview** (`previewVideoAutoplay`, default off)
- **`.avi`**: no in-pane player — animate `!VIDTHUMB_CACHE` strip frames when present, plus **Open with default app** (D33); tag metadata still listed when parseable
- On decode error for otherwise playable types: short message + open-with-default-app button (and poster if available)

### Icon-view video strips (`!VIDTHUMB_CACHE`, D26)

- Sibling hidden folder next to the video: `{videoName}.thumb_1.jpg` … `thumb_20.jpg`
- Icon / thumbnail views loop frames (`vidThumbFrameMs` in Settings → Behavior)
- Context menu **Video previews**:
  - **Generate missing** — this folder only
  - **Generate missing (all subfolders)** — recursive walk (skips cache dirs)
  - **Regenerate all** — overwrite strips for videos in this folder
  - On selected video(s): **Generate video preview(s)**
- Generation uses bundled ffmpeg: 20 frames sampled evenly across duration; progress via `op-progress` / status bar
- **Generate missing** skips only strips with all **20 non-empty** frames; partial/interrupted strips are deleted and regenerated
- **Regenerate all** clears each video’s strip files then rewrites all 20 frames
- Missing or incomplete strips fall back to the Windows shell icon

---

## PDF

- Embedded Chromium PDF viewer via `mfe-media://` iframe (`mediaUrl`)
- Default open params: `#navpanes=0&zoom=100` (no thumbnail/outline sidebar; 100% zoom for readable preview)
- Fallback: icon + “Open with default app” if URL unavailable

---

## Directory

- Child count (non-recursive) + sum size optional (expensive — skip or cache)
- “Indexed for search: yes/no”

---

## ZIP archives (`.zip`)

- `kind: 'archive'` with `archiveFormat: 'zip'` — nested **contents tree** in the preview pane (expand/collapse folders; file sizes when known)
- **Not** a navigable virtual folder (still deferred) — browsing stays outside the archive; use **Extract All…** from the preview toolbar or context menu
- Listing uses the ZIP central directory only (no full-file load); trees truncate around 4000 nodes
- Zip-slip style entry names (`../…`) are omitted from the tree
- File fields include Files / Folders counts; subtitle summarizes counts
- Folders in the tree start **collapsed** (expand on click), except when the archive has a **single top-level folder** — that folder opens automatically so its contents are visible

---

## Unity packages (`.unitypackage`)

- `kind: 'archive'` with `archiveFormat: 'unitypackage'` — same contents tree UI as ZIP
- Format is gzip-compressed tar; each GUID folder’s `pathname` is mapped to Unity paths (typically `Assets/…`)
- Streams the archive (reads `pathname` text + `asset` sizes only; does not extract payloads)
- **No Extract All** in the preview toolbar (import via Unity / open externally)
- Trees truncate around 4000 nodes; `../` pathnames omitted

---

## 7-Zip / RAR / TAR (`.7z`, `.rar`, `.tar`, `.tar.gz`, `.tgz`)

- Same `kind: 'archive'` contents-tree preview as ZIP (list-only; **no Extract All** in the toolbar)
- `.7z` — listed via bundled `7za` (`7zip-bin` / `7zip-min`, asar-unpacked)
- `.rar` — listed via `node-unrar-js` (WASM UnRAR)
- `.tar` / `.tar.gz` / `.tgz` — streamed with `tar-stream` (+ gunzip); compound suffixes detected before bare `.gz`
- Trees truncate around 4000 nodes; `../` entry names omitted
- Password / multi-volume / exotic RAR variants may fail with a warning — use Open externally

---

## Android packages (`.apk`)

- `kind: 'archive'` with `archiveFormat: 'apk'` — ZIP contents tree (list-only; **no Extract All**)
- Metadata from binary `AndroidManifest.xml` (ZIP entry only): Package, Version (`versionName`), Version code when parseable
- Subtitle prefers `package · versionName` plus file/folder counts
- No permission dump or launcher-icon extract

---

## Windows Installer (`.msi`)

- `kind: 'archive'` with `archiveFormat: 'msi'` — contents tree via bundled `7za` (list-only; **no Extract All**)
- Also shows shell icon (`mediaUrl`) and VERSIONINFO fields when present (same strings as executable preview)
- Listing may fail on unusual MSIs — warning + empty tree; Open externally remains available

---

## Disc / disk images (`.iso`, `.img`)

- `kind: 'archive'` — contents tree via random-access listing (list-only; **no Extract All**). Bundled `7za` does **not** support ISO/UDF.
- Prefers **UDF** when an Anchor Volume Descriptor is present (Windows install ISOs — ISO9660 is often only a stub `README.TXT`)
- Falls back to **ISO 9660 / Joliet** (2048-byte cooked sectors; `.img` also tries raw Mode-1 2352)
- Companion `.cue` / `.ccd` stay text previews; `.sub` stays binary

---

## TrueType fonts (`.ttf`)

- `kind: 'font'` — sample pangram / alphabet via `@font-face` over `mfe-media` (`font/ttf`)
- Name-table fields when present: Family, Full name, Version, Copyright
- Does not install the font into Windows; OTF / WOFF not in this pass (D36)

---

## Compiled HTML Help (`.chm`) — D35

- `kind: 'chm'` — full in-pane help viewer: **Contents TOC** + topic HTML
- Main decompiles via Windows `hh.exe -decompile` into `userData/chm-preview/` (path+mtime+size key); never writes beside the browsed file (D2). Resolves `hh.exe` from `%SystemRoot%\hh.exe` (typical) then SysWOW64 / System32 fallbacks
- Topics / CSS / images served as `mfe-media://chm/<hash>/…` so relative links resolve (D7 — no `file://`)
- Renderer uses a **sandboxed iframe** (no scripts); TOC click → `preview:chmTopic`
- TOC from `.hhc` sitemap (cap ~4000 nodes); folders start **collapsed**; `../` Locals omitted; default topic from `.hhp` or first HTML topic
- Large files (&gt;256 MiB) skipped with a warning — use **Open** for the system help viewer
- Best-effort: odd encodings, broken links, or ActiveX-era pages may degrade; scripts do not run

---

## Executables (`.exe` / `.dll` / …)

- `kind: 'executable'` — Windows VERSIONINFO via `version.dll` (Explorer Properties → Details parity)
- Fields (`group: executable`): File description, File version, Product name, Product version, Copyright, Company, Language, Original filename, Internal name, Comments, Legal trademarks, Private/Special build (omit empty)
- Preview shows the **shell application icon** (same glyph Explorer uses for that PE)
- Subtitle prefers File description, else Product name
- Also covers `.dll`, `.scr`, `.ocx`, `.cpl`, `.sys` when a version resource exists; **`.com`** shows the shell icon (VERSIONINFO uncommon — no warning when missing). `.msi` uses the archive + metadata preview above.

---

## Windows shortcuts (`.lnk`)

- `kind: 'shortcut'` — resolved via `WScript.Shell` CreateShortcut (Windows only)
- Fields (`group: shortcut`): Target, Target type (file/folder/URL/missing), Arguments, Start in, Comment, Icon location, Shortcut key, Run (if not Normal)
- Preview body shows the target path plus **Open shortcut** / **Open target** (when the target exists on disk)
- Missing or unreadable links still show file details with a warning

---

## SafeTensors (`.safetensors`)

Header-only parse (8-byte length + JSON); **weights are never loaded**. No large file icon — header subtitle carries the summary.

**Subtitle:** `SafeTensors · {type} · {params} · {dtype} · {N} tensors`

**Weights** (compact): parameters, tensor count, dtype, short tensor-name sample.

**Training** (from `__metadata__`, deduped — no full raw dump):

- Nested JSON strings (`software`, `training_info`, …) are deep-parsed
- Promoted rows: name, software, base model, dim/alpha, steps/LR/optimizer, hashes, …
- Remaining keys as a single syntax-highlighted **More metadata** JSON block
- Tag frequency / datasets as highlighted JSON when present

---

## Performance

- Cap JSON / prompt display length in UI (e.g. 32–64 KiB) with Copy / Reveal raw
- Parse on main process; cache preview parse result keyed by path+mtime+size until change
- Cancel in-flight preview when selection changes
- Multi-select: preview the focused / most recently selected path (not a blank summary)
