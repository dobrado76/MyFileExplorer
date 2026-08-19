# MyFileExplorer v0.9.0 — release notes

**Date:** 2026-08-19  
**Tag:** `v0.9.0` (package **0.9.0**)  
**Previous product baseline:** [v0.8.0](CHANGELOG.md#080---2026-08-16)

Ninth product release (**v0.9**): an **opt-in universal local script runner** in the file manager. PowerShell, Python, cmd, and bash run against the current folder or selection with live output. Save a script once and it is a first-class command forever. Optional AI can **write** scripts; it **never reads** your files.

Also in this line: **opt-in movie/TV metadata** (D50), This PC tools from the Drives header, and a large metadata / rename / ADS polish pass.

Full detail: [CHANGELOG.md](CHANGELOG.md). Scripts: [docs/SCRIPTS.md](docs/SCRIPTS.md). Media: [docs/MEDIA_METADATA.md](docs/MEDIA_METADATA.md). Why switch from Explorer: [docs/ADVANTAGES.md](docs/ADVANTAGES.md).

---

## Highlights

### Universal script runner (D51)

Explorer stops at “open this folder in a terminal.” MyFileExplorer **is** the runner.

- **Off by default.** Settings → **Scripting and AI → Enable scripting** shows the toolbar Scripts button and context **Scripts**. Saved library under app data — no sidecars in your folders.
- **PowerShell, Python 3 (not 2.x), cmd, bash** on PATH (or Settings → Scripting and AI → Script runner overrides).
- **Folder** (`--root`) or **selection** (`--input-list` UTF-8 manifest). Recursive and dry-run when the script supports them.
- Live stdout/stderr, elapsed time, **Stop**. The run window is movable/resizable and remembers size.
- Script Manager: editor with highlighting, parameters, categories, extension / min-selection filters, import/export `.mfescript`, external file refs. Maximize for a two-column field layout and a taller editor.
- First-class **context menu** items — a saved script is as reachable as Copy or Delete.
- Destructive source is flagged. Declared deps show **Copy install command** — the app never silent-installs packages.

That is the infinite part: any job you can express in a script — reports, renames, transcodes, caption merges, folder audits — becomes a reusable verb on the current folder or selection. The file manager does not need a new feature for each job.

### Optional AI that never sees your files

Settings → **Scripting and AI** → Enable AI (off by default; requires scripting on): OpenAI-compatible providers, including LM Studio.

- Generate or modify from a **task description + source only**. No paths, listings, or file bytes.
- Model dropdown from `GET /v1/models` (cached). OpenAI catalogs hide embeddings/TTS/image.
- **Ask AI to Fix** after a failed run asks first and lists the payload. Never auto-sent.
- Saved scripts **rerun locally with zero AI calls**.

### Movie / TV metadata (D50)

Settings → Media Metadata (off by default). Extract from a local Plex server or download (TMDB / OMDb). Covers and JSON live as NTFS streams on the file or folder — no `.nfo` / `folder.jpg`. Show posters on the show folder; episode tiles can show `SxxExx`. Watched / genre toolbar. Change cover. Consolidate ripper Subs.

### Also in 0.9

- Right-click **Drives**: Computer Manager, Device Manager, Control Panel, Properties.
- Collapse all on the current tab’s folder tree.
- ADS writes restore NTFS **ChangeTime** (not just Date modified) so sync tools do not recopy a whole library.
- Thumbnail view folder icons when Media Metadata is on.
- Rename clashes use the same Skip / Keep both / Replace review as copy/move.
- Local `dist` no longer Authenticode-signs (GitHub Release builds were already unsigned).

---

## Install

1. Run `MyFileExplorer-0.9.0.exe` (GitHub Release or your Updates folder).
2. Settings stay in `%APPDATA%\MyFileExplorer`.
3. Before a PC swap: **Settings → About → Export…** (includes the script library; AI keys stay on the machine).

## Upgrade notes

- Fully quit and relaunch (scripts, AI, and media metadata are main/renderer — HMR is not enough).
- Scripts are new: open **Scripts**, write or generate one, Save, then run from the context menu. AI is optional.
- Media Metadata stays **off** until you enable it. If you already extracted on 0.8.x builds, ADS host times are now preserved on **future** writes only.
- Re-enter remote passwords after settings import if you use remotes.
