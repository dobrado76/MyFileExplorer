# Remove the per-user logon task for the Virtual Folder projection agent.
$ErrorActionPreference = "Stop"
$exe = Join-Path $PSScriptRoot "src\MfeVirtualFolderService\bin\Release\net8.0-windows\MfeVirtualFolderService.exe"
if (-not (Test-Path $exe)) {
  $exe = Join-Path $PSScriptRoot "src\MfeVirtualFolderService\bin\Debug\net8.0-windows\MfeVirtualFolderService.exe"
}
if (Test-Path $exe) {
  & $exe --uninstall-autostart
  exit $LASTEXITCODE
}

# Fallback if binaries were deleted
schtasks.exe /Delete /TN "\MyFileExplorer\VirtualFolderProjection" /F
exit 0
