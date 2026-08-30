# Build Release and register per-user logon autostart for the Virtual Folder projection agent.
# Run once (unelevated is fine). Survives reboot via Task Scheduler — not a LocalSystem service.
# Requires WinFsp installed first: https://winfsp.dev/
# End users: prefer the GitHub Release zip + packaging\Install-ProjectionService.ps1
#   (see docs/VIRTUAL_FOLDER_PROJECTION.md).

$ErrorActionPreference = "Stop"
$sln = Join-Path $PSScriptRoot "MfeVirtualFolderService.sln"

Write-Host "Building Release…"
dotnet build $sln -c Release
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

$exe = Join-Path $PSScriptRoot "src\MfeVirtualFolderService\bin\Release\net8.0-windows\MfeVirtualFolderService.exe"
if (-not (Test-Path $exe)) {
  Write-Error "Built exe not found: $exe"
}

Write-Host "Installing autostart (logon task)…"
& $exe --install-autostart
exit $LASTEXITCODE
