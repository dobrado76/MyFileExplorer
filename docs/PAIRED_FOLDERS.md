# MyFileExplorer — Dual-Pane Paired Folders Mode

**Status:** Implementation specification  
**Target:** MyFileExplorer post-v0.14 dogfooding phase  
**Scope:** Interactive comparison and synchronization between the two folders visible in the side-by-side two-pane layout  
**Primary design rule:** Extend the existing file-operation model; do not create a separate backup product

---

## 1. Purpose

The existing two-pane layout displays two independent folders. Paired Folders Mode makes the relationship between those folders explicit.

It adds a narrow vertical action rail in place of the ordinary splitter. The rail provides directional copy actions, comparison, synchronization, selection helpers, and mode controls. After comparison, the two file views become a coordinated, row-aligned representation of the folder pair so users can understand and act on differences without leaving the main workspace.

The feature is interactive and user-driven. It is not a scheduled backup system, continuous synchronization service, versioning system, or background watcher.

### Product statement

> Compare and reconcile the two folders already in front of you, using the same safe file operations, conflict handling, progress reporting, cancellation, and review mechanisms as the rest of MyFileExplorer.

---

## 2. Goals

1. Make common left/right folder operations immediately discoverable in the two-pane layout.
2. Compare two folder trees by relative path and classify every item clearly.
3. Reveal results inside the existing paired panes rather than in a disconnected dialog.
4. Support selective copy and controlled one-way or two-way synchronization.
5. Preview every synchronization plan before writing to disk.
6. Reuse existing copy, conflict, progress, cancellation, issue-review, undo, timestamp, and metadata behaviour.
7. Keep both ordinary folders and their navigation context intact when entering or leaving comparison mode.
8. Remain safe for large folders, network locations, removable media, and partially inaccessible trees.

---

## 3. Non-goals

Do not add any of the following as part of this feature:

- Scheduled or unattended synchronization.
- Continuous filesystem monitoring.
- Historical snapshots, retention policies, or version chains.
- Cloud-specific synchronization semantics.
- Block-level or delta transfer.
- Three-way merge.
- Automatic text or binary content merge.
- Duplicate detection unrelated to relative paths.
- Renamed-file inference in v1.
- A general backup-job manager.
- A persistent synchronization database.
- Automatic deletion without an explicit reviewed plan.
- Synchronization involving three or four panes.
- Remote-to-remote synchronization in v1.

---

## 4. Terminology

| Term | Definition |
| --- | --- |
| **Left root** | Folder currently displayed in the left pane when the pair is captured. |
| **Right root** | Folder currently displayed in the right pane when the pair is captured. |
| **Relative path** | Item path relative to its corresponding root, normalized for comparison. |
| **Pair row** | One relative path and its optional left and right entries. |
| **Comparison session** | In-memory comparison state tied to one captured root pair. |
| **Comparison projection** | The coordinated result views shown in both panes after comparison. |
| **Ghost row** | A visual placeholder where an item exists only on the opposite side. It is not a filesystem object. |
| **Direction** | Left-to-right or right-to-left operation intent. |
| **Sync plan** | Immutable reviewed list of proposed filesystem operations derived from a comparison snapshot. |
| **Stale result** | A result whose underlying item changed after comparison and before execution. |

---

## 5. Entry conditions and mode availability

Paired Folders Mode is available only when all of the following are true:

- Layout is exactly `2`, side by side.
- Both pane slots contain active tabs.
- Both active tab locations are folders or supported repository roots that resolve to folders.
- Neither pane is displaying Computer, Recycle Bin, an unmaterialized search result, nor another non-folder virtual location.

### Supported root combinations for v1

| Left | Right | Compare | Copy | Sync |
| --- | --- | ---: | ---: | ---: |
| Local folder | Local folder | Yes | Yes | Yes |
| Local folder | UNC/mapped folder | Yes | Yes | Yes |
| UNC/mapped folder | UNC/mapped folder | Yes | Yes | Yes, with normal network limitations |
| Local folder | Projected `.mfevirtual` drive/folder | Yes where filesystem projection exposes ordinary paths | Yes | Yes |
| Local folder | App-internal Virtual Folder without OS projection | Deferred | Deferred | No |
| Local folder | FTP/SFTP/FTPS repository | Optional later phase | Existing supported transfers only | Deferred |

If the pair is unsupported, keep the centre rail visible but disable unavailable actions and explain the reason in tooltips.

### Activation

The centre action rail is present whenever layout `2` is active. It replaces the plain vertical splitter, but it does not automatically run a comparison.

This distinction is important:

- **Ordinary paired state:** two normal independent file views plus quick transfer actions.
- **Comparison state:** captured roots, comparison projection, status filters, selection by pair row, and synchronization actions.

---

## 6. Centre action rail

### 6.1 Geometry

- Default visual width: `40 px`.
- Minimum visual width: `36 px`.
- The rail occupies the existing vertical boundary between the two panes.
- Preserve pane resizing through invisible `5–6 px` resize hit zones on both outer edges of the rail.
- Dragging either edge adjusts the existing two-pane split ratio.
- Double-clicking a non-button region equalizes the two pane widths.
- Buttons must not initiate resizing.
- Rail background uses `--bg-panel`; borders use `--border`.
- The focused direction or active operation may use `--accent`, but the rail must not look permanently selected.

