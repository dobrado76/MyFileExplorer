#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

BIN="dist/linux-unpacked/my-file-explorer"

if [[ ! -x "$BIN" ]]; then
  echo "Unpacked binary not found: $BIN"
  echo "Build it first with: npm run build:linux"
  exit 1
fi

# Prefer sandbox. Override if needed, e.g.:
#   MFE_LINUX_ELECTRON_FLAGS='--ozone-platform=wayland --enable-features=UseOzonePlatform --no-sandbox' npm run run:unpacked
EXTRA_FLAGS="${MFE_LINUX_ELECTRON_FLAGS:---ozone-platform=wayland --enable-features=UseOzonePlatform}"

echo "Launching unpacked MyFileExplorer binary in Wayland mode..."
echo "GTK theme-module warnings are usually non-fatal."

# shellcheck disable=SC2086
exec env \
  GSETTINGS_SCHEMA_DIR=/usr/share/glib-2.0/schemas/ \
  GDK_BACKEND=wayland \
  ELECTRON_OZONE_PLATFORM_HINT=wayland \
  "$BIN" \
  $EXTRA_FLAGS
