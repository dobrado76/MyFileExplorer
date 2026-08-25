# Local scripts (D51)

**Status:** shipped in **v0.9.0**. Script Runner works with **no AI configured**. AI may **write** scripts; it **never reads** the user’s files.

MyFileExplorer is not only a browser. It is a **universal script runner** attached to whatever you are looking at. A saved script is a first-class command on the current folder or selection — as reachable as Copy or Delete. Anything you can express in PowerShell, Python, cmd, or bash becomes a reusable verb. The app does not need a new feature for each job.

Not File Automator ([FUTURE_IDEAS.md](FUTURE_IDEAS.md) item 1). Not D41 custom commands (`shell:exec` is detached, no captured stdout). Locked choice: [DECISIONS.md](DECISIONS.md) **D51**. On-disk layout: [PROJECT_FORMAT.md](PROJECT_FORMAT.md).

---

## Why this extends the app almost infinitely

A file manager’s built-in verbs are finite: copy, rename, preview, search. Real libraries need *your* jobs — statistics reports, caption concatenations, transcode queues, sidecar cleanup, audit CSVs, “move everything that matches X.”

D51 makes those jobs **native**:

| Built-in feature | Script you save once |
| ---------------- | -------------------- |
| Fixed set of commands | Any script you write, import, or generate |
| One-off terminal window | Run / Dry run / Stop with live output, from the folder you are in |
| Hidden `.bat` next to the files | Library under app data (D2) — folders stay clean |
| AI that wants your disk | Optional AI that sees **task text and source only** |
| Re-teach the computer every time | Context **Scripts >** — same script, any folder, forever |

The runner is the product. The script is the extension. Share a `.mfescript`, point at an external `.ps1` / `.py`, or generate a draft and edit it. Capabilities grow with **your** library of scripts, not with the next app release.

That is the point of v0.9: the app ships a **stable place to run code against the current view**. After that, every saved script is a new product feature you did not have to wait for.

---

## What it is / is not

| This | Not this |
| ---- | -------- |
| Saved library of local scripts, run from the toolbar or context **Scripts** | A plugin SDK or marketplace |
| Live stdout/stderr, elapsed time, Stop | A detached window you lose (`shell:exec` / D41) |
| Folder (`--root`), selection (`--input-list`), or **global** (no path args) | “Run whatever is in PATH as a shell string” |
| Optional AI that drafts / modifies / repairs **source** | An agent that browses your disk |
| Dry-run flag + first-run risk ack | Silent `pip install` or auto-elevation |
| Repeatable verbs you keep forever | File Automator / node-editor pipelines ([FUTURE_IDEAS.md](FUTURE_IDEAS.md)) |

**D41 custom commands** stay for “open this `.exe` with `{path}`” (Photoshop, VLC). Use D51 when you need **output, parameters, dry-run, cancel, or a script you will rerun in many folders**.

---

## Product rules