### 6.2 Default rail arrangement

Top to bottom:

| Control | Icon concept | Behaviour |
| --- | --- | --- |
| Compare / Recompare | `GitCompareArrows` or equivalent | Opens comparison options on first use; reruns using current options afterward. |
| Comparison filter | `ListFilter` | Available after compare; opens status filter menu. Badge shows visible differences count. |
| Separator | — | — |
| Copy selected left → right | `ArrowRight` | Copies selected real left items into the corresponding right relative paths. |
| Copy selected right → left | `ArrowLeft` | Symmetric operation. |
| Separator | — | — |
| Synchronize left → right | `ChevronsRight` | Builds a reviewed one-way mirror/update plan. Never executes immediately. |
| Synchronize right → left | `ChevronsLeft` | Symmetric operation. |
| Two-way reconcile | `ArrowLeftRight` | Builds a reviewed bidirectional plan; conflicts require decisions. |
| Separator | — | — |
| Swap pane assignments | `PanelLeftRight` | Swaps the two pane tab assignments without moving files. |
| Exit comparison | `X` | Only visible/enabled during comparison; restores normal views. |

The rail may scroll vertically at extreme window heights, but the primary actions should fit at normal desktop heights.

### 6.3 Tooltips

Every control needs an explicit tooltip containing direction and consequence. Do not rely on arrow icons alone.

Examples:

- `Copy selected from left to right`
- `Synchronize right folder from left folder…`
- `Swap panes — does not move files`
- `Compare C:\Photos with D:\Photos Backup…`

Use the final folder names in Compare tooltip text when space permits.

### 6.4 Direction safety

Directional operations must use both spatial and textual reinforcement:

- The arrow points toward the destination.
- Hover highlights the source pane border subtly and destination pane border more strongly.
- Tooltip names `left` and `right` and includes both root names.
- Synchronization always opens a plan dialog whose header repeats `source → destination`.

---

## 7. Ordinary paired state

Before comparison, both panes behave exactly as they do now.

### 7.1 Copy selected between panes

The two single-arrow controls work without running Compare.

Rules:

1. Source is the pane on the tail side of the arrow.
2. Destination is the folder currently displayed in the opposite pane.
3. Copy the source pane’s selected real items into the destination root.
4. Reuse existing copy-operation planning when Ctrl is held.
5. Reuse existing progress, cancellation, issue review, conflict policies, undo, timestamp preservation, ADS behaviour, and selection-after-copy.
6. Disable the action when the source selection is empty.
7. Never treat a ghost row as a real source item.

This ordinary action copies selected top-level items. Relative-path-aware copies belong to comparison state.

---

## 8. Starting a comparison

### 8.1 Compare options popover/dialog

First activation of Compare opens a compact options popover anchored to the rail. It is not a full settings page.

Options:

| Option | Default | Notes |
| --- | ---: | --- |
| Include subfolders | On | Off compares immediate children only. |
| Follow directory symbolic links/junctions | Off | When off, compare the link object, not its target tree. Prevent cycles. |
| Include hidden/system items | Follow each pane’s effective visibility settings | Display the resolved choice clearly. |
| Comparison method | `Size + modified time` | Alternatives below. |
| Modified-time tolerance | `2 seconds` | Useful across filesystems with different timestamp precision. |
| Ignore empty folders | Off | If on, omit folders that contain no included descendants on either side. |
| Case sensitivity | `Automatic by roots` | Windows/NTFS normally insensitive; Linux paths normally sensitive. |

Comparison methods:

1. **Fast: size + modified time** — default.
2. **Size only** — useful when timestamps are unreliable.
3. **Content hash when needed** — compare size first; hash same-sized files only when other criteria do not establish equality.
4. **Always content hash** — advanced and potentially expensive; explain cost.

The popover includes `Compare` and `Cancel`.

### 8.2 Capturing the pair

When comparison starts, capture:

- Left pane ID and tab ID.
- Right pane ID and tab ID.
- Canonical left and right roots.
- Comparison options.
- Original per-pane view state needed for exact restoration:
  - location/search overlay;
  - view mode;
  - sort;
  - selection;
  - scroll offset;
  - tree expansion and collapse state where affected.

The comparison session is invalidated if either pane navigates to a different root or receives a different tab assignment. See Section 16.

### 8.3 Scan feedback

- Start an in-place busy state immediately.
- Rail Compare button becomes Stop.
- Status bar reports `Comparing`, roots, items scanned, and current relative path.
- Total is indeterminate until traversal establishes it.
- Hashing shows files and bytes hashed separately from discovery.
- Cancellation preserves ordinary panes and does not enter partial comparison mode.
- Access-denied and transient scan errors are collected, not silently interpreted as missing items.

---

## 9. Comparison model

### 9.1 Pairing key

Items pair by normalized relative path from their respective roots.

Normalization must account for:

- Platform path separator.
- `.` and redundant separators.
- Case sensitivity policy.
- Unicode comparison behaviour without mutating the actual filename.
- Trailing separators for folders.

Never use basename alone for recursive comparisons.

### 9.2 Result statuses

Each pair row has one primary status:

