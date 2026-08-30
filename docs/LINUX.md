# Linux setup for MyFileExplorer (experimental)

**Version:** 0.13.0 · Windows remains the primary product target.

This project is **Windows-first**. Linux packaging and launch scripts are experimental helpers for contributors; they are not a supported product matrix yet. Windows features that depend on Win32 APIs (shell icons, Recycle Bin, ADS, NTFS search, **Network neighborhood**, mapped-drive dialogs, **Virtual Folder OS projection (D68 / WinFsp)**, etc.) degrade or no-op on Linux — the Win32 network module is lazy-loaded and never initialized on Linux builds. **Virtual Folders (D67)** work in-app on Linux; there is no OS mount / Project UI on Linux (FUSE deferred).

The notes below target a modern Wayland-only desktop session (e.g. Kubuntu/Plasma). Paths and configurations may need adjustment on other distros.

---

## 1) Install dependencies

From the project root:

```bash
npm install
```

On Debian/Ubuntu-based systems you may also need:

```bash
sudo apt update
sudo apt install build-essential libgtk-3-0 libnss3
```

---

## 2) Build the Linux bundle

```bash
npm run build:linux
```

Output lands in `dist/` (AppImage, optional snap, and `linux-unpacked/`).

---

## 3) Run the built app

The application's core main process loop natively optimizes its own environment properties, sandbox structures, and Wayland hooks automatically on boot. No external environment variables or runtime CLI flags are required.

Prefer the unpacked binary helper:

```bash
npm run run:unpacked
```

Or AppImage (version is read from `package.json`):

```bash
npm run run:linux
```

---

## 4) Dev / Wayland helpers

```bash
npm run dev:linux
```

---

## 5) Install a desktop launcher (optional)

```bash
npm run install:linux
```

Creates `~/.local/share/applications/my-file-explorer.desktop` pointing at the unpacked binary or AppImage under this repo’s `dist/`.

### Manual desktop entry with the repo icon

Because the repository code handles its own environment parameters inside `index.ts`, your desktop entry can stay clean and direct. Replace `$REPO` with your absolute clone path:

```ini
[Desktop Entry]
Type=Application
Name=MyFileExplorer
Comment=Custom Electron File Explorer
Exec=env GSETTINGS_SCHEMA_DIR=/usr/share/glib-2.0/schemas/ \$REPO/dist/linux-unpacked/my-file-explorer
Icon=\$REPO/build/icon.png
Terminal=false
Categories=Utility;FileManager;
StartupWMClass=myfileexplorer
```

Then refresh the desktop engine mapping:

```bash
update-desktop-database ~/.local/share/applications
```

---

## 6) Troubleshooting

### WebAssembly Startup Delay
The application may take 3–4 seconds to render its primary canvas on boot. This is normal behavior for the Linux environment; the underlying engine utilizes this window to unpack, parse, and compile the **13.5MB ONNX WebAssembly machine learning models** into active thread layers.

### AppImage crashes on Wayland / GTK schemas
Some minimal Plasma/Wayland sessions hit Chromium GTK schema mismatches with AppImage out-of-the-box. If the app fails to start or throws segmentation faults, follow the **Host OS GSettings Recovery** steps below.

### “No Linux bundle in dist/”

```bash
npm run build:linux
```

### Blank UI
Run inside a real desktop session (not a headless SSH shell without display forwarding).

---

## 7) Suggested beginner workflow

```bash
npm install
npm run build:linux
npm run run:unpacked
```

---

## Host OS GSettings Schema Recovery

If the Electron executable crashes on launch due to missing desktop enums or missing GNOME styling packages inside minimal KDE layouts, execute these structural system updates:

```sh
# 1. Reset and clean the default system schema file to a stock version
sudo apt install --reinstall gsettings-desktop-schemas

# 2. Install the missing asset package containing required GNOME enum schemas
sudo apt install gnome-desktop3-data

# 3. Pull down related font mapping structures to satisfy additional checks
sudo apt install gnome-settings-daemon-common

# 4. Recompile the system schema folder so the OS registers the database layout
sudo glib-compile-schemas /usr/share/glib-2.0/schemas/

# 5. Clean up any broken, conflicting local schema directories created during testing
rm -rf ~/.local/share/glib-2.0/schemas
```

Windows packaging remains `npm run dist` / `npm run build:win` on a Windows host (`scripts/dist.mjs` refuses non-Windows hosts).
