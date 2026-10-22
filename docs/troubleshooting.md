# Troubleshooting

Least invasive check first. Do not delete `%APPDATA%\MyFileExplorer` as a first step. That removes settings, tabs, the search index, and saved scripts. It does not remove notes stored on your files.

When a step says “export settings”, use Settings → **About** → **Export…** and keep the file offline.

## The window never opens, or it closes immediately

**Causes:** A previous crash, a bad GPU driver, or a broken `settings.json`.

**Checks:**

1. Look at `%APPDATA%\MyFileExplorer\logs\main.log`. On the next launch, a file larger than 2 MB is emptied and logging starts over. Lines from before that launch are gone. If the app is still running and the file is already over 2 MB, those lines are still there until the next start.
2. If the log mentions the GPU or the window flashes then dies, set hardware acceleration off. If you cannot open Settings, start once with a copy of the app data folder renamed aside (see below) so defaults load.

**Resolution:** Rename `%APPDATA%\MyFileExplorer` to `MyFileExplorer.bak`. Start the app. If it opens, the previous app data was the problem. Copy `settings.json` back only after you have a working window; if the copy makes it crash again, keep the new folder and use pieces of the export you made earlier. Your documents were not in that folder.

**Expected result:** A window on This PC or your last tabs, using either the repaired settings or fresh defaults.

