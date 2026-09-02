# MfeShellLauncher

Tiny Windows launcher for experimental shell redirect (D72). Invoked by HKCU `Directory\shell\open` and `explore` command handlers.

## Usage

```text
MfeShellLauncher.exe open "D:\folder"
MfeShellLauncher.exe explore "D:\folder"
MfeShellLauncher.exe --restore-shell-redirect
```

`MyFileExplorer.exe` must sit beside this executable in the install directory.

## Build

```powershell
dotnet publish src/MfeShellLauncher -c Release -r win-x64 -o publish
```

Shipped via `electron-builder` `extraFiles` as `MfeShellLauncher.exe` next to the main app.

## Dev override

Set `MFE_SHELL_LAUNCHER` to point at a built launcher when running Electron from `npm run dev`.