- Saved scripts rerun locally with **zero** AI calls.
- Generate / modify / repair send **task text and source code only** (plus OS + available runtimes + the CLI contract). Never selected names, paths, listings, or file bytes.
- Keys live in Electron `safeStorage` (`ai-secrets.json`), not `settings.json`.
- Library lives under `%APPDATA%\MyFileExplorer\scripts\` (D2) — never sidecars in browsed folders.
- Spawn is **executable + argument array** (`shell: false`). Paths with `&` or spaces are data, not a second command.
- Scripts run **as you**. They can read, change, or delete anything your Windows user can. Review source before Run.

---

## Mental model

You are always in a **folder**, and you may have a **selection**. Some jobs need neither.

1. **Folder scope** — “do this to the place I am looking at.” The runner passes `--root` (absolute path of the current tab folder) and, if you tick it, `--recursive`. Working directory is that folder.
2. **Selection scope** — “do this to what I highlighted.” Paths go in a **temp UTF-8 manifest** (one absolute path per line). The runner passes `--input-list` pointing at that file, then deletes it when the process exits. Working directory is the parent of the first selected path.
3. **Global scope** — “do this with no current folder or selection.” Tick **Global** in Script Manager (next to Min selection). Folder, Selection, Recursive, Context menu, Destructive, and Dry-run supported turn off and stay disabled; **External file** can stay on. The script appears as its own toolbar button (the strip is hidden when none exist). Choose **Show** (icon / label / both) and **Icon…** (Lucide, custom image, or External file glyph) — same idea as Quick Launch. The runner passes only optional `--dry-run` and named `--params`. Working directory is the folder that contains the script file.

A script can enable **folder, selection, or both**. **Global is exclusive** of those. Context **Scripts >** only lists folder/selection items that match:

| Filter | Effect |
| ------ | ------ |
| **Context menu** | Off = Script Manager / toolbar only |
| **Folder** scope | Empty pane or a folder selection |
| **Selection** scope | One or more selected items |
| **Extensions** | Selection of **files** only; every name must match (e.g. `jpg, png, webp`). Empty = any type |
| **Min selection** | Hide unless at least *N* items are selected (`0` = no minimum) |
| **Category** | Optional heading in the Scripts submenu |

That is how a script becomes “part of the app”: save it, leave **Context menu** on, set filters so it appears only when it makes sense (for example a caption-join script only when two or more `.txt` files are selected).

---

## CLI contract

Every script must parse **argv**, not a single shell string.

| Flag | When | Meaning |
| ---- | ---- | ------- |
| `--root <folder>` | Folder mode | Absolute folder to operate on |
| `--recursive` | Folder mode, optional | Walk subfolders (you still decide what that means) |
| `--input-list <file>` | Selection mode | UTF-8 text file, one absolute path per line (empty lines ignored) |
| `--dry-run` | Optional | Print what would change; exit 0; **do not write or delete** |
| `--<name> [value]` | When you defined parameters | See [Parameters](#parameters) |

**Folder:**

```text
script --root "D:\Photos\2026" [--recursive] [--dry-run] [--param …]
```

**Selection:**

```text
script --input-list "C:\Users\…\AppData\Local\Temp\mfe-….txt" [--dry-run] [--param …]
```

**Global:**

```text
script [--dry-run] [--param …]
```

Generate / Modify with AI uses the same target. If Target is **Global**, the model is told not to emit `--root` or `--input-list`.

Treat unknown flags as errors. Write progress to **stdout**; errors to **stderr**. Do not open a GUI prompt — the Run window is the console.

### How the app actually launches

| Language | Typical spawn (then your CLI flags) |
| -------- | ----------------------------------- |
| PowerShell | `powershell.exe -NoProfile -ExecutionPolicy Bypass -File <script.ps1>` (or `pwsh`) |
| Python | `python <script.py>` or `py -3 <script.py>` — **Python 3.x only** |
| cmd | `cmd.exe /d /s /c <script.cmd>` |
| bash | `bash <script.sh>` |

Interpreters are detected on PATH. Optional absolute overrides: **Settings → Scripting and AI → Script runner**. A missing interpreter is an error on Run, not a silent fallback to `cmd /c`.

**Python 2.x is not supported.** Generated and hand-written scripts are Python 3 (`print(…, file=sys.stderr)`, `argparse`, etc.). If Run fails with `SyntaxError` on `file=`, the machine’s `python` on PATH is 2.7 — install Python 3, or set the Script runner override to `py` / a Python 3 `python.exe`. The app does not ship a Python runtime.

PowerShell’s `param($Root)` does **not** bind `--root`. Parse `$args` (examples below). Python should use `argparse`.

---

## Parameters

In Script Manager, one line per parameter:

```text
name|type|label|required
```

- `name` — letters, then letters/digits/`_`/`-`. Becomes `--name`.
- `type` — `string`, `int`, `float`, `bool`, `file`, `folder`, or `choice`.
- `label` — shown on the Run dialog.
- `required` — `1` or `0`.

Examples:

```text
pattern|string|Name pattern|1
limit|int|Max files to list|0
recurseNames|bool|Also match folders|0
dest|folder|Output folder|0
```

At run time:

- `string` / `int` / `float` / `file` / `folder` / `choice` → `--name value` (omitted if empty and not required).
- `bool` → `--name` is passed **only when true** (no `false` token).

The Run dialog collects values before spawn. Required empty values fail validation in the app (the script never starts).

The schema allows a `choice` list; Script Manager’s line format currently stores an empty choices array. Use `string` (or validate inside the script) unless you set choices another way.

---

## Turn it on

**Settings → Scripting and AI → Enable scripting** (`scripts.enabled`, default **off**).

A first install stays a plain file manager. The toolbar Scripts button and context **Scripts** menu appear only when this is on. Interpreter overrides and optional AI live on the same settings page.

---

## Using the product

### Script Manager

Toolbar **Scripts** (manager), a global script’s toolbar button (right-click), or context **Scripts → Manage Scripts…** (only after scripting is enabled).

- Movable and resizable. **Maximize** (and the restored size) persist. Maximized uses a two-column field layout so the editor is taller.
- Every field and button has a hover tip.
- **New** — blank managed script (nothing sent to AI).
- **Generate with AI…** — optional; task text only. Target **Global** when the script must not take a folder or selection.
- **Import** / **Export** — Import a `.ps1` / `.py` / `.cmd` / `.sh` (copied into the library) or a `.mfescript` JSON export. Export writes `.mfescript`.
- Write or paste source. Set language, folder vs selection, or **Global** (next to Min selection). Global turns off Folder / Selection / Recursive / Context menu / Destructive / Dry-run; External file can stay. Parameters and dependencies still apply.
- **External file** — run a `.ps1` / `.py` / `.cmd` / `.bat` / `.sh` on disk. Hides the in-app editor (one or the other). The file is not copied into app data.
- **Save** writes `%APPDATA%\MyFileExplorer\scripts\library.json` plus `managed/<id>.<ext>`. Later runs are local. If the display name is already used, Save appends ` (2)`, ` (3)`, … (same idea as Explorer). The library list is never sent to AI.

### Run window

**Run** / **Dry run** opens the execution dialog: live stdout/stderr, elapsed time, **Stop**, copy output. Drag the title to move; drag edges to resize. Size and position are remembered. Folder runs can still toggle **Recursive** here even if the script’s default is off. **Close** on the run window returns to Script Manager (or Generate) instead of dropping you back on the file list. After a real **Run** (or Stop mid-run), the file list and folder tree refresh like F5 so created, renamed, or deleted items show up. Dry run does not refresh.

Output is capped (~400 000 characters) so a chatty walk cannot freeze the UI.

### Context menu

Right-click files, folders, or empty pane → **Scripts >**. Eligible saved items are listed (grouped by **Category**). That is how a script becomes a verb you forget is “custom.”

### First run and destructive source

The first time you run anything, acknowledge that scripts run as you and can delete files (`settings.scripts.acknowledgedRisk`).

Destructive-looking source (`Remove-Item`, `os.remove`, `rm -rf`, `del`, `shutil.rmtree`, …) shows a banner even if you did not tick **Destructive**. Tick **Destructive** yourself for overwrite-heavy jobs that the scanner might miss.

### Dependencies

Declared names (pip packages, PowerShell modules) are shown with **Copy install command**. The app **never** silently `pip install` or `Install-Module`.

---

## Use cases

These are the jobs a file manager cannot ship as one-off buttons — and the reason a script library scales.

| Job | Typical scope | Language | Notes |
| --- | ------------- | -------- | ----- |
| Inventory / audit CSV (counts, extensions, oldest/newest, total bytes) | Folder + recursive | PowerShell or Python | Write next to `--root` or to a `--dest` folder |
| “What is actually in here?” top-N largest files | Folder | PowerShell | Parameter `limit` |
| Hash selected files (SHA-256) for a manifest or compare | Selection | Python | Extensions empty; min selection `1` |
| Join selected caption / `.txt` files into one document | Selection | PowerShell | Extensions `txt`; min selection `2` |
| Report empty folders / leftover `Thumbs.db` / `desktop.ini` only | Folder + recursive | PowerShell | Dry-run first |
| Delete junk sidecars (`.tmp`, zero-byte files) | Folder or selection | Python | **Destructive** + `--dry-run` |
| ffmpeg / magick **queue** (print or run one command per video/image) | Selection | PowerShell | Extensions `mp4, mkv, mov`; depends on tools on PATH |
| List videos missing a `!VIDTHUMB_CACHE` strip | Folder + recursive | PowerShell | Complements D26 without a new app feature |
| Flatten a nest of folders, or group files by extension / year | Folder | Python | Dry-run prints planned `Move-Item` / `os.replace` |
| Duplicate basename check (same name, different folders) | Folder + recursive | Python | Report only |
| Project: run a linter / test / `git status` on the repo you are in | Folder | PowerShell or cmd | External file if the real script already lives in the repo |
| Robocopy / mirror **preview** from this folder to a backup root | Folder | PowerShell | Parameter `dest` type `folder`; always dry-run until trusted |
| A1111 / EXIF prompt dump for selected images | Selection | Python | You supply the parser; AI never sees the images |
| Media library: list files with / without ADS `media_metadata` | Folder | PowerShell | Complements D50; uses `Get-Item -Stream` |

Save each as its own library item with a **Category** (`Library`, `Photos`, `Video`, `Dev`, `Cleanup`). After a week of dogfooding, the context menu is *your* file manager.

---

## Usage examples

Paste these into Script Manager, set the metadata in each heading, **Save**, then **Dry run** or **Run** from a cheap test folder first.

All examples honor `--dry-run` and reject unknown flags.

### Shared: PowerShell argv

PowerShell does not bind `--root` to `param()`. Use a small parser:

```powershell
function Get-MfeArgs {
  $out = @{
    Root = $null
    InputList = $null
    Recursive = $false
    DryRun = $false
    Params = @{}
  }
  $i = 0
  while ($i -lt $args.Count) {
    $a = [string]$args[$i]
    switch -Regex ($a) {
      '^--root$' { $i++; $out.Root = [string]$args[$i] }
      '^--input-list$' { $i++; $out.InputList = [string]$args[$i] }
      '^--recursive$' { $out.Recursive = $true }
      '^--dry-run$' { $out.DryRun = $true }
      '^--([A-Za-z][A-Za-z0-9_-]*)$' {
        $name = $Matches[1]
        $next = if ($i + 1 -lt $args.Count) { [string]$args[$i + 1] } else { $null }
        if ($next -and $next -notlike '--*') { $i++; $out.Params[$name] = $next }
        else { $out.Params[$name] = $true }
      }
      default { throw "Unknown argument: $a" }
    }
    $i++
  }
  return $out
}