Windows 10 machines missing the Visual C++ runtime were a startup failure before 0.21.0. Current builds ship those DLLs. If an old build still fails before any window, install the [Microsoft Visual C++ redistributable](https://learn.microsoft.com/en-us/cpp/windows/latest-supported-vc-redist) or update MyFileExplorer.

## Settings won’t open, or a change does nothing

**Checks:** You are in the installed app, not a second copy pointed at `MFE_USER_DATA`. Confirm the path in a log line or by the fact that an export from **About** matches what you see.

**Resolution:** Change the control again. Settings write through immediately. If Import just ran, it replaced the whole file; the control you remember may have been overwritten.

**Expected result:** The next file listing or preview follows the new value. Hardware acceleration needs a restart.

## Delete did not ask, and the file is gone

**Causes:** **Delete** recycles. **Shift+Delete** permanently deletes. A single file can skip the extra confirm when **Always confirm permanent delete** is off.

**Checks:** Open the in-app Recycle Bin (tab bar or tree). If the file is there, select it and press **Enter** or Restore.

**Resolution:** If it is not in the bin, it was permanent. **Undelete** (Settings → Appearance → **Show Undelete toolbar button**, then the tab-bar icon) scans the NTFS MFT. It only helps on NTFS, only for data still in free space, and it needs an administrator prompt when the volume cannot be read otherwise. It is not Recycle Bin restore. Pick a **different** destination folder so you do not overwrite anything else.

**Expected result:** Either the bin restore puts the file back, or Undelete writes a copy under the folder you chose, with relative parent folders. If the clusters were reused, recovery cannot succeed. The app cannot fix that.

## Copy or move stopped on a name that already exists

**Cause:** Continue-then-review. Items that do not collide finish. Copying a folder creates that destination folder and keeps filling it; the folder just created is not itself a collision, and it shows up in the list and the tree while the copy is still running. One item inside the folder that cannot be copied does not stop the rest of the folder. One dialog then lists the real collisions. A folder you can open is part of the copy. The review is for access denied and real name collisions.

**Resolution:** Choose Skip, Keep both, Replace, Keep most recent, or Retry per group. Skip applies to the listed item, not to the whole folder the copy already created. **Cancel** on the progress line stops work still queued. Next time, hold Ctrl while clicking **Paste** or **Delete**, or press **Ctrl+Shift+V**, to open the plan before anything is written. Dragging with Ctrl only copies.

**Expected result:** The destination folder is filled. The review, if it appears, names the conflicting item inside it. **Ctrl+Z** undoes the operation the app recorded, when undo data still exists.

## Copy leaves out two Electron archives

**Cause:** These paths are not copied. Opening them reports names that exist only inside the archive (for example `octicon`), or “Invalid package”:

- `node_modules\electron\dist\resources\default_app.asar`
- `release\win-unpacked\resources\default_app.asar`
- `release\win-unpacked\resources\app.asar`

The source folder is unchanged. Any other `.asar` file is copied as one file. Verify copy can stay on.

**Resolution:** Nothing to restore for those paths. If an older copy left an empty folder with one of those names, delete that folder and copy again.

**Expected result:** The destination does not contain those archives. Copy review does not list names from inside them.

## A file is “in use” or will not rename

**Causes:** Preview, a video player, mpv, or another process has the file open. Rich player and Chromium preview are not supposed to lock the file for the whole session; another app still might.

**Checks:** Close preview (**Ctrl+Shift+P**), stop Now Playing, and close external players. The busy-file review can list processes and offer End task. Ending a task kills that process.

**Expected result:** Rename or move proceeds. If Windows still reports sharing violation, the holder is outside this app.

## Preview is blank or says it cannot display the file

**Checks:**

1. Extension is in [PREVIEW_EXTENSIONS.md](PREVIEW_EXTENSIONS.md). If not, use **Open with default app**.
2. For video, Chromium plays common MP4/WebM/MOV. MKV, AVI, WMV, and similar use **Open with default app** unless Settings → Preview → **Rich player (mpv)** is on and mpv is available.
3. Text files over the preview byte limit are truncated (default 2 MB, Settings → Preview).

**Resolution:** Turn on Rich player only for containers Chromium does not play. If mpv is missing, install it on PATH or, from a source checkout, `npm run tools:fetch-mpv`. Decode errors do not silently switch to mpv.

**Expected result:** A picture, a player, a text excerpt, or a clear “open externally” action. Not a crash.

## Search finds nothing, or finds stale names

**Causes:** Indexed search is on but the folder was never indexed. Or the index has not caught up. Or the term is excluded (`node_modules`, `.git`, …). Or you are matching the file name only and the word is in the path.

**Checks:** Settings → **Search index**. See whether this folder is a root. Toolbar indexed-only mode restricts hits to those roots. **F5** refreshes the listing; it does not rebuild the whole drive index by itself.

**Resolution:** Add the folder as an index root, or turn indexed-only off to walk the open folder. Remove an exclude that matches the name. After a large rename, give the USN journal a moment, or rebuild that root from the search settings if the UI offers reindex for that root.

**Expected result:** New hits match the current names. Deleted files disappear from results when the index updates. Deleting inside the app also drops stale hits from the open search.

## Slideshow looks the same as the original photo

**Causes:** **Enable slideshow UI** is on (otherwise there is no show), but **Camera looks** is off, or frequency is 0, or the path filter misses this file, or this slide was not rolled, or crop mode is on.

**Checks:** Settings → Slideshow. **Camera looks** must be checked. Open **Camera looks…** and set frequency above 0. At least one effect must be checked. Clear the path filter or use a path that matches.

**Resolution:** Leave Dusty lens unchecked if the show feels slow. The look is painted at display time. The JPEG on disk does not change. Reopen the slideshow after changing the master switch.

**Expected result:** Some slides (by frequency) show the effect. The same playlist index keeps the same look until you change frequency, the checked effects, the switch, or the filter.

## Notes, covers, or folder sizes disappeared after a backup restore

**Cause:** The backup copied the main file bytes and dropped NTFS alternate streams.

**Checks:** The file’s size and date look right, but **Note…**, the cover, or **Calculate Statistics** data is gone. Settings export will not contain them.

**Resolution:** Restore again from a copy that kept ADS, or recreate the note. Prevent the next loss with a backup tool that copies alternate streams on NTFS→NTFS. This app does not reconstruct streams from a byte-only backup.

**Expected result:** After an ADS-aware restore, the note and cover show again without retyping.

## Git buttons are missing, or Git says it is not a repository

**Checks:** Settings → **Git** → Enable. `git` works in a terminal (`git --version`). The folder, or a parent, contains `.git`.

**Resolution:** If you deleted `.git`, the toolbar is supposed to clear. Point **executable path** at `git.exe` if it is not on PATH. Credentials stay in Git’s own credential helper. This app does not store them.

**Expected result:** Status overlays and Commit / Pull / Push on a real repository. Failures printed from Git are Git’s errors. Read them in the Git output. Fix remotes and auth in Git, not by resetting MyFileExplorer settings.

## A script will not start

**Checks:** Settings → **Scripting and AI** → **Enable scripting**. The runner matches the file: PowerShell, **Python 3** (not 2.x), cmd, or bash. Python 2 is not used.

**Resolution:** Install that interpreter and, if needed, set its path in the scripting settings. Read the script output pane. A non-zero exit is the script or the interpreter, not a broken file list. Dry-run when the script offers it before you point it at a large folder.

**Expected result:** Live output in the runner. **Stop** ends the process. Saved scripts reappear under **Scripts** on the context menu.

## Ask AI fails, or you are worried it uploaded your photos

**Cause of a failure:** No provider, no key, or the provider rejected the call. Keys live in `ai-secrets.json`, not in settings export.

**What is sent:** The description you type and the script text involved in that request. Browsed files and paths are not attached as your documents.

**Resolution:** Settings → **Scripting and AI**. Fix the provider URL and key. See the provider’s own status page if the key is valid and the call still fails. Do not paste the key into an issue.

**Expected result:** A script draft you can edit and run locally afterward. Later runs of the saved script do not call the provider.

## Network drive is empty or was dropped from the tree

**Checks:** The share is online. A mapped letter that is disconnected can be reconnected from the tree without opening Explorer. Offline tabs are supposed to wait, not vanish, for encrypted and network paths.

**Resolution:** Expand **Network**, click the drive, and retry. UNC paths reopen from the session listing cache when the cache is warm. Details: [NETWORKS.md](NETWORKS.md).

**Expected result:** The folder lists. If Windows itself cannot open the share, this app cannot either.

## FTP or SFTP will not connect

**Checks:** Settings → **Remote repositories** is enabled. Host, port, protocol, and user match the server. A password is stored for the connection (export will not show it).

**Resolution:** Test the same host with a dedicated FTP client. If that fails, the server or the firewall is the problem. If that works and this app does not, compare passive mode, FTPS versus FTP, and the exact port. Capture the error text from the connect dialog. Do not send the password.

**Expected result:** A remote tab you can browse. Transfers use this app’s progress line.

## Virtual Folder projection does not show in Explorer

**Checks:** You installed [WinFsp](https://winfsp.dev/), installed the projection service from the release zip, and turned on Settings → Behavior → **Virtual Folder OS projection**. The `.mfevirtual` file opens inside MyFileExplorer even without WinFsp.

**Resolution:** Follow [VIRTUAL_FOLDER_PROJECTION.md](VIRTUAL_FOLDER_PROJECTION.md). Projection is Windows-only. Without it, the collection still works inside this app.

**Expected result:** Explorer shows the projected tree, or you keep using the collection only inside MyFileExplorer.

## The app is slow on a huge folder

**Causes:** Thumbnail generation, a preview parsing a large file, an index walk, or a camera look that samples the image many times (Dusty lens).

**Checks:** Switch the view to List or Details. Collapse the preview. Pause slideshow camera looks. Exclude `node_modules` from search.

**Resolution:** Hardware acceleration off can make the UI slower; turn it back on if you disabled it for a GPU job and the job is finished. Restart after that change.

**Expected result:** Scrolling stays responsive. Tens of thousands of files in one folder is a supported case; a multi-terabyte recursive search of an unindexed disk is not meant to feel instant.

## How to report a bug

1. Settings → **About**: version.
2. Windows version.
3. What you did, what you expected, what happened. Quote the dialog text.
4. A few lines from `logs\main.log` around the time of the failure. Remove paths you do not want public.
5. Do not attach `settings.json`, `ai-secrets.json`, or a full user profile.

https://github.com/dobrado76/MyFileExplorer/issues
