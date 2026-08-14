#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE}")/.." && pwd)"
cd "$ROOT_DIR"

BIN="dist/linux-unpacked/my-file-explorer"

if [[ ! -x "$BIN" ]]; then
  echo "Unpacked binary not found: $BIN"
  exit 1
fi

echo "Launching unpacked MyFileExplorer binary in native Wayland mode..."

# Enforce the Wayland backend switches directly inside system memory variables
export GDK_BACKEND="wayland"
export ELECTRON_OZONE_PLATFORM_HINT="wayland"

# Map the global system schema folder path so the initial handshake passes
exec env GSETTINGS_SCHEMA_DIR=/usr/share/glib-2.0/schemas/ "$BIN"
