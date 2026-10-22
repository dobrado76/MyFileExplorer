# Getting started

## Install a release (Windows)

1. Open https://github.com/dobrado76/MyFileExplorer/releases/latest
2. Download `MyFileExplorer-x.y.z.exe` (the NSIS installer attached to that release).
3. Run the installer.
4. Start **MyFileExplorer**.

The usual install location is:

```text
%LOCALAPPDATA%\Programs\MyFileExplorer\MyFileExplorer.exe
```

Uninstall does **not** delete `%APPDATA%\MyFileExplorer`. Your settings, session, search index, and scripts remain. Deleting that folder yourself wipes them. It does not delete the files you were browsing, and it does not remove NTFS alternate streams already written onto those files.

There is no macOS build. Linux packaging is experimental: [LINUX.md](LINUX.md).

## First session

1. Open a folder as a tab (address bar, tree, or **Ctrl+T**).
2. Select a file and confirm the preview pane shows it. **Ctrl+Shift+P** toggles the preview surface.
3. Press **Delete** on a disposable file. It goes to the in-app Recycle Bin (tab bar and/or tree, unless you hid it). Restore it from that view. **Enter** on a selected Recycle Bin item restores it.
4. Settings → **About** shows the running version. **Export…** writes a portable settings file. Store that file somewhere you back up. Do not publish it: it can contain folder paths, host names, and media-metadata tokens.

## Where your app data lives

Both the installed app and `npm run dev` use:

```text
%APPDATA%\MyFileExplorer\
```

Override only when you mean to: environment variable `MFE_USER_DATA`, or `MFE_ISOLATED_USER_DATA=1` for a repository-local `.dev-user-data\` folder. Do not point those at a folder you browse as documents.

Important files (details in [PROJECT_FORMAT.md](PROJECT_FORMAT.md)):

| Path | Role |
| --- | --- |
| `settings.json` | Preferences. Private. Do not paste it into a bug report. |
| `session.json` | Open tabs, selection, scroll, splitters. Not included in Settings export. |
| `window-state.json` | Main window position. Not exported. |
| `search-index.sqlite` | Search index. |
| `logs\main.log` | Main-process log. Rotates by truncation when it exceeds 2 MB. |
| `ai-secrets.json` | Scripting AI API keys (OS-protected storage). Never exported. |
| `scripts\` | Saved script library. |

## Confirm the app is working

- The window opens and lists a local disk.
- Creating a tab and going **Back** (Alt+Left or Backspace when history exists) returns to the previous folder.
- **F5** refreshes the listing.
- A PNG or JPEG shows in the preview pane.

If the window never appears, see [troubleshooting.md](troubleshooting.md).

## Build from source

Only if you are developing or you cannot use a release installer:

```bash
npm install
npm run dev
```

`npm run check` is typecheck, lint, tests, and the support-doc freshness check. Full build and release steps: [BUILD.md](BUILD.md).

Developer dependencies (Node.js, a C++ build environment for native modules) are not required for the installer.