| Status | Meaning |
| --- | --- |
| `identical` | Both sides exist with the same type and meet the selected equality criteria. |
| `left_only` | A real entry exists only under the left root. |
| `right_only` | A real entry exists only under the right root. |
| `left_newer` | Both files exist; left modified time is newer beyond tolerance and content is not considered identical. |
| `right_newer` | Symmetric. |
| `different` | Both exist but neither is safely classified as newer, or content differs with effectively equal times. |
| `type_conflict` | Same relative path is a file on one side and folder/link/other type on the other. |
| `metadata_only` | Optional classification when content hashes match but relevant timestamps/attributes differ. Hidden by default unless implemented. |
| `inaccessible` | One or both entries could not be read sufficiently to compare safely. |
| `error` | Traversal or comparison failed for this relative path. |

Folder pair rows derive an aggregate status from descendants but must distinguish `folder itself` from `folder contains differences`.

### 9.3 Entry snapshot

Each real side entry should include enough snapshot data to revalidate before execution:

```ts
type CompareEntrySnapshot = {
  absolutePath: string
  relativePath: string
  kind: 'file' | 'directory' | 'symlink' | 'junction' | 'other'
  size: number | null
  modifiedMs: number | null
  createdMs?: number | null
  fileId?: string | null
  volumeId?: string | null
  hash?: string | null
  attributes?: number | null
}
```

`fileId` and `volumeId` are optional but useful on Windows for stale-result validation.

### 9.4 Result shape

```ts
type PairCompareRow = {
  id: string
  relativePath: string
  depth: number
  left: CompareEntrySnapshot | null
  right: CompareEntrySnapshot | null
  status: PairCompareStatus
  reason: string
  aggregate?: {
    identical: number
    different: number
    leftOnly: number
    rightOnly: number
    conflicts: number
    errors: number
  }
}

type PairComparisonSession = {
  id: string
  leftRoot: string
  rightRoot: string
  options: PairCompareOptions
  createdAt: number
  rows: PairCompareRow[]
  counts: Record<PairCompareStatus, number>
  selectedRowIds: Set<string>
  visibleStatuses: Set<PairCompareStatus>
  stale: boolean
}
```

Do not persist complete result rows in `session.json`. A comparison is an ephemeral snapshot. Persisting only the last-used options is acceptable through `settingsSchema`.

---

## 10. Revealing comparison results

### 10.1 Chosen design: coordinated paired projection

After a successful Compare, keep the normal application shell, pane toolbars, roots, trees, preview, status bar, and centre rail. Replace only the ordinary file listings with a coordinated comparison projection.

Both sides render the same ordered `PairCompareRow[]`:

- Left view renders `row.left`, or a ghost row if it is null.
- Right view renders `row.right`, or a ghost row if it is null.
- Corresponding rows have the same vertical position and height.
- Vertical scrolling is synchronized.
- Expanding/collapsing a folder row applies to both sides.
- Sorting applies to the pair model and therefore reorders both sides together.
- Selecting a row selects the pair row, while preserving knowledge of which side was clicked.

This directly answers the fundamental UX question: the comparison is visible where the folders already are, and the relationship remains spatial.

### 10.2 Why not a third results pane

A middle result panel would consume width, separate results from actual files, and make directional actions harder to interpret. A modal result window would hide the roots and interrupt the main workspace. Status badges alone on independent lists would fail to align missing or differently sorted items.

The coordinated projection provides one comparison table expressed across two panes.

### 10.3 Projection header

Insert a slim comparison strip above each projected listing and below its normal pane toolbar.

Left strip:

`Compared root: <left root> · <visible count> items`

Right strip:

`Compared root: <right root> · <visible count> items`

Both strips share:

- Comparison method summary.
- `Results may be stale` warning when applicable.
- Recompare action.
- Exit action may remain centre-rail only to reduce duplication.

### 10.4 Row appearance

Status should be encoded through a small badge/glyph and subtle tint, never colour alone.

| Status | Suggested glyph | Suggested treatment |
| --- | --- | --- |
| Identical | `Check` | Muted neutral/green; hidden by default after compare if desired. |
| Left only | `CircleDot` or `Plus` on left | Left row normal with blue/green accent; right ghost labelled `Missing`. |
| Right only | Symmetric | Symmetric. |
| Left newer | `ArrowRight` | Direction glyph points toward older side. |
| Right newer | `ArrowLeft` | Symmetric. |
| Different | `NotEqual` | Amber. |
| Type conflict | `TriangleAlert` | Red/amber. |
| Inaccessible/error | `OctagonAlert` | Red; never selected automatically for sync. |

Ghost rows:

- Preserve the exact row height.
- Use dashed outline or muted italic `Missing` text plus the relative name.
- Do not display a fake file icon as though the object exists.
- Cannot be opened, previewed, renamed, dragged, or used as a source.
- May be selected as part of the pair row to request copying from the real side.

### 10.5 Name and path display

For recursive comparison, every row must expose its relative location.

- In Details view, add a comparison-only `Relative folder` column.
- In List/Icon modes, show the parent relative path as secondary text.
- Folder hierarchy mode may indent rows and allow paired expand/collapse.
- Default result view should be Details, but entering comparison must not permanently overwrite the user’s ordinary per-folder view preference.

### 10.6 Synchronized scrolling

Use one shared virtualizer/row model if practical. If two virtualizers remain necessary:

