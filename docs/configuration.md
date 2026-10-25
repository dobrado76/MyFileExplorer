# Configuration

Preferences live in `%APPDATA%\MyFileExplorer\settings.json`. Change them in **Settings** (the gear). They apply as you change them; there is no separate Save button for the settings window.

Settings has a search box at the top. It filters the section list (about 180 ms after you stop typing).

## Sections

| Section | What it controls |
| --- | --- |
| **Appearance** | Theme (dark, light, custom colors), font family and size, icon size, tab width and tab icons, tree pin, Recycle Bin placement. **Show Undelete toolbar button** is off by default. |
| **Behavior** | Folders first, **Name sort**, **Item check boxes**, **Paste non-file clipboard as a file**, default new-tab path, **Always confirm permanent delete**, **Open Command Line** (cmd or PowerShell), **Hide extensions in names**, **Video thumbnail frame delay (ms)** (default 300, range 50–2000), folder statistics, Virtual Folder OS projection (off). New-file templates are **New → From Template** / **Manage Templates…** (cap 40). The catalog is in settings; the file copies are `%APPDATA%\MyFileExplorer\Templates\`. |
| **Context menu** | Hide, reorder, and add commands. **Discover** can add static shell verbs. Custom commands are stored in settings. |
| **Quick access** | Pinned folders and groups in the tree. |
| **Quick launch** | Toolbar buttons that start other programs. The strip is hidden when the list is empty. Cap 24. |
| **Layouts** | Named workspace snapshots. **Auto-save when switching layouts** defaults on. Cap 50. Order in this list is the menu order. |
| **Folder views** | Per-folder view mode, sort, and Details columns. Separate from layouts. |
| **View filter** | Patterns the toolbar eye applies (hidden names such as `node_modules`, wildcards). The eye can be turned off per session. |
| **Preview** | **Show preview by default** (on), **Max text preview bytes** (default 2 MB), **Word wrap text preview** (off), **Autoplay media in preview** (off), **Rich player (mpv)** (off). |
| **Search index** | Indexed folders, excludes, **Show hidden files in search**, bookmarks, saved filters. The toolbar search-options checkbox **Search indexed roots** is remembered, but it is not a control on this page. |
| **Network** | LAN discovery and mapped-drive behavior. |
| **Windows integration** | **Redirect folder openings to MyFileExplorer** (experimental, off until you opt in). Machine-local; not in a settings export. **Restore previous folder-opening configuration** puts the old verbs back. See [WINDOWS_SHELL_REDIRECT.md](WINDOWS_SHELL_REDIRECT.md). |
| **Remote repositories** | FTP, FTPS, and SFTP. Off until enabled. Passwords are not written into a settings export. |
| **Slideshow** | **Enable slideshow UI** (off). Delay default 2000 ms. Include subfolders defaults on. **Camera looks** off until enabled. |
| **Media Metadata** | Movie/TV metadata. Off. Cover height default 120 px. |
| **Metadata** | User-defined fields. **Enable** is off. |
| **Git** | Git overlays and actions. **Enable Git integration** is off. Uses the `git` on your PATH unless you set **Git executable**. |
| **Scripting and AI** | **Enable scripting** is off. Interpreters, Ask AI, providers. API keys are not stored in `settings.json`. |
| **Advanced** | **Disable hardware acceleration** (off; restart required). **Enable localhost search API** (off, port 8081, loopback only). |
| **About** | Running version, **Export…**, **Import…**, **Check for update**. **Folder or URL** is a local installer folder or a GitHub Releases URL. |

## Defaults that surprise people

- **Name sort** defaults to **Windows Explorer** (digit runs compare as numbers). **Character by character** orders `file10` before `file2`. The file list, the tree, and slideshow name order share this. Inside a media library, thumbnail and icon Name order is still season then episode.
- **Folders first** is on. Media Metadata can mix files and folders in icon/thumbnail view of a library when that option is on. List and Details still follow Folders first.
- **Delete** goes to the Recycle Bin. **Shift+Delete** is permanent. **Always confirm permanent delete** is off, so a single file may delete after less prompting than a multi-selection or a folder. Do not test this on files you need.
- **Hide name extensions** defaults to `lnk` and `mfevirtual`. The file is still there; the label omits the suffix. Rename and tooltips use the real name.
- **Search excludes** start as `node_modules`, `.git`, `.hg`, `.svn`, `Thumbs.db`.
- **Search indexed roots** is off, so the toolbar searches the current folder by walking it until you turn that checkbox on.
- **Paste screenshots and text** is on. A URL becomes a `.url` shortcut. The page is not downloaded.
- **Hardware acceleration** stays on unless you disable it under Advanced. Turn it off only when the GPU must be left to another program, then restart the app.

## Export and import

Settings → **About** → **Export…** writes an envelope:

- `format` is `myfileexplorer-settings`.
- The settings document is included, except dialog and window geometry (positions and sizes of tool windows).
- Network hosts and remote connection definitions are included **without passwords**.
- The script library source is included **without AI API keys**.

Not included: `session.json` (open tabs), `window-state.json`, thumbnail cache, search index, `ai-secrets.json`, custom Quick Launch PNG files, or the file bytes under `Templates\`. The template catalog (names and stored filenames) is inside the settings document; the copies themselves are not.

**Import…** replaces settings (and those sidecars when the file contains them). A raw `settings.json` is also accepted. Import overwrites the current preferences. Export first if you might want the old ones back.

## What is not a setting

These live on the NTFS file or folder as alternate data streams. They survive settings import, and they are **not** inside the settings export:

- Notes (`mfe_note`), item icons, folder statistics, media metadata and covers, user-metadata values (`mfe_meta`), image-edit versions (`VER_1`…`VER_4`).

Copying that file to a non-NTFS disk, or backing it up with a tool that ignores ADS, drops them even when the main bytes copy successfully.

## Privacy before you share a config file

Export is safer than `settings.json`, and it is still not public. It can list folder paths, Quick Launch program paths, Plex/TMDB/OMDb fields, Git tool templates, and remote host names. Remove those before posting an issue. Never attach `ai-secrets.json` or a live `settings.json`.
