# Remote repositories (FTP / FTPS / SFTP)

**Version:** 0.10.0 · Decision **D46** · **Status:** shipped (opt-in; not local-drive parity)

Canonical product + engineering reference for the opt-in **Remote repositories** feature.

The product remains a **Windows-first local file manager**. Remotes are a bonus for deploy/sync workflows — not Explorer parity over the wire.

---

## Intent

| Want | Do not want |
| ---- | ----------- |
| Bookmark hosts, browse, upload/download, mkdir/rename/delete | Fake Explorer parity (Recycle Bin, shell icons, NTFS search, watches) |
| Honest remote UX (latency, permanent delete only) | Passwords in plain `settings.json` |
| Same tabs / panes / progress chrome | Rewrite the whole FS stack |
| Prefer SFTP / FTPS; allow cleartext FTP with explicit ack | WebDAV / rclone / cloud SDKs in this feature |

**Already covered without this:** UNC (`\\server\share`) and mapped drive letters — see [NETWORKS.md](NETWORKS.md).

---

## Enablement & chrome (D46)

1. **Settings → Remote repositories → Enable** (`remoteRepos.enabled`, default **false**).
2. When **off**: no remote toolbar group, no tree section, Connect refuses.
3. When **on**:
   - Toolbar group: connection **Select** dropdown + **Add / Edit / Rename / Delete / Connect / Disconnect** (icons + tooltips except Select).
   - Tree **Remote repositories** section (after Network) only if ≥1 saved connection exists.
4. Connect opens/focuses a tab at the connection start path (`mfe-remote://…`). Disconnect closes the live session; the tab can go offline like an unmounted volume.

Public test hosts (Rebex / Tele2 / Wing) are **optional presets** in Add — never auto-inserted.

**Add / Edit connection** dialog: movable/resizable modal with persisted `remoteConnectionBounds` (stripped on portable settings export), horizontal label|field rows, Cancel / Save buttons. Optional public test presets fill the form.

---

## Location scheme

Tab / listing paths use an opaque URI:

```text
mfe-remote://{connectionId}/posix/path
```

Examples:

- `mfe-remote://abc123/` — remote root
- `mfe-remote://abc123/pub/example`

Helpers: [`src/shared/remotePaths.ts`](../src/shared/remotePaths.ts). Display chrome may show connection name + protocol; the URI is the canonical location.

---

## Data

| Store | Contents |
| ----- | -------- |
| `settings.json` → `remoteRepos` | `{ enabled }` only |
| `settings.json` → `remoteConnectionBounds` | Last Add/Edit dialog geometry (null = centered defaults; not exported) |
| `userData/remote-connections.json` | Connection metadata (no passwords) |
| `userData/remote-scratch/` | Staged copies for Open / preview (`mfe-media` allowlisted) |
| Electron `safeStorage` | Password / passphrase blobs keyed by connection id |

**Settings export / import (D45):** portable JSON includes `remoteRepos.enabled` **and** the full `remoteConnections[]` metadata list (same envelope field as Network hosts). Passwords and dialog bounds are never exported; after import, edit each connection and set the password again. Bare `settings.json` import leaves the connection list unchanged.

---

## Protocols

| Protocol | Default port | Notes |
| -------- | ------------ | ----- |
| **SFTP** | 22 | Preferred (`ssh2`) |
| **FTPS** | 990 | Implicit TLS via `basic-ftp` |
| **FTP** | 21 | Requires `insecureFtpAck: true` |

**Session pool:** one live session per connection id. **FTP/FTPS:** `basic-ftp` allows only one in-flight command — all list/stat/transfer ops for that connection are **serialized**; if a prior race closed the client, reconnect and retry once. SFTP is also serialized for safety.

**TOFU:** first successful connect stores a host fingerprint on the connection; mismatch fails until the user clears/trusts via Edit.

---

## Ops (v1)

- List / navigate / F5 refresh (no live watch)
- mkdir, rename, permanent delete (confirm; never Recycle Bin)
- Upload / download / local↔remote DnD & paste (progress + Cancel); move = copy then delete when crossing local↔remote
- **Open / double-click:** stage under `userData/remote-scratch`, then Windows default app (never pass `mfe-remote://` to the OS)
- **Preview / image viewer:** same scratch staging; size/mtime from remote stat
- Multi-pane: remote tab works like any tab (still tab-backed)

### Busy feedback

Modal spinner (no dismiss) while:

- Connecting
- Opening a remote folder (list)
- Opening a remote file (stage + default app)

On failure: error text + **OK**. On success: modal closes (no extra button). Soft/background listing refreshes stay quiet.

### Out of v1 (and likely forever for remotes)

- Recycle Bin / undo-trash (Del = permanent with confirm)
- Search index / Everything query over remote trees
- Live directory watches / auto-refresh beyond manual F5
- Shell icons / `!VIDTHUMB_CACHE` / video remux / image-editor save-back without download→edit→upload
- Creating `.lnk` shortcuts on the remote
- OS drag-out (`CF_HDROP`) of remote items without a prior local download
- Treating remote paths as valid `mfe-media` sources without staging
- Recursive folder transfer (upload/download trees)
- WebDAV / rclone / cloud SDKs

---

## Architecture

```text
Renderer chrome
  → IPC (Zod)
    → main location router
        → local Win32 / Node FS
        → remote session pool (per connection id, serialized queue)
            → ssh2 | basic-ftp
            → safeStorage secrets
            → userData scratch for open/preview
```

Path validation stays in main. Remote paths use POSIX normalize independently of `path.win32`. Same Result envelope and Zod IPC style (D9).

This is the same class as “zip as navigable folder”: a second location kind, not a tweak to `listWin32`.

---

## Security

- Prefer SFTP/FTPS; warn on cleartext FTP (credentials + file bytes on the wire).
- Sanitize remote names for local scratch (no `../` slip).
- Do not widen `mfe-media` to remote URLs — stage under allowlisted `userData` only.
- Credentials never in renderer memory longer than dialog submit; never in session path strings.
- Host-key / cert policy is TOFU with stored fingerprint; mismatch requires Edit → clear fingerprint.

---

## Manual test presets

| Preset | Host | Proto | Login | Notes |
| ------ | ---- | ----- | ----- | ----- |
| Rebex | `test.rebex.net` | SFTP 22 / FTP 21 | `demo` / `password` | Read-only |
| Tele2 | `speedtest.tele2.net` | FTP 21 | `anonymous` | Upload under `upload/` |
| Wing | `demo.wftpserver.com` | FTP 21 / FTPS 990 / SFTP 2222 | `demo` / `demo` | Live demo |

---

## Acceptance

- [x] Enable off by default; enable shows toolbar; Add connection shows tree section
- [x] Save SFTP connection; reconnect after relaunch with remembered password
- [x] Browse, upload, download with cancelable progress
- [x] Del on remote = permanent confirm; no Recycle Bin
- [x] Preview / Open stage locally; no junk written onto the remote; no OS `mfe-remote://` open
- [x] Cleartext FTP requires insecure acknowledgment
- [x] FTP ops serialized (no “Client is closed… still running” on normal browse)
- [x] Settings export includes connection metadata; import restores list; passwords must be re-entered
- [ ] Local-only verbs hidden/disabled on remote tabs (ongoing polish)

