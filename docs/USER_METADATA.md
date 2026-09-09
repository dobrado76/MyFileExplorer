# User-defined structured metadata (D70)

> **Opt-in, off by default.** Settings → **Metadata** → **Enable user metadata**. When off, context / preview / columns / Power Search meta UI stay hidden and `userMetadata:*` IPC rejects. Distinct from Media Metadata (D50) and notes (D61).

**Status:** shipped in **v0.16.0**; expanded in **v0.17.0** with catalog Undo, Hygiene, Pack dry-run, field extras, bulk Leave/Set/Clear, full Details click-edit, Copy/Paste, in-folder facets, icon badge, scripts bridge, and Power Search set-first picker · Decision **D70** · **Windows / NTFS only**

MyFileExplorer is a **local file workbench**: richer meaning on ordinary files without relocating them into a proprietary database. User-defined metadata is a **project-local semantic schema** — not a global app feature:

```text
Files → richer previews → attached meaning → search by meaning → virtual organization → actions based on meaning
```

Organizations define **metadata sets** (field catalogs), then **assign** a set to folders (exact or recursive). By default nothing shows anywhere. Explicit **No metadata** bindings punch holes under a recursive project root (e.g. `Temporary`, `node_modules`). Orthogonal to notes (D61), media metadata (D50), and raw ADS stream columns (D38).

Locked choice: [DECISIONS.md](DECISIONS.md) **D70**. Streams: [ADS.md](ADS.md). IPC: [IPC_CONTRACT.md](IPC_CONTRACT.md). Scripts: [SCRIPTS.md](SCRIPTS.md).

---

## Identity model

Each **field** has three separate concepts:

| Concept | Example | Role |
| --- | --- | --- |
| **`id`** | `mf_a83f71c2` | Immutable opaque identity. ADS keys + Details column ids (`meta:<id>`). Never renamed or reused. |
| **`key`** | `review_state` | Human query token for Power Search (`meta.review_state:…`). |
| **`name`** | `Review state` | Display label (Settings, dialog, column headers). Freely renameable. |

Each **choice / multi-choice / icon-tags option** likewise has opaque **`id`**, query **`key`**, and display **`label`**. ADS stores option **ids**, never labels — renaming “Awaiting review” → “Pending review” does not disconnect values.

Changing a field or option **`key`** requires a confirmation warning (raw typed queries may need updates). Structured Power Search stores opaque ids and regenerates the current keys when emitting queries.

**Cross-set keys:** the same field `key` may appear in multiple sets **only when field types are identical**. Raw `meta.<key>:` queries OR across every compatible field sharing that key. Choice option keys map to the union of matching option ids. Types that disagree cannot be saved.

**Catalog safety:** field / set / binding arrays soft-parse — one invalid definition does not wipe the rest of the catalog.

---

## Settings: sets + bindings

`settings.userMetadata`:

```ts
{
  enabled: boolean              // default false
  showToolbarButton?: boolean   // optional Metadata manager button on the toolbar
  sets: Array<{ id: string; name: string; fields: Field[] }>
  bindings: Array<{ path: string; recursive: boolean; setId: string | null }>
  /** Hidden recovery catalog — not shown in ordinary UI */
  deletedIdentities?: {
    fields: Array<{ id: string; formerKey: string; type: FieldType }>
    options: Array<{ id: string; fieldId: string; formerKey: string }>
  }
}
```

Each **field** (beyond id / key / name / type):

```ts
{
  showAsColumn?: boolean       // merge into Details by default when the set applies
  required?: boolean           // editing constraint — see Required fields
  defaultValue?: string | number | boolean | string[] | null
                               // seeded into Metadata… when the item has no value (not auto-written)
  showOnIcon?: boolean         // at most one per set — row icon badge
  columnWidthHint?: number     // 60–480 px preferred Details width
  // type-specific: choices[], text{}, boolean{}, lucide* on options…
}
```

### Required fields

`required` is an **editing constraint**, not a guarantee that every item already has a value:

| Rule | Behavior |
| --- | --- |
| **Set** | Must supply a valid non-empty value |
| **Clear** | Unavailable for required fields (bulk mode omits Clear; Details cannot cycle/clear to empty) |
| **Leave** | Always allowed — including legacy items that still lack the required value |
| **Single-item Save** | Rejects a missing / empty required value |
| **Defining required** | Does **not** populate existing items; no automatic ADS writes |
| **Clear all** | Still removes the whole `mfe_meta` stream (explicit wipe of the item) |

