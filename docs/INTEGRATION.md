# Integrating with MyFileExplorer

**Version:** 0.12.0

Other apps can “Reveal in Explorer” / open a folder **inside MyFileExplorer** instead of launching Windows File Explorer. A single running instance is reused; each request opens or focuses a **tab**.

---

## Ways to call it

### 1. Command line (recommended)

```text
MyFileExplorer.exe --reveal "D:\Projects\shot.png"
MyFileExplorer.exe --open "D:\Projects"
MyFileExplorer.exe "D:\Projects\shot.png"
```

| Form | Behavior |
| ---- | -------- |
| `--reveal <path>` / `-r` | Folder → new/focus tab on that folder. File → tab on parent folder **and select the file**. |
| `--open <path>` / `-o` | Open path as a folder tab (files open their parent, no selection). |
| Bare absolute path | Same as `--reveal`. |

If MyFileExplorer is already running, the second process exits immediately and the first window focuses and handles the path.

**Installed path (typical):**

```text
%LOCALAPPDATA%\Programs\MyFileExplorer\MyFileExplorer.exe
```

**PowerShell example from another app:**

```powershell
$exe = Join-Path $env:LOCALAPPDATA "Programs\MyFileExplorer\MyFileExplorer.exe"
Start-Process -FilePath $exe -ArgumentList @('--reveal', $fullPath)
```

**Node / Electron example:**

```js
import { spawn } from 'node:child_process'
import { join } from 'node:path'

const exe = join(process.env.LOCALAPPDATA, 'Programs', 'MyFileExplorer', 'MyFileExplorer.exe')
spawn(exe, ['--reveal', targetPath], { detached: true, stdio: 'ignore' }).unref()
```

### 2. Custom URL protocol `mfe://`

Registered on install / first run (`electron-builder` `protocols` + `setAsDefaultProtocolClient`).

```text
mfe://reveal?path=D%3A%5CProjects%5Cshot.png
mfe://open?path=D%3A%5CProjects
```

`path` must be absolute and URL-encoded.

```powershell
Start-Process "mfe://reveal?path=$([uri]::EscapeDataString($fullPath))"
```

---

## Behavior notes

- Paths are validated/normalized in the main process (absolute only).
- Reuses an existing **unscoped** tab already showing that folder when possible; otherwise opens a new tab.
- Scoped tabs (“Open as root in new tab”) are not reused for external opens.
- Requests that arrive before the UI finishes booting are queued and applied afterward.

---

## Dev mode

```text
npm run dev -- --reveal "D:\some\file.txt"
```

Protocol registration in dev points at the Electron binary + app entry; prefer CLI args while developing.
