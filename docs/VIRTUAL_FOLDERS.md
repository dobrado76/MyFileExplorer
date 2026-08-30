# Virtual Folders (D67)

**Version:** 0.14.0 (unreleased) · Decision **D67**

A **Virtual Folder** is a portable `.mfevirtual` JSON file that MyFileExplorer presents as a **folder-like tree of path references** — not copies and not one physical directory. Works on any filesystem MFE supports (no NTFS ADS).

## Terminology

| Term | Meaning |
| --- | --- |
| **Virtual Folder** | Product feature — folder-like collection in the UI |
| **`.mfevirtual`** | Portable JSON definition file on disk (one file = one tree) |
| **Virtual Folder entry** | Reference to a real file/folder, or an **embedded group** (nested Virtual Folder) |
| **Embedded group** | Nested Virtual Folder stored only inside the parent JSON (`kind: virtualFolder` + `label` + `children`) |
| **Virtual location** | `Tab.path` = absolute path of the `.mfevirtual` document; optional in-document group stack |
| **Resolve target / real location** | Underlying filesystem object |

## Concept

| | Real folder | Virtual Folder |
|---|---|---|
| On disk | Directory | Single `.mfevirtual` file |
| Members | Children of the directory | Explicit references + embedded groups (anywhere) |
| Drag/paste in | Copy/move files | **Add references** (cut/move *between* Virtual Folders also removes the source membership) |
| Delete (Del) | Delete / Recycle | **Remove from collection** |
| Physical delete | Same | Explicit **Delete from Disk…** |
| Open folder member | Enter that folder | Navigate to the **real** folder |
| Open nested Virtual Folder | Enter subfolder | Stay on the same document; push an in-document group |
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
    { "id": "…", "kind": "folder", "path": "F:\\AI\\Training", "relative": false },
    {
      "id": "…",
      "kind": "virtualFolder",
      "label": "Watch later",
      "children": [
        { "id": "…", "kind": "file", "path": "clips/a.mp4", "relative": true }
      ]
    }
  ]
}
```

- **Relative** paths use `/` and resolve against the document’s parent directory (preferred when the target is under that tree).
- **Absolute** paths are native (cross-drive / UNC).
- **Nested Virtual Folders** are **embedded groups** (`label` + `children`) — not separate `.mfevirtual` files.
- **Legacy:** an entry with `kind: "virtualFolder"` and a `path` to another `.mfevirtual` still loads as an external link; new creates never write those. Peer `.mfevirtual` files that are only legacy members may still be hidden from the parent directory listing.
- Broken targets stay in the file; UI shows Missing + **Locate Target…**.

## Navigation

`Tab.path` is still the **absolute path of the `.mfevirtual` file** on disk (no fake `Collection.mfevirtual\Child` filesystem paths). In-document groups use an internal group stack (and opaque `mfe-vfgroup:…` row paths for selection/tree only).

In the UI the document is presented as a **folder**:

- Listed and sorted with folders; Type = Virtual Folder; folder+paper icon
- Extension never shown in labels
- Appears in the folder **tree**; expand shows groups and referenced folders; drop onto it adds references
- **Open as root in new tab** scopes the tree to the collection

Opening a referenced real folder navigates to that real path; opening an embedded group stays on the document and lists that group’s children. Back / Up pop the group stack, then leave the document (or return to the collection when tab-rooted).

## Create / edit

- **New → Virtual Folder** (or context **Add → Virtual Folder**) in a real folder creates a `.mfevirtual` document on disk and starts inline rename.
- Inside an open Virtual Folder, **New** / **Add** offers **only Virtual Folder** — inserts an **embedded group** into the current group (or root) and starts rename of its label. No second file on disk.
- Drop or paste into an open Virtual Folder to add references into the **current group** (duplicates skipped). **Cut / move** from one Virtual Folder into another **moves the reference** (add to destination, remove from source). Copy leaves the source membership.
- **Del** removes membership (or the whole embedded group); **Shift+Del** / **Delete from Disk…** uses normal delete confirms for real targets / document files.

## UI wording

- New → Virtual Folder  
- Add to Virtual Folder  
- Remove from Virtual Folder  
- Type: Virtual Folder  
- Reveal Real Location  

## Name clashes (portable)

Stem = filename without `.mfevirtual`. In the same parent directory, MyFileExplorer avoids:

- Real folder `Name` next to `Name.mfevirtual`
- Creating either when the other already exists (auto-suffix `Name (2)` …)

Wording is “name already used” / conflicts with a folder or Virtual Folder — not mount-specific (works on Linux too).

## OS projection (D68, Windows-only, DEV-gated)

Optional **in-place** WinFsp mount: `Name.mfevirtual` → sibling directory `Name\`. Explorer and other apps browse members there. Independent .NET service; MFE Project UI is win32-only and **hidden unless the DEV gate is active**. Linux keeps in-app D67 only (FUSE deferred). Local disk only in v1 (UNC rejected). Embedded groups appear as directories inside the mount; legacy path-based nested documents use a visited-set for cycles.

See [VIRTUAL_FOLDER_PROJECTION.md](VIRTUAL_FOLDER_PROJECTION.md).

## Non-goals (v1 in-app)

Smart/query folders, global Virtual Folder database, automatic link repair across disk, recursive expansion of member folders in the MFE UI, ADS, fake nested FS paths, volatile size/mtime in JSON, automatic migration of legacy sibling nested `.mfevirtual` files into embedded groups.

## Related

- Decision: [DECISIONS.md](DECISIONS.md) **D67**, **D68**
- Preview: selecting a `.mfevirtual` in its parent shows a Virtual Folder preview (not raw JSON)
- CLI / association: [INTEGRATION.md](INTEGRATION.md)
- OS projection: [VIRTUAL_FOLDER_PROJECTION.md](VIRTUAL_FOLDER_PROJECTION.md)