- Cap 32 sets; 32 fields per set; 32 options per choice-like field; 200 bindings.
- Feature chrome and IPC require `enabled === true`.
- `setId: string` → use that set. `setId: null` → **explicit No metadata** (suppresses inherited recursive sets).
- Resolve like folder views: exact path wins; else longest recursive ancestor. Winning binding may resolve to null.
- **Remove assignment** ≠ **No metadata**: removing an exact binding restores inheritance; writing `null` suppresses until removed or replaced.
- Deleting a set confirms with the count of bindings referencing it, then drops those bindings and records **tombstones** for its fields/options. Never scans or deletes ADS values.
- Soft-parse keeps valid fields/sets/bindings when one row fails Zod.
- Legacy flat `fields[]` migrates into one **Default** set with **no bindings** (opt-in immediately).
- Keys round-trip with Settings → About → **Export / Import** (D45). Window geometry for the manager is stripped. `deletedIdentities` is included in export.

Types: `text` | `number` | `boolean` | `date` | `choice` | `multiChoice` | `link` | `iconTags`.

### Binary fields (`type: "boolean"`)

ADS still stores JSON `true` / `false`. Display and editors use configurable labels (default **Yes** / **No**):

```ts
boolean?: {
  trueLabel: string   // ≤ 40 chars; default "Yes"
  falseLabel: string  // ≤ 40 chars; default "No"
}
```

Examples: True/False, Todo/Done, Open/Closed. Power Search accepts `true`/`false`/`yes`/`no`/`1`/`0` and the field’s labels (`meta.done:Done`). Details columns show the labels; click cycles values (and clear when not required).

### Link fields (`type: "link"`)

ADS stores a string. Allowed values:

- **http(s) URL** — Open follows in the system default browser (`shell:openExternal`).
- **Absolute path** — Windows drive (`C:\…`) or UNC (`\\server\share\…`). Folders navigate in-app; files open with the OS association.
- **Relative path** — resolved against the item’s folder (or the folder itself when the item is a directory).
- **`file://` URLs** — normalized to a path before open.

Empty clears. Preview and the Metadata dialog: **Browse…** (file or folder; Shift = store relative), **Open**, **Reveal** (paths), drop a file/folder onto the field (Shift = relative). Soft amber **Path not found** when a path target is missing (still openable). Details: filled links click = Open, middle-click = Reveal, context Open / Reveal / Copy; **empty** cells click-to-edit to set the value. Power Search treats links like text (substring).

### Icon tags (`type: "iconTags"`)

Visual multi-select tags. ADS stores the same shape as multi-choice (`string[]` of option ids). Each option has a glyph (`lucideName` / `lucideColor` / optional `lucidePack`) plus label/key. Preview, Metadata dialog, and Details columns show **every** option icon in catalog order: muted when off, option color when on; click toggles. Power Search matches like multi-choice (`meta.<key>:<optionKey>`).

Choice, multi-choice, and icon-tag **options** can be reordered (↑/↓) in the Metadata manager; that order is display order.

### Optional text validation

Only for `type: "text"`. Default: no extra validation (any string within the global length cap).

```ts
text?: {
  minLength?: number
  maxLength?: number
  validation?: {
    pattern: string      // body only
    flags?: '' | 'i'     // no g/y/m/s
    message?: string
  }
}
```

Match is **whole-value**: `new RegExp('^(?:' + pattern + ')$', flags)`.

- Validate only non-empty values; empty/clear always allowed unless `required`.
- Blur + Save in the UI; **main is authoritative**.
- Bulk edit validates the proposed value once (for **Set**).
- Values that become invalid after changing a regex stay stored and show as invalid — never silently stripped.
- Invalid regex definitions cannot be saved in Settings.
- Pattern ≤ 500 chars; text values length-bounded.
- Settings / manager includes a **Test validation** strip.
- **Validation only — no transformation** (no replace/format/extract; that belongs in Scripts, D51).

### Regex safety (implementation)

Pattern/input length limits reduce ReDoS risk but do not eliminate it (`(a+)+$`). Regex evaluation must not block Electron’s renderer or main process: use a safe-pattern check **and** a terminable worker with a strict timeout. Main-process writes use the same protected evaluator. This is an implementation safeguard, not a product capability.

---

## On-item storage

One NTFS ADS stream: **`mfe_meta`**.