$cli = Get-MfeArgs @args
```

The examples below inline a shorter version of the same idea.

---

### 1. Folder inventory (PowerShell)

**When:** You opened a library root and want a one-page report — how many files, which extensions, how much disk.

**Script Manager**

| Field | Value |
| ----- | ----- |
| Name | Folder inventory |
| Language | PowerShell |
| Scope | Folder |
| Recursive | on (default; you can turn it off on Run) |
| Dry-run supported | off (read-only) |
| Category | Library |
| Parameters | *(none)* |

```powershell
$root = $null
$recursive = $false
$i = 0
while ($i -lt $args.Count) {
  switch ($args[$i]) {
    '--root' { $i++; $root = $args[$i] }
    '--recursive' { $recursive = $true }
    '--dry-run' { } # read-only
    default { throw "Unknown argument: $($args[$i])" }
  }
  $i++
}
if (-not $root) { throw '--root is required' }

$opt = @{ File = $true; Force = $true }
if ($recursive) { $opt.Recurse = $true }
$files = @(Get-ChildItem -LiteralPath $root @opt | Where-Object { -not $_.PSIsContainer })

$byExt = $files | Group-Object { if ($_.Extension) { $_.Extension.ToLowerInvariant() } else { '(none)' } } |
  Sort-Object Count -Descending

