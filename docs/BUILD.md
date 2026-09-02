# Building & releases

**Version:** 0.14.0 (tag `v0.14.0`)

The Windows installer (`MyFileExplorer-x.y.z.exe`) is typically **well over 100 MB**. GitHub rejects pushing files that large into the repo — keep `dist/` gitignored. CI does **not** use Actions artifact storage (quota); installers ship only via **GitHub Releases** on version tags.

**Primary target:** Windows. Experimental Linux AppImage packaging is documented in [LINUX.md](LINUX.md) (`npm run build:linux`). `npm run dist` / `dist:nobump` are **Windows-host only**.

---

## Local

```bash
npm ci
npm run check          # typecheck + lint + test — same as the GitHub “Typecheck, lint, test” job
npm run build:win      # electron-vite + electron-builder → dist/
# or
npm run dist:nobump    # same idea; also syncs Settings → Updates folder if a local path is set
```

`npm run check` is what the Actions job **Typecheck, lint, test** runs. A `pre-push` hook (installed on `npm install` / `npm ci`) runs the same command for **branch** pushes so a failing lint or test never leaves the machine. **Tag-only** pushes skip the suite (so publishing a tag is not blocked by unrelated working-tree WIP). Skip entirely only if you must: `git push --no-verify`.

Output: `dist/MyFileExplorer-<version>.exe` (plus `.blockmap` / `latest.yml`). Older docs may say `MyFileExplorer Setup x.y.z.exe` — both names are accepted by Check for update.

In-app **Settings → About → Updates source** accepts a local installer folder **or** a GitHub Releases URL (new installs default to https://github.com/dobrado76/MyFileExplorer/releases). When an update is available, **What's new** always downloads **`RELEASE_NOTES.md`** from the online GitHub repo (version tag, then `main`) — including when the updates source is a local folder.

### `EBUSY` / `app.asar` locked

If the build dies with `EBUSY: resource busy or locked … app.asar`, something still has `dist/win-unpacked` open — usually a **MyFileExplorer.exe you launched from that folder** (not the installed app under `%LOCALAPPDATA%\Programs\MyFileExplorer`).

`npm run dist` / `dist:nobump` now stop processes under `dist/win-unpacked` and retry deleting that folder before packaging. If it still fails: close that window (or reboot), delete `dist/win-unpacked` manually, retry.

### Experimental Linux

On a Linux host (Wayland-oriented helpers):

```bash
npm run build:linux    # AppImage (+ linux-unpacked)
npm run run:unpacked   # preferred launch path on many Plasma/Wayland setups
```

Details, flags, and troubleshooting: [LINUX.md](LINUX.md).

---

## GitHub Actions

Workflow: [`.github/workflows/build-windows.yml`](../.github/workflows/build-windows.yml)

| Trigger | What runs |
| ------- | --------- |
| Pull request / push to `main` | `npm run check` + Virtual Folder projection service tests (WinFsp installed in CI) |
| Tag `v*` (e.g. `v0.14.0`) | Check + build **three** Windows executables: `MyFileExplorer.exe` + `MfeShellLauncher.exe` (bundled in the NSIS installer) and `MfeVirtualFolderService.exe` (separate zip) → attach to a **GitHub Release** |
| **Actions → Run workflow** | Check only (same as a main push) |

CI does not build Linux installers yet. The projection zip is optional — users also install [WinFsp](https://winfsp.dev/) separately; see [VIRTUAL_FOLDER_PROJECTION.md](VIRTUAL_FOLDER_PROJECTION.md). `MfeShellLauncher.exe` is built in CI and shipped inside the main installer (shell redirect, D72); see [WINDOWS_SHELL_REDIRECT.md](WINDOWS_SHELL_REDIRECT.md).

### Ship a build for friends

```bash
# package.json version should match the tag (e.g. 0.14.0)
git tag v0.14.0
git push origin v0.14.0
```

When the workflow finishes, download from:

`https://github.com/dobrado76/MyFileExplorer/releases/latest`

(or the README “Download Latest Executables” badge).

---

## Notes

- Installers are **unsigned**. `electron-builder.yml` sets `win.signExecutable: false` so Windows packs skip `signtool` (icon/metadata still applied). `CSC_IDENTITY_AUTO_DISCOVERY=false` is macOS-only and does **not** stop Windows signing.
- `electron-builder --publish never` — Releases are attached by Actions, not electron-builder.
- Never commit `dist/*.exe` — `dist/` is in `.gitignore` on purpose.
- No `actions/upload-artifact` — avoids Actions artifact storage quota.
