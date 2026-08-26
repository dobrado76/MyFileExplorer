# Git-aware browsing (D64)

**Version:** 0.12.0 · Decision **D64**

Optional, **off by default**. When enabled in Settings → **Git**, MyFileExplorer discovers repositories via the system `git` CLI and shows lightweight status while browsing. This is a **Git-aware file manager first**, lightweight client second — not a full Git GUI.

Do **not** confuse with image ADS **Version Control** (D27).

## Architecture

- Main-process `GitService` only (`src/main/git/`).
- `child_process.spawn(gitExe, args, { shell: false })`. Always `--` before paths.
- Discovery: `git rev-parse --show-toplevel` (no manual `.git` heuristics).
- Status: one `git status --porcelain=v2 -z --branch` per repo → path map + folder aggregates.
- Listing: do **not** extend `DirEntry`; enrich via cache + FileView lookup (same pattern as notes/icons).
- Multi-pane: cache keyed by canonical repo root; toolbar follows the **active pane**.
- Network remotes (`mfe-remote://`): skipped in v1.
- Auth: system Git Credential Manager / SSH only — never store tokens.
- Temps: commit `-F` message files and HEAD blobs for external diff under `userData/git-scratch`.

## Settings (`settings.git`)

| Key | Default | Notes |
|-----|---------|--------|
| `enabled` | `false` | Master switch — no Git work when off |
| `executablePath` | `''` | Optional; else PATH / common Git for Windows paths |
| `showOverlays` / `showFolderIndicators` / `showToolbar` / `showChangedCount` / `showStatusColumn` / `showAheadBehind` | mostly `true` | Display toggles |
| `showIgnored` | `false` | Include ignored paths in status |
| `autoFetch` | `false` | Reserved; v1 does not auto-fetch |
| `refreshDebounceMs` | `400` | Watcher / invalidate debounce |
| `suspendLargeRepos` + `largeRepoFileThreshold` | off / 500k | Soft guard for huge dirty trees |
| `diffTool` | empty | External diff `{left}` `{right}` `{relativePath}` `{repoRoot}` |
| `diagnostics` | `false` | Extra logging (reserved) |

## IPC

Whitelist only (`git:*`): detect, test, discover, getStatus, refresh, stage/unstage/discard, commit, fetch/pull/push, branches, stash, showDiff, openTerminal, relativePaths, pickers.

## Context menu

Builtin **Git** submenu (hideable in Settings → Context menu): Stage, Unstage, Discard (confirm), Show changes, Copy repo-relative path, Open repository root, Open terminal at root, Refresh.

## Out of v1

Commit graph, history browser, rebase/merge editors, remotes UI, GitHub/GitLab/PR, credentials UI, submodule/worktree/LFS admin, blame/bisect, full stash manager, built-in text diff, `git:` search tokens, Power Search Git fields, Properties Git section, `reset --hard` / `clean`.

## Related

- Decision: [DECISIONS.md](DECISIONS.md) **D64**
- Plan: Git Aware Integration (phased A–G)