Write-Output "Root: $root"
Write-Output "Recursive: $recursive"
Write-Output "Files: $($files.Count)"
Write-Output ("Bytes: {0:N0}" -f (($files | Measure-Object Length -Sum).Sum))
Write-Output ''
Write-Output 'Extension  Count        Bytes'
foreach ($g in $byExt) {
  $bytes = ($g.Group | Measure-Object Length -Sum).Sum
  Write-Output ('{0,-10} {1,8} {2,16:N0}' -f $g.Name, $g.Count, $bytes)
}
```

**How to run:** Open the folder → toolbar **Scripts** → select **Folder inventory** → **Run**. Or right-click empty pane → **Scripts → Folder inventory**.

---

### 2. Largest files (PowerShell, parameterized)

**When:** “What is eating this drive?” without leaving the tab.

**Parameters**

```text
limit|int|How many files|0
```

Default in the script if `--limit` is omitted: `25`.

```powershell
$root = $null
$recursive = $false
$limit = 25
$i = 0
while ($i -lt $args.Count) {
  switch ($args[$i]) {
    '--root' { $i++; $root = $args[$i] }
    '--recursive' { $recursive = $true }
    '--dry-run' { }
    '--limit' { $i++; $limit = [int]$args[$i] }
    default { throw "Unknown argument: $($args[$i])" }
  }
  $i++
}
if (-not $root) { throw '--root is required' }
if ($limit -lt 1) { $limit = 25 }

