# Building & CI artifacts

**Version:** 0.4.0

The Windows installer (`MyFileExplorer Setup x.y.z.exe`) is typically **well over 100 MB**. GitHub rejects pushing files that large into the repo — keep `dist/` gitignored and ship installers via CI.

---

## Local

```bash
npm ci
npm run check
npm run build:win      # electron-vite + electron-builder → dist/
# or
npm run dist:nobump    # same idea; also syncs Settings → Updates folder if set
```

Output: `dist/MyFileExplorer Setup <version>.exe` (plus `.blockmap` / `latest.yml`).

### `EBUSY` / `app.asar` locked

If the build dies with `EBUSY: resource busy or locked … app.asar`, something still has `dist/win-unpacked` open — usually a **MyFileExplorer.exe you launched from that folder** (not the installed app under `%LOCALAPPDATA%\Programs\MyFileExplorer`).

`npm run dist` / `dist:nobump` now stop processes under `dist/win-unpacked` and retry deleting that folder before packaging. If it still fails: close that window (or reboot), delete `dist/win-unpacked` manually, retry.

---

## GitHub Actions

Workflow: [`.github/workflows/build-windows.yml`](../.github/workflows/build-windows.yml)

| Trigger | What runs |
| ------- | --------- |
| Pull request | `npm run check` only (no giant artifact) |
| Push to `main` / `master` | Check + Windows installer → **Actions artifact** |
| Tag `v*` (e.g. `v0.4.0`) | Check + installer artifact + attach files to a **GitHub Release** |
| **Actions → Run workflow** | Same as a main push (manual rebuild) |

### Download for a friend (no Release tag)

1. Open the repo on GitHub → **Actions** → **Build Windows**.
2. Open the successful run for the commit you want.
3. Download **`MyFileExplorer-Setup-<version>`** under Artifacts.
4. Unzip — run `MyFileExplorer Setup <version>.exe`.

Artifacts expire after **30 days** (workflow setting). For a lasting link, push a version tag:

```bash
git tag v0.4.0
git push origin v0.4.0
```

That creates/updates a Release with the installer attached (no 100 MB git push).

---

## Notes

- CI sets `CSC_IDENTITY_AUTO_DISCOVERY=false` (unsigned builds; no cert hang).
- Never commit `dist/*.exe` — `dist/` is in `.gitignore` on purpose.
