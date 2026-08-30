# Virtual Folder OS projection (D68)

**Windows-only** · Decision **D68** · Related: [VIRTUAL_FOLDERS.md](VIRTUAL_FOLDERS.md) (D67)

Optional in-place OS projection of `.mfevirtual` collections via **WinFsp**, so Explorer and other apps see members at a sibling folder path.

## Mount shape

| On disk | Role |
| --- | --- |
| `D:\root\Name.mfevirtual` | Portable JSON definition (D67) |
| `D:\root\Name` | WinFsp **directory mount** (in-place sibling) |

Linux / FUSE projection is **deferred**. D67 in-app Virtual Folders still work on Linux; Project UI and the service are win32-only.

## Service

Independent .NET process: [`tools/MfeVirtualFolderService/`](../tools/MfeVirtualFolderService/).

- Console / Windows Service host (`--console` for debug)
- Prefer **per-user** agent (directory mounts must be visible to the interactive session)
- Named pipe: `\\.\pipe\MyFileExplorer.VirtualFolderService` (camelCase JSON lines)
- Commands: `Ping`, `Status`, `Mount`, `Unmount`, `ListMounts`
- Mount registry under `%LOCALAPPDATA%\MyFileExplorer\VirtualFolderService\mounts.json`
- Requires [WinFsp](https://winfsp.dev/) installed (optional Windows feature / redistributable — respect WinFsp license)
- Without WinFsp at build time, `HAS_WINFSP` is omitted; the host still builds and answers `Ping` / `Status`

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

- **DEV-gated** until product-ready: requires `devGateActive` (otherwise Settings toggle, context verbs, and badges are omitted).
- Setting `virtualFolderOsProjectionEnabled` (default `false`) — Settings → Behavior, **win32 + DEV only**
- IPC `virtualFolderProject:status|mount|unmount|listMounts` — handlers registered **only on win32**; pipe client is dynamically imported
- Context **Project to Windows** / **Unproject** when setting is on; FileView **P** badge / Type “· Projected” when mounted
- Stem clash rules on create/rename (all platforms; wording does not mention mounts)

## Build

```bash
dotnet build tools/MfeVirtualFolderService/MfeVirtualFolderService.sln
dotnet test tools/MfeVirtualFolderService/tests/MfeVirtualFolder.Protocol.Tests
```

**Not** part of `npm run check` / Electron scripts — no .NET or WinFsp dependency for the app build. Electron never links WinFsp.
