# Power Rename (D40)

**Status:** shipped · Decision **D40** · Inspired by [PowerToys PowerRename](https://learn.microsoft.com/en-us/windows/powertoys/powerrename) and [Bulk Rename Utility](https://www.bulkrenameutility.co.uk/) panels

Batch-rename the **current selection** (files and/or folders) with a live preview. The dialog always shows a simple Search / Replace strip (PowerToys-style). Collapsible **Advanced options** add Bulk Rename Utility–style panels for case, remove, numbering, dates, and more — without leaving MyFileExplorer.

Locked choice: [DECISIONS.md](DECISIONS.md) **D40**. Name conflicts use the bulk-op review ([D18](DECISIONS.md)). Session undo: [D23](DECISIONS.md).

---

## At a glance

| You see | When |
| ------- | ---- |
| Context **Power Rename…** | One or more selected local files and/or folders |
| Live preview (old → new) | As soon as any rule would change a name |
| Per-row checkboxes | Include / skip items before **Apply** |
| **Advanced options** | Collapsed by default; badge shows how many panels are active |
| Dialog **Undo** | After a successful Apply in this dialog session |
| Ctrl+Z / Ctrl+Y | Session undo stack (`power-rename` entry) |

**Does not** recurse into selected folders, copy/move to a new location, or change file timestamps. Remotes follow the same rename path as F2 when supported by the location.

---

## Open the dialog

1. Select one or more items in the file view (or a folder in the tree where the menu offers it).
2. Right-click → **Power Rename…** (builtin `power-rename`; hideable under Settings → Context menu).

The dialog is resizable / maximizable; size is remembered in settings geometry (`powerRenameBounds`, not exported — D45).

---

## Layout

```
┌─ Controls ─────────────────────┬─ Preview ─────────────────────┐
│ Search for / Replace with      │ ☐ Check all / Uncheck all     │
│ ☐ Regex · Match all · Case     │ old name  →  new name         │
│ Apply to: name / ext / full    │ …                             │
│ ▸ Advanced options  [N active] │                               │
│   (panels 2, 4–12 when open)   │                               │
└────────────────────────────────┴───────────────────────────────┘
                    [ Undo ]  [ Close ]  [ Apply ]
```

- **Apply** is enabled when at least one checked, non-excluded row would rename.
- Empty **Search for** is fine if Advanced options alone change names (e.g. numbering only).
- After Apply, paths update in the dialog so you can chain another pass. Dialog **Undo** reverses the last Apply.

---

## Simple controls (always visible)

### Search for / Replace with

| Mode | How Search works | How Replace works |
| ---- | ---------------- | ----------------- |
| **Regex off** (default) | **DOS wildcards:** `*` = any run of characters (including empty); `?` = exactly one character. All other characters are literal (dots, `+`, `(`, etc.). | Literal text inserted for each match. No `$1` groups. |
| **Regex on** | JavaScript `RegExp` pattern. `*` / `?` keep regex meaning. | Replacement string; capture groups `$1`, `$2`, … |

Examples (regex **off**):

| Search | Matches | Notes |
| ------ | ------- | ----- |
| `vacation` | substring `vacation` | Same as a plain find |
| `*.jpg` | names ending in `.jpg` (when Apply to includes that text) | `*` → any prefix |
| `photo??.jpg` | `photo12.jpg`, not `photo1.jpg` | each `?` is one character |
| `file.v1` | only the literal `file.v1` | `.` is **not** “any character” |

### Match all occurrences

- **Off:** only the first match in the target segment is replaced.
- **On:** every match in the segment is replaced (`g` flag).

### Case sensitive

- **Off:** matching ignores case.
- **On:** exact case required.

### Apply to

Controls **only** which part of the basename the Search/Replace step touches. Advanced stem panels still run on the filename stem afterward; Extension (11) always runs last on the extension.

| Value | Search/Replace target |
| ----- | --------------------- |
| **Filename only** (default) | Stem; extension unchanged by this step |
| **Extension only** | Extension without the leading `.` |
| **Filename + extension** | Entire basename |

---

## Pipeline order

Transforms run in a fixed order (Bulk Rename Utility–style). Defaults are no-ops.

1. **Search / Replace** (simple strip) — skipped if Search is empty  
2. **Name (2)** — Keep / Remove / Fixed  
3. **Case (4)**  
4. **Remove (5)**  
5. **Move / Copy (6)**  
6. **Add (7)**  
7. **Auto date (8)**  
8. **Append folder (9)**  
9. **Numbering (10)**  
10. **Extension (11)**  

**Selection filter (12)** does not change names. It marks rows as excluded (dimmed, unchecked) so Apply skips them. Numbering indices count only non-excluded items.

Windows validation runs at the end: empty names, `\ / : * ? " < > |`, trailing space/period, and `.` / `..` are rejected and shown as errors in the preview.

---

## Advanced options

Collapsed by default. Expand to edit panels. A badge (e.g. **3 active**) appears when any panel differs from defaults — even while collapsed — so you know Advanced is affecting the preview.

**Reset advanced** restores every advanced panel to defaults. It does **not** clear Search / Replace / regex flags.

Session draft: Advanced values and open/closed state survive dialog remounts in the same app session (same idea as the regex checkboxes). They are **not** written to settings export.

### 2 · Name

| Mode | Effect |
| ---- | ------ |
| **Keep** | Leave the stem (after Search/Replace) alone |
| **Remove** | Clear the stem (extension may remain) |
| **Fixed** | Replace the entire stem with **Fixed text** |

### 4 · Case

| Mode | Effect |
| ---- | ------ |
| **Same** | No change |
| **Lower** / **Upper** | Whole stem |
| **Title** | Capitalize each word (split on spaces / `.` / `_` / `-`) |
| **Sentence** | First character upper, rest lower |

**Except:** space- or comma-separated words left unchanged (matched case-insensitively).

### 5 · Remove

Applied to the stem, in roughly this order:

| Control | Meaning |
| ------- | ------- |
| **First n** / **Last n** | Drop that many characters from the start / end |
| **From** / **To** | 1-based inclusive character range to delete (`0` = unused) |
| **Chars** | Delete every occurrence of each character typed here |
| **Words** | Delete whole tokens (split on spaces / `.` / `_` / `-`) matching the listed words |
| **Crop** | **Before** / **After** a **Crop text** match (case-insensitive): keep the side you choose |
| **Digits** | Strip `0–9` |
| **High** | Strip code points ≥ 128 |
| **Trim** | Trim leading/trailing spaces |
| **D/S** | Collapse double spaces |
| **Accents** | Strip combining marks (NFD) |
| **Chars** (letters) | Strip Unicode letters |
| **Sym.** | Strip symbols (keep letters, digits, spaces, `.` `_` `-`) |
| **Lead dots** | **Same** / **Remove** all / **Keep one** leading `.` |

### 6 · Move / Copy

Two independent segments. Positions are **1-based inclusive** on the current stem.

| Mode | Effect |
| ---- | ------ |
| **None** | Skip |
| **Move** | Cut characters From–To and append them (with optional **Sep.**) |
| **Copy** | Leave the range in place and also append a copy |

### 7 · Add

| Field | Effect |
| ----- | ------ |
| **Prefix** | Insert at the start of the stem |
| **Insert** + **At pos.** | Insert at 0-based index |
| **Suffix** | Append before the extension |

### 8 · Auto date

| Field | Options |
| ----- | ------- |
| **Mode** | None / Prefix / Suffix (uses **Sep.** between stamp and name) |
| **Type** | **Modified** (`mtime` from listing) · **Created** (`birthtime`, falls back to modified) · **Current** (now) |
| **Fmt** | YMD, YDM, DMY, MDY, YMD HMS, Unix seconds |
| **Sep.** | Separator inside the date and between name ↔ stamp |
| **Seg.** | Extra separator used in YMD HMS (date ↔ time) |
| **Off. days** | Add/subtract whole days from the chosen timestamp |

**Not supported:** EXIF “Date taken”, Accessed time, or changing the file’s actual timestamps.

### 9 · Append folder

| Field | Effect |
| ----- | ------ |
| **Mode** | None / Prefix / Suffix |
| **Sep.** | Between folder piece(s) and the stem |
| **Levels** | How many parent folder names to join (1 = immediate parent) |

Example: `E:\Movies\All\clip.mp4` with Levels **1**, Prefix, Sep `_` → `All_clip.mp4`.

### 10 · Numbering

| Field | Effect |
| ----- | ------ |
| **Mode** | None / Prefix / Suffix / Insert (at **At**) |
| **Start** / **Incr.** | First number and step |
| **Pad** | Zero-pad width (`3` → `001`) |
| **Type** | Decimal / Hex / Roman |
| **Sep.** | Between number and name |
| **Reset per folder** | Restart the sequence for each parent directory |

Sequence order follows the selection list; excluded filter rows do not consume a number.

### 11 · Extension

| Mode | Effect |
| ---- | ------ |
| **Same** | Leave extension |
| **Lower** / **Upper** | Change case of the extension |
| **Fixed** | Set extension to **Fixed ext** (with or without leading `.`) |
| **Remove** | Strip the extension |

### 12 · Selection filter

Filters which of the **already selected** items participate. Does not load more files from disk.

| Control | Effect |
| ------- | ------ |
| **Filter** | DOS wildcards (default) or regex if **Regex** is on; matched against the full basename |
| **Match case** | Case-sensitive filter |
| **Files** / **Folders** | Include those kinds (symlinks treated like files) |
| **Min / Max name len** | `0` = no limit |

Excluded rows show **(excluded)**, stay dimmed, and cannot be checked for Apply.

---

## Preview and Apply

1. Edit rules until the preview looks right.
2. Uncheck any rows you want to skip (or rely on the selection filter).
3. **Apply** renames checked rows via `fs:rename` (same as F2).
4. Same-folder collisions among the batch are skipped; on-disk conflicts open the **D18** review (Skip / Keep both / Replace / Keep most recent).
5. Dialog **Undo** or Ctrl+Z reverses a successful multi-rename when it is still on the undo stack.

Video strip frames under `!VIDTHUMB_CACHE` are renamed best-effort with the file ([PREVIEW.md](PREVIEW.md)).

---

## Worked examples

### Replace a prefix (simple)

- Search: `IMG_` · Replace: `` · Match all off · Apply to: Filename only  
- `IMG_1234.jpg` → `1234.jpg`

### Wildcard extension in the full name

- Search: `*.TXT` · Replace: `.txt` · Apply to: Filename + extension · Match all off  
- Or use **Extension → Lower** with empty Search.

### Number vacation photos

- Search empty  
- Advanced → Numbering: Prefix, Start `1`, Pad `3`, Sep `_`  
- `beach.jpg`, `pier.jpg` → `001_beach.jpg`, `002_pier.jpg`

### Strip brackets and title-case

- Remove → Chars: `[]`  
- Case → Title  
- `holiday [final].mp4` → `Holiday Final.mp4` (stem; extension unchanged)

### Date suffix from modified time

- Auto date → Suffix, Type Modified, Fmt YMD, Sep `-`  
- `shot.jpg` → `shot-2024-01-15.jpg` (local calendar from listing `mtime`)

### Only JPEGs in a mixed selection

- Selection filter → `*.jpg` (or `*.jpeg`)  
- Other selected files show as excluded; numbering skips them.

---

## What this is not

| Feature | Status |
| ------- | ------ |
| Recurse into selected folders | Out of scope — select the children (or use Scripts) |
| New Location (rename into another folder) | Out of scope — use Copy/Move To |
| EXIF Date Taken / Accessed time | Out of scope |
| Change Created/Modified timestamps | Out of scope |
| Favourites / `.bru` profiles | Out of scope — session draft only |
| JavaScript rename expressions | Out of scope |

For automation beyond the dialog, see [SCRIPTS.md](SCRIPTS.md).

---

## Implementation notes

| Piece | Location |
| ----- | -------- |
| Pure pipeline + preview | `src/shared/powerRename.ts` |
| Dialog UI | `src/renderer/components/PowerRenameDialog.tsx` |
| Apply / dialog undo | `appStore.applyPowerRename` / `undoPowerRenameApply` → `fs:rename` / `fs:relocate` |
| Unit tests | `src/tests/powerRename.test.ts` |

No dedicated `powerRename:*` IPC — rename stays on the shared filesystem API.

---

## Related

- [DECISIONS.md](DECISIONS.md) **D40**, **D18**, **D23**
- [PRODUCT_SPEC.md](PRODUCT_SPEC.md) — file operations table
- [ADVANTAGES.md](ADVANTAGES.md) — vs PowerToys / Explorer
- [PREVIEW.md](PREVIEW.md) — video thumb cache follows rename
