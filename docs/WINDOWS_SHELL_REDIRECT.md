# Windows shell redirect (experimental)

**Version:** 0.15.7  
**Decision:** D72

Attempt to redirect physical-directory opens that resolve through per-user HKCU `Directory/shell/open` and `Directory/shell/explore` to MyFileExplorer. This is **experimental** - actual coverage is measured locally via the invocation log.

## What it does

- Replaces the `command` handler for `Directory/shell/open` and `Directory/shell/explore` under `HKCU\Software\Classes\` with `MfeShellLauncher.exe`.
- Clears any `DelegateExecute` value on those managed verb roots (after backup) so Windows uses the command string; status verification requires it to stay absent.
- The launcher forwards filesystem directories to `MyFileExplorer.exe --open` and files to `--reveal`.
- Unsupported targets (empty `%1`, shell namespace GUIDs, `shell:` URLs, missing paths) fall back to `explorer.exe` via safe argument lists (no recursion).
- A full registry subtree backup is written before enable; **Restore** / disable performs **delete-then-import** (exact subtree restore), verifies that managed commands no longer reference `MfeShellLauncher.exe`, then **deletes the backup** so the next Enable captures a fresh baseline.
- Enable also copies `MfeShellLauncher.exe` into `%APPDATA%\MyFileExplorer\shell-redirect\` so uninstall can restore even if the install-dir copy is already gone.

## What it does not do

- Replace `explorer.exe`, the desktop shell, Win+E, or taskbar Explorer.
- Intercept `explorer.exe /select`, direct Explorer COM APIs, or `Drive/shell` verbs.
- Enable `Folder` shell verbs in v1 (Shell namespace - deferred).
- Export/import redirect state with Settings backup (machine-local only).
- Delete `Directory\shell\open` / `explore` without a **valid complete backup** (fail closed → `restoreRequired`).

## Settings

**Settings -> Windows integration** (Windows only):

- Toggle redirect on/off (enable runs backup + transactional apply; repair is transactional too).
- **Test** - `ShellExecute` on a temp folder; checks invocation log.
- **Repair** - regenerate launcher paths after reinstall/move (rolls back command values if verification fails).
- **Restore previous folder-opening configuration** - exact restore from backup, then clear backup artifacts.

State lives in `%APPDATA%\MyFileExplorer\shell-redirect\` (`state.json`, `backup.json`, `*.reg`, `invocations.jsonl`, sidecar `MfeShellLauncher.exe`). Not portable.

## Invocation log privacy

The log records **full filesystem paths** on this PC for diagnostics. It is not included in settings export or automatic bug reports. The launcher trims `invocations.jsonl` to the newest ~500 lines. Clear it from Settings when done experimenting.

## Uninstall

The NSIS uninstaller runs `MfeShellLauncher.exe --restore-shell-redirect` **before** removing app files:

1. Prefer `$INSTDIR\MfeShellLauncher.exe`
2. Else `%APPDATA%\MyFileExplorer\shell-redirect\MfeShellLauncher.exe`
3. Else if `backup.json` still exists → **Abort** uninstall (restore required)
4. Restore failures (non-zero exit) also **Abort**

The restorer checks `reg.exe` exit codes, uses delete-then-import, refuses to wipe keys without a valid backup, and verifies managed commands no longer point at `MfeShellLauncher.exe`.

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
- Uninstall after deleting `$INSTDIR\MfeShellLauncher.exe` (sidecar / Abort paths)
- Restore with missing/corrupt `backup.json` (must not delete registry)
- Enable → Restore → third-party changes handler → Enable → Restore (must not revive stale baseline)
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
