# Security

**Version:** 0.9.0

---

## Process hardening

- `contextIsolation: true`
- `nodeIntegration: false`
- `sandbox: true` on BrowserWindow (preferred)
- No remote module
- Preload is the only bridge; whitelist IPC channels

---

## Path rules

- Normalize and resolve paths in **main** before any IO
- Reject path segments that escape intended roots for protocol serving
- Symlinks: `stat` carefully; do not follow symlinks out of allowlisted roots for **protocol** reads without explicit policy (v1: resolve realpath and re-check allowlist)
- UNC paths allowed when user navigates to them; still validated as absolute

---

## Media protocol

Renderer must not read arbitrary files via `file://`. Use `mfe-media://` (name TBD) with main-side allowlist:

- Paths under currently open tab directories (and parents as needed for icons)
- Explicit preview target
- Thumb cache directory inside userData

**Media metadata (D50)** writes NTFS streams on the **user-selected** file/folder (and its parent container flag) only after a context-menu or preview action. Paths go through `requireAbsolute` like other FS IPC. See [MEDIA_METADATA.md](MEDIA_METADATA.md).

---

## Destructive actions

| Action                          | Guard                                              |
| ------------------------------- | -------------------------------------------------- |
| Trash                           | Paths must exist; basename/path validation         |
| Permanent delete                | Extra confirm for directories or multi-select (D7) |
| Move onto self / into own child | Reject                                             |
| Paste overwrite                 | User confirmation                                  |

Never delete `userData` internals via normal file UI unless user navigated there deliberately (treat like any folder — OK).

**Scripts (D51):** chrome is off until Settings → Scripting and AI → Enable scripting. Spawned as exe + argv (`shell: false`). Paths in `--root` / `--input-list` are `requireAbsolute`. AI HTTP is off unless Enable AI is on; generate/modify/fix never include user paths, listings, or file bytes. API keys use `safeStorage`. See [SCRIPTS.md](SCRIPTS.md).

---

## Clipboard

Prefer Electron / OS APIs for file lists. Do not execute clipboard text as paths without user paste action into the address bar or paste command.

---

## Dependencies

Prefer maintained native modules; audit on upgrade. Sharp and better-sqlite3 (or equivalent) are expected natives — package with electron-builder unpack rules.
