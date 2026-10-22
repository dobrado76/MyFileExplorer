# Product

**Application:** MyFileExplorer  
**Repository:** https://github.com/dobrado76/MyFileExplorer  
**Package version in this repository:** 0.21.2 (`package.json`)  
**Newest changelog release section:** 0.21.0 (2026-10-19). The changelog **Unreleased** section is empty.  
**Running app version:** Settings → **About**. Use that version when it disagrees with this file.  
**License:** GPL-3.0. The name and logo are trademarks. See [LICENSING.md](../LICENSING.md) and [TRADEMARK.md](../TRADEMARK.md).

MyFileExplorer is a Windows file manager (Electron + React). It browses the real filesystem. It does not move your files into its own database.

Primary platform: Windows 10 and Windows 11. Linux AppImage helpers exist and are experimental. macOS is not a target.

## What it is for

People who outgrow Windows File Explorer: many folders at once, previews, search, notes and metadata on the files themselves, scripts, and optional Git, media-library, and remote-server tools.

A folder stays a folder. Extra meaning (notes, icons, folder statistics, movie metadata, image-edit versions, user-defined fields) is stored as NTFS Alternate Data Streams on that file or folder, not as sidecar files next to it. App preferences and session state live under `%APPDATA%\MyFileExplorer`.

## What a normal session includes

- Tabs, up to four panes, and named layouts.
- Details, icons, thumbnails, and list views, with Explorer-style name order unless you change it.
- A preview pane for many file types, including images, video, PDF, Office-ish text, archives, and 3D meshes.
- Copy, move, delete to the Recycle Bin, undo, and conflict review.
- Optional search indexes, slideshow, scripts, Git, FTP/SFTP, media metadata, and user metadata. Those features stay off until you enable them.

## What it does not do

- It does not replace every Windows Explorer feature, and it does not host Explorer shell extensions or cloud-provider shell namespaces.
- It does not sync or back up NTFS alternate streams by itself. Most copy tools drop those streams. Back them up with a tool that copies ADS if you rely on notes, covers, or statistics.
- It does not send your files to an AI provider. Optional script generation sends the task text and script source you submit, not the folder you are browsing.
- It does not include the Everything search engine. Search is built in and only covers roots you choose to index, plus a live folder walk.
- Parked notes under `docs/plans/` are not features. Do not describe them as available.

## Related documents

Feature behavior is specified in the topic files under `docs/` (Search, Preview, Slideshow, Scripts, Git, and the others listed in [README.md](README.md)). This support set adds install, settings, troubleshooting, and FAQ coverage around those files.
