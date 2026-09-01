# User-defined structured metadata (D70)

> **Opt-in, off by default.** Settings → **Metadata** → **Enable user metadata**. When off, context / preview / columns / Power Search meta UI stay hidden and `userMetadata:*` IPC rejects. Distinct from Media Metadata (D50) and notes (D61).

**Version:** D70 · Decision **D70**

MyFileExplorer is a **local file workbench**: richer meaning on ordinary files without relocating them into a proprietary database. User-defined metadata is a **project-local semantic schema** — not a global app feature:

```text
Files → richer previews → attached meaning → search by meaning → virtual organization → actions based on meaning
```

Organizations define **metadata sets** (field catalogs), then **assign** a set to folders (exact or recursive). By default nothing shows anywhere. Explicit **No metadata** bindings punch holes under a recursive project root (e.g. `Temporary`, `node_modules`). Orthogonal to notes (D61), media metadata (D50), and raw ADS stream columns (D38).

## Identity model

Each **field** has three separate concepts:

| Concept | Example | Role |
| --- | --- | --- |
| **`id`** | `mf_a83f71c2` | Immutable opaque identity. ADS keys + Details column ids (`meta:<id>`). Never renamed or reused. |
| **`key`** | `review_state` | Human query token for Power Search (`meta.review_state:…`). |
| **`name`** | `Review state` | Display label (Settings, dialog, column headers). Freely renameable. |

Each **choice / multi-choice option** likewise has opaque **`id`**, query **`key`**, and display **`label`**. ADS stores option **ids**, never labels — renaming “Awaiting review” → “Pending review” does not disconnect values.

Changing a field or option **`key`** requires a confirmation warning (raw typed queries may need updates). Structured Power Search stores opaque ids and regenerates the current keys when emitting queries.

**Cross-set keys:** the same field `key` may appear in multiple sets **only when field types are identical**. Raw `meta.<key>:` queries OR across every compatible field sharing that key. Choice option keys map to the union of matching option ids. Types that disagree cannot be saved.

## Settings: sets + bindings

`settings.userMetadata`:

```ts
{
  enabled: boolean // default false
  sets: Array<{ id: string; name: string; fields: Field[] }>
  bindings: Array<{ path: string; recursive: boolean; setId: string | null }>
}
```

- Cap 32 sets; 32 fields per set; 32 options per choice field; 200 bindings.
- Feature chrome and IPC require `enabled === true`.
- `setId: string` → use that set. `setId: null` → **explicit No metadata** (suppresses inherited recursive sets).
- Resolve like folder views: exact path wins; else longest recursive ancestor. Winning binding may resolve to null.
- **Remove assignment** ≠ **No metadata**: removing an exact binding restores inheritance; writing `null` suppresses until removed or replaced.
- Deleting a set confirms with the count of bindings referencing it, then drops those bindings. Never scans or deletes ADS values.
- Legacy flat `fields[]` migrates into one **Default** set with **no bindings** (opt-in immediately).

Types: `text` | `number` | `boolean` | `date` | `choice` | `multiChoice`.

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

- Validate only non-empty values; empty/clear always allowed.
- Blur + Save in the UI; **main is authoritative**.
- Bulk edit validates the proposed value once.
- Values that become invalid after changing a regex stay stored and show as invalid — never silently stripped.
- Invalid regex definitions cannot be saved in Settings.
- Pattern ≤ 500 chars; text values length-bounded.
- Settings editor includes a **Test validation** strip.
- **Validation only — no transformation** (no replace/format/extract; that belongs in Scripts, D51).

### Regex safety (implementation)

Pattern/input length limits reduce ReDoS risk but do not eliminate it (`(a+)+$`). Regex evaluation must not block Electron’s renderer or main process: use a safe-pattern check **and** a terminable worker with a strict timeout. Main-process writes use the same protected evaluator. This is an implementation safeguard, not a product capability.

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

Writes use `withPreservedHostTimes` (D61 pattern). win32 local NTFS only; remotes / non-NTFS: soft-fail / verb hidden (D2). Deleting a field definition or clearing a binding does **not** wipe ADS values (orphans remain until cleared).

## UX

- Settings → **Metadata**: **Enable** (off by default), manage sets/fields, folder assignments list, text validation + Test strip, Metadata pack.
- Context **Metadata set…** (folder / empty pane): Assign set · No metadata (this folder / + subfolders) · Remove explicit assignment.
- Context **Metadata…** (edit values): only when the selection shares one non-null resolved set.
- Preview: pinned **Metadata** editor above Details when a set applies; otherwise omitted.
- Details: while the list cwd resolves to a non-null set, fields with `showAsColumn` merge into effective columns; leave / No metadata → those columns disappear. Column ids remain `meta:<fieldId>`.
- Files resolve the set for their **parent folder**; folders for **their own path**.

## Power Search

User-facing syntax uses **keys** (union across compatible fields):

```text
meta.review_state:awaiting_review
meta.approved:true
meta.rating:>=4
hasmeta:
hasmeta.review_state:
```

Parser maps keys → opaque field id unions via the catalog of all sets. Structured Power Search builder stores opaque field ids.

## Metadata pack

ZIP compress still omits ADS. D70 proposes a dedicated **Metadata pack** (ZIP of relative paths → `mfe_meta` JSON + definitions sidecar with **all sets**) so values can cross non-NTFS copies. Distinct from Compress-to-ZIP. Apply writes streams with preserved host times on NTFS; merges sets by id; does **not** auto-create folder bindings.

## Non-goals

No formula engine, schema stacking, per-item set override, database, auto-classification, workflow system, one-ADS-per-field, browsing-folder sidecars, regex replacement/formatting, wiping ADS on clear/delete set, or replacing Note/Status/media.

## Related

- [DECISIONS.md](DECISIONS.md) **D70**
- [ADS.md](ADS.md) · [SEARCH.md](SEARCH.md) · [ADVANTAGES.md](ADVANTAGES.md) · [BUSINESS_UVP.md](BUSINESS_UVP.md)

## Ship documentation checklist

When polishing a release that includes D70, keep README, ADVANTAGES, BUSINESS_UVP, PRODUCT_SPEC, PROJECT_FORMAT, ADS, SEARCH, IPC_CONTRACT, RELEASE_NOTES / CHANGELOG aligned with the **semantic workbench** story: files stay on disk; users define meaning per project folder; search and columns operate on that meaning; Virtual Folders and scripts compose with the same attached values.

