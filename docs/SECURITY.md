# Security

**Version:** 0.4.0

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

---

## Destructive actions

| Action                          | Guard                                              |
| ------------------------------- | -------------------------------------------------- |
| Trash                           | Paths must exist; basename/path validation         |
| Permanent delete                | Extra confirm for directories or multi-select (D7) |
| Move onto self / into own child | Reject                                             |
| Paste overwrite                 | User confirmation                                  |

Never delete `userData` internals via normal file UI unless user navigated there deliberately (treat like any folder — OK).

---

## Clipboard

Prefer Electron / OS APIs for file lists. Do not execute clipboard text as paths without user paste action into the address bar or paste command.

---

## Dependencies

Prefer maintained native modules; audit on upgrade. Sharp and better-sqlite3 (or equivalent) are expected natives — package with electron-builder unpack rules.