- Share row order, measured row height, expansion state, and scroll offset.
- Prevent feedback loops when synchronizing scroll events.
- Variable-height rows are not permitted in comparison mode.
- Details/List rows use fixed height based on current UI density/font settings.
- Icon/thumbnail modes may be supported later; v1 may force a comparison-specific Details presentation.

**Recommended v1 constraint:** Always use a comparison-specific Details presentation. This yields exact alignment and dramatically reduces complexity. Restore the previous view modes on exit.

### 10.7 Preview behaviour

- Clicking a real left entry previews the left file.
- Clicking a real right entry previews the right file.
- Clicking a ghost keeps the pair selected but shows `No item on this side` in preview.
- For a row with two real files, add `Compare sides` to the preview header where a meaningful side-by-side preview already exists or can be reused.
- Do not make binary diff or general-purpose text diff part of v1.

---

## 11. Filtering, sorting, and selection

### 11.1 Default filter

After comparison, show all statuses **including identical** by default. Toggle any status (including Identical) off in the filter menu. The last-used filter is stored in `settings.pairFolders.visibleStatuses` across sessions and is also captured when saving a named workspace layout.

Filter menu options:

- Differences only.
- Identical.
- Left only.
- Right only.
- Left newer.
- Right newer.
- Different.
- Conflicts/errors.
- Files only.
- Folders only.

Show status counts beside each option.

### 11.2 Sorting

Default sort: relative path, folders represented hierarchically or folders-first consistently.

Available sorts:

- Relative path.
- Status.
- Name.
- Left modified.
- Right modified.
- Left size.
- Right size.
- Size difference.

Sort always affects both projected sides as one pair table.

### 11.3 Selection semantics

- A selection is fundamentally a set of pair-row IDs.
- Clicking either side selects the pair row and records the last-clicked side.
- Ctrl and Shift selection behave like the normal file view.
- The selected row treatment spans both panes subtly, with the clicked side more strongly emphasized.
- The status bar reports both pair rows and real objects, for example: `12 pairs selected · 9 left items · 10 right items`.
- Directional actions compute valid source entries from the selected pair rows.

### 11.4 Useful selection commands

The filter menu or a small secondary rail menu should offer:

- Select all visible differences.
- Select left-only.
- Select right-only.
- Select left-newer.
- Select right-newer.
- Select conflicts.
- Clear selection.

Avoid adding a large permanent set of selection buttons to the narrow rail.

---

## 12. Directional copy in comparison state

When the user invokes left → right:

1. Inspect selected pair rows.
2. Include only rows with a real left entry.
3. Destination path is `rightRoot + relativePath`.
4. Create required parent folders as part of the operation plan.
5. Ignore selected ghost-only left sources and explain exclusions in the plan/result summary.
6. For a folder row, avoid duplicating descendant operations if the selected folder operation already covers them.
7. Type conflicts and overwrites use existing conflict policy and issue review.
8. If Ctrl is held, open the existing file-operation plan before starting.

After completion:

- Recompare affected relative paths incrementally if safe, otherwise mark results stale and offer Recompare.
- Do not silently remove rows from the comparison projection based only on expected outcomes.
- Prefer a targeted rescan of affected subtrees.

---

## 13. Synchronization modes

All synchronization buttons build a plan. None execute immediately.

### 13.1 Left → right synchronization

Semantic meaning:

> Make the right root agree with the left root under the selected policy.

Default policy is **Update**, not destructive mirror:

- Copy left-only items to right.
- Replace/update right counterpart when left is newer.
- Leave right-only items untouched.
- Prompt/plan conflicts where right appears newer or both differ ambiguously.

Optional plan policy:

| Policy | Behaviour |
| --- | --- |
| **Update destination** | Copy missing and source-newer items; preserve destination-only items. Default. |
| **Mirror source** | Additionally remove destination-only items. Requires explicit destructive acknowledgement. |
| **Copy missing only** | Copy source-only items; never replace existing destination items. |

Right → left is symmetric.

### 13.2 Two-way reconcile

Default rules:

- Left-only → copy to right.
- Right-only → copy to left.
- Left-newer → copy left to right.
- Right-newer → copy right to left.
- Identical → no operation.
- Different with inconclusive chronology → conflict requiring user choice.
- Type conflict → conflict requiring user choice.
- Inaccessible/error → excluded and clearly reported.

Two-way mode must never delete an item merely because it is absent on one side. Without persistent historical state, absence cannot be distinguished from a new item versus a deletion. Therefore v1 two-way reconcile is additive/update-only.

This is a crucial safety rule.

### 13.3 Selected rows versus full comparison

Sync Plan dialog begins with scope:

- `All visible differences` — default when no rows are selected.
- `Selected pairs only` — default when one or more rows are selected.
- `Entire comparison, including filtered-out rows` — explicit advanced choice.

Never interpret filtered-out rows as implicitly selected.

---

## 14. Sync Plan dialog

### 14.1 Purpose

The dialog is the final authority before a synchronization changes the filesystem. It is both a dry-run presentation and an editable operation plan.

### 14.2 Header

Example:

`Synchronize left → right`

`C:\Working Photos  →  D:\Photo Backup`

Show policy, comparison age, and a stale warning if either root changed since scanning.

### 14.3 Summary cards

