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

echo "Launching unpacked MyFileExplorer binary in Wayland mode..."

# Use Electron's native environment flag to force the sandbox and zygote off
# This bypasses the command-line argument parser completely
export ELECTRON_DISABLE_SANDBOX=1

exec env \
  GSETTINGS_SCHEMA_DIR=/usr/share/glib-2.0/schemas/ \
  GDK_BACKEND=wayland \
  ELECTRON_OZONE_PLATFORM_HINT=wayland \
  GTK_MODULES="" \
  NO_AT_BRIDGE=1 \
  "$BIN" \
  --ozone-platform=wayland \
  --enable-features=UseOzonePlatform,NetworkServiceInProcess
