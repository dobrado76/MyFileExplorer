# Virtual Folders (D67)

**Version:** 0.14.0 (unreleased) · Decision **D67**

A **Virtual Folder** is a portable `.mfevirtual` JSON file that MyFileExplorer presents as a **folder-like collection of path references** — not copies and not one physical directory. Works on any filesystem MFE supports (no NTFS ADS).

## Terminology

| Term | Meaning |
| --- | --- |
| **Virtual Folder** | Product feature — folder-like collection in the UI |
| **`.mfevirtual`** | Portable JSON definition file on disk |
| **Virtual Folder entry** | Reference to a real file or folder |
| **Virtual location** | Internal navigation: `Tab.path` = absolute path of the `.mfevirtual` document |
| **Resolve target / real location** | Underlying filesystem object |

## Concept

| | Real folder | Virtual Folder |
|---|---|---|
| On disk | Directory | Single `.mfevirtual` file |
| Members | Children of the directory | Explicit references (anywhere) |
| Drag/paste in | Copy/move files | **Add references** |
| Delete (Del) | Delete / Recycle | **Remove from collection** |
| Physical delete | Same | Explicit **Delete from Disk…** |
| Open folder member | Enter that folder | Navigate to the **real** folder |
| Move the collection | Moves tree | Moves only the `.mfevirtual` file |

## Format

UTF-8 JSON, Git-friendly (2-space indent, stable key order, LF):

```json
{
  "format": "MyFileExplorer.VirtualFolder",
  "version": 1,
  "id": "…",
  "created": "…",
  "modified": "…",
  "settings": { "manualOrder": true },
  "entries": [
    { "id": "…", "kind": "file", "path": "docs/a.pdf", "relative": true },
    { "id": "…", "kind": "folder", "path": "F:\\AI\\Training", "relative": false }
  ]
}
```

- **Relative** paths use `/` and resolve against the document’s parent directory (preferred when the target is under that tree).
- **Absolute** paths are native (cross-drive / UNC).
- Nested Virtual Folders use `kind: "virtualFolder"`.
- Broken targets stay in the file; UI shows Missing + **Locate Target…**.

## Navigation

`Tab.path` is still the **absolute path of the `.mfevirtual` file** on disk (no fake `Collection.mfevirtual\Child` paths). In the UI the document is presented as a **folder**:

- Listed and sorted with folders; Type = Virtual Folder; folder+paper icon
- Extension never shown in labels
- Appears in the folder **tree**; expand shows referenced folders; drop onto it adds references
- **Open as root in new tab** scopes the tree to the collection

Opening a referenced real folder navigates to that real path; Back / Up (when the collection is the tab root) returns to the document.

## Create / edit

- **New → Virtual Folder** (or context **Add → Virtual Folder**).
- Inside an open Virtual Folder, **New** / **Add** offers **only Virtual Folder** — creates a nested `.mfevirtual` beside the parent document and adds it as a member (`kind: virtualFolder`). Real folders/files cannot be created “inside” the collection (add references by drop/paste instead).
- Drop or paste into an open Virtual Folder to add references (duplicates skipped).
- **Del** removes membership; **Shift+Del** / **Delete from Disk…** uses normal delete confirms.
- Nested `.mfevirtual` entries are supported. Cycles are allowed as data; recursive helpers must use a visited set.

## UI wording

- New → Virtual Folder  
- Add to Virtual Folder  
- Remove from Virtual Folder  
- Type: Virtual Folder  
- Reveal Real Location  

## Non-goals (v1)

Smart/query folders, global Virtual Folder database, automatic link repair across disk, recursive expansion of member folders, ADS, fake nested FS paths, volatile size/mtime in JSON.

## Future (optional OS projection)

MFE Virtual Folders are normally resolved inside MyFileExplorer, with optional OS-level projection later.

## Related

- Decision: [DECISIONS.md](DECISIONS.md) **D67**
- Preview: selecting a `.mfevirtual` in its parent shows a Virtual Folder preview (not raw JSON)
- CLI / association: [INTEGRATION.md](INTEGRATION.md)
