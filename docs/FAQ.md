# FAQ

Answers describe the shipping app. Settings → **About** is your build’s version. Topic files linked from [README.md](README.md) are the long form.

## Install and updates

### 1. Where do I download MyFileExplorer?

https://github.com/dobrado76/MyFileExplorer/releases/latest — the Windows installer is `MyFileExplorer-x.y.z.exe`. It is not stored in the git repository because of its size.

### 2. Where is it installed?

Usually `%LOCALAPPDATA%\Programs\MyFileExplorer\MyFileExplorer.exe`.

### 3. Does uninstall delete my settings?

No. `%APPDATA%\MyFileExplorer` is left in place. Your documents are untouched either way. Alternate streams already written on those documents stay until something else removes them.

### 4. Does uninstall delete my files?

No.

### 5. I installed a new version and my tabs are gone. Where are they?

Tabs are `session.json` in app data, not in the installer. An upgrade should keep that folder. If you renamed or deleted `%APPDATA%\MyFileExplorer`, the session is gone. Settings export does not contain open tabs.

### 6. How do I see the version?

Settings → **About**.

### 7. Can I run it on macOS?

No supported build.

### 8. Can I run it on Linux?

Experimental AppImage helpers only. [LINUX.md](LINUX.md). Windows is the platform the features are written for. NTFS alternate streams, the Recycle Bin, WinFsp projection, and Undelete are Windows behaviors.

## Windows and files

### 9. How is this different from File Explorer?

Same basic habits: Delete recycles, Ctrl drags a copy, shell icons, right-drag menus. Added: tabs that restore, a real preview, search you scope yourself, notes on the file, scripts, optional Git and media tools. It does not host shell extensions.

### 10. How do I open a folder?

Address bar (**Ctrl+L**), the tree, or **Ctrl+T** for a new tab. Another program can run `MyFileExplorer.exe --reveal "D:\path"`.

### 11. How do I go back?

Alt+Left, the Back button, or Backspace when the tab has history. If there is no history, Backspace goes up. In the Recycle Bin, Backspace leaves the bin.

### 12. How do I refresh?

**F5** or **Ctrl+R**. That reloads the listing. It is not a web-page reload.

### 13. How do I rename?

Select one item and press **F2**. While the name is being edited, Delete and Backspace change the text. Dragging a selection inside the name and releasing outside the box stays in rename.

### 14. What does Delete do?

Sends the selection to the Recycle Bin. The tree’s focused folder is deleted if the key event is on the tree. Restore from the in-app Recycle Bin. **Enter** there restores the selection.

### 15. What does Shift+Delete do?

Permanent delete. It does not go to the Recycle Bin. **Ctrl+Z** will not bring it back. Undelete is a separate, best-effort NTFS scan.

### 16. Why was there no confirm?

**Always confirm permanent delete** is off by default (Settings → Behavior). Multiple items and folders still confirm. Turn that option on if every permanent delete must ask.

### 17. Can I undo a copy, move, or rename?

**Ctrl+Z** undoes the last file operation the app recorded. **Ctrl+Y** or **Ctrl+Shift+Z** redoes it. The stack is memory for this run only, at most 30 operations. Quitting clears it. Undo does not reverse another program’s save, and it does not reverse Shift+Delete.

### 18. How does a name collision work?

The rest of the copy finishes, including the other items inside a folder. The destination folder created for that copy is not a collision, and it shows up in the list and the tree as soon as it is created. One review lists the real collisions: Skip, Keep both, Replace, Keep most recent, Retry. A folder you can read and write is copied; the review is for access denied and real name collisions. To preview first, hold Ctrl while clicking **Paste** or **Delete**, or press **Ctrl+Delete** or **Ctrl+Shift+V**. **Ctrl+C** / **Ctrl+V** stay normal clipboard commands. Dragging with Ctrl copies and does not open the plan.

### 19. How do I cancel a long copy?

