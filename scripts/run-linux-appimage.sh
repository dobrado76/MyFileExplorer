#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

APPIMAGE="dist/MyFileExplorer-0.5.2.AppImage"

if [[ ! -f "$APPIMAGE" ]]; then
  echo "AppImage not found: $APPIMAGE"
  echo "Build it with: npm run build:linux"
  exit 1
fi

chmod +x "$APPIMAGE"
export GDK_BACKEND=wayland
export ELECTRON_OZONE_PLATFORM_HINT=wayland
export GSETTINGS_BACKEND=memory
export ELECTRON_ENABLE_LOGGING=1

echo "Launching MyFileExplorer AppImage in Wayland-only mode..."
exec env GSETTINGS_BACKEND=memory GDK_BACKEND=wayland ELECTRON_OZONE_PLATFORM_HINT=wayland "$APPIMAGE" --ozone-platform=wayland
