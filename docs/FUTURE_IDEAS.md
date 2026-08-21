# Optional feature ideas (future evaluation)

**Status:** parking lot only. **Do not implement from this file.** These are candidates for later, independent evaluation — not a roadmap, not a batch spec, and not part of current v0.10.0 work.

Canonical plan: [../PLAN.md](../PLAN.md). Locked product decisions: [DECISIONS.md](DECISIONS.md). Near-term Phase 11 leftovers stay in [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md); this document is a longer-horizon list.

If one idea is chosen later, it needs its own focused plan, impact analysis, testing strategy, and scope decision **before** any code changes. Prefer a new D-number in DECISIONS.md when locking behavior.

---

## Document purpose

Ten possible features that could narrow selected capability gaps versus mature third-party file managers (for example OneCommander), while keeping MyFileExplorer’s existing product identity.

Evaluate each idea independently. Do not treat this list as “implement all of these.”

## Product constraints

Any future feature inspired by this document should preserve:

- Explorer-like tree + file list (not Miller columns or a second navigation paradigm).
- Existing tabs, panes, previews, context menus, layouts, search, and file-op workflows unless a small extension is truly required.
- No large UI refactors for optional parity.
- Extend existing concepts; do not invent parallel systems.
- Avoid duplicating something the app already mostly does.
- Discoverable but not cluttering the default chrome.
- Predictable behavior, persistent user intent, local-first, direct filesystem interaction.
- NTFS ADS is fine when useful; non-NTFS limits stay explicit.
- Windows-specific features are acceptable when they are clearly labeled (D1).
- Add one substantial feature at a time and dogfood it before starting another.

---

# 1. File Automator / batch transformation pipelines

**Not D51.** Local scripts + optional AI authoring shipped as [SCRIPTS.md](SCRIPTS.md). This item stays a separate, unevaluated pipeline composer.

## Idea

Optional batch-processing: compose several file transformations into one ordered operation. Not a visual programming environment or general automation platform. Unify existing (or simple) ops into a repeatable pipeline that can be previewed before run.

## Why it could help

The app already has Power Rename, image handling, custom commands, previews, and bulk selection. A lightweight automator could replace several manual passes.

Examples:

- Resize images, convert to JPEG at a chosen quality, rename, move to another folder.
- Convert PNG/WebP to JPEG while keeping relative names.
- Apply a rename rule, then move matches to an archive folder.
- Change dimensions and strip selected metadata.
- Run a custom command after a built-in transformation.

## Possible UX

Context menu or toolbar: **Batch Tools…** / **Automate selected files…** — modal or side panel with an ordered list of operations (drag to reorder).

Candidate blocks: Rename, convert image format, resize, rotate, strip metadata, Move, Copy, create archive, extract archive, run custom command.

Show: input count, files affected per stage, expected output names/paths, conflicts, dry-run/preview where practical.

Optional named presets (`Web Images`, `JPEG 95% + Resize 4K`, …). One-off runs must not require saving a preset.

## Scope boundary

Not a node editor, workflow engine, scheduler, or automation language. Operate on the current selection.

## Technical notes

- Partial failure: continue-then-review (D18).
- Per-stage progress; conflicts match copy/move.
- A failed stage must not silently feed later stages unexpected inputs.
- Undo where practical (rename/move); some transforms are not reversible without originals.

## Questions before implementation

- Files only, or folders too?
- Expose intermediate files?
- Custom scripts immediately, or only after built-ins mature?
- Preset export/import?
- Deliberately exclude conditionals?

## Acceptance (if ever built)

Unused: no change to existing ops. User can preview a simple multi-step workflow. Deterministic order. Conflicts/failures visible. Cancel leaves a consistent app. Large selections stay responsive.

---

# 2. Smart clipboard paste

## Idea

When the clipboard is **not** filesystem items, `Ctrl+V` could create an appropriate file in the current folder.

## Candidate types

| Clipboard | Possible behavior |
| --------- | ----------------- |
| Image / bitmap | PNG by default; optional JPEG/WebP; prompt or timestamp name |
| Plain text | `.txt` with contents; optional filename prompt |
| URL | Windows `.url` shortcut, or save URL as text; **Download linked file here** only as an explicit choice — never auto-download on paste |
| HTML / rich text | Save as HTML or plain text |

Ordinary copied files stay exactly as today. Non-file content: a sensible default, or a compact choice. A **Paste Special** submenu can expose alternatives.

## Scope boundary

Not a general downloader or content-import framework.

## Questions

- Automatic vs opt-in?
- Default image format?
- Prompt vs generated names?
- Undo for clipboard-created files?

---

# 3. New-file templates

## Idea

Extend **New** with user-defined templates: Markdown with front matter, JSON skeleton, HTML boilerplate, C# class, Python script, README, project notes, CSV with headings.

```text
New >
  Folder
  Text document
  ...
  From Template >
    Markdown Article
    C# Class
    Manage Templates...
```

Store ordinary files under `%APPDATA%\MyFileExplorer\Templates` (D2 — app state in `userData` only). Optional metadata: display name, suggested filename, category, icon, extension.

Later, simple tokens only (`{date}`, `{time}`, `{folder}`, `{counter}`) — not a templating language.

## Scope boundary

**Copy this template file here and give the copy a name.**

---

# 4. Reopen recently closed tabs

## Idea

Short history of closed tabs; restore with `Ctrl+Shift+T`.

