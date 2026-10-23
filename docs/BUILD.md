# Building & releases

**Version:** 0.21.0 (tag `v0.21.0`)

The Windows installer (`MyFileExplorer-x.y.z.exe`) is typically **well over 100 MB**. GitHub rejects pushing files that large into the repo — keep `dist/` gitignored. CI does **not** use Actions artifact storage (quota); installers ship only via **GitHub Releases** on version tags.

**Primary target:** Windows. Experimental Linux AppImage packaging is documented in [LINUX.md](LINUX.md) (`npm run build:linux`). `npm run dist` / `dist:nobump` / `dist:full` are **Windows-host only**.

---

## Local

```bash
npm ci
npm run check          # typecheck + lint + test + support-doc check — same as the GitHub “Typecheck, lint, test” job
npm run dist           # bump patch, pack MyFileExplorer only → dist/
npm run dist:nobump    # same pack, no version bump
npm run dist:full      # same as dist, and republish MfeShellLauncher, mpv, and the VC++ DLLs
npm run build:win      # MyFileExplorer pack only (no version bump, no updates-folder copy)
npm run build:win:full # pack plus those side tools
```

`dist` and `build:win` reuse `tools/MfeShellLauncher/publish/MfeShellLauncher.exe`, `tools/mpv`, and `build/vc-redist` from the last full pack. They still go into the installer. GitHub’s tag build sets `CI=true`, so `npm run build:win` there still rebuilds those side tools.

`npm run check` is what the Actions job **Typecheck, lint, test** runs (including `npm run docs:support:check`). A `pre-push` hook (installed on `npm install` / `npm ci`) runs the same command for **branch** pushes so a failing lint or test never leaves the machine. Rebuild the support bundle with `npm run docs:support` before that check if you changed a bundled doc. **Tag-only** pushes skip the suite (so publishing a tag is not blocked by unrelated working-tree WIP). Skip entirely only if you must: `git push --no-verify`.

Output: `dist/MyFileExplorer-<version>.exe` (plus `.blockmap` / `latest.yml`). Older docs may say `MyFileExplorer Setup x.y.z.exe` — both names are accepted by Check for update.

In-app **Settings → About → Updates source** accepts a local installer folder **or** a GitHub Releases URL (new installs default to https://github.com/dobrado76/MyFileExplorer/releases). When an update is available, **What's new** always downloads **`RELEASE_NOTES.md`** from the online GitHub repo (version tag, then `main`) — including when the updates source is a local folder.

### `EBUSY` / `EPERM` / `app.asar` locked

Packaging replaces `dist\win-unpacked\resources\app.asar`. Electron keeps every `.asar` it has stat'd mapped until that process exits, so a file manager (or Cursor, which is also Electron) that indexed or opened that archive holds it shut. The installed app does not store the repo path. A current build reads other projects' `.asar` files as ordinary files and does not keep them open. An older build still holds whatever it already opened until you quit that process.

An exe actually started from `dist\win-unpacked` is the archive's own host. Quit that window. The Start Menu install under `%LOCALAPPDATA%\Programs\MyFileExplorer` can stay open.

`npm run build:win`, `build:win:full`, `dist`, `dist:nobump`, and `dist:full` stop processes under `dist/win-unpacked` (and a leftover `.tmp`) and retry deleting those folders before packaging. If it still fails: quit the process that has the archive open, delete `dist/win-unpacked` manually, retry.

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
| Tag `v*` (e.g. `v0.21.0`) | Check + build **three** Windows executables: `MyFileExplorer.exe` + `MfeShellLauncher.exe` (bundled in the NSIS installer) and `MfeVirtualFolderService.exe` (separate zip) → attach to a **GitHub Release** |
| **Actions → Run workflow** | Check only (no installer / Release) |
| Branch push / PR | **No** Actions run — local `pre-push` hook runs `npm run check` |

CI does not build Linux installers yet. The projection zip is optional — users also install [WinFsp](https://winfsp.dev/) separately; see [VIRTUAL_FOLDER_PROJECTION.md](VIRTUAL_FOLDER_PROJECTION.md). `MfeShellLauncher.exe` is built in CI and shipped inside the main installer (shell redirect, D72); see [WINDOWS_SHELL_REDIRECT.md](WINDOWS_SHELL_REDIRECT.md).

### Ship a build for friends

```bash
# package.json version should match the tag (e.g. 0.21.0)
git tag v0.21.0
git push origin v0.21.0
```

When the workflow finishes, download from:

`https://github.com/dobrado76/MyFileExplorer/releases/latest`

(or the README “Download Latest Executables” badge).

---

## Notes

- Windows packs stage `msvcp140.dll`, `vcruntime140.dll`, and `vcruntime140_1.dll` (`scripts/stage-vc-redist.mjs`) and ship them beside the exe and the unpacked `koffi` / `sharp` addons. `koffi.node` imports that CRT; a Windows 10 PC without the Visual C++ redistributable otherwise dies on startup with “The specified module could not be found.” The build machine must already have those DLLs (Visual Studio x64 redist, or System32).
- Installers are **unsigned**. `electron-builder.yml` sets `win.signExecutable: false` so Windows packs skip `signtool` (icon/metadata still applied). `CSC_IDENTITY_AUTO_DISCOVERY=false` is macOS-only and does **not** stop Windows signing.
- `electron-builder --publish never` — Releases are attached by Actions, not electron-builder.
- Never commit `dist/*.exe` — `dist/` is in `.gitignore` on purpose.
- No `actions/upload-artifact` — avoids Actions artifact storage quota.