```json
{
  "format": "MyFileExplorer.UserMetadata",
  "version": 1,
  "updatedAt": "…",
  "values": {
    "mf_a83f71c2": "mo_9c21e4",
    "mf_…": ["mo_aa", "mo_bb"],
    "mf_…": 4
  }
}
```

Writes use `withPreservedHostTimes` (D61 pattern). win32 local NTFS only; remotes / non-NTFS: soft-fail / verb hidden (D2). Deleting a field definition or clearing a binding does **not** wipe ADS values (**orphans** remain until Hygiene clear / reconnect).

---

## Manager dialog

Floating Script-Manager-style window (`userMetadataManagerBounds`). Settings → Metadata stays a thin enable + summary + **Manage sets…**.

| Tab | Purpose |
| --- | --- |
| **Per-set tabs** | Rename / delete set; field list + Field editor (types, options ↑/↓, extras) |
| **Assignments** | Folder bindings list (exact / recursive / No metadata) |
| **Pack** | Export ZIP; **Preview…** dry-run; **Apply…** import |
| **Hygiene** | Scan a folder for orphan field/option ids; clear selected; reconnect field orphans to a catalog field by **key** (option ids remapped via live options or **tombstones**) |
| **Searches** | Read-only list of Power Search saves (meta queries first); open Power Search to run/edit |

**Undo** / **Ctrl+Z** (when focus is not in an input): session stack of catalog snapshots (sets + bindings), cap 30. Restores definitions only — never reverses ADS values.

---

## UX

- Settings → **Metadata**: **Enable**, optional **Show toolbar button**, counts, **Manage sets…**.
- Context **Metadata set…** (folder / empty pane): Assign set · No metadata (**Items in this folder only** / + subfolders) · Remove explicit assignment. **No sets defined…** opens the manager.
- Context **Metadata…** (edit values): only when the selection shares one non-null resolved set. Submenu also **Copy metadata…** / **Paste metadata…** (session clipboard `{ setId, values }`; paste requires the same set).
- Preview: pinned **Metadata** editor above Details when a set applies; otherwise omitted.
- **Details columns**: while the list cwd resolves to a non-null set, fields with `showAsColumn` merge into effective columns; leave / No metadata → those columns disappear. Column ids remain `meta:<fieldId>`. Empty cells stay **blank** (no dash placeholders). **All field types** are editable in-column:
  - boolean — click cycle (clear when not required)
  - choice — option menu
  - multi-choice — checkbox dropdown (toggle commits immediately)
  - date / text / number — inline edit
  - icon tags — glyph toggles
  - link — Open / Reveal when filled; click-to-edit when empty
- **Bulk Metadata…** (multi-select): per field **Leave** (default) / **Set** / **Clear**; Clear omitted when `required`. “varies” when values differ. Save writes only Set/Clear keys (`Clear` → null). **Clear all** still wipes the whole stream. Required: **Set** needs a non-empty value; **Leave** allowed for legacy empties.
- **In-folder facets** (toolbar): when a set resolves for the cwd, filter chips for boolean / choice / icon tags / multi-choice (session-only; cleared when leaving the folder). Distinct from Power Search and the name eye filter.
- **Icon badge**: at most one field per set with `showOnIcon` overlays a short label (boolean/choice) or first on icon-tag glyph on the row icon (does not replace D62 custom item icons).
- **Item editors** (preview / Metadata…): files use the **parent** folder’s binding. Folders use a binding on **themselves** first; if none, they inherit the **parent** folder’s binding. A non-recursive assignment means **items directly contained in this folder** (list rows), not “metadata on the directory object only.” Opening that child does not apply the set to *its* contents unless the child has its own assignment (or a recursive ancestor). UI label: **Items in this folder only**.
- **Cwd / columns / Assign set**: still resolve the folder path itself (exact, else longest recursive ancestor).
- Single-item Metadata… seeds `defaultValue` when the item has no value for that field (user still must Save); Save rejects empty required fields.

---

## Power Search

User-facing syntax uses **keys** (union across compatible fields):

```text
meta.review_state:awaiting_review
meta.approved:true
meta.rating:>=4
hasmeta:
hasmeta.review_state:
```

Parser maps keys → opaque field id unions via the catalog of all sets. The structured builder picks a **metadata set** first, then a **field from that set only** (not a flat list of every field across sets).

---

## Metadata pack

ZIP compress still omits ADS. Dedicated **Metadata pack** (ZIP of relative paths → `mfe_meta` JSON + definitions sidecar with **all sets** and **`deletedIdentities`**) so values can cross non-NTFS copies. Distinct from Compress-to-ZIP.

