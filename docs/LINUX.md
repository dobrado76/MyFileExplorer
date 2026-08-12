# Linux setup for MyFileExplorer (experimental)

**Version:** 0.6.3 · Windows remains the primary product target.

This project is **Windows-first**. Linux packaging and launch scripts are experimental helpers for contributors; they are not a supported product matrix yet. Windows features that depend on Win32 APIs (shell icons, Recycle Bin, ADS, NTFS search, Network neighborhood, etc.) degrade or no-op on Linux.

The notes below target a Wayland desktop session (e.g. Kubuntu/Plasma). Paths and flags may need adjustment on other distros.

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

Prefer the unpacked binary helper:

```bash
npm run run:unpacked
```

Or AppImage (version is read from `package.json`):

```bash
npm run run:linux
```

If Electron fails under a restricted sandbox on your desktop, you can opt in to `--no-sandbox` (not recommended for daily use):

```bash
MFE_LINUX_ELECTRON_FLAGS='--ozone-platform=wayland --enable-features=UseOzonePlatform --no-sandbox' \
  npm run run:unpacked
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

Replace `$REPO` with your clone path:

```ini
[Desktop Entry]
Type=Application
Name=MyFileExplorer
Comment=Custom Electron File Explorer
Exec=env GSETTINGS_SCHEMA_DIR=/usr/share/glib-2.0/schemas/ GDK_BACKEND=wayland ELECTRON_OZONE_PLATFORM_HINT=wayland $REPO/dist/linux-unpacked/my-file-explorer --ozone-platform=wayland --enable-features=UseOzonePlatform
Icon=$REPO/build/icon.png
Terminal=false
Categories=Utility;FileManager;
StartupWMClass=MyFileExplorer
```

Then:

```bash
update-desktop-database ~/.local/share/applications
```

---

## 6) Troubleshooting

### AppImage crashes on Wayland / GTK schemas

Some Plasma/Wayland sessions hit Chromium GTK schema mismatches with AppImage. Prefer `npm run run:unpacked`.

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

Optional menu entry:

```bash
npm run install:linux
```

Windows packaging remains `npm run dist` / `npm run build:win` on a Windows host (`scripts/dist.mjs` refuses non-Windows hosts).