$opt = @{ File = $true; Force = $true }
if ($recursive) { $opt.Recurse = $true }
Get-ChildItem -LiteralPath $root @opt |
  Where-Object { -not $_.PSIsContainer } |
  Sort-Object Length -Descending |
  Select-Object -First $limit |
  ForEach-Object {
    '{0,16:N0}  {1}' -f $_.Length, $_.FullName
  }
```

On Run, set **How many files** to `50` → the app passes `--limit 50`.

---

### 3. SHA-256 selected files (Python)

**When:** You selected a handful of archives or uploads and want hashes in the Run window (copy output).

**Script Manager**

| Field | Value |
| ----- | ----- |
| Name | SHA-256 selection |
| Language | Python |
| Scope | Selection |
| Extensions | *(empty)* |
| Min selection | `1` |
| Category | Verify |
| Dry-run supported | off |

```python
from __future__ import annotations

import argparse
import hashlib
from pathlib import Path


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(add_help=False)
    p.add_argument('--root')
    p.add_argument('--input-list')
    p.add_argument('--recursive', action='store_true')
    p.add_argument('--dry-run', action='store_true')
    args, unknown = p.parse_known_args()
    if unknown:
        raise SystemExit(f'Unknown argument: {unknown[0]}')
    if not args.input_list:
        raise SystemExit('--input-list is required')
    return args


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open('rb') as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b''):
            h.update(chunk)
    return h.hexdigest()


def main() -> None:
    args = parse_args()
    paths = [
        Path(line.strip())
        for line in Path(args.input_list).read_text(encoding='utf-8').splitlines()
        if line.strip()
    ]
    for path in paths:
        if not path.is_file():
            print(f'SKIP (not a file): {path}')
            continue
        print(f'{sha256(path)}  {path}')


if __name__ == '__main__':
    main()
```

**How to run:** Multi-select files → right-click → **Scripts → SHA-256 selection**. Large files hash in-process; watch the elapsed timer. **Stop** kills the Python process.

---

### 4. Join selected text files (PowerShell)

**When:** You keep per-image `.txt` captions and want one combined file for review.

**Script Manager**

| Field | Value |
| ----- | ----- |
| Name | Join text files |
| Language | PowerShell |
| Scope | Selection |
| Extensions | `txt` |
| Min selection | `2` |
| Dry-run supported | on |
| Parameters | `dest\|string\|Output file name\|0` |
| Category | Photos |

```powershell
$list = $null
$dry = $false
$destName = 'joined.txt'
$i = 0
while ($i -lt $args.Count) {
  switch ($args[$i]) {
    '--input-list' { $i++; $list = $args[$i] }
    '--dry-run' { $dry = $true }
    '--dest' { $i++; $destName = $args[$i] }
    default { throw "Unknown argument: $($args[$i])" }
  }
  $i++
}
if (-not $list) { throw '--input-list is required' }

