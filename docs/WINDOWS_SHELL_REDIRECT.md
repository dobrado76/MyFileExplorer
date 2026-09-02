# Windows shell redirect (experimental)

**Version:** 0.15.0  
**Decision:** D72

Attempt to redirect physical-directory opens that resolve through per-user HKCU `Directory/shell/open` and `Directory/shell/explore` to MyFileExplorer. This is **experimental** - actual coverage is measured locally via the invocation log.

## What it does

- Replaces the `command` handler for `Directory/shell/open` and `Directory/shell/explore` under `HKCU\Software\Classes\` with `MfeShellLauncher.exe`.
- The launcher forwards filesystem directories to `MyFileExplorer.exe --open` and files to `--reveal`.
- Unsupported targets (empty `%1`, shell namespace GUIDs, `shell:` URLs, missing paths) fall back to `explorer.exe` via safe argument lists (no recursion).
- A full registry subtree backup is written before enable; **Restore previous folder-opening configuration** reproduces your prior handler (Explorer or another file manager).

## What it does not do

- Replace `explorer.exe`, the desktop shell, Win+E, or taskbar Explorer.
- Intercept `explorer.exe /select`, direct Explorer COM APIs, or `Drive/shell` verbs.
- Enable `Folder` shell verbs in v1 (Shell namespace - deferred).
- Export/import redirect state with Settings backup (machine-local only).

## Settings

**Settings -> Windows integration** (Windows only):

- Toggle redirect on/off (enable runs backup + transactional apply).
- **Test** - `ShellExecute` on a temp folder; checks invocation log.
- **Repair** - regenerate launcher paths after reinstall/move.
- **Restore previous folder-opening configuration** - import backup.

State lives in `%APPDATA%\MyFileExplorer\shell-redirect\` (`state.json`, `backup.json`, `*.reg`, `invocations.jsonl`). Not portable.

## Invocation log privacy

The log records **full filesystem paths** on this PC for diagnostics. It is not included in settings export or automatic bug reports. Clear it from Settings when done experimenting.

## Uninstall

The NSIS uninstaller runs `MfeShellLauncher.exe --restore-shell-redirect` before removing app files. If restore fails, restore manually from Settings before uninstalling.

## Manual test matrix

- Browser open-downloads-folder / show-in-folder
- Electron `shell.showItemInFolder`
- VS / VS Code reveal
- Windows Run dialog with a folder path
- Desktop folder shortcuts
- ZIP open-folder actions
- Network / UNC paths; missing paths
- Win+E; `explorer.exe /select`
- Uninstall while redirect enabled
- Reinstall to different directory + Repair
- Settings export/import does not affect redirect

Deferred (`Folder` milestone): `shell:Downloads`, Control Panel, Recycle Bin, shell namespace GUID objects.

## Dev

```text
# Build launcher
dotnet publish tools/MfeShellLauncher/src/MfeShellLauncher -c Release -r win-x64 -o tools/MfeShellLauncher/publish

# Override launcher path in dev
set MFE_SHELL_LAUNCHER=F:\path\MfeShellLauncher.exe
```

See also [INTEGRATION.md](INTEGRATION.md) for `--open` / `--reveal` CLI.
