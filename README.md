# MyFileExplorer

**v0.1.0** — Windows desktop file manager (Electron + React).

A highly functional Explorer-style app: tabs, persisted views, curated context menu, rich previews (including AI image generation metadata when present), standard file operations, and optional indexed search.

|          |                                                                                                 |
| -------- | ----------------------------------------------------------------------------------------------- |
| Platform | Windows 10/11 (primary)                                                                         |
| Stack    | Electron · electron-vite · React 19 · TypeScript · Zustand · Zod · Sharp · SQLite (node:sqlite) |
| License  | MIT                                                                                             |

## Quick start

```bash
npm install
npm run dev        # launch with HMR (same %APPDATA%\MyFileExplorer settings as installed)
npm run check      # typecheck + lint + tests
npm run build:win  # Windows installer into dist/
```

---

## Start here

1. **[PLAN.md](PLAN.md)** — canonical project plan
2. **[docs/README.md](docs/README.md)** — documentation index
3. **[docs/IMPLEMENTATION_PLAN.md](docs/IMPLEMENTATION_PLAN.md)** — build phases

Open **this folder** as the workspace. Everything needed to implement lives here.

---

## Goals

- Feel familiar like File Explorer without cloning every rarely used feature
- Fast, clear previews with type-specific metadata panels
- Multi-tab browsing with session restore
- Customizable theme (dark / light / custom) and UI font
- Dramatic search speed for folders you mark for indexing

## Non-goals (v1)

Full Explorer parity, shell-extension hosting, cloud-provider shells, macOS/Linux-first support.

---

## Scripts

| Script              | Purpose                              |
| ------------------- | ------------------------------------ |
| `npm run dev`       | Electron + HMR                       |
| `npm run check`     | typecheck + lint + test              |
| `npm run test`      | Vitest unit tests                    |
| `npm run build`     | electron-vite production build       |
| `npm run build:win` | Windows installer (electron-builder) |

---

## Documentation

See [docs/README.md](docs/README.md).