$paths = @(Get-Content -LiteralPath $list -Encoding utf8 | Where-Object { $_.Trim() })
$dir = Split-Path -Parent $paths[0]
$out = Join-Path $dir $destName

Write-Output "Would join $($paths.Count) files -> $out"
foreach ($p in $paths) { Write-Output "  $p" }
if ($dry) { exit 0 }

$parts = foreach ($p in $paths) {
  "===== $(Split-Path -Leaf $p) ====="
  Get-Content -LiteralPath $p -Raw -Encoding utf8
  ''
}
Set-Content -LiteralPath $out -Value ($parts -join "`n") -Encoding utf8
Write-Output "Wrote $out"
```

Tick **Dry-run supported**. First click **Dry run** (prints the plan). Then **Run**. Output `joined.txt` lands next to the first selected file.

---

### 5. List (or delete) `*.tmp` junk (Python, destructive)

**When:** A render or sync left temporary files. Dry-run is the default habit.

**Script Manager**

| Field | Value |
| ----- | ----- |
| Name | Remove TMP files |
| Language | Python |
| Scope | Folder |
| Recursive | on |
| Destructive | on |
| Dry-run supported | on |
| Category | Cleanup |

```python
from __future__ import annotations

import argparse
from pathlib import Path


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(add_help=False)
    p.add_argument('--root', required=True)
    p.add_argument('--input-list')
    p.add_argument('--recursive', action='store_true')
    p.add_argument('--dry-run', action='store_true')
    args, unknown = p.parse_known_args()
    if unknown:
        raise SystemExit(f'Unknown argument: {unknown[0]}')
    return args


def main() -> None:
    args = parse_args()
    root = Path(args.root)
    pattern = '**/*.tmp' if args.recursive else '*.tmp'
    hits = sorted(p for p in root.glob(pattern) if p.is_file())
    for path in hits:
        print(('WOULD DELETE' if args.dry_run else 'DELETE'), path)
        if not args.dry_run:
            path.unlink()
    print(f'{len(hits)} file(s)')


if __name__ == '__main__':
    main()
```

Always **Dry run** on a real library first. The destructive banner will appear because of `path.unlink`.

---

### 6. ffmpeg queue for selected videos (PowerShell)

**When:** You selected a few `.mp4` / `.mkv` files and want a consistent hand-off to ffmpeg (already on PATH). This does not replace a full encoder UI — it *is* the encoder UI, for people who already have a command they trust.

**Script Manager**

| Field | Value |
| ----- | ----- |
| Name | ffmpeg CRF queue |
| Language | PowerShell |
| Scope | Selection |
| Extensions | `mp4, mkv, mov, webm` |
| Min selection | `1` |
| Dry-run supported | on |
| Dependencies | *(none — ffmpeg is an exe, not a pip package)* |
| Parameters | `crf\|int\|CRF (quality)\|0` |
| Category | Video |

```powershell
$list = $null
$dry = $false
$crf = 23
$i = 0
while ($i -lt $args.Count) {
  switch ($args[$i]) {
    '--input-list' { $i++; $list = $args[$i] }
    '--dry-run' { $dry = $true }
    '--crf' { $i++; $crf = [int]$args[$i] }
    default { throw "Unknown argument: $($args[$i])" }
  }
  $i++
}
if (-not $list) { throw '--input-list is required' }

$ffmpeg = Get-Command ffmpeg -ErrorAction SilentlyContinue
if (-not $ffmpeg) { throw 'ffmpeg was not found on PATH' }

