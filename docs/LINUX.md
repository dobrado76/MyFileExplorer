# Linux setup for MyFileExplorer

This project is primarily Windows-focused. It can still be run on Linux for development and packaging, but the app is not a fully native Linux desktop app yet. In this Kubuntu/Plasma environment, the app is being validated on the Wayland-only path, which is the required target.

The commands below are the working Wayland-only launch flows for this current session. The unpacked binary path is the most reliable fallback when the packaged app or dev watcher still hits GTK startup warnings.

---

## 1) Install dependencies

From the project root:

```bash
npm install
```

If Node.js is missing, install it first:

```bash
sudo apt update
sudo apt install nodejs npm
```

If you are on Ubuntu/Kubuntu and want the usual desktop tooling as well:

```bash
sudo apt install build-essential libgtk-3-0 libnss3
```

---

## 2) Build the Linux bundle

From the project root:

```bash
npm run build:linux
```

This creates the Linux build in the `dist/` folder, including the AppImage and the unpacked binary.

---

## 3) Run the built app directly

The most reliable way on this Kubuntu/Wayland session is to launch the unpacked Electron binary directly:

```bash
env GSETTINGS_SCHEMA_DIR=/usr/share/glib-2.0/schemas/ \
  GDK_BACKEND=wayland \
  ELECTRON_OZONE_PLATFORM_HINT=wayland \
  ./dist/linux-unpacked/my-file-explorer \
  --ozone-platform=wayland \
  --enable-features=UseOzonePlatform \
  --no-sandbox
```

There is also a helper script for this exact command:

```bash
npm run run:unpacked
```

---

## 4) Run the AppImage

The AppImage path is not reliable in this Kubuntu/Plasma Wayland session. It has been observed to crash with:

```text
ERROR:ui/gtk/gtk_ui.cc:252] Schema org.gnome.desktop.interface does not have key font-antialiasing
Segmentation fault (core dumped)
```

So do not rely on the AppImage as the primary launch path on this machine.

If you still want to try it manually:

```bash
chmod +x dist/MyFileExplorer-0.5.2.AppImage
GDK_BACKEND=wayland ELECTRON_OZONE_PLATFORM_HINT=wayland GSETTINGS_BACKEND=memory ./dist/MyFileExplorer-0.5.2.AppImage --ozone-platform=wayland
```

This is only for debugging; it is not the stable path.

---

## 5) Launcher / installed app note

The AppImage launcher entry is not reliable in this session. The direct unpacked binary is the only confirmed working launch path.

If you try to install it to `~/.local/bin` or add a desktop entry, it may appear to do nothing or crash silently in the background. This is not a valid replacement for the working unpacked-binary launch.

Do not rely on:

```bash
~/.local/bin/MyFileExplorer.AppImage
```

as the primary entry point in this environment.

---

## 6) Install the Linux launcher helper

The repo includes a beginner-friendly helper that installs a simple KDE/Plasma launcher using a folder icon so it shows up in the app menu.

```bash
npm run install:linux
```

This checks the build output in `dist/`, prefers the unpacked binary when available, and creates a desktop entry in `~/.local/share/applications` using `Icon=folder` for a generic file-manager look.

This is helpful when you want a launcher entry for the current session, even though the actual working runtime on this Kubuntu/Wayland system is still the unpacked binary path.

### Optional: manual desktop launcher with the project icon

If you want the Linux launcher to show the app icon from this repository, create a desktop entry like this:

```bash
nano ~/.local/share/applications/my-file-explorer.desktop
```

```ini
[Desktop Entry]
Type=Application
Name=MyFileExplorer
Comment=Custom Electron File Explorer
Exec=env GSETTINGS_SCHEMA_DIR=/usr/share/glib-2.0/schemas/ GDK_BACKEND=wayland ELECTRON_OZONE_PLATFORM_HINT=wayland /home/ghislainb/sourcecode/MyFileExplorer/dist/linux-unpacked/my-file-explorer --ozone-platform=wayland --enable-features=UseOzonePlatform --no-sandbox
Icon=/home/ghislainb/sourcecode/MyFileExplorer/build/icon.png
Terminal=false
Categories=Utility;FileManager;
StartupWMClass=myfileexplorer
```

Then refresh the menu or run:

```bash
update-desktop-database ~/.local/share/applications
```

This is the same runtime pattern used by the working unpacked-binary flow, and it is the most reliable way to get both a launcher entry and the correct app icon on KDE/Plasma Wayland.

If you prefer a more generic KDE look instead of the repo icon, replace the `Icon=` line with:

```ini
Icon=folder
```

---

## 7) Troubleshooting

### The app crashes immediately on Wayland

This is a known Chromium/Electron + KDE/GTK schema mismatch at the session layer. If the runtime fails here, it is a system desktop issue rather than an application bug. The supported path is to keep the Wayland launch and continue validating the app inside that session.

If you prefer the direct binary path that is currently the most stable on your system:

```bash
env GSETTINGS_SCHEMA_DIR=/usr/share/glib-2.0/schemas/ \
  GDK_BACKEND=wayland \
  ELECTRON_OZONE_PLATFORM_HINT=wayland \
  ./dist/linux-unpacked/my-file-explorer \
  --ozone-platform=wayland \
  --enable-features=UseOzonePlatform \
  --no-sandbox
```

### It says there is no Linux bundle in `dist/`

Build it first:

```bash
npm run build:linux
```

### Electron starts but the UI looks broken or blank

Check that you are running inside a real desktop session, not a minimal or headless terminal environment.

If needed, restart the session and rerun the Wayland launch.

---

## 8) Best beginner workflow

If you just want the least-friction setup on Kubuntu:

```bash
npm install
npm run build:linux
npm run run:unpacked
```

If you also want a launcher entry in the KDE menu, run:

```bash
npm run install:linux
```

This is the only confirmed working Wayland-only path for this current session. The launcher is a convenience for menu access, but the actual reliable runtime remains the unpacked binary.