- Files to copy.
- Files to replace.
- Folders to create.
- Items to remove, if Mirror is selected.
- Conflicts requiring decisions.
- Excluded/inaccessible items.
- Estimated bytes to transfer.

### 14.4 Operation table

Columns:

- Checkbox.
- Action.
- Relative path.
- Source summary.
- Destination summary.
- Reason.
- Status/decision.

Actions:

- Copy.
- Replace.
- Create folder.
- Move to Recycle Bin / permanent delete only when the destination filesystem and existing application behaviour permit it.
- Skip.
- Conflict decision required.

Filters:

- All.
- Copy/create.
- Replace.
- Delete.
- Conflicts.
- Excluded.

### 14.5 Conflict decisions

Reuse existing conflict comparison cards and policies where possible:

- Use left.
- Use right.
- Keep both.
- Keep most recent, only when timestamps establish a winner beyond tolerance.
- Skip.

Support `Apply to similar` with careful grouping by conflict kind, not merely file extension.

### 14.6 Execution controls

Buttons:

- `Cancel`.
- `Export plan…` — optional later; not required for v1.
- `Run synchronization`.

The Run button remains disabled while unresolved required decisions exist.

For Mirror mode, require a checkbox immediately above Run:

`I understand that destination-only items listed above will be removed.`

Use Recycle Bin where the existing operation model supports it. Permanent deletion must be named explicitly.

### 14.7 Revalidation

Immediately before execution:

1. Re-stat every operation source and existing destination.
2. Compare against the captured snapshots.
3. Mark changed rows stale.
4. Do not proceed silently with stale destructive or overwrite operations.
5. Offer:
   - Rebuild plan.
   - Skip stale items and continue.
   - Cancel.

New unrelated items discovered after comparison are not automatically added to an already reviewed plan.

### 14.8 Execution

- Convert approved plan entries into the existing main-process operation model.
- Reuse progress events and status bar.
- Cancellation stops between items and during supported large-file streams.
- Queue issues and use the existing grouped end-of-operation review.
- Undo should be available to the extent already supported by the constituent operations.
- At completion show a concise summary and recompare affected paths or the full pair.

---

## 15. Deletion and mirror safety

Mirror is the only mode that proposes deletion solely due to destination-only status.

Safety requirements:

- Mirror is not the default policy.
- Selecting Mirror changes the dialog tone and makes removal counts prominent.
- Root deletion is impossible.
- Never follow a directory junction/symlink and delete outside the captured destination root.
- Resolve and re-check every destination path against the canonical destination root in main.
- Do not delete inaccessible/unscanned paths.
- If source traversal was incomplete, disable Mirror entirely.
- Prefer Recycle Bin where supported.
- For destinations without trash support, name `Permanent delete` explicitly and require stronger confirmation.
- A comparison cancellation or scan error can never produce a partial mirror plan.

---

## 16. Navigation and invalidation

### 16.1 While comparison is active

Normal navigation controls remain visible, but navigation away from either captured root ends or invalidates the comparison.

Recommended behaviour:

- Clicking Back, Forward, Up, breadcrumb, tree folder, or another tab prompts only if there is an unexecuted edited Sync Plan.
- Otherwise exit comparison immediately, restore ordinary view state, then perform navigation.
- Changing sort/filter inside comparison does not invalidate it.
- Swapping panes preserves the comparison session by swapping its side assignments and directional interpretation.

### 16.2 Filesystem changes

Watch both captured roots using the existing watch infrastructure where practical.

When changes occur:

- Mark affected result rows or the whole session stale.
- Show a visible but non-modal `Results changed — Recompare` notice.
- Do not continuously recompute large comparisons in the background.
- A targeted incremental refresh is acceptable for changes caused by MFE itself, but correctness takes precedence over cleverness.

### 16.3 Layout changes

Changing from layout `2` to `1`, `3`, or `4` exits comparison and restores the ordinary views. The centre rail exists only in layout `2`.

---

## 17. Empty, same, and nested roots

### 17.1 Same root

If canonical roots resolve to the same folder:

- Compare may report that both panes point to the same location.
- Disable all directional copy and synchronization actions.
- Offer `Swap panes` only if useful.

### 17.2 Nested roots

If one root is inside the other, synchronization can recursively copy the destination into itself or otherwise create pathological plans.

Rules:

- Detect canonical ancestry before scanning.
- Compare may be allowed only if the nested counterpart subtree is automatically excluded with a conspicuous explanation.
- Synchronization and directional folder copy must reject any plan that copies a root into itself or its descendant.
- Simpler acceptable v1 rule: block paired comparison/sync entirely for nested roots.

**Recommended v1:** Block nested root pairs and explain why.

### 17.3 Empty roots

Empty folders are valid. A comparison against an empty folder produces only-left or only-right rows and can be used for an initial copy/update plan.

---

## 18. Filesystem semantics

### 18.1 Timestamp tolerance

- Default tolerance: 2 seconds.
- Apply tolerance only to equality/newer classification, not displayed timestamps.
- If timestamps fall within tolerance but sizes differ, status is `different`.
- If timestamps fall within tolerance and sizes match under fast comparison, status may be `identical` with reason `Same size; modified times within tolerance`.

### 18.2 Hashing