The status bar progress has **Cancel**.

### 20. Paste created a PNG I did not expect.

**Paste non-file clipboard as a file** is on by default (Settings → Behavior). A copied screenshot becomes a PNG in the folder. A copied URL becomes a `.url` shortcut and is not downloaded. Turn that option off to stop that.

### 21. How do I create a symlink?

File Tools → **Create link…** — symbolic link, hard link, or junction. Windows may require administrator rights for some symbolic links.

### 22. How do I open Command Prompt here?

**Open Command Line here**. Settings → Behavior chooses cmd or PowerShell. Shift runs it as administrator (UAC).

### 23. Where is the Recycle Bin in the window?

Settings → Appearance → placement: none, tree, toolbar, or both. Default is both. The **?** next to that icon (it stays on the tab bar even when the bin is hidden) is Help. **GitHub documentation** opens the docs in your browser. **Copy AI support link** copies `https://raw.githubusercontent.com/dobrado76/MyFileExplorer/refs/heads/main/AI-SUPPORT.md`.

### 24. Can I cut and paste into Explorer and back?

Yes. The clipboard uses the normal Windows file drop format, so Cut pastes as a move in both directions.

## Tabs, panes, layouts

### 25. How do I close a tab and get it back?

**Ctrl+W** closes it. **Ctrl+Shift+T** or the tab bar **Recently closed** reopens it. The stack holds 25. **Clear recently closed** empties it. A search-results tab is not restored.

### 26. How do I use two folders at once?

The layout control switches 1, 2, 3, or 4 panes. Two panes can show a paired-folder rail (copy and compare). See [PAIRED_FOLDERS.md](PAIRED_FOLDERS.md).

### 27. What is a named layout?

A snapshot of tabs, pane layout, and window positions, including extra explorer windows. Settings → **Layouts**. Switching layouts auto-saves the one you left when that option is on (default on). Applying a layout closes explorer windows that are not in the snapshot. Cap 50.

### 28. What is a view preset versus a folder view?

A view preset stores mode, sort, and Details columns and can be applied without creating a per-folder override. A folder view is an override stored for that path. Apply of a preset patches an existing override; it does not create one.

### 29. How do I move a tab to another window?

Tab menu **Move to new window**. **Merge into main window** sends it back. Closing a floated window asks Merge or Close tabs. **Reopen closed window** keeps up to 10. Dragging a tab off to tear it is not in this version.

### 30. What is a tab drop shortcut?

Right-click a tab → **Set drop shortcut…**. Pressing that chord copies or moves the focused selection into the tab’s current folder. Reserved chords such as Ctrl+C are rejected. The shortcut is saved on the tab and in layouts.

### 31. Why did an offline network tab stay instead of disappearing?

Encrypted and network paths are kept so they can reconnect. They are not deleted from the session just because the disk was asleep.

## View and sort

### 32. Why is `file2` before `file10`?

That is Explorer order (the default **Name sort**). Digit groups compare as numbers. Settings → Behavior → **Literal** uses character order, where `file10` comes first.

### 33. Why did sort change inside a TV folder?

Thumbnail and icon Name order in a marked media library is season then episode, not the raw filename. List and Details follow the normal folders-first and name-sort rules unless Media Metadata’s mix option applies to icon views.

### 34. How do I hide `node_modules`?

The toolbar eye applies the view filter. Patterns are Settings → **View filter**. Search excludes are separate (Settings → **Search index**) and start with `node_modules`, `.git`, `.hg`, `.svn`, and `Thumbs.db`.

### 35. The extension is missing on shortcuts.

Settings → Behavior hides the label suffix for `lnk` and `mfevirtual` by default. The file name on disk still has the extension.

### 36. How do I add a Details column?

Right-click the Details header, or Settings → **Folder views**. Image, media, tag, generation, note, Git, and statistics columns exist. Some fill in after a background read (they show empty until then). Generation columns appear when the file has that metadata.