$paths = @(Get-Content -LiteralPath $list -Encoding utf8 | Where-Object { $_.Trim() })
foreach ($src in $paths) {
  $dir = Split-Path -Parent $src
  $stem = [IO.Path]::GetFileNameWithoutExtension($src)
  $dest = Join-Path $dir ($stem + '.crf' + $crf + '.mp4')
  $line = @('ffmpeg', '-y', '-i', $src, '-c:v', 'libx264', '-crf', "$crf", '-c:a', 'copy', $dest)
  Write-Output ($line -join ' ')
  if (-not $dry) {
    & ffmpeg -y -i $src -c:v libx264 -crf $crf -c:a copy $dest
    if ($LASTEXITCODE -ne 0) { throw "ffmpeg failed on $src (exit $LASTEXITCODE)" }
  }
}
```

**Dry run** prints every command. **Run** encodes sequentially; **Stop** kills the current ffmpeg (process tree).

---

### 7. Empty-folder report (PowerShell)

**When:** After a cleanup you want leftover empty directories — report only.

```powershell
$root = $null
$recursive = $false
$i = 0
while ($i -lt $args.Count) {
  switch ($args[$i]) {
    '--root' { $i++; $root = $args[$i] }
    '--recursive' { $recursive = $true }
    '--dry-run' { }
    default { throw "Unknown argument: $($args[$i])" }
  }
  $i++
}
if (-not $root) { throw '--root is required' }

$opt = @{ Directory = $true; Force = $true }
if ($recursive) { $opt.Recurse = $true }
$empty = @(
  Get-ChildItem -LiteralPath $root @opt |
    Where-Object { -not (Get-ChildItem -LiteralPath $_.FullName -Force | Select-Object -First 1) }
)
Write-Output "$($empty.Count) empty folder(s) under $root"
$empty | ForEach-Object { $_.FullName }
```

Folder scope, recursive on, category `Cleanup`.

---

### 8. External repo script

If the real automation already lives in a project (`tools/audit.py`), do **not** paste it into app data:

1. New script → language Python → **External file** → Browse to the `.py`.
2. The file must still implement `--root` / `--input-list` (or you wrap it in a managed 10-line launcher that forwards `$args`).
3. **Revert** / managed backups do not apply to the external file — git owns that.

This is how a coding workspace and the file manager share one script without copying.

---

### 9. cmd / bash (minimal)

**cmd** (folder echo) — language **cmd**, folder scope:

```bat
@echo off
set ROOT=
:loop
if "%~1"=="" goto run
if "%~1"=="--root" (set "ROOT=%~2" & shift & shift & goto loop)
if "%~1"=="--recursive" (shift & goto loop)
if "%~1"=="--dry-run" (shift & goto loop)
echo Unknown argument: %~1 1>&2
exit /b 1
:run
if not defined ROOT (echo --root is required 1>&2 & exit /b 1)
echo Root=%ROOT%
dir /b "%ROOT%"
```

**bash** (selection line count) — language **bash**, selection scope (Git Bash / WSL `bash` on PATH):

```bash
#!/usr/bin/env bash
set -euo pipefail
LIST=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --input-list) LIST="$2"; shift 2 ;;
    --dry-run) shift ;;
    --root|--recursive) shift ;;
    *) echo "Unknown argument: $1" >&2; exit 1 ;;
  esac
done
[[ -n "$LIST" ]] || { echo "--input-list is required" >&2; exit 1; }
wc -l "$LIST"
while IFS= read -r p; do
  [[ -z "$p" ]] && continue
  echo "$p"
