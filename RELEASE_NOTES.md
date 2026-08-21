# MyFileExplorer v0.10.0 — release notes

**Date:** 2026-08-21  
**Tag:** `v0.10.0` (package **0.10.0**)  
**Previous product baseline:** [v0.9.0](CHANGELOG.md#090---2026-08-19)

Tenth product release (**v0.10**): a **drive-only NTFS USN journal manager** (D52) plus a stability pass. Scripting, copy/move progress, preview, slideshow, and Details ADS all got the polish that showed up in daily use after 0.9.

Full detail: [CHANGELOG.md](CHANGELOG.md). Search / USN: [docs/SEARCH.md](docs/SEARCH.md). Why switch from Explorer: [docs/ADVANTAGES.md](docs/ADVANTAGES.md).

---

## Highlights

### NTFS USN journal manager (D52)

Drive Properties → **USN…** (Windows / NTFS only). View status and recent change records, enable or resize the journal (UAC when Windows requires it), and — with a loud warning — delete or clear it.

- First-time **Enable** writes then deletes a unique `testing USN *.txt` on that volume so Recent immediately shows Create + Delete.
- **Delete journal…** is not a quick toggle. Windows walks the whole volume to reset USN attributes. That can take minutes (or much longer on huge libraries) and **cannot be cancelled**. The dialog shows **Deleting…** with elapsed time.
- VeraCrypt and other mounted NTFS volumes are normal NTFS as far as the journal is concerned. Encryption does not block USN; admin permission and an in-progress delete do.
- Search **Index this drive** still does not create a journal. Use USN… if you want one; after delete, reindex that volume for incremental USN updates.

### Also in 0.10

- **Settings search** — jump to a preference without hunting tabs.
- **Preview word wrap** on text / Markdown / HTML source (off by default).
- **Properties** moveable/resizable; drive capacity as aligned size / bytes / percent.
- **Copy / move / delete** progress shows the current path and counts files (not “1 of 1” for a fat folder).
- **Details ADS / meta** fill for on-screen rows without a dummy scroll.
- **Start Slideshow** is usable on large folders again.
- Script Manager / AI generate polish (names, import `.ps1`/`.py`/`.cmd`/`.sh`, Ask AI to Fix actually applies source, Close returns to the right dialog).
- Slideshow crop steps halved (5% / 2.5% / 1% / 0.5%).

---

## Install

1. Run `MyFileExplorer-0.10.0.exe` (GitHub Release or your Updates folder).
2. Settings stay in `%APPDATA%\MyFileExplorer`.
3. Before a PC swap: **Settings → About → Export…** (includes the script library; AI keys stay on the machine).

## Upgrade notes

- Fully quit and relaunch (USN manager, preview wrap, and script UI are main/renderer — HMR is not enough).
- Scripts and Media Metadata stay **off** until you enable them (same as 0.9).
- Do not use **Delete journal…** unless you mean a full-volume USN reset.
- Re-enter remote passwords after settings import if you use remotes.
