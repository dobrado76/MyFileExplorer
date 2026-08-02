# Preview & metadata

**Version:** 0.0.0 (spec)

The preview pane shows a type-appropriate visualization plus a **metadata field list** that grows based on what can be parsed. Missing fields are omitted (never show empty placeholder rows for AI params).

---

## PreviewModel (IPC)

```ts
type PreviewModel = {
  path: string
  kind:
    | 'image' | 'text' | 'markdown' | 'spreadsheet' | 'document' | 'rtf'
    | 'audio' | 'video' | 'pdf' | 'binary' | 'directory' | 'missing'
  mediaUrl?: string // protocol URL for display (images, PDF)
  textSample?: string // utf-8 sniff / markdown source, truncated
  htmlBody?: string // Word / RTF HTML fragment (renderer sanitizes)
  sheets?: { name: string; rows: string[][] }[] // spreadsheet preview
  fields: PreviewField[] // ordered for display
  warnings?: string[] // e.g. "truncated", "parse incomplete"
}

type PreviewField = {
  id: string // stable key e.g. "gen.prompt"
  label: string // UI label
  value: string // display string (may be long)
  group?: 'file' | 'image' | 'generation' | 'other'
  mono?: boolean // use monospace / multiline block
  copyable?: boolean
}
```

---

## Always-on file fields (`group: file`)

When available from `stat`:

- Name
- Path
- Type / extension
- Size (human)
- Date modified / created (if available on Windows)
- Read-only / hidden attributes (if cheap)

---

## Images

**Display:** image via protocol URL (respect EXIF orientation when feasible).

**Image fields:** dimensions (via Sharp or header parse), bit depth if cheap.

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

Extract when present:

| Field id            | Label                               |
| ------------------- | ----------------------------------- |
| `gen.prompt`        | Prompt                              |
| `gen.negative`      | Negative prompt                     |
| `gen.steps`         | Steps                               |
| `gen.sampler`       | Sampler                             |
| `gen.cfg`           | CFG scale                           |
| `gen.seed`          | Seed                                |
| `gen.size`          | Size                                |
| `gen.model`         | Model                               |
| `gen.modelHash`     | Model hash                          |
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

- JPEG/WebP: EXIF UserComment / ImageDescription best-effort; if looks like A1111 parameters, run same parser
- `.json` sidecar next to image (`name.json`) — optional later; not required for v1

---

## Text

- UTF-8 / UTF-16 LE sniff; if binary → `kind: 'binary'`
- Show first `textPreviewMaxBytes` chars
- **Syntax highlighting** in the renderer (`highlight.js`, selective grammars) for common types: HTML/XML, JSON, TS/JS, YAML, CSS/SCSS, Python, shell/PowerShell, INI/TOML-ish, SQL, C-family, Rust, Go, PHP, Ruby, Lua, etc. Unknown extensions stay monospace plaintext.
- Extensions: `.txt`, `.json`, `.yaml`, `.yml`, `.log`, `.css`, `.js`, `.ts`, … (`.md` / office formats use dedicated kinds below)

---

## Markdown (`.md`, `.markdown`)

- `kind: 'markdown'` with raw `textSample`
- Renderer: GFM via `marked`, sanitized with DOMPurify before inject

---

## Spreadsheet (`.xls`, `.xlsx`, `.xlsm`, `.xlsb`, `.ods`; `.csv` best-effort)

- Parsed in main with SheetJS (`xlsx`); capped rows/cols/sheets for UI
- Renderer: sheet tabs + scrollable HTML table

---

## Word (`.docx`, `.doc`)

- `.docx` → HTML via `mammoth`; `.doc` → plain text via `word-extractor` then simple HTML
- `kind: 'document'`, `htmlBody` sanitized in renderer

---

## RTF (`.rtf`)

- Lightweight RTF → text/HTML in main (`kind: 'rtf'`); not a full layout engine
- Renderer reuses the HTML document preview surface

---

## Audio / video

- Inline Chromium `<video>` / `<audio>` via `mfe-media://` (`mediaUrl`)
- Video: `.mp4`, `.m4v`, `.webm`, `.mkv`, `.avi`, `.mov`, `.wmv`, `.mpg`, `.mpeg`
- Audio: `.mp3`, `.wav`, `.flac`, `.ogg`, `.m4a`, `.aac`, `.wma`, `.opus`
- Playback depends on Chromium’s codecs (H.264/AAC MP4 and WebM usually work; AVI/MPEG/WMV/many MKV often need “Open with default app”)
- On decode error: short message + open-with-default-app button

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

## Performance

- Cap JSON / prompt display length in UI (e.g. 32–64 KiB) with Copy / Reveal raw
- Parse on main process; cache preview parse result keyed by path+mtime+size until change
- Cancel in-flight preview when selection changes