## Preview and images

### 37. How do I show or hide preview?

**Ctrl+Shift+P**, or the panel control. **Open preview window** moves the same preview into its own window and hides the docked pane.

### 38. What can preview show?

Images (including JFIF and HDR), video and audio, PDF, HTML and Markdown, extracted Office text, PowerPoint slides, calendar and email (`.ics`, `.eml`), 3D meshes, CHM, ZIP/7z/RAR/tar.gz, shortcuts, SafeTensors, Unity packages, and executables. Full list: [PREVIEW_EXTENSIONS.md](PREVIEW_EXTENSIONS.md).

### 39. Why won’t this MKV play inside the pane?

Chromium’s player is used for types it can play (MP4, WebM, MOV, and similar). MKV, TS, WMV, AVI, and similar offer **Open with default app** unless **Rich player (mpv)** is on and mpv can be started. A decode error does not automatically switch to mpv.

### 40. What is Keep playing?

On a video, **Keep playing** opens **Now Playing**, which keeps that file playing while the preview follows whatever you select next. **Dock** returns playback to the preview when that file is still the preview target. Closing the window ends it. Deleting or moving the file stops it.

### 41. How do I edit an image?

Select one editable image and press **Ctrl+E**, or use the editor command. On **Annotate**, draw a text box. It stays selected, with the same move and resize handles as a rectangle. Type in it, including **E**. **Escape** leaves the text box and brings the handles back; **Escape** again closes the editor. **Ctrl+S** still saves from that box. When the file has saved versions, **Undo last** in the editor top bar drops only the newest one and reloads the previous. The same action is **Undo last edit** on the **Version Control** menu. File-window keys such as **Backspace**, **Delete**, and **Ctrl+A** stay in the editor until it closes. Saves write the picture and keep up to four earlier versions in NTFS streams `VER_1`…`VER_4` on that file. Revert uses those streams. Zipping the file with a tool that drops ADS drops the versions. A context command that launches Photoshop on one image with versions asks whether to open the original or commit the newest edit into the file first.

### 42. The editor opened empty.

That was a defect fixed for the 0.21.0 release. Update if you are on an older build. If a current build still opens empty, note the extension and the **About** version in a bug report.

### 43. Where do video thumbnail strips come from?

A hidden sibling folder `!VIDTHUMB_CACHE` next to the videos. The context command is **Generate video preview** (one file) or **Generate video previews** (a selection). **Video thumbnail frame delay (ms)** is Settings → Behavior (default 300, range 50–2000), not the Preview page.

### 44. Why is the preview text cut off?

Text preview stops at **text preview max bytes** (default 2 MB). Raise it under Settings → Preview. Word wrap is off until you enable it.

## Search

### 45. Does this use Everything?

No. The query style is similar. The index is this app’s SQLite index of roots you add. A search that is not indexed walks the current folder.

### 46. How do I search only what I indexed?

Open the toolbar search options and turn on **Search indexed roots**. That choice is remembered. Add the folder or drive under Settings → **Search index**. That settings page does not contain the checkbox.

### 47. How do I type a query?

Toolbar box (**Ctrl+Shift+F**). Examples: `ext:png`, `size:>1mb`. **Ctrl+F** opens **Power Search**, the visual builder. Operators and date fields are in [SEARCH.md](SEARCH.md).

### 48. The search box stuck after I clicked the address bar.

Leaving a search via the breadcrumb or address bar cancels the walk and clears the query so the box stays editable. If an old build revived the query, update.

### 49. Search results changed my view to Details.

Current builds keep the view you had (thumbnails, icons, list, or Details). The view picker still works on the results. Details adds a Folder column, and the column headers sort those hits.

### 50. Can another program call search?

Settings → **Advanced** → **Enable localhost search API**. It is off by default (port 8081, this PC only). It searches indexed roots. Leave it off unless you intend to use it. Do not publish the token or forward the port.

