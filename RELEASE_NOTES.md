# MyFileExplorer v0.12.0 — release notes

**Date:** 2026-08-26  
**Tag:** `v0.12.0` (package **0.12.0**)  
**Previous product baseline:** [v0.11.0](CHANGELOG.md#0110---2026-08-24)

Twelfth product release (**v0.12**): optional **Git-aware browsing** (**D64**), toolbar **Quick Launch** (**D63**), global scripts as their own toolbar buttons, Recycle Bin placement, clipboard parity with Explorer, and a dogfood polish pass on search, slideshow, and preview.

Full detail: [CHANGELOG.md](CHANGELOG.md). Git guide: [docs/GIT.md](docs/GIT.md). Why switch from Explorer: [docs/ADVANTAGES.md](docs/ADVANTAGES.md).

---

## Highlights

### Git-aware browsing (D64)

**Off by default** — Settings → **Git** → Enable. Uses your installed `git` CLI (never stores credentials). While browsing a repo you get status overlays, folder indicators, an optional Details **Git status** column, and an active-pane toolbar (branch · changes · ahead/behind, Commit / Pull / Push / branch / stash). Context **Git >** covers stage, unstage, discard (with confirm), external diff (HEAD ↔ working tree), copy repo-relative path, open root / terminal, and refresh. Select the **repository root** to open a Git Graph–style history in the preview pane.

### Quick Launch (D63)

Toolbar pins for the programs you use every day. Settings → **Quick Launch** adds name, path, arguments, **icon** / **label** / **both**, and Lucide / custom / program glyph. The strip stays hidden until at least one pin exists. Click to launch; drop an `.exe` or shortcut onto the strip to add.

### Global scripts + Recycle Bin placement

- Script Manager **Global** — each global script is its own toolbar button (same face options as Quick Launch).
- Settings → Appearance **Recycle Bin**: Don’t show / Tree / Toolbar / both (default both).

### Also in this release

- **Copy/Cut ↔ Explorer** — native Win32 `CF_HDROP` so paste works both ways (including Cut → move).
- Search **Show hidden** vs view filter clarified; slideshow respects the toolbar eye; leading `!Name` search is literal.
- Slideshow **Alt** toggles full path in the title bar; large folders no longer slow play speed.
- New tab **+** sits after the last tab; Enter on images opens the folder gallery.

---

## Install

1. Run `MyFileExplorer-0.12.0.exe` (GitHub Release or your Updates folder).
2. Settings stay in `%APPDATA%\MyFileExplorer`.
3. Before a PC swap: **Settings → About → Export…** (includes the script library and templates catalog; AI keys stay on the machine).

## Upgrade notes

- Fully quit and relaunch (Git IPC and toolbar chrome need a cold start after upgrade).
- **Git**, Scripts, and Media Metadata stay **off** until you enable them. For Git: install Git for Windows or set `git.exe` under Settings → Git.
- Notes and item icons still need **local NTFS**.
- Re-enter remote passwords after settings import if you use remotes.
