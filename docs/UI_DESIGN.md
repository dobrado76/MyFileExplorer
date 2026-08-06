# UI design

**Version:** 0.2.0

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

1. **Tab bar** — strip with overflow; drag reorder; double-click title to rename; `×` close; `+` new tab
2. **Toolbar** — Back, Forward, Up, breadcrumb (flex), Search
3. **Body** — Tree | Files | Preview (splitters)
4. **Status bar** — item count, selected count; during copy/move/rename/delete/trash/video-preview (and any FS wait >1 s) a progress bar (`op-progress`) — determinate when advancing, indeterminate otherwise — with current file name

### Splitters

- Vertical between tree and files; between files and preview
- Persist px widths + collapsed flags in `session.json`
- Minimum widths so panes don’t crush

---

## File view

- **Icons modes:** CSS grid of cells; virtualized (`@tanstack/react-virtual` or equivalent)
- **List / Details:** virtualized rows; details header clickable for sort
- Selection: click, Ctrl, Shift range; marquee optional Phase 10
- Focus ring for keyboard nav
- Drag ghost: selection count badge

---

## Breadcrumb

- Segments as buttons; chevrons between
- Deep paths: collapse middle into `…` menu
- Trailing editable segment / address mode on Ctrl+L

---

## Preview pane

- Header: file name + type
- Body: media / text / placeholder
- Footer or side fields: metadata table (key → value), monospace for prompts
- Empty state when nothing selected

---

## Dialogs

- Confirm permanent delete
- Name conflict on paste
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
