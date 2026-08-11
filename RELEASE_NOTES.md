# MyFileExplorer v0.5.0 — release notes

**Date:** 2026-08-11  
**Previous:** [v0.4.0](CHANGELOG.md#040---2026-08-09) (plus 0.4.x patches through 0.4.7)

Fifth product release. Focus: **slideshow / categorizer** (D37) with **compiled file lists** (D39), **NTFS Alternate Data Streams** tooling (D38), deeper previews (CHM D35, fonts D36, more archives), and Explorer-parity polish (ZIP via 7za, empty-pane open, submenu hover).

Full detail: [CHANGELOG.md](CHANGELOG.md). Why switch from Explorer: [docs/ADVANTAGES.md](docs/ADVANTAGES.md). Slideshow: [docs/SLIDESHOW.md](docs/SLIDESHOW.md). ADS: [docs/ADS.md](docs/ADS.md).

---

## Highlights

### Slideshow & compiled lists (D37 / D39)
Optional fullscreen slideshow with categorizer map, image-list cache, and **compiled `.dat` / `.txt` lists** for huge libraries — Update Lists writes ADS Index on `.dat` only; `.txt` expands from body at play; virtual playlist scales without multi‑GB path arrays.

### NTFS Alternate Data Streams (D38)
Opt-in Details column **Alternate streams**, ADS Manager dialog, and `ads:*` IPC — list / read / write / delete / copy streams without slowing every folder listing.

### Richer previews
- **`.chm`** — Contents TOC + sandboxed topic HTML (D35)  
- **`.ttf`** — in-pane font sample (D36)  
- **Archives** — list-only trees for 7z / RAR / TAR(.GZ) / APK / MSI / ISO / IMG alongside ZIP / Unity  

### Compress & workspace polish
- **Compress to ZIP** streams via bundled **7za** (real `%` progress; Cancel kills the helper)  
- Empty multi-pane slots: **Open Computer** / **Browse…** (drag-tab still works)  
- Context submenu hover delay + gap bridge (Hide from view, etc.)  
- Layout switcher is a compact toolbar dropdown; shell-icon extract stays background-queued  

---

## Install

1. Run `MyFileExplorer Setup 0.5.0.exe` (or your updates-folder installer).
2. Settings live in `%APPDATA%\MyFileExplorer` (unchanged from 0.4.x — reinstall does not wipe them).

## Upgrade notes

- Fully quit and relaunch after upgrade (new settings keys get Zod defaults).
- Slideshow UI stays **off** until Settings → Slideshow → **Enable slideshow UI**.
- Re-run **Update Lists** on compiled-list roots after upgrade if you still have old `.txt` Index ADS — play no longer reads them; only `.dat` Index matters.
- ADS column is opt-in under Details column picker (Windows / NTFS only).
