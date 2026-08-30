# Install MyFileExplorer Virtual Folder projection agent (per-user logon autostart).
# Place this script next to MfeVirtualFolderService.exe (GitHub Release zip layout).
# Prerequisites: WinFsp — https://winfsp.dev/
# Run unelevated as your normal Windows user (not LocalSystem).

$ErrorActionPreference = "Stop"
$exe = Join-Path $PSScriptRoot "MfeVirtualFolderService.exe"
if (-not (Test-Path $exe)) {
  Write-Error "MfeVirtualFolderService.exe not found next to this script:`n  $exe"
}

Write-Host "Installing autostart for:`n  $exe"
& $exe --install-autostart
exit $LASTEXITCODE