## Slideshow and camera looks

### 51. How do I start a slideshow?

Settings → **Slideshow** → **Enable slideshow UI**. Then the toolbar and the folder command **Start Slideshow** appear. Until that switch is on, those controls stay hidden. The settings section itself stays visible.

### 52. What does Include subfolders do?

Default on: the show walks child folders. Off: only the folder you started from.

### 53. How do I stop?

Esc, Space, Enter, or click. The cursor hides after about two seconds of idle.

### 54. I categorized the wrong picture.

Press `\`. That undoes the last categorize or delete still buffered in the show.

### 55. What are camera looks?

Color, grain, and blur drawn on the slide only. The file is not modified. Settings → Slideshow → **Camera looks** is off until you turn it on. Frequency must be above 0, and at least one effect must be checked. **Camera looks…** edits the list, sliders, and optional custom shaders. The same position in the playlist keeps the same look when you step back.

### 56. Why did only some photos change?

Frequency below 100% skips some indexes. A path filter skips paths that do not match. Empty filter means all paths. `AI` matches those letters anywhere. `\AI\` matches a folder whose name is `AI`. Crop mode shows the untreated photo.

### 57. The show got slower when looks are on.

The slide is decoded and then drawn through the GPU. Dusty lens does much more work per pixel than the other built-in looks. Uncheck Dusty lens, or turn **Camera looks** off. The original file is unchanged.

### 58. The Camera looks window shows the effect, but the show does not.

The window previews the selected effect even when the slideshow switch or the master **Camera looks** switch is off. The show needs **Enable slideshow UI**, **Camera looks** on, and frequency above 0. If the status says the slideshow skips this photo, the path filter excluded it.

### 59. Where is the categorizer map stored?

Settings → Slideshow → **Mapping Manager…**. Rows are inside settings (`slideshow.categorizerMap`) and travel with export/import. An exported `.map` file is a copy; deleting the file does not clear the settings.

## Metadata, notes, statistics

### 60. How do I attach a note?

Right-click → **Note…**. It is stored on the file as an NTFS stream, not as a sibling text file. Preview and the Details checklist columns can show it. Power Search understands `note:`, `todo:`, and `hasnote:`.

### 61. How do I set a custom icon on one file?

Right-click → **Set icon…**. That is not File Tools → **Change Icon…** (the Windows icon change). Created and Modified times are restored after the write.

### 62. How do I see which folders use the most space?

Select the folder → **Calculate Statistics**. The folder preview then includes a space map. Details Size can show the calculated total afterward. Shift+click is the variant that skips tagged paths. See [FOLDER_STATISTICS.md](FOLDER_STATISTICS.md).

### 63. What is user metadata?

Settings → **Metadata** → **Enable** (off by default). You define field sets, bind them to folders, and edit values. Values are an NTFS stream `mfe_meta` on the item. Details columns and Power Search `meta.<key>:` can read them. Guide: [USER_METADATA.md](USER_METADATA.md).

### 64. When do I see Raw parameters?

When the prompt body is missing, or a negative-prompt section was present but not parsed. A successful parse hides it.

### 65. Will notes show on a FAT USB stick or a zip file?

No. Alternate streams are NTFS. Copies that ignore ADS, and zip tools that store only the main bytes, drop them.

## Movies and TV

### 66. How do I turn on movie metadata?

Settings → **Media Metadata** → Enable. Then right-click a movie or show folder → extract from Plex or download from the internet (TMDB or OMDb). You supply those credentials. They are settings fields; treat an export as private.

### 67. Where is the poster stored?

On the folder as NTFS streams, not in a sidecar jpg you have to keep next to the video. Episode files use `SxxExx` titles when the show option is on.

### 68. Watched and genre filters disappeared after I switched folders.

The last choice is remembered per library folder (up to 200 folders), not as one global filter.

## Scripts and AI

### 69. How do I run a script on this folder?

Settings → **Scripting and AI** → **Enable scripting**. Toolbar **Scripts** → new script, or the context menu **Scripts**. Choose PowerShell, Python 3, cmd, or bash. Python 2 is not supported. **Stop** kills the run. Guide and examples: [SCRIPTS.md](SCRIPTS.md).

### 70. Does Ask AI read my files?

No. The request is the task you describe and the script text. Paths and file bytes from the folder you are browsing are not uploaded. After you save, the script runs locally.

### 71. Where is the API key?

In `%APPDATA%\MyFileExplorer\ai-secrets.json`, protected with the OS credential store. It is not in Settings export. Do not copy that file into an issue.

### 72. A global script has no folder. Where is the button?

Each global script is its own toolbar button, using the same icon style as Quick Launch.

## Git

### 73. How do I enable Git?

Settings → **Git** → Enable. Git must be installed (`git` on PATH, or an executable path you set). The app does not store your Git password.

### 74. I deleted `.git` and the buttons stayed.

Current builds clear the cached status so the toolbar and Git preview tab go away. Update if an older build left `fatal: not a git repository` on screen.

### 75. Who decides commit rules and hooks?

Git. This app starts Git and shows its output. Hook failures and authentication are Git’s. Use Git’s documentation for remotes, credentials, and rebase.

## Network and remotes

### 76. How do I reconnect a mapped drive?

Expand **Network** in the tree and click the disconnected letter. You do not have to open Explorer first. [NETWORKS.md](NETWORKS.md).

### 77. How do I add SFTP?

Settings → **Remote repositories** → enable, then add the host. Passwords are not included in settings export. The server’s own accounts and firewall are outside this app. [REMOTE_FTP.md](REMOTE_FTP.md).

## Virtual folders

### 78. What is a Virtual Folder?

A `.mfevirtual` file that lists paths. Opening it shows those items as a folder. Deleting inside it removes the reference, not the original file, unless you explicitly delete the target. [VIRTUAL_FOLDERS.md](VIRTUAL_FOLDERS.md).

### 79. Why doesn’t Explorer show the same folder?

OS projection is optional and off. It needs WinFsp plus the projection service from the release. Settings → Behavior → **Virtual Folder OS projection**. Without that, only MyFileExplorer shows the collection. [VIRTUAL_FOLDER_PROJECTION.md](VIRTUAL_FOLDER_PROJECTION.md).

## Undelete and the USN journal

### 80. How do I get back a Shift+Delete file?

Settings → Appearance → **Show Undelete toolbar button** (off by default). Use the new tab-bar icon. Scan, then recover into a folder you choose. Files are written with their relative parent paths, not dumped into one flat directory. This is MFT recovery, not Recycle Bin restore. It can fail if the disk reused the space. It may ask for administrator approval. [UNDELETE.md](UNDELETE.md).

### 81. What is Drive Properties → USN…?

The NTFS change journal used to notice creates and deletes for the search index. Enabling or resizing it can ask for UAC. **Delete journal** forces a full volume scan and cannot be cancelled. Do not use it on a large disk unless you intend that scan. [SEARCH.md](SEARCH.md).

## Performance and safety

### 82. Thumbnails flash or the UI stalls while scrolling.

Thumbnail work is queued so it should not freeze preview. A fix for scroll flashing in large thumbnail folders shipped in 0.21.0. Update if you still see the old flash, and include the folder size in a report.

### 83. Should I turn off hardware acceleration?

Only when another program needs the GPU and this app is competing with it. Settings → **Advanced**. Restart. Turn it back on afterward; the interface is slower without it.

### 84. Is my folder uploaded anywhere?

Normal browsing, preview, search, and slideshow stay on this PC. Ask AI sends only the script task you submit. Media metadata download contacts TMDB, OMDb, or your Plex server when you run that command. FTP/SFTP contacts the host you configured. Nothing else is a cloud drive.

### 85. Can I back up the app?

Export settings from **About** for preferences, hosts (no passwords), and scripts (no API keys). The template catalog is in that file; the copies under `Templates\` are not, and neither are Quick Launch images. Separately back up files **with** NTFS streams if you use notes, covers, or statistics. Copying only `settings.json` does not copy notes.

## Failures

### 86. The app vanished on startup.

Read `%APPDATA%\MyFileExplorer\logs\main.log`. Rename the app-data folder to `MyFileExplorer.bak` and start again to test a clean profile. See [troubleshooting.md](troubleshooting.md). Do not delete the `.bak` until you know you do not need the export.

### 87. Preview says the file is missing, but Explorer shows it.

You may be in a search result or a virtual folder whose target was moved. **F5**. If the path was a network share, reconnect it from **Network**.

### 88. I want slideshow captions drawn on the photo. Where is that switch?

The public Slideshow settings do not include that control. If you do not see it, it is not part of the supported UI. Do not invent a settings key or a hidden file to turn it on. Camera looks are the display treatment that is documented, and they do not burn text into the file.

### 89. Who do I tell if this is a bug?

https://github.com/dobrado76/MyFileExplorer/issues — version from **About**, what you expected, the exact message, and a short log excerpt with personal paths removed. Do not attach settings or API keys. If `logs\main.log` is empty, the app may have started after the file passed 2 MB: that launch empties it.

### 90. Ctrl+Z is empty after I restarted. Where did undo go?

Nowhere to restore. Undo is a memory stack for the current run (at most 30 operations). It is not written to disk. A Recycle Bin file is still in the in-app bin. A Shift+Delete is not on the stack; Undelete is the separate NTFS scan, and it can fail.

### 91. How do I rename many files at once?

Select them, then right-click → **Power Rename…**. Search and replace can be literal, DOS `*` / `?`, or regex. **Advanced options** add case, numbering, dates, and similar transforms. Apply renames the selected names only. It does not open folders and rename what is inside. **Ctrl+Z** can reverse that batch while it is still on this session’s undo stack. [POWER_RENAME.md](POWER_RENAME.md).

### 92. How do I compare two folders?

Use a two-pane layout. The centre rail is there whenever layout 2 is active. **Compare** classifies the two folders by relative path. The single-arrow copy actions work without a compare. Sync uses a reviewed plan. This is not Git and not a cloud sync. [PAIRED_FOLDERS.md](PAIRED_FOLDERS.md).

### 93. How do I create a file from a template?

**New** → **From Template**, or the same command on the context menu. **Manage Templates…** adds a file, sets the pretty name (menu label and default filename), and reorders the list. Cap 40. The copies live in `%APPDATA%\MyFileExplorer\Templates\`. Settings export keeps the catalog, not those file bytes.

### 94. How do I check for an update?

Settings → **About** → **Check for update**. **Folder or URL** is the updates source: the default GitHub Releases URL, or a local folder of installers. The installer name is `MyFileExplorer-x.y.z.exe`. When a newer build is listed, **What's new** loads the release notes. [BUILD.md](BUILD.md).

### 95. Can Windows open folders in MyFileExplorer instead of Explorer?

Only if you turn on Settings → **Windows integration** → **Redirect folder openings to MyFileExplorer**. It is off until you opt in. It is per-user, experimental, and not part of a settings export. **Restore previous folder-opening configuration** puts the old verbs back. It is not a full Explorer replacement. [WINDOWS_SHELL_REDIRECT.md](WINDOWS_SHELL_REDIRECT.md).

### 96. Can I use thumbnails or Details, and sort by date, while search results are showing?

Yes. Change the view picker while the results are open. Thumbnails, icons, list, and Details all show the hits. In Details, click a column header — **Date modified**, **Date created**, Size, or Name — to sort the hits. That choice is the folder’s view, so it stays after you clear the search. Details also shows a Folder column for the parent path.
