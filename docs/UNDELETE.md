# NTFS Undelete (D74)

**Version:** 0.20.5 · **Status:** shipped · Decision **D74**

Classic MFT-based file recovery for local NTFS volumes — the same model Recuva-class utilities use: scan deleted FILE records, list candidates, write selected default `$DATA` streams to a destination folder.

Locked choice: [DECISIONS.md](DECISIONS.md) **D74**. Everyday undo (Recycle Bin / Ctrl+Z) stays [D7](DECISIONS.md) / [D23](DECISIONS.md). USN journal control is [D52](DECISIONS.md) — a different tool.

---

## At a glance

| You see | When |
| ------- | ---- |
| Tab-bar **Undelete** icon | Settings → Appearance **Show Undelete toolbar button** is on (off by default; win32) |
| Scan → filterable table | After opening the dialog and clicking **Scan** |
| Status **good** / **poor** / **unrecoverable** | From whether `$DATA` runs look readable (folders always unrecoverable in v1) |
| **Recover…** | ≥1 selected recoverable row; picks a destination folder |
| UAC prompt | When raw volume open needs elevation (short-lived child) |

**Does not** restore Recycle Bin items, carve files with destroyed MFT records, or undo SSD TRIM / overwrite. Soft-fail off Windows / non-NTFS / cancelled UAC. No context-menu entry — the toolbar icon is the only chrome.

---

## Open the dialog

1. Settings → Appearance → turn on **Show Undelete toolbar button**.
2. Click the Undelete icon on the tab bar (next to Recycle Bin when that control is visible).

Dialog geometry: `undeleteBounds` (not exported — D45). The dialog’s volume picker defaults to a local letter.

---

## Workflow

1. Confirm the volume letter (NTFS only).
2. **Scan** — reads `$MFT`, keeps records with the in-use flag clear, parses `$FILE_NAME` + unnamed `$DATA`. Progress bar + Cancel stay live (main thread yields during the walk). May prompt for administrator.
3. Filter by name or path; select rows (skip **unrecoverable** / folders for recover). Status text: deleted items found vs total MFT records scanned (most records are still in-use live files).
4. **Recover…** — choose a destination folder. Progress shows **processed** count plus **wrote / failed** (bar ≠ successful writes). Raw volume reads are sector-aligned (required on `\\.\X:`). Files recreate their MFT parent folder tree under that folder (`dest\Photos\2024\file.jpg`), not a flat dump. Incomplete parent chains use `_incomplete\…`. Unique names (`name (2).ext`) only when that path is already taken. Prefer a folder on another volume when recovering a nearly full drive.

**Cancel** aborts an in-process scan/recover; an elevated child that already started may finish writing its JSON before exit.

---

## Status meanings

| Status | Meaning |
| ------ | ------- |
| **good** | Resident data present, or non-resident runs all mapped (no sparse holes) |
| **poor** | Sparse runs or empty resident payload — partial recovery likely |
| **unrecoverable** | No `$DATA`, encrypted/compressed, directory, or no mapped runs |

v1 lists **files and folders** from deleted FILE records. Recover writes **files** only (directories show as unrecoverable — use them for path context / filtering). Named alternate streams and EFS are out of scope.

---

## Elevation

Same pattern as D52: try open `\\.\X:` in-process; on access denied, spawn a short-lived elevated helper (`--undelete-scan` / `--undelete-recover`) via UAC RunAs, exchange results through a temp JSON under `userData/undelete-scratch/`, then exit. The main app stays non-elevated.

---

## Honesty

- Best-effort after **Empty Recycle Bin**, **Shift+Del**, or permanent unlink while MFT records and clusters remain.
- Overwritten clusters, TRIM on SSDs, and reused FILE records fail recover — the UI surfaces failed tokens after Recover.
- For accidental delete while the file is still in the Recycle Bin, use **Restore** / Ctrl+Z instead of this tool.

---

## IPC

| Channel | Role |
| ------- | ---- |
| `undelete:scan` | `{ volume }` → candidates (+ `elevated`) |
| `undelete:recover` | `{ volume, tokens[], destDir }` → `{ recovered[], failed[], elevated }` |
| `undelete:cancel` | Abort in-flight scan/recover controllers |

Shapes: [IPC_CONTRACT.md](IPC_CONTRACT.md). Schemas: `src/shared/schemas/undelete.ts`.

---

## Related

- [DECISIONS.md](DECISIONS.md) **D74** · [PRODUCT_SPEC.md](PRODUCT_SPEC.md) · [SEARCH.md](SEARCH.md) (USN ≠ undelete) · [SECURITY.md](SECURITY.md)
