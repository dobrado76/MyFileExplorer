# Development

End users should install a GitHub Release. This page is for people changing the application.

```bash
npm install
npm run dev          # Electron with hot reload
npm run check        # typecheck, lint, tests, support-doc check
npm run docs:support # rebuild AI-SUPPORT.md after support docs change
npm run dist:nobump  # Windows installer without bumping the version
```

- Specs live in `docs/`. Locked product decisions are `docs/DECISIONS.md`. When behavior changes, update the docs in the same change, then run `npm run docs:support` if a bundled support page changed.
- `npm run check` is what a branch `git push` runs locally, and what the tag workflow’s check job runs. Pull requests do not start GitHub Actions by themselves.
- App state for a normal dev run is still `%APPDATA%\MyFileExplorer`, the same folder as the installed app. Do not commit that folder. Do not paste `settings.json` into chats or issues.
- License for contributions: GPL-3.0. See [CONTRIBUTING.md](../CONTRIBUTING.md).
- Build, signing, and release layout: [BUILD.md](BUILD.md). Experimental Linux: [LINUX.md](LINUX.md).

Issues: https://github.com/dobrado76/MyFileExplorer/issues
