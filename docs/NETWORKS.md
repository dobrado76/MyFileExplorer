# Network neighborhood & mapped drives (D44 / D3)

**Version:** 0.10.0 · Decisions **D3**, **D44**, **D45**, **D49**

MyFileExplorer aims to replace Windows File Explorer for day-to-day LAN and mapped-drive work: browse `\\server` / shares, keep disconnected mapped letters visible, reconnect without opening Explorer, and rediscover PCs without a permanent “discovering…” spinner.

Related: [PRODUCT_SPEC.md](PRODUCT_SPEC.md) · [DECISIONS.md](DECISIONS.md) · [IPC_CONTRACT.md](IPC_CONTRACT.md) · [PROJECT_FORMAT.md](PROJECT_FORMAT.md) · settings export in Advanced (D45).

---

## What you see

### Drives (mapped letters)

- Live mounts appear under the tree **Drives** section (USB eject removes the letter immediately).
- **Mapped network letters** stay listed when disconnected (Explorer red-X / “Disconnected” style): label shows UNC + `(Disconnected)`, dimmed row.
- Sources: `GetLogicalDriveStrings` + `GetDriveType` + `HKCU\Network` for RemotePath. **Does not** call `WNetGetConnection` / `GetVolumeInformation` on network letters during the drive list (those block Electron main for many seconds on a disconnected map and freeze icons/UI). Reconnect still uses WNet when you open a disconnected letter.
- Opening a disconnected letter (or any path on that letter, or Offline **Retry now**) reconnects via **`WNetAddConnection2W`** (Explorer click-to-reconnect parity). Credentials → interactive **`WNetUseConnectionW`**. `WNetRestoreConnectionW` is **not** relied on — often missing from `mpr.dll`.
- Successful reconnect clears Offline on the tab and refreshes the Drives list (drops “(Disconnected)”).
- **Disconnect / forget:** right-click a mapped letter (connected or disconnected) → **Disconnect N:…** / **Disconnect N: (forget mapping)…**. Uses **`WNetCancelConnection2W`** with **`CONNECT_UPDATE_PROFILE`** so the persistent “Reconnect at sign-in” mapping is removed and the letter leaves the tree. If files are open, you can force disconnect. Section-header **Disconnect network drive…** still opens the system multi-drive picker.

### Network (LAN hosts)

- Tree section **Network** appears below Drives only when at least one **reachable** host is listed.
- Unlike mapped letters, **offline Network computers are not shown** — remembered names are probe targets only until TCP 445 / shares answer.
- This PC is omitted by default; enable **Settings → Network → Show local computer NAME** to include it when reachable.
- Hosts show as uppercase NetBIOS-style labels when appropriate (`NEWONYX`), with UNC `\\HOST`.
- Expand a host → disk shares as folders (`NetShareEnum`; admin `$` shares hidden by default).
- Address bar / navigation accepts UNC like Explorer: `\\server`, `\\server\share`, deeper paths.
- Bare `\\server` lists shares as directory entries (not a real filesystem directory).

### Context menu

| Where | Actions |
| ----- | ------- |
| Network section header | Map network drive… · Disconnect… · Refresh Network |
| Drives section header | Computer Manager · Device Manager · Control Panel · Map… · Disconnect… · Properties (This PC) |
| Host / share folder | Map… · Refresh shares (host) · Open in new tab · … |
| Folder (tree / list / empty pane) | **Open Command Line here** (cmd or PowerShell from Settings; **Shift+click** = Administrator) |

Map / Disconnect open the native Windows WNet dialogs.

---

## Discovery pipeline

Discovery never blocks folder listing or IPC. It runs in a **worker thread**.

1. **Seed probes** — load remembered names from `userData/network-hosts.json` (not shown yet). Local PC filtered unless `showLocalComputer`.
2. **Probe remembered** — TCP **445** gate + `NetShareEnum`; only hosts that answer are added to the tree.
3. **Find more** — Shell Network neighborhood (PowerShell) + ARP with 445 gate (≈ **20s budget** per pass).
4. **Skip** legacy `NetServerEnum` (often ~50s then empty without SMBv1 Computer Browser).

The **Network** tree section appears only for reachable hosts (respecting the local-computer toggle). During rediscovery, the previous online list is kept until the first verified update (empty running payload). When the section is visible, the header may show **discovering…** while `status === 'running'`.

### When discovery runs

| Trigger | Behavior |
| ------- | -------- |
| App launch | Always one pass (remembered names probed; tree fills as hosts answer) |
| F5 / Ctrl+R | Rediscover + clear cached share lists |
| Context **Refresh Network** / Settings **Discover now** | Same |
| Settings → Network → **Automatic** | Extra passes on a timer (default **every 5 minutes**, clamp 1–60) |
| Settings → Network → **Manual** | Launch + explicit refresh only |

While a pass is already running, the auto timer skips stacking another.

### Startup

Shell paints as soon as settings/session load. **Drives**, pane listings, and the first Network discovery pass refresh **in the background** (discovery starts ~400ms after listings begin so it does not compete with the first `fs:list`). Drive list polling is every **10s**.

### Remembered hosts