| Action | Behavior |
| --- | --- |
| **Export…** | Walk files **and directories** with non-empty `mfe_meta`; embed current definitions (+ tombstones); preserve field/set **ids** |
| **Preview…** | Dry-run: definition add/skip/conflict counts + value create/overwrite/missing/**conflict-skipped** |
| **Apply…** | Merge non-conflicting definitions; write only non-conflicting filtered values; **do not** auto-create folder bindings; keep `enabled` from current settings |

### Pack merge conflict outcomes

Safe default: **conflicting definitions and their dependent values are skipped, reported, and never partially imported.** Non-conflicting definitions and values may continue.

| Situation | Outcome |
| --- | --- |
| Set id exists with a **different name** | Local name kept; reported; fields still merge under the rules below |
| Field id exists with another **type** or **key** | Conflict — field def skipped; value keys for that id skipped |
| Incoming field **key** collides with a differently typed local field (other id) | Conflict — incoming field skipped; its values skipped |
| Compatible field id already present | Skip overwrite of the local def (including options); do **not** import pack option ids absent locally |
| Incoming choice options include an **option id owned by another local field** | Conflict — whole incoming field skipped |
| Pack value references a field id not present after merge, or option ids absent locally | Those keys / option ids **skipped** (no new orphans from Apply) |

Apply writes accepted streams with preserved host times on NTFS.

---

## Hygiene (orphans)

After deleting field definitions, ADS may still hold unknown field ids or unknown option ids. ADS stores **opaque option ids only** — after an option is deleted there is no former key left on disk.

### Catalog tombstones

Deleting a field, option, or set appends lightweight **`deletedIdentities`** rows (hidden from ordinary UI):

```ts
deletedIdentities: {
  fields: [{ id, formerKey, type }]
  options: [{ id, fieldId, formerKey }]
}
```

Caps: 256 field tombstones, 512 option tombstones (newest first). Live ids prune matching tombstones. Packs export/import tombstones so recovery survives machines.

| Action | Behavior |
| --- | --- |
| **Scan…** | Pick a folder root; report field / option orphans |
| **Clear selected** | Rewrite docs removing those keys (delete stream if empty); host times preserved |
| **Reconnect by key** | Prompt for a catalog field **key**; rewrite selected **field** orphans to that field’s id when types match (via live field or field tombstone). Choice/multi/icon option ids remapped by **formerKey** from tombstones or still-live options — **never** by inventing keys from ADS alone. Without a tombstone / live option, unmapped option values are left unchanged (still orphan) |

Never auto-wipe on set/field delete. Do not promise option-key remapping when the old definition is unavailable and no tombstone exists.

---

## Scripts bridge

When user metadata is enabled and a **selection** script run shares one resolved set, the runner writes a sibling temp JSON and sets:

```text
MFE_META_MANIFEST=<path>
```

Payload: `{ setId, setName, fields, items: [{ path, values }] }`. Deleted when the process exits (same lifecycle as `--input-list`). See [SCRIPTS.md](SCRIPTS.md).

---

## Non-goals

No formula engine, schema relationships, computed fields, conditional fields, templates, workflows, automation rules, schema stacking, per-item set override, proprietary database, auto-classification, one-ADS-per-field, browsing-folder sidecars, regex replacement/formatting, wiping ADS on clear/delete set, or replacing Note/Status/media.

After required-field clearing, orphan option recovery via tombstones, and pack conflict handling, the metadata system is **complete**. Do not grow it into a database application inside the file manager.

---

## Related

- [DECISIONS.md](DECISIONS.md) **D70**
- [ADS.md](ADS.md) · [SEARCH.md](SEARCH.md) · [SCRIPTS.md](SCRIPTS.md) · [IPC_CONTRACT.md](IPC_CONTRACT.md)
- [ADVANTAGES.md](ADVANTAGES.md) · [BUSINESS_UVP.md](BUSINESS_UVP.md)

## Ship documentation checklist

When polishing a release that includes D70, keep README, ADVANTAGES, BUSINESS_UVP, PRODUCT_SPEC, PROJECT_FORMAT, ADS, SEARCH, IPC_CONTRACT, SCRIPTS, RELEASE_NOTES / CHANGELOG aligned with the **semantic workbench** story: files stay on disk; users define meaning per project folder; search and columns operate on that meaning; Virtual Folders and scripts compose with the same attached values.
