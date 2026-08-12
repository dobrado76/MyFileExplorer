#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

VERSION="$(node -p "require('./package.json').version")"
APPIMAGE_PATH="dist/MyFileExplorer-${VERSION}.AppImage"
SNAP_PATH="dist/my-file-explorer_${VERSION}_amd64.snap"
UNPACKED_PATH="dist/linux-unpacked/my-file-explorer"
DESKTOP_DIR="$HOME/.local/share/applications"
DESKTOP_FILE="$DESKTOP_DIR/my-file-explorer.desktop"

# Optional: some Wayland/GTK setups need Electron --no-sandbox. Prefer unset.
EXTRA_FLAGS="${MFE_LINUX_ELECTRON_FLAGS:---ozone-platform=wayland --enable-features=UseOzonePlatform}"

install_desktop_entry() {
  local exec_path="$1"

  mkdir -p "$DESKTOP_DIR"

  cat > "$DESKTOP_FILE" <<EOF
[Desktop Entry]
Type=Application
Name=MyFileExplorer
Comment=File Explorer
Exec=env GSETTINGS_SCHEMA_DIR=/usr/share/glib-2.0/schemas/ GDK_BACKEND=wayland ELECTRON_OZONE_PLATFORM_HINT=wayland "$exec_path" ${EXTRA_FLAGS}
Icon=folder
Terminal=false
Categories=Utility;FileManager;
StartupWMClass=MyFileExplorer
EOF

  chmod +x "$DESKTOP_FILE"
  update-desktop-database "$DESKTOP_DIR" 2>/dev/null || true

  echo "Installed desktop launcher at: $DESKTOP_FILE"
  echo "You can now start it from the application menu."
}

if [[ -f "$UNPACKED_PATH" ]]; then
  echo "Found unpacked Linux build; installing desktop launcher."
  install_desktop_entry "$ROOT_DIR/$UNPACKED_PATH"
  exit 0
fi

if [[ -f "$APPIMAGE_PATH" ]]; then
  echo "AppImage bundle found."
  chmod +x "$APPIMAGE_PATH"
  install_desktop_entry "$ROOT_DIR/$APPIMAGE_PATH"
  echo "Note: on some Wayland desktops, the unpacked binary is more reliable than AppImage."
  exit 0
fi

if [[ -f "$SNAP_PATH" ]]; then
  echo "Snap bundle found."
  echo "Install with:"
  echo "  sudo snap install --dangerous dist/my-file-explorer_${VERSION}_amd64.snap"
  echo "Then run:"
  echo "  my-file-explorer"
  exit 0
fi

echo "No Linux bundle found in dist/."
echo "Run: npm run build:linux"
exit 1