- Opening `\\server` or listing shares **remembers** the host (for faster probes next time).
- Persisted in `network-hosts.json` (capped); collapsed IP ↔ hostname aliases where possible.
- Remembered ≠ visible: a name stays in the file when offline, but the tree only lists hosts that answered on the latest discovery pass.
- Included in **Settings → About → Export settings** (D45). Import replaces the remembered list when the export envelope contains `networkHosts`.

---

## Settings → Network

| Control | Meaning |
| ------- | ------- |
| Discovery mode | **Automatic** (timed) or **Manual only** |
| Auto refresh every (minutes) | 1–60; default **5** (Automatic only) |
| Enable network discovery | Master switch (default **on**). Off = no LAN discovery; mapped drives unchanged |
| Show local computer NAME | Include this PC under Network (default **off**) |
| Discover now | Start a pass immediately |
| Map network drive… / Disconnect… | Native WNet dialogs |

Prefs live in `settings.networkDiscovery`: `{ enabled, mode, intervalMinutes, showLocalComputer }` (defaults: true / auto / 5 / false). New fields on this object are included in **Export / Import settings** (D45) automatically because export serializes the full `settingsSchema` document.

---

## Offline tabs & mapped drives (D3)

- Tabs whose path is unreachable (unmounted BitLocker, network not ready, disconnected map) stay **Offline** and poll / retry — they are **not** closed.
- Offline UI: title, path, hint, **Retry now** (also triggers mapped-drive restore when applicable).
- Tree Drives poll (~3s) keeps live mount / disconnected labels in sync; Offline-tab retry is separate (~8s).
- To **remove a forever-dead mapping**, disconnect the letter from the tree (see above). Offline tabs for that path remain until you close them; they will not come back as a ghost drive.

---

## Listing memory cache (D49)

Re-opening a NAS / UNC / mapped / `mfe-remote://` folder used to wait on a full `fs:list` every time (often ~2 s). Explorer feels faster on the second visit because the shell already has the directory in memory.

MyFileExplorer does the same **in the renderer only**, session-scoped:

- Paint the last listing immediately, then refresh from the network in the background.
- Cap ~24 folders; skip listings larger than 20 000 entries.
- Drop the snapshot on **F5**, our own create/rename/delete/move, and `fs-changed` when that folder is watched.
- **Not** local NTFS. **Not** written to disk. **Not** used to skip the background revalidate.

---

## UNC path rules (main)

- Paths are validated/normalized in main before IO. UNC-aware normalize must **not** turn `\\server` into `\server` (Node `path.normalize` pitfall).
- `NetShareEnum` takes a **bare** server name with `str16` structs (koffi `void*` AV risk avoided).
- Media protocol allowlist still applies after successful list.

---

## IPC & events

| Channel / event | Role |
| --------------- | ---- |
| `network:startDiscovery` | Start async discovery; returns `{ generation }` |
| `network:listShares` | `{ server }` → share list |
| `network:mapDriveDialog` / `disconnectDriveDialog` | Native dialogs |
| `network:disconnectMappedDrive` | `{ path, force? }` — cancel + forget one letter |
| `mfe-event` `network-discovery` | `{ generation, status, hosts?, message? }` progress / result |
| `fs:listDrives` | DriveInfo including `offline`, `remotePath` |
| `fs:list` | On drive-letter paths, attempts mapped reconnect first |
| `shell:openCommandLine` | `{ path, elevated? }` — cmd or PowerShell (`commandLineShell`); `elevated` = UAC |

Schemas: `src/shared/schemas/network.ts`, `networkDiscovery.ts`, `networkPaths.ts`.

---

## Persistence (userData)

| File | Contents |
| ---- | -------- |
| `network-hosts.json` | Remembered LAN hosts |
| `settings.json` → `networkDiscovery` | Auto/manual + interval + showLocalComputer |
| `settings.json` → export envelope | Portable backup includes hosts (not window geometry) |

Not exported: `window-state.json`, live `session.json` tabs (use a **named layout** to move a workspace).

---

## Non-goals / soft-fail

- No SMBv1 Computer Browser dependency.
- Empty LAN / only this PC → Network section stays hidden (no flash then disappear).
- Bare `\\server` is not a shell cwd for **Open Command Line** (item hidden for host-only UNC).
- Cloud provider namespaces / remote FTP are out of scope here — remotes are [REMOTE_FTP.md](REMOTE_FTP.md) (D46).

---

## Manual test checklist

1. Cold start with known LAN PCs — Network section appears as hosts answer (not before); offline remembered names stay hidden; “discovering…” clears when the pass finishes. Cold start with no remotes — Network section stays hidden.
2. Settings → Network → Manual — no timed rediscovery; F5 still rediscovers.
3. Automatic + 1 minute — at most one brief discovering pass per interval.
4. Disconnect a mapped letter (or reboot before VPN) — letter stays under Drives as Disconnected; click reconnects **without** opening Explorer; contents list; label loses “(Disconnected)”.
5. Right-click a forever-dead Disconnected letter → **Disconnect N: (forget mapping)…** — confirm; letter disappears from Drives; no longer in `HKCU\Network`.
6. Address bar `\\HOST` → share folders; expand host in tree → same shares.
7. Network header → Map / Disconnect dialogs open.
8. Export settings on PC A → import on PC B → remembered hosts + discovery prefs restored.
