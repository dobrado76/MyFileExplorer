# MyFileExplorer Virtual Folder Projection Service (D68)

**Windows-only.** Optional WinFsp agent that mounts `Name.mfevirtual` in-place as `Name\`.

**End-user install (recommended):** download `MfeVirtualFolderService-win-x64.zip` from [GitHub Releases](https://github.com/dobrado76/MyFileExplorer/releases/latest) and follow **[docs/VIRTUAL_FOLDER_PROJECTION.md](../../docs/VIRTUAL_FOLDER_PROJECTION.md)** (includes the WinFsp download link).

## Prerequisites (runtime)

1. **[WinFsp](https://winfsp.dev/)** — install first; restart if prompted. Provides `winfsp-msil.dll` (loaded from the WinFsp install directory at runtime — not bundled).
2. MyFileExplorer Settings → Behavior → **Virtual Folder OS projection**.

## Prerequisites (build from source)

1. [.NET 8 SDK](https://dotnet.microsoft.com/download)
2. [WinFsp](https://winfsp.dev/) installed **before** `dotnet build` / `publish` so `HAS_WINFSP` is defined.

Without WinFsp at build time the agent still builds and answers `Ping` / `Status`, but `Mount` returns an error. Restart the agent after installing WinFsp if you built without it earlier.

## Setup once from this repo (survives reboot)

**Do not** install this as a LocalSystem Windows Service. In-place mounts and the named pipe must run in **your interactive logon session**.

One command (builds Release, then registers autostart):

```powershell
cd tools\MfeVirtualFolderService
powershell -ExecutionPolicy Bypass -File .\install-autostart.ps1
```

Or after a build, from an **unelevated** prompt as your normal user:

```bat
src\MfeVirtualFolderService\bin\Release\net8.0-windows\MfeVirtualFolderService.exe --install-autostart
```

Release zip layout uses `packaging\Install-ProjectionService.ps1` next to the published exe.

What it registers:

1. Prefer Task Scheduler `\MyFileExplorer\VirtualFolderProjection` (at logon, restart on failure)
2. If Task Scheduler denies access → `HKCU\...\Run` value `MyFileExplorerVirtualFolderProjection`

Either way the agent starts at sign-in and remounts entries from `%LOCALAPPDATA%\MyFileExplorer\VirtualFolderService\mounts.json`.

- Remove: `uninstall-autostart.ps1`, release `Uninstall-ProjectionService.ps1`, or `…\MfeVirtualFolderService.exe --uninstall-autostart`
- After rebuilding Release, run `--install-autostart` again so the path stays current

Debug without autostart:

```bat
dotnet run --project src\MfeVirtualFolderService -- --console
```

## Build / test

```bat
dotnet build tools\MfeVirtualFolderService\MfeVirtualFolderService.sln
dotnet test tools\MfeVirtualFolderService\tests\MfeVirtualFolder.Protocol.Tests
```

CI (`Build Windows` workflow) installs WinFsp, runs these tests, and on version tags publishes a self-contained `MfeVirtualFolderService-win-x64.zip`.

Named pipe: `\\.\pipe\MyFileExplorer.VirtualFolderService` (one camelCase JSON line per request/response).

Example request:

```json
{"cmd":"mount","documentPath":"D:\\Collections\\Work.mfevirtual"}
```

Host mode is **per-user** (logon task or `--console`). Mount registry: `%LOCALAPPDATA%\MyFileExplorer\VirtualFolderService\mounts.json`.

## Limits (v1)

- **Local paths only** — UNC documents (`\\server\share\…`) are rejected.
- **Nested Virtual Folders** — browsed in-process from nested JSON; cycles use a visited-set (cyclic edge → empty listing).
- **No dir-enum cache** yet — see comments in `WinFspMountBackend.ReadDirectory`.

## License

WinFsp has its own license — do not bundle/redistribute without reviewing https://winfsp.dev/ and complying with its terms. This service is an optional MyFileExplorer component.
