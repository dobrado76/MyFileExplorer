# Remove per-user logon autostart for the Virtual Folder projection agent.
$ErrorActionPreference = "Stop"
$exe = Join-Path $PSScriptRoot "MfeVirtualFolderService.exe"
if (Test-Path $exe) {
  & $exe --uninstall-autostart
  exit $LASTEXITCODE
}

schtasks.exe /Delete /TN "\MyFileExplorer\VirtualFolderProjection" /F 2>$null
Remove-ItemProperty -Path "HKCU:\Software\Microsoft\Windows\CurrentVersion\Run" `
  -Name "MyFileExplorerVirtualFolderProjection" -ErrorAction SilentlyContinue
Write-Host "Autostart removed (exe was missing; cleaned Task Scheduler / Run key if present)."
exit 0
