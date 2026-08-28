# Git-aware browsing (D64)

**Version:** 0.13.0 · Decision **D64**

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
| `showIgnored` | `false` | Include ignored paths in the Changes dialog. Overlays always show ignored items with an **I** badge (status always uses `--ignored=matching`) |
| `historyPageSize` | `150` | Commits per page in repo-root history and File history (20–500; Load more uses the same size) |
| `autoFetch` | `false` | Reserved; v1 does not auto-fetch |
| `refreshDebounceMs` | `400` | Watcher / invalidate debounce |
| `suspendLargeRepos` + `largeRepoFileThreshold` | off / 500k | Soft guard for huge dirty trees |
| `diffTool` | empty | External diff `{left}` `{right}` `{relativePath}` `{repoRoot}` |
| `diagnostics` | `false` | Extra logging (reserved) |

## IPC

Whitelist only (`git:*`): detect, test, discover, getStatus, refresh, stage/unstage/discard, **ignore**, commit, fetch/pull/push, branches (create may take `startPoint`), stash, **clone**, showDiff (HEAD ↔ working tree, commit vs parent, or two commits), openTerminal, relativePaths, pickers, **log**, **showCommit**, **logFile**, plus history ops: **createTag** (optional push to remote), **deleteTag** (optional delete on remote), **checkoutCommit**, **mergeCommit**, **rebaseOnto** (non-interactive), **reset** (soft/mixed/hard), **cherryPick**, **revert**.

## Context menu

Builtin **Git** submenu (hideable in Settings → Context menu): Stage, Unstage, Discard (confirm), **Gitignore** (append to repo-root `.gitignore`; tracked paths are removed from the index), Show changes, **File history…** (single file), Copy repo-relative path, Open repository root, Open terminal at root, Refresh.

**New / Add → GitHub Repository** (below From Template) opens a clone dialog (folder name + URL; URL prefills from the clipboard when it looks like a Git URL). Clashes with an existing name are blocked before clone. Requires Git integration enabled.

## Repo-root preview

When Git is enabled and the preview target is the **repository root** folder (selected, or current folder with nothing selected), the preview pane shows a Git Graph–style history: lane graph, branch/remote/tag badges, author, relative time, short hash (click to copy), and a detail strip for the selected commit. **Double-click** a row (or **Enter** when the list is focused) opens a commit detail dialog (full message, parents, file list; double-click a file for external diff). Load more pages history.

**Toolbar** (Git Extensions–inspired): refresh, branch switch/create, fetch/pull, push, commit (staged count), stash/more, open terminal, client-side filter on the loaded list. The **changes** count is clickable and opens a working-tree dialog (folder tree of dirty paths) with Stage / Unstage / Discard, Reveal, and **Show changes** (external diff tool from Settings → Git).

**Commit row context menu** (GE-inspired): Copy submenu; Merge into current branch; Rebase current branch on (non-interactive); Reset soft/mixed/hard (confirms; hard is strong); Create branch/tag here (create tag can push to origin — tags are not included in a normal branch Push); Delete tag… when the row has tag refs (optional also delete on origin); Checkout (detached); Revert; Cherry-pick; Navigate (parents/HEAD in loaded list); View (refresh / terminal). Conflicts surface via notify + status refresh — no conflict editor.

Not a full commit browser — no blame, interactive rebase, or PR UI.

## Out of v1

Built-in inline **text diff** pane, interactive rebase / Advanced rewrite, merge-conflict **resolver UI**, remotes UI, GitHub/GitLab/PR, credentials UI, submodule/worktree/LFS admin, blame/bisect, full stash manager, Archive, `git:` search tokens, Power Search Git fields, Properties Git section, `clean`.

## Related

- Decision: [DECISIONS.md](DECISIONS.md) **D64**