Worth restoring (tabs already hold this): path, nav history, view/sort, selection, scroll, custom title/icon, search, tree expand, offline/missing-drive, pane association where it makes sense.

UX: `Ctrl+Shift+T`, **Tabs → Recently Closed**, tab-bar context **Reopen closed tab**.

## Scope boundary

Undo for tab close — not a general session-history browser.

---

# 5. Grouped favorites / Quick Access

## Idea

Named groups on the existing Quick Access list (D20), for example Development / AI / Media, with create/rename/delete group, move pin into group, reorder groups and pins, drag a folder onto a group, optional group icon/color.

Ungrouped favorites keep working.

## Scope boundary

Organizational containers for shortcuts — not virtual query folders.

---

# 6. Symbolic link, hard link, and junction creation

## Idea

Create Windows links from the app: file/dir symlink, file hard link, directory junction.

UX: **File Tools → Create link…** or **Paste as →** Symbolic link / Hard link / Junction. Dialog: source, type, destination, proposed name, short constraint notes.

Preview/Details could show link type, target, target availability.

## Scope boundary

Advanced filesystem utility — not an alias-management product.

---

# 7. Attached notes / lightweight to-do metadata

## Idea

Notes, status, or a small checklist on files/folders **without visible sidecars**. NTFS ADS is the natural store (see [ADS.md](ADS.md)).

Uses: “Needs review”, “Do not delete”, “Waiting for client”, “Archive after September”, a tiny folder checklist.

Fields: note text, optional status, optional checklist, last-modified.

UX: **Add note…** / **Metadata → Note…**; preview when present; optional Details columns (Note, Status, Has Note); subtle badge.

## Scope boundary

Context on filesystem objects — not project management (no deadlines, notifications, assignees, kanban, dependencies).

---

# 8. Named file view presets

## Idea

Save/reapply the **existing** view system (orthogonal to per-folder overrides D22 and named workspace layouts D25).

Examples: Development (Details + name/ext/size/modified), Photos (large thumbs + dimensions/date/rating), AI Images (thumbs + model/seed/sampler), Video (thumbs + duration/resolution/codec).

```text
View Presets >
  Development
  Photos
  Save current view as preset...
  Manage presets...
```

Preset state: view mode, icon size, columns/order/widths, sort, grouping. **Not** path, selection, scroll, or search.

## Scope boundary

Reuse the existing renderer. Not a full adaptive layout designer.

---

# 9. Colored path / folder tags

## Idea

A small color marker on files/folders (red urgent, yellow active, green done, …). Menu **Tag Color →** None / palette / Custom. Render as a dot, thin accent, and/or Details column.

Storage: NTFS ADS preferred; non-NTFS fallback is a separate decision.

Possible later: filter/search/sort by tag, named labels.

## Scope boundary

Not a DAM taxonomy.

---

# 10. First-class user script actions

**Shipped as D51** — [SCRIPTS.md](SCRIPTS.md). This parking-lot item is closed for the runner/library/AI-authoring slice. Remaining “action” ideas (icons) can be evaluated separately. The file list and folder tree refresh after a real run (not dry-run).

## Idea

A slightly more structured layer on **existing custom commands** (D41) — not a plugin SDK.

Examples: Python cleanup, image conversion, ffmpeg preset, hash selection, project PowerShell.

An action could specify: name, icon, exe/command, args, working directory, applicable types, multi-select behavior, console visibility, confirm, refresh/reveal after.

Reuse current placeholders where possible; extra tokens only if needed (`{selected}`, `{currentFolder}`, `{fileStem}`, …).

Launch: executables, `.bat`/`.cmd`, PowerShell, Python via a **user-configured** interpreter. Do not bundle extra runtimes.

## Scope boundary

**Do not** build a plugin runtime, marketplace, in-process third-party extensions, custom language, or background scheduler.

Model stays: launch the user’s command with useful filesystem context.

---

# Suggested priority (evaluation only — not a roadmap)

**Highest value / lowest disruption:** Smart clipboard paste → Reopen closed tabs → New-file templates → Grouped Quick Access → Symlink/hard link/junction.

**High value / moderate scope:** File automator → Named view presets → User script actions.

**Semantic filesystem:** Attached notes → Color tags.

---

# Explicitly not proposed

| Idea | Why not |
| ---- | ------- |
| Miller columns | Second navigation paradigm; would rewrite selection, DnD, keys, virtualization, layouts, search, a11y, panes. |
| Full adaptive view designer | Dynamic row heights, responsive fields, excerpts — huge renderer cost. Named presets cover most of the value. |
| Arbitrary multi-window workspace | Overlaps tabs, multi-pane (D31), and named layouts (D25). |
| Full plugin SDK / marketplace | User-script actions cover many workflows without binary APIs, in-process third-party code, or marketplace maintenance. |

---

# Evaluation checklist (before picking one)

1. Recurring workflow, or just more features?
2. Can it extend an existing concept?
3. Still Explorer-familiar?
4. New persistent state — how is it versioned? (D2 / settingsSchema / D45 export)
5. Data-integrity-sensitive ops?
6. Risk on very large directories?
7. Missing drives, UNC, remotes, offline tabs?
8. Windows/NTFS-only — acceptable (D1)?
9. Implement and dogfood independently?
10. Clear boundary so it does not become another product category?

The goal is not parity for its own sake. Adopt only ideas that make MyFileExplorer more useful while keeping it a predictable, Explorer-familiar file manager.