- Use a streaming cryptographic or strong content hash already suitable in Node; SHA-256 is acceptable.
- Hash on main/worker side, never renderer.
- Limit concurrency to avoid saturating disks.
- Prefer one reader per physical volume, with conservative concurrency for SSDs/network shares.
- Emit byte progress and support cancellation.
- Cache hashes only within the comparison session using path + size + modified stamp as key.
- Do not create sidecars or ADS merely to cache hashes.

### 18.3 Symbolic links and junctions

- Default: compare the link/reparse object, do not traverse it.
- If following is enabled, track canonical visited directories to prevent cycles.
- Never allow traversal to weaken destination-root containment during planned writes.

### 18.4 ADS and metadata

Normal copy behaviour must continue preserving ADS according to existing MyFileExplorer rules and filesystem capabilities. Comparison v1 need not classify differing ADS independently unless existing metadata can do so cheaply.

Do not claim two files are byte-identical in UI when the selected comparison method examined only default-stream size and timestamp. The reason text should remain epistemically accurate.

### 18.5 Case collisions

When comparing a case-sensitive source with a case-insensitive destination, detect relative paths that cannot coexist at the destination. Classify them as conflicts and block automatic synchronization for those rows.

### 18.6 Long paths and permissions

Use existing normalized absolute-path and long-path support. Traversal failures must become explicit inaccessible/error results. Never reinterpret access denial as item absence.

---

## 19. Architecture

### 19.1 Domain separation

Do not add the comparison engine or full state directly into `appStore.ts`, `Dialogs.tsx`, or `FileView.tsx`.

Create bounded modules such as:

```text
src/
├─ main/
│  ├─ pairCompare/
│  │  ├─ scan.ts
│  │  ├─ classify.ts
│  │  ├─ hash.ts
│  │  ├─ plan.ts
│  │  ├─ revalidate.ts
│  │  └─ index.ts
│  └─ ipc/
│     └─ registerPairCompare.ts
├─ renderer/
│  ├─ pairCompare/
│  │  ├─ pairCompareStore.ts
│  │  ├─ pairCompareActions.ts
│  │  ├─ PairActionRail.tsx
│  │  ├─ PairCompareView.tsx
│  │  ├─ PairCompareHeader.tsx
│  │  ├─ PairFilterMenu.tsx
│  │  └─ SyncPlanDialog.tsx
│  └─ components/
│     └─ ...existing integration points only
└─ shared/
   ├─ pairCompare/
   │  ├─ types.ts
   │  └─ schemas.ts
   └─ ipc/
      └─ ...typed API additions
```

Names may adapt to repository conventions, but preserve the domain boundary.

### 19.2 Process ownership

| Concern | Owner |
| --- | --- |
| Root/path validation | Main |
| Recursive traversal | Main |
| Stat and hashing | Main |
| Status classification | Main/shared pure functions |
| Sync plan generation | Main/shared pure functions |
| Pre-execution revalidation | Main |
| Filesystem mutations | Existing main FS operation infrastructure |
| Projection filters, sort, selection | Renderer pair-compare store |
| Coordinated rendering and scrolling | Renderer |
| Session chrome restoration | Renderer existing tab/pane state plus ephemeral comparison snapshot |

### 19.3 IPC outline

Names are illustrative and must follow existing typed channel conventions:

```ts
pairCompare:start(options): Promise<{ sessionId: string }>
pairCompare:cancel({ sessionId }): Promise<void>
pairCompare:result({ sessionId }): Promise<PairComparisonResult>
pairCompare:progress event
pairCompare:buildPlan(request): Promise<PairSyncPlan>
pairCompare:revalidatePlan({ planId }): Promise<PairPlanValidation>
pairCompare:executePlan({ planId, approvedDecisions }): Promise<ExistingOperationResult>
pairCompare:dispose({ sessionId }): Promise<void>
```

For large comparisons, do not send an unbounded result as thousands of individual IPC calls. Return batches or one compact result payload after progress events. Consider pagination/windowing only if result serialization becomes measurably problematic.

All inputs and outputs require Zod schemas consistent with the existing architecture.

### 19.4 Cancellation

Use an `AbortController` or existing cancellation mechanism keyed by session/operation ID. Traversal, hashing, plan generation, and revalidation must check cancellation regularly.

### 19.5 Memory

- Store metadata, not file contents.
- Avoid duplicate absolute-path strings where practical, but do not prematurely obscure the model.
- A million-row comparison may still be large; define an initial soft warning threshold and test it.
- Renderer must virtualize projected rows.
- Dispose session rows/hashes promptly on exit or recompare.

---

## 20. Settings and persistence

Add only user preferences that are likely to remain useful:

```ts
pairFolders: {
  includeSubfolders: boolean
  followLinks: boolean
  compareMethod: 'size_mtime' | 'size' | 'hash_when_needed' | 'hash_all'
  modifiedToleranceMs: number
  ignoreEmptyFolders: boolean
  /** @deprecated — migrated into visibleStatuses when absent */
  showIdenticalByDefault: boolean
  /** Last-used compare result filter (session-lasting). */
  visibleStatuses: PairCompareStatus[]
}
```

Requirements:

- Add them under the existing `settingsSchema` so export/import round-trips them.
- Do not persist root pairs automatically as a new configuration catalogue in v1.
- Named workspace layouts preserve tabs, pane assignments, **and** `pairCompareVisibleStatuses` so a saved “backup/sync pair” restores both folders and its compare filter.
- Do not persist comparison results or sync plans across application restarts in v1.

