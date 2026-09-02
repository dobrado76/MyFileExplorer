# UI design

**Version:** 0.15.0

Dark-first workbench aesthetic; light and custom themes via CSS variables. This is a **tool**, not a marketing site.

---

## Tokens

| Token                                   | Role                       |
| --------------------------------------- | -------------------------- |
| `--bg` / `--bg-elevated` / `--bg-panel` | Surfaces                   |
| `--border`                              | Hairlines, splitters       |
| `--text` / `--text-dim`                 | Primary / secondary        |
| `--accent` / `--accent-dim`             | Selection, primary actions |
| `--danger` / `--success`                | Destructive / positive     |
| `--font-family` / `--font-size`         | From settings              |

Custom theme = user-editable map of these tokens in settings.

---

## Chrome

1. **Tab bar** — default: each tab is only as wide as its title (capped ~220px, min ~90px). Settings → Appearance **Equal-width tabs** restores “all tabs match the widest label” (icon-only custom tabs stay tight and do not stretch). Overflow uses ◀ ▶ scroll (active tab stays in view; mouse wheel scrolls the strip); drag reorder; optional colored Lucide icon + title, or a custom image (label on/off, size); icon-only tabs hug the image so they work as categorizer drop bins; double-click title to rename; right-click for Duplicate / Rename / Set icon / Close; `×` close; `+` new tab; drag tab onto a view pane to assign/move it (**Ctrl+drag** duplicates so both panes can show the same path)
2. **Global bar** — **New** dropdown (folder / typed files / Other…) then Edit actions (Undo/Redo, Cut/Copy/Paste/Delete, Select all, Collapse all) on the left; trailing (right-aligned): layout 1/2/4, Search, view filter, preview, Layouts / Settings
3. **Body** — pane grid (each pane: nav + tree | files) + shared Preview (splitter); focused-pane ring only when layout is 2 or 4
4. **Status bar** — item count, selected count; during copy/move/rename/delete/trash/video-preview (and any FS wait >1 s) a progress bar (`op-progress`) — determinate when advancing, indeterminate otherwise — with current file name

### Multi-view panes (D31)

- Layout modes: single, side-by-side, wide-top + two bottom, 2×2 grid
- Focused pane gets a clear focus ring; empty panes show “Drop a tab here” plus **Open Computer** (new tab at default/home path) and **Browse…** (folder picker → open as root in that pane) — drag-tab still works
- Per-pane mini toolbar: Back / Forward / Up / Refresh / breadcrumb / view mode
- Breadcrumb: click segment to jump; **click empty address area** (or Ctrl+L) to edit the path

### Splitters

- Vertical between tree and files (per pane); between pane grid and preview
- Horizontal between pane rows when layout is 3 or 2×2; vertical between pane columns when layout is 2, 3 (bottom row), or 4
- Persist px widths, pane split ratios, + collapsed flags in `session.json`
- Minimum widths so panes don’t crush

---

## File view

- **Icons modes:** CSS grid of cells; virtualized (`@tanstack/react-virtual` or equivalent)
- **List / Details:** virtualized rows; details header clickable for sort. Horizontal overflow: one scrollbar at the **bottom of the file pane**; the header stays lined up with the rows (it does not scroll by itself).
- Selection: click, Ctrl, Shift range; marquee optional Phase 10; optional **item check boxes** (Settings → Behavior) for Ctrl-free multi-select
- Rename: F2 / context, or **Explorer two-click** (select, pause, click name → rename immediately; double-click still opens / expands)
- Focus ring for keyboard nav
- Folder tree: ↑↓ move selection; ← collapse (or select parent); → expand (or select first child). Toolbar **Collapse all** closes every expanded branch on the **current tab** (This PC default); the file list stays put until you navigate
- Folder tree drag: hover a **collapsed** folder ~2s to expand it (continue the drop into a subfolder)
- Drag ghost: selection count badge

---

## Breadcrumb

- Segments as buttons; chevrons between
- Deep paths: collapse middle into `…` menu **only when the trail overflows** available width (keep root + as much of the tail as fits)
- Trailing editable segment / address mode on Ctrl+L

---

## Preview pane

- Header: file name + type
- Body: media / text / placeholder
- Footer or side fields: metadata table (key → value), monospace for prompts. When both movie/TV details and extracted file metadata exist, **Media** / **File** tabs sit under the visualization (not over it)
- Empty state when nothing selected

---

## Dialogs

- Confirm permanent delete
- End-of-op issue review (grouped conflicts / locks / denials after copy, move, trash, delete); **In use** shows lock owners + End task (D65)
- New file type picker
- Settings (modal or route)
- Properties (detailed: drive capacity bar, folder size calc, file metadata)

Prefer compact confirm dialogs; Enter confirms when safe.

---

## Context menu

App-drawn menu (not OS full shell menu). Position clamped to viewport. Submenus flip horizontally and shift vertically (or scroll) so they stay on-screen. Keyboard: Escape closes; arrows move.

---

## Accessibility

- `aria-label` on icon buttons
- `role="tablist"` / `tab` for tabs
- Grid/list roving tabindex
- Don’t rely on color alone for selection
