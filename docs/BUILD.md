# Building & releases

**Version:** 0.6.0

The Windows installer (`MyFileExplorer Setup x.y.z.exe`) is typically **well over 100 MB**. GitHub rejects pushing files that large into the repo — keep `dist/` gitignored. CI does **not** use Actions artifact storage (quota); installers ship only via **GitHub Releases** on version tags.

---

## Local

```bash
npm ci
npm run check
npm run build:win      # electron-vite + electron-builder → dist/
# or
npm run dist:nobump    # same idea; also syncs Settings → Updates folder if a local path is set
```

Output: `dist/MyFileExplorer Setup <version>.exe` (plus `.blockmap` / `latest.yml`).

In-app **Settings → Advanced → Updates source** accepts a local installer folder **or** a GitHub Releases URL (new installs default to https://github.com/dobrado76/MyFileExplorer/releases).

### `EBUSY` / `app.asar` locked

If the build dies with `EBUSY: resource busy or locked … app.asar`, something still has `dist/win-unpacked` open — usually a **MyFileExplorer.exe you launched from that folder** (not the installed app under `%LOCALAPPDATA%\Programs\MyFileExplorer`).

`npm run dist` / `dist:nobump` now stop processes under `dist/win-unpacked` and retry deleting that folder before packaging. If it still fails: close that window (or reboot), delete `dist/win-unpacked` manually, retry.

---

## GitHub Actions

Workflow: [`.github/workflows/build-windows.yml`](../.github/workflows/build-windows.yml)

| Trigger | What runs |
| ------- | --------- |
| Pull request / push to `main` | `npm run check` only |
| Tag `v*` (e.g. `v0.6.0`) | Check + build installer → attach to a **GitHub Release** |
| **Actions → Run workflow** | Check only (same as a main push) |

### Ship a build for friends

```bash
# package.json version should match the tag (e.g. 0.6.0)
git tag v0.6.0
git push origin v0.6.0
```

When the workflow finishes, download from:

`https://github.com/dobrado76/MyFileExplorer/releases/latest`

(or the README “Download Latest Executables” badge).

---

## Notes

- CI sets `CSC_IDENTITY_AUTO_DISCOVERY=false` (unsigned builds; no cert hang).
- `electron-builder --publish never` — Releases are attached by Actions, not electron-builder.
- Never commit `dist/*.exe` — `dist/` is in `.gitignore` on purpose.
- No `actions/upload-artifact` — avoids Actions artifact storage quota.