---

## 21. Keyboard and accessibility

Suggested shortcuts, subject to collision review:

| Shortcut | Action |
| --- | --- |
| `Ctrl+Shift+C` | Compare/recompare the two folders. |
| `Alt+Right` | Copy selected pair entries left → right while in comparison mode. |
| `Alt+Left` | Copy selected pair entries right → left. |
| `Ctrl+Shift+Right` | Build left → right sync plan. |
| `Ctrl+Shift+Left` | Build right → left sync plan. |
| `Escape` | Cancel active scan; otherwise clear selection/close menu according to existing precedence. |

Do not implement shortcuts until checked against existing application and OS conventions.

Accessibility requirements:

- Rail buttons have accessible names including direction.
- Ghost rows are announced as `Missing on left/right`, not as disabled files.
- Status is announced textually.
- Pair-row selection is understandable from either pane.
- Focus movement between left view, rail, and right view follows spatial order.
- Colour is never the sole result indicator.
- The Sync Plan table and conflict decisions are fully keyboard-operable.

---

## 22. Error handling

### Scan errors

- Continue when individual items are inaccessible.
- Represent affected paths as `inaccessible` or `error`.
- If a subtree cannot be enumerated, mark the scan incomplete.
- Disable Mirror whenever the source scan is incomplete.
- Show error count and a details list.

### Root loss

If a drive disconnects or root disappears:

- Stop active compare/plan execution safely.
- Keep the comparison projection visible if useful, marked offline/stale.
- Disable write actions.
- Offer Recompare when the root returns.
- Do not discard the underlying tab merely because the root is temporarily offline; follow existing offline-tab behaviour.

### Partial synchronization

- Existing operation progress and issue review remain authoritative.
- Completion summary distinguishes succeeded, skipped, failed, cancelled, and unresolved.
- Recompare after partial completion; do not pretend the pair is synchronized.

---

## 23. Testing requirements

### 23.1 Pure comparison tests

- Empty versus empty.
- Empty versus populated.
- Immediate-only versus recursive.
- Identical size/time.
- Timestamp inside/outside tolerance.
- Same size and different hash.
- Different size.
- Left/right only.
- Left/right newer.
- Equal-time different content.
- File/folder type conflict.
- Case-sensitive and case-insensitive pairing.
- Unicode filenames.
- Hidden/system inclusion.
- Empty-folder policy.
- Links and junction cycles.
- Access-denied subtree.

### 23.2 Plan generation tests

- Update left → right.
- Mirror left → right.
- Missing-only policy.
- Right → left symmetry.
- Two-way additive reconcile.
- Ambiguous conflicts never auto-resolve.
- Two-way absence never generates deletion.
- Filtered-out versus selected scope.
- Selected parent folder suppresses redundant child operations.
- Destination parent creation ordering.
- Root/nested-root protection.
- Case collision protection.
- Incomplete scan disables Mirror.

### 23.3 Revalidation tests

- Source modified after compare.
- Destination modified after compare.
- Source removed.
- Destination appears after compare.
- File replaced with directory.
- Root disconnect.
- Unrelated new item is not silently inserted into reviewed plan.

### 23.4 Renderer tests

- Rail appears only for layout `2`.
- Split ratio remains resizable through rail edge hit zones.
- Double-click equalizes panes.
- Correct actions enable/disable based on roots and selections.
- Pair rows align for left-only/right-only entries.
- Ghosts cannot open, drag, preview as real files, or serve as sources.
- Selection and scrolling synchronize.
- Status filters retain counts.
- Exiting restores original pane view/selection/scroll.
- Navigation invalidates/exits comparison correctly.
- Swap reverses roots and action directions correctly.
- Layout change exits comparison.
- Theme, font size, and density do not break row alignment.

### 23.5 Integration tests

- Copy selected ordinary left → right.
- Copy selected comparison rows while preserving relative paths.
- Sync Plan drives existing operations.
- Existing name-conflict issue review still works.
- Cancellation during traversal, hashing, copy, and revalidation.
- ADS/timestamps follow existing copy rules.
- Network path latency and disconnect.
- Very long paths.
- Large folder virtualization.

### 23.6 Manual dogfooding matrix

Test at minimum:

- Two small local SSD folders.
- Same data with intentionally modified timestamps.
- Local ↔ mapped NAS folder.
- Two mapped folders.
- Read-only destination.
- VeraCrypt or other relevant mounted volume.
- Folder containing junctions/symlinks.
- AI dataset with thousands of images and metadata.
- Source-control tree with many small files.
- Media tree with large video files.
- Destination with case collisions or filesystem timestamp limitations.

---

## 24. Performance targets

These are design targets, not promises until measured:

- Rail interactions: immediate.
- Comparison startup feedback: under 100 ms.
- Non-hash traversal: stream progress continuously and avoid blocking renderer.
- Result rendering: remain smooth at 100,000 pair rows through virtualization.
- Selection/filter/sort: avoid quadratic work.
- Hash concurrency: bounded and cancellable.
- No file bytes cross into renderer.
- No unbounded watcher or timer remains after exiting comparison.

