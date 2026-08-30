# MyFileExplorer Virtual Folder Projection Service (D68)

**Windows-only.** Optional WinFsp agent that mounts `Name.mfevirtual` in-place as `Name\`.

## Prerequisites

1. [.NET 8 SDK](https://dotnet.microsoft.com/download)
2. [WinFsp](https://winfsp.dev/) installed (provides `winfsp-msil.dll`). Rebuild after installing so `HAS_WINFSP` is defined.

Without WinFsp the agent still builds and answers `Ping` / `Status`, but `Mount` returns an error.

At runtime the agent loads `winfsp-msil.dll` from the WinFsp install directory (not copied into the build output). Restart the agent after installing WinFsp.

## Build / run

```bat
dotnet build tools\MfeVirtualFolderService\MfeVirtualFolderService.sln
dotnet test tools\MfeVirtualFolderService\tests\MfeVirtualFolder.Protocol.Tests
dotnet run --project tools\MfeVirtualFolderService\src\MfeVirtualFolderService -- --console
```

Not required for MyFileExplorer `npm run check` / Electron packaging.

Named pipe: `\\.\pipe\MyFileExplorer.VirtualFolderService` (one camelCase JSON line per request/response).

Example request:

```json
{"cmd":"mount","documentPath":"D:\\Collections\\Work.mfevirtual"}
```

Host mode is **per-user** (not LocalSystem) so directory mounts are visible in the interactive session.

## Limits (v1)

- **Local paths only** — UNC documents (`\\server\share\…`) are rejected.
- **Nested Virtual Folders** — browsed in-process from nested JSON; cycles use a visited-set (cyclic edge → empty listing).
- **No dir-enum cache** yet — see comments in `WinFspMountBackend.ReadDirectory`.

## License

WinFsp has its own license — do not bundle/redistribute without reviewing https://winfsp.dev/ and complying with its terms. This service is an optional MyFileExplorer component.
