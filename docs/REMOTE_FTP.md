# Remote repositories (FTP / SFTP) — deferred bonus

**Status:** Spec only — **not scheduled**, **not a v1 requirement**, **may never ship**.  
**Related deferred items:** archive-as-folder browsing; cloud-provider namespace integration ([DECISIONS.md](DECISIONS.md)).

Optional remote browse/transfer for people who still deploy or sync via FTP-class protocols (especially web hosting). The product remains a **local Windows file manager** first. This is a neat bonus, not a must.

---

## Intent

| Want | Do not want |
| ---- | ----------- |
| Bookmark a host, browse dirs, upload/download, rename/delete, mkdir | Treat remote like a local drive with full Explorer parity |
| Honest “remote mode” UX (latency, no recycle, no live watch) | Fake shell icons, Recycle Bin, NTFS search, or dir watches over the wire |
| Prefer secure protocols; clear credential storage | Store passwords in plain settings JSON |
| Same tabs / panes / progress chrome where it fits | Rewrite the whole FS stack for remote |

**Already in scope without this feature:** UNC (`\\server\share`) and mapped drive letters — those use the normal local path APIs when Windows mounts them.

---

## Protocols (when implementing)

| Protocol | Priority | Notes |
| -------- | -------- | ----- |
| **SFTP** (SSH) | Preferred first | Common on modern hosts; one TCP port; solid Node libs |
| **FTPS** (FTP over TLS) | Second | Still common on shared web hosting |
| **FTP** (cleartext) | Optional / discouraged | Allow with an explicit insecure warning; many legacy hosts still need it |

Do not promise WebDAV, rclone backends, or cloud SDKs in this doc. Those are separate deferred “cloud namespace” work if ever.

---

## Product cut (suggested MVP)

Ship only if the MVP stays small and honest:

1. **Saved connections** — host, port, protocol, username, optional remote start path, display name.
2. **Connect → tab** — address / tree / file list for that remote root (URI-ish location, not `C:\…`).
3. **Ops:** list, navigate, mkdir, rename, delete (permanent only), upload, download; status-bar progress + Cancel (reuse D28 patterns).
4. **Open / preview** — download to a scratch dir under `userData` (D2: never write app sidecars into remote trees), then open/preview like a local temp file; clear or TTL the scratch.
5. **Local ↔ remote** copy via DnD or paste when one side is remote (upload/download), with conflict handling (D18 spirit) where practical.
6. **Disconnect / offline** — tab can stay open as Offline (same spirit as D3 unmounted volumes); reconnect without losing the bookmark.

### Explicitly out of MVP (and likely forever for remotes)

- Recycle Bin / undo-trash (Del = permanent with confirm)
- Search index / Everything query over remote trees
- Live directory watches / auto-refresh beyond manual F5 (optional cheap poll later)
- Shell icons / `!VIDTHUMB_CACHE` / video remux / image-editor save-back without an explicit download→edit→upload flow
- Creating `.lnk` shortcuts on the remote
- OS drag-out (`CF_HDROP`) of remote items without a prior local download
- Treating remote paths as valid `mfe-media` sources without staging

---

## UX sketch

- Entry: Settings or toolbar → **Remote connections** (or “Connect to server…”), plus Quick access pins for saved remotes if useful.
- Location bar accepts a connection id + remote path (exact scheme TBD at implement time, e.g. `sftp://user@host/path` display form vs opaque bookmark id).
- Chrome badge or tab subtitle: **Remote** / protocol name so it never looks like a local folder.
- Context menu: curated subset only (Open, Download, Upload here, Rename, Delete, New folder, Copy path) — no Properties / Recycle / Generate thumbs / shell verbs.
- Multi-pane (D31): one pane local + one remote is the main win for web deploy workflows.

---

## Architecture notes (for a future implementer)

Today main FS code assumes **Windows absolute paths** (`normalizeAbsolute`, Win32 list, recycle, watches, media allowlist). Remotes need a thin **VFS / backend switch** behind existing IPC shapes (`fs:list`, ops, progress) — not scattered `if (ftp)` in the renderer.

Rough shape:

```
Renderer (unchanged chrome)
    → preload IPC (paths may be remote URIs or connection-scoped ids)
        → main: route by location kind
            → local: current Win32 / Node path stack
            → remote: protocol client (SFTP/FTPS/FTP) + session pool
```

- Keep credentials in **main** only (OS credential store or encrypted blob under `userData` — decide at implement time; never in renderer or session path strings).
- Cap concurrent connections; idle timeout; cancel in-flight transfers.
- Path validation still in main: no path traversal tricks in remote relative paths; normalize remote paths with POSIX rules independently of `path.win32`.
- Same Result envelope and Zod IPC style (D9).

This work is the same class as “zip as navigable folder”: a second location kind, not a tweak to `listWin32`.

---

## Security

- Prefer SFTP / FTPS; warn loudly for cleartext FTP (credentials + file bytes on the wire).
- No trust of remote filenames for local scratch paths (sanitize; resist zip-slip-style `../` when staging).
- Do not widen `mfe-media` to arbitrary remote URLs — stage under allowlisted `userData` scratch only.
- Certificate / host-key verification policy must be explicit (TOFU vs strict pin) before shipping FTPS/SFTP.

---

## Acceptance ideas (only if built)

- [ ] Save an SFTP connection, reconnect after relaunch without retyping the password (when user chose “remember”)
- [ ] Browse, upload, download with cancelable progress
- [ ] Del on remote permanently deletes with confirm; never offers Recycle Bin
- [ ] Preview opens a staged local copy; closing/cleanup does not leave junk in the remote tree
- [ ] Cleartext FTP requires an explicit insecure acknowledgment
- [ ] Local-only features are disabled or hidden in remote tabs (search index, thumbs generate, trash, etc.)

---

## Priority

**Bonus.** Implement only after core local workflows and soak feedback; skip entirely if maintenance cost outweighs demand. Updating this doc when product taste changes is enough until someone schedules real work.