done < "$LIST"
```

Prefer PowerShell or Python on Windows unless you already maintain `.cmd` / `.sh` files.

---

## Suggested first library

Save these six, then grow:

1. **Folder inventory** (example 1) — every new disk.
2. **Largest files** (example 2) — before you blame “the OS.”
3. **SHA-256 selection** (example 3) — downloads and archives.
4. **Join text files** (example 4) — caption / notes folders.
5. **Remove TMP files** (example 5) — always dry-run first.
6. One **your** job (ffmpeg, robocopy preview, git status, ADS report).

Export each as `.mfescript` into a backup folder you actually sync. Settings → About **Export** also includes the whole library (source yes, API keys no).

---

## AI (optional)

Settings → **Scripting and AI** (after scripting is on):

- Enable AI (off = no outbound AI HTTP).
- Providers: OpenAI, OpenRouter, LM Studio, custom OpenAI-compatible base URL.
- **Test** / **Refresh models** uses `GET /v1/models` (no wasteful completion). The result fills a model dropdown and is cached on the provider (no keys).
- Default model, per-provider model, temperature, max tokens, preferred language. Switch providers or pick a cheaper model from the list — you do not type ids.

**Generate / Modify script with AI…** (Script Manager or context menu) — movable and resizable like Script Manager; size persists.

1. Describe the task in plain language (“CSV of extension counts under the current folder, honor --recursive and --dry-run”).
2. Review/edit source in the highlighted editor (PowerShell, Python, cmd, bash). Name and description come from the model (the Task prompt) — they appear after Generate/Modify so they are not typed and then overwritten. The file on disk is `managed/<id>.<ext>`, not the name.
3. Save. Later runs are **local** — generating again is optional. A name that already exists becomes `Name (2)` (the model is not told your library).

Also:

- Generate / Modify / Ask AI to Fix show a dialog overlay (indeterminate bar + elapsed) while waiting.
- Local vs cloud indicator. Cloud first-use copy: task/script may go to the provider; **files do not**.
- **Modify with AI…** opens this dialog with the current name, description, language, source, and folder/selection flags. **Modify** sends current source plus **Modify instruction**, or **Task** if that field is empty. **Regenerate** always uses Task (new draft).
- **Ask AI to Fix** (after a non-zero exit) asks first and lists the payload (source, exit code, stderr, OS/runtime). Optional path redaction. Never auto-sent.

Prompt ideas that work well (because the model never sees your disk):

- “Folder script: list files larger than --min-mb megabytes. Support --recursive and --dry-run (dry-run only prints).”
- “Selection script: copy selected files to --dest (folder param). Skip existing names unless --overwrite. Dry-run prints planned copies.”
- “PowerShell: report folders that contain no images (jpg/png/webp). Recursive. Read-only.”

Vague prompts (“make my photos better”) produce vague scripts. Name the CLI flags you want.

No provider → **Open AI Settings**, not a hard error on the runner. Hand-written scripts always work.

---

## Import / export

- Import a raw `.ps1` / `.py` / `.cmd` / `.bat` / `.sh` (copied into the managed library) or a `.mfescript` JSON (`format: myfileexplorer-script`). Import warns that the file is **untrusted** — read the source.
- Settings export includes the script library (source yes) and AI provider metadata (keys no). Dialog geometry is stripped.
- External file references: tick **External file** and browse to a `.ps1` / `.py` / `.cmd` / `.sh`. The in-app editor hides; Save stores the path only and does not overwrite the file.
- **Revert** restores the previous **managed** source after an AI modify (not after a normal Save, and not for external files).

Library on disk:

```text
%APPDATA%\MyFileExplorer\scripts\
  library.json
  managed\<id>.ps1 | .py | .cmd | .sh
  backups\<id>.prev
```

---

## Safety

- First-run ack: scripts run as your Windows user.
- Destructive banner from source scan and/or the **Destructive** tick.
- `--dry-run` is a convention **you** implement. The app only adds the flag and enables the button when **Dry-run supported** is on (or the source contains `--dry-run`).
- No `shell: true`. No automatic package install. No automatic UAC elevation.
- Selection manifests live in the temp directory and are deleted when the run finishes (or is cancelled).
- AI repair never fires by itself.

If a script should not be a context-menu landmine, turn **Context menu** off and run it only from Script Manager.

---

## Out of v1

Scheduler, plugin SDK, marketplace, node editor, IntelliSense/debugger, auto `pip install`, generation history, required categories, Miller columns, automatic elevation, File Automator pipelines.

---

## Related

| Doc | Why |
| --- | --- |
| [DECISIONS.md](DECISIONS.md) D51 | Locked product rules |
| [PROJECT_FORMAT.md](PROJECT_FORMAT.md) | `userData/scripts/`, settings export |
| [IPC_CONTRACT.md](IPC_CONTRACT.md) | `script:*` / `ai:*` |
| [SECURITY.md](SECURITY.md) | Path validation; scripts still run as you |
| [ADVANTAGES.md](ADVANTAGES.md) | Why this is not Explorer |
| [FUTURE_IDEAS.md](FUTURE_IDEAS.md) | File Automator stays separate |
