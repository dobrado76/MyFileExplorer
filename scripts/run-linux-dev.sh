#!/usr/bin/env bash
set -euo pipefail

export GDK_BACKEND=wayland
export ELECTRON_OZONE_PLATFORM_HINT=wayland
export GSETTINGS_BACKEND=memory
export ELECTRON_ENABLE_LOGGING=1
export XDG_CURRENT_DESKTOP=${XDG_CURRENT_DESKTOP:-KDE}
export GTK_A11Y=none

cd "$(dirname "${BASH_SOURCE[0]}")/.."

echo "Launching MyFileExplorer in Wayland-only dev mode..."
electron-vite dev
