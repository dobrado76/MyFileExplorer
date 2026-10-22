# Reference

Exact behavior for support questions. Feature essays live in the topic documents. This page is the short contract.

## Keyboard (file window)

These are handled by the explorer shell when a text field is not focused. During rename, **Delete** and **Backspace** edit the name; they do not delete the file.

| Chord | Action |
| --- | --- |
| Ctrl+T | New tab |
| Ctrl+W | Close the active tab |
| Ctrl+Shift+T | Reopen the most recently closed tab (cap 25). Search-result tabs are not restored. |
| Ctrl+Tab | Next tab |
| Alt+Left | Back |
| Alt+Right | Forward |
| Backspace | Back if this tab has history; otherwise up. In the Recycle Bin view, leaves that view. |
| F5, Ctrl+R | Refresh the listing (not a browser reload) |
| F2 | Rename the single selection, or the focused tree folder |
| Ctrl+C / Ctrl+X / Ctrl+V | Copy, cut, paste files. If text is selected, Ctrl+C copies that text instead. |
| Ctrl+Shift+V | Paste as a plan (review before the copy runs) |
| Ctrl+A | Select all |
| Ctrl+Z | Undo the last file operation the app recorded |
| Ctrl+Y, Ctrl+Shift+Z | Redo |
| Delete | Recycle the selection (tree focus recycles that folder) |
| Shift+Delete | Permanent delete |
| Ctrl+E | Edit image, when exactly one editable image is selected |
| Ctrl+F | Power Search |
| Ctrl+Shift+F | Focus the toolbar search box |
| Ctrl+Shift+P | Toggle the preview surface |
| Ctrl+L | Edit the address bar |
| Enter | Open the selection. In the Recycle Bin, restore it. |

**Plan before a write:** hold Ctrl while clicking **Paste** or **Delete** on the toolbar or the context menu, or press **Ctrl+Delete** or **Ctrl+Shift+V**. That opens the plan dialog (dry run) before anything is written. **Ctrl+C**, **Ctrl+X**, and **Ctrl+V** are clipboard copy, cut, and paste. Dragging with Ctrl copies; it does not open the plan.

A tab can have its own drop shortcut (right-click the tab → **Set drop shortcut…**). That chord moves or copies the focused selection into the tab’s folder. It cannot reuse a chord in the table above. **Auto** uses extra Shift/Ctrl on the keypress to force copy or move; the tab can instead be **Always move** or **Always copy**.

## Slideshow keys

Esc, Space, Enter, or a click stops the show. `\` undoes the last categorize or delete still buffered in the show. Crop keys are documented in [SLIDESHOW.md](SLIDESHOW.md). Camera looks do not change the file.

## Name order

- **Explorer** (default): Windows `StrCmpLogicalW`. Digit runs compare as numbers. `002` before `02` before `2`.
- **Literal**: character by character. `0` before `s`. `file10` before `file2`.

Settings → Behavior → **Name sort**.

## Delete, undo, conflicts

- **Delete** uses the Windows Recycle Bin through the app. Restore from the in-app Recycle Bin. The app does not send you to Explorer’s bin.
- **Shift+Delete** is permanent. Multi-select and folders ask for confirmation. A single file may not, unless **Confirm permanent delete always** is on.
- Long copy, move, trash, and delete show progress and **Cancel**.
- If some names already exist, items that can proceed do so. One review at the end offers Skip, Keep both, Replace, Keep most recent, and Retry.
- Undo/redo covers the file operations the app performed (copy, move, rename, delete, and similar). It does not undo edits made in another program. It does not restore a permanent delete; that needs **Undelete** (NTFS MFT), which is not the same as Recycle Bin restore and does not always succeed.

## Storage map

| Data | Where |
| --- | --- |
| Preferences | `%APPDATA%\MyFileExplorer\settings.json` |
| Open tabs | `session.json` in that folder |
| Window position | `window-state.json` |
| Search index | `search-index.sqlite` |
| Logs | `logs\main.log` (truncated above 2 MB) |
| Scripts | `scripts\` |
| AI API keys | `ai-secrets.json` (not in export) |
| Notes, icons, stats, media metadata, user metadata, image versions | NTFS ADS on the file or folder |

`MFE_USER_DATA` replaces the app-data directory. `MFE_ISOLATED_USER_DATA=1` uses `.dev-user-data\` in the repo. Neither changes the files you browse.

## File formats this app owns

| Extension or stream | Meaning |
| --- | --- |
| `.mfevirtual` | Virtual Folder document: references to real paths, not copies of the files. |
| `.map` | Slideshow categorizer map imported or exported from Mapping Manager. The live map is also inside settings. |
| Settings export | JSON envelope `format: "myfileexplorer-settings"`. |

Preview reads many other extensions (images, video, PDF, archives, Office text, meshes). The list is [PREVIEW_EXTENSIONS.md](PREVIEW_EXTENSIONS.md). The app does not become the editor for those formats except the in-app image editor for images it can edit.

## Launch from another program

```text
MyFileExplorer.exe --reveal "D:\Projects\shot.png"
MyFileExplorer.exe --open "D:\Projects"
mfe://reveal?path=D%3A%5CProjects%5Cshot.png
```

`--reveal` selects a file in its parent folder. `--open` opens a folder tab. A second launch focuses the running instance. Details: [INTEGRATION.md](INTEGRATION.md).

## External programs (boundary)

| Tool | Required? | This app | The other tool |
| --- | --- | --- | --- |
| Windows | Yes | File manager UI, Recycle Bin calls, NTFS | The operating system, Explorer, permissions, UAC |
| `git` | Only if Git is enabled | Menus, overlays, how arguments are passed | Clone, commit, credentials, hooks |
| PowerShell, Python 3, cmd, or bash | Only for scripts | Editor, runner, context menu, dry-run | Language, modules, execution policy |
| mpv | Only if Rich player is on | Settings → Preview, overlay when Chromium cannot play the file | Decoding that container. Also searched on PATH. Developers can run `npm run tools:fetch-mpv`. |
| WinFsp | Only for Virtual Folder OS projection | Mount request and the projection service from the release zip | The filesystem driver |
| TMDB, OMDb, Plex | Only for media metadata download/extract | Stores results on the folder as ADS | Their accounts, APIs, and servers |
| FTP/SFTP server | Only for remotes | Client UI and transfers | The server, accounts, host keys |

This app does not install Git, Python, WinFsp, or Plex for you.

## Limits (verified)

- Layouts: 50. Templates: 40. Quick Launch: 24. Recently closed tabs: 25. Reopen closed window: 10.
- Slideshow image-list cache cap: 100 000 paths.
- Text preview default max: 2 097 152 bytes.
- Image-edit versions kept on the file: 4 (`VER_1`…`VER_4`).
- Custom camera looks: 24, up to 8 sliders each.
- Folder space-map file tiles: default 50 000 (range 100–50 000).
- User-metadata library filter entries for media: max 200 stored Watched/Genre choices.
- `main.log` truncates when larger than 2 MB.

## Generation metadata

When a PNG or JPEG contains an Automatic1111-style parameter block (PNG text, JPEG comment, or EXIF description/comment), the preview can show prompt, negative prompt, steps, sampler, CFG, seed, size, model, and VAE. **Raw parameters** appears when the prompt or negative prompt did not parse. Details columns can show a subset of the same fields.
