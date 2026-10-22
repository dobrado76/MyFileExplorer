# Configuration

Preferences live in `%APPDATA%\MyFileExplorer\settings.json`. Change them in **Settings** (the gear). They apply as you change them; there is no separate Save button for the settings window.

Settings has a search box at the top. It filters the section list (about 180 ms after you stop typing).

## Sections

| Section | What it controls |
| --- | --- |
| **Appearance** | Theme (dark, light, custom colors), font family and size, icon size, tab width and tab icons, tree pin, Recycle Bin placement. **Show Undelete toolbar button** is off by default. |
| **Behavior** | Folders first, **Name sort**, checkboxes, paste of non-file clipboard data, default new-tab path, permanent-delete confirm, command-line shell (cmd or PowerShell), extensions hidden in labels, folder statistics, Virtual Folder OS projection (off). |
| **Context menu** | Hide, reorder, and add commands. **Discover** can add static shell verbs. Custom commands are stored in settings. |
| **Quick access** | Pinned folders and groups in the tree. |
| **Quick launch** | Toolbar buttons that start other programs. The strip is hidden when the list is empty. Cap 24. |
| **Layouts** | Named workspace snapshots. **Auto-save on switch** defaults on. Cap 50. Order in this list is the menu order. |
| **Folder views** | Per-folder view mode, sort, and Details columns. Separate from layouts. |
| **View filter** | Patterns the toolbar eye applies (hidden names such as `node_modules`, wildcards). The eye can be turned off per session. |
| **Preview** | Text size limit (default 2 MB), word wrap (off), video autoplay (off), **Rich player (mpv)** (off), thumbnail-strip frame delay (default 300 ms, range 50–2000). |
| **Search index** | Indexed folders, excludes, match options, bookmarks, filters, optional local HTTP API (off, port 8081). |
| **Network** | LAN discovery and mapped-drive behavior. |
| **Windows integration** | Experimental redirect of folder Open/Explore to MyFileExplorer. Off until you opt in. See [WINDOWS_SHELL_REDIRECT.md](WINDOWS_SHELL_REDIRECT.md). |
| **Remote repositories** | FTP, FTPS, and SFTP. Off until enabled. Passwords are not written into a settings export. |
| **Slideshow** | **Enable slideshow UI** (off). Delay default 2000 ms. Include subfolders defaults on. **Camera looks** off until enabled. |
| **Media Metadata** | Movie/TV metadata. Off. Cover height default 120 px. |
| **Metadata** | User-defined fields. **Enable** is off. |
| **Git** | Git overlays and actions. Off. Uses the `git` on your PATH unless you set an executable path. |
| **Scripting and AI** | **Enable scripting** is off. Interpreters, Ask AI, providers. API keys are not stored in `settings.json`. |
| **Advanced** | Disable hardware acceleration (off). Optional search HTTP API. |
| **About** | Running version, **Export…**, **Import…**, update check. **Updates source** is a local installer folder or a GitHub Releases URL. |

## Defaults that surprise people

- **Name sort** is `explorer` (Windows logical order: digit runs compare as numbers). **Literal** is character-by-character (`file10` before `file2`). The file list, the tree, and slideshow name order share this. Inside a media library, thumbnail and icon Name order is still season then episode.
- **Folders first** is on. Media Metadata can mix files and folders in icon/thumbnail view of a library when that option is on. List and Details still follow Folders first.
- **Delete** goes to the Recycle Bin. **Shift+Delete** is permanent. **Confirm permanent delete always** is off, so a single file may delete after less prompting than a multi-selection or a folder. Do not test this on files you need.
- **Hide name extensions** defaults to `lnk` and `mfevirtual`. The file is still there; the label omits the suffix. Rename and tooltips use the real name.
- **Search excludes** start as `node_modules`, `.git`, `.hg`, `.svn`, `Thumbs.db`.
- **Indexed-only search** is off, so the toolbar searches the current folder by walking it until you turn indexed search on.
- **Paste screenshots and text** is on. A URL becomes a `.url` shortcut. The page is not downloaded.
- **Hardware acceleration** stays on unless you disable it under Advanced. Turn it off only when the GPU must be left to another program, then restart the app.

## Export and import

Settings → **About** → **Export…** writes an envelope:

- `format` is `myfileexplorer-settings`.
- The settings document is included, except dialog and window geometry (positions and sizes of tool windows).
- Network hosts and remote connection definitions are included **without passwords**.
- The script library source is included **without AI API keys**.

Not included: `session.json` (open tabs), `window-state.json`, thumbnail cache, search index, `ai-secrets.json`, custom Quick Launch PNG files.

**Import…** replaces settings (and those sidecars when the file contains them). A raw `settings.json` is also accepted. Import overwrites the current preferences. Export first if you might want the old ones back.

## What is not a setting

These live on the NTFS file or folder as alternate data streams. They survive settings import, and they are **not** inside the settings export:

- Notes (`mfe_note`), item icons, folder statistics, media metadata and covers, user-metadata values (`mfe_meta`), image-edit versions (`VER_1`…`VER_4`).

Copying that file to a non-NTFS disk, or backing it up with a tool that ignores ADS, drops them even when the main bytes copy successfully.

## Privacy before you share a config file

Export is safer than `settings.json`, and it is still not public. It can list folder paths, Quick Launch program paths, Plex/TMDB/OMDb fields, Git tool templates, and remote host names. Remove those before posting an issue. Never attach `ai-secrets.json` or a live `settings.json`.