Add instrumentation around scan, classify, serialize, render, plan, revalidate, and execute phases during development.

---

## 25. Implementation phases

### Phase 1 — Rail and ordinary directional copy

- Replace layout-2 splitter with resizable action rail.
- Implement exact enablement/tooltips.
- Copy selected left → right and right → left using existing operations.
- Swap panes.
- Add component and interaction tests.

**Exit criterion:** The rail is useful without comparison and does not regress split resizing or pane focus.

### Phase 2 — Comparison engine

- Shared types/schemas.
- Main-process traversal/classification/cancellation/progress.
- Fast `size + modified time` comparison only.
- Errors and incomplete-scan semantics.
- Unit tests.

**Exit criterion:** Deterministic comparison result for local/UNC roots with trustworthy error reporting.

### Phase 3 — Coordinated comparison projection

- Comparison-specific Details view.
- Aligned real/ghost rows.
- Synchronized selection, scroll, expansion, sort, and filters.
- Preview semantics.
- Exact exit/restoration.

**Exit criterion:** A user can understand every common difference without opening a separate dialog.

### Phase 4 — Directional copy from results

- Relative-path destinations.
- Parent creation.
- Targeted recompare or stale-state handling.
- Existing conflict/progress/review integration.

**Exit criterion:** Selected differences can be safely reconciled in either direction.

### Phase 5 — One-way Sync Plan

- Update, Mirror, and missing-only policies.
- Full plan dialog.
- Revalidation.
- Execution through existing FS operations.
- Destructive safety.

**Exit criterion:** Reviewed one-way synchronization is safe under concurrent filesystem changes.

### Phase 6 — Two-way reconcile

- Additive/update-only rules.
- Explicit ambiguous conflict decisions.
- No deletion inference.

**Exit criterion:** Two folders can be reconciled without historical state and without unsafe deletion assumptions.

### Phase 7 — Hash comparison and optimization

- Hash-when-needed and hash-all.
- Bounded concurrency and progress.
- Large-tree performance work based on measurement.

Do not begin later phases merely to complete the list. Each phase must survive dogfooding before expanding scope.

---

## 26. Acceptance criteria

The feature is complete when:

1. Layout `2` uses a resizable centre action rail without reducing existing pane behaviour.
2. Users can copy selected ordinary items in either direction.
3. Compare produces explicit, cancellable, error-aware results by relative path.
4. Results appear as aligned coordinated rows across the two existing panes.
5. Missing counterparts are represented by safe ghost rows.
6. Filtering, sorting, selection, scrolling, and folder expansion remain synchronized.
7. Leaving comparison restores the prior ordinary pane states.
8. Selected comparison results can be copied in either direction with relative paths preserved.
9. One-way sync always presents a complete operation plan before execution.
10. Mirror deletion is opt-in, conspicuous, root-contained, revalidated, and disabled after incomplete scans.
11. Two-way reconcile never infers deletion from absence.
12. Stale sources/destinations are detected before destructive or overwrite operations.
13. Existing conflict review, progress, cancellation, undo, timestamp, and metadata rules remain in force.
14. The implementation passes typecheck, lint, existing tests, and the new test suite.
15. No comparison logic materially enlarges the existing central monolithic files when a dedicated domain module is appropriate.

---

## 27. Locked design decisions

These decisions should be treated as requirements unless dogfooding produces concrete evidence against them:

1. The centre rail replaces the plain splitter only in the side-by-side two-pane layout.
2. The rail remains a resize boundary.
3. Compare is explicit, not automatic whenever two panes open.
4. Comparison results are shown inside the two existing panes as one coordinated projection.
5. Corresponding results are row-aligned; absent counterparts use ghost rows.
6. Comparison v1 uses a fixed-height Details presentation for reliable alignment.
7. Sync always produces a reviewed plan before execution.
8. One-way default is non-destructive Update, not Mirror.
9. Two-way reconcile is additive/update-only because v1 has no persistent history from which to infer deletion.
10. Errors and access denial are never treated as absence.
11. Mirror is disabled after any incomplete source scan.
12. Results and plans are ephemeral and are not persisted across restart.
13. The feature reuses existing filesystem operation infrastructure.
14. The feature stops at interactive pair reconciliation and does not become a backup scheduler.

---

## 28. Recommended first implementation slice for Cursor

Cursor should begin only with Phase 1 and the structural foundations needed for later phases:

1. Locate the existing layout-2 grid and vertical splitter implementation.
2. Extract a `PairActionRail` component rather than adding controls inline to the pane-grid component.
3. Preserve the current split-ratio persistence and drag behaviour through rail edge hit zones.
4. Derive left/right active tab and folder roots from existing pane assignments.
5. Implement action availability as one pure function with tests.
6. Wire ordinary selected copy left → right and right → left into the existing operation path.
7. Implement Swap panes through existing pane assignment actions.
8. Add disabled Compare/Sync controls as clearly marked future actions only if the same branch will immediately continue into Phase 2; otherwise omit inert production controls.
9. Run `npm run check`.
10. Manually verify resizing, focus, selection, drag-and-drop, tab assignment, named layouts, restart restoration, and both themes.

Do not implement synchronization by directly issuing ad hoc `fs.copy` or delete calls from the new component. The centre rail is a controller over existing application capabilities; filesystem authority remains in the established main-process operation model.

