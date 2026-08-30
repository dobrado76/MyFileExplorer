# Virtual Folder OS projection (D68)

**Windows-only** · Decision **D68** · Related: [VIRTUAL_FOLDERS.md](VIRTUAL_FOLDERS.md) (D67)

Optional in-place OS projection of `.mfevirtual` collections via **WinFsp**, so Explorer and other apps see members at a sibling folder path.

## Install (end users)

Projection is **optional**. MyFileExplorer Virtual Folders work without it; enable this when you want Explorer / other apps to browse the same collection at `Name\`.

### 1. Install WinFsp

Download and install **WinFsp** from the official site:

**https://winfsp.dev/**

Restart Windows if the installer asks you to. WinFsp has its own license — MyFileExplorer does **not** bundle or redistribute it.

### 2. Install the projection service

GitHub Releases attach **`MfeVirtualFolderService-win-x64.zip`** next to the app installer.

1. Download the zip from the [latest release](https://github.com/dobrado76/MyFileExplorer/releases/latest).
2. Unzip to a permanent folder (for example `%LOCALAPPDATA%\MyFileExplorer\VirtualFolderService\`).
3. Run **`Install-ProjectionService.ps1`** (right-click → Run with PowerShell, or  
   `powershell -ExecutionPolicy Bypass -File .\Install-ProjectionService.ps1`).
4. Use an **unelevated** prompt as your normal user. **Do not** install this agent as a LocalSystem Windows Service — in-place mounts and the named pipe must run in your interactive logon session.

The script registers a per-user logon task (Task Scheduler, or HKCU Run as fallback) so the agent starts at sign-in and remounts saved mounts.

To remove: run **`Uninstall-ProjectionService.ps1`**, or  
`MfeVirtualFolderService.exe --uninstall-autostart`.

### 3. Enable in MyFileExplorer

**Settings → Behavior → Virtual Folder OS projection**

When on: create / rename / browse auto-mounts visible `.mfevirtual` docs on local disk. Context **Unproject** is a session opt-out; **Project to Windows** remounts.

### Developers (build from source)

See [`tools/MfeVirtualFolderService/README.md`](../tools/MfeVirtualFolderService/README.md) — requires .NET 8 SDK + WinFsp installed before build (`HAS_WINFSP`).

```powershell
cd tools\MfeVirtualFolderService
powershell -ExecutionPolicy Bypass -File .\install-autostart.ps1
```

## Mount shape

| On disk | Role |
| --- | --- |
| `D:\root\Name.mfevirtual` | Portable JSON definition (D67) — **Hidden** on Windows so Explorer (default) does not show it |
| `D:\root\Name` | WinFsp **directory mount** (in-place sibling) — visible in Explorer |

Linux / FUSE projection is **deferred**. D67 in-app Virtual Folders still work on Linux; Project UI and the service are win32-only.

## Service

Independent .NET process: [`tools/MfeVirtualFolderService/`](../tools/MfeVirtualFolderService/).

- **Autostart (recommended):** release zip `Install-ProjectionService.ps1`, or from source `install-autostart.ps1` / `MfeVirtualFolderService.exe --install-autostart`
- `--console` for debug; optional SCM Windows Service host remains for advanced use but is not the default install path
- Named pipe: `\\.\pipe\MyFileExplorer.VirtualFolderService` (camelCase JSON lines)
- Commands: `Ping`, `Status`, `Mount`, `Unmount`, `ListMounts`
- Mount registry under `%LOCALAPPDATA%\MyFileExplorer\VirtualFolderService\mounts.json` (remounted on agent start)
- Requires [WinFsp](https://winfsp.dev/) at runtime (loads `winfsp-msil.dll` from the WinFsp install directory)
- CI builds the service **with** WinFsp present so `HAS_WINFSP` is defined; Release zips are self-contained `win-x64`

### Limits (v1)

- **Local disk only** — UNC / network document paths are rejected by the mount coordinator (`\\` prefix).
- **Embedded groups** — listed in-process from `children` in the same JSON (directories inside the mount). **Legacy** path-based nested `.mfevirtual` files still load as nested JSON (no second mount); walks use a **visited-set** so cycles (A→B→A) do not recurse forever; cyclic edges appear empty.
- **Directory enumeration** — no short-TTL cache yet; each `ReadDirectory` rebuilds from JSON / real readdir (invalidate on document watcher reload).
- **ACLs** — the WinFsp mount runs in the interactive user session and inherits that user’s normal filesystem access to member targets. v1 does not set custom ACLs on the mount directory or pipe beyond OS defaults.

## Filesystem behavior (v1)

| Op in mount | Behavior |
| --- | --- |
| List root | Members from JSON |
| Open file | Pass-through to real target |
| Browse folder member | Live readdir of real folder |
| Embedded group | Directory listing from `children` in the same document |
| Legacy nested `.mfevirtual` | Directory listing from nested JSON (visited-set for cycles) |
| Create / mkdir at root | Denied |
| Delete at root | Remove membership only |
| Delete inside folder member | Real delete on target tree |

## MFE integration

- Setting `virtualFolderOsProjectionEnabled` (default `false`) — Settings → Behavior, **win32 only**
- **Set-and-forget when enabled:** create / rename / browse auto-mounts visible `.mfevirtual` docs; trash/delete/rename/absorb unmount first in main. Context **Unproject** is a session opt-out (auto-ensure skips until **Project**); **Project** remains as a remount/retry.
- IPC `virtualFolderProject:status|mount|unmount|listMounts` — handlers registered **only on win32**; pipe client is dynamically imported
- FileView **P** badge / Type “· Projected” when mounted
- MFE listings **hide** the sibling mount directory when `Name.mfevirtual` is present; the definition file is **Hidden** on disk so Explorer (default) mainly shows the mount folder
- Stem clash rules on create/rename (all platforms; wording does not mention mounts)

## Build

```bash
dotnet build tools/MfeVirtualFolderService/MfeVirtualFolderService.sln
dotnet test tools/MfeVirtualFolderService/tests/MfeVirtualFolder.Protocol.Tests
```

Tagged GitHub Releases also publish `MfeVirtualFolderService-win-x64.zip` (self-contained). Electron never links WinFsp; the app talks to the agent over the named pipe only.
