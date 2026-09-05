!macro customUnInstall
  ; Restore shell redirect registry before app files are removed (D72).
  ; Prefer $INSTDIR launcher; fall back to userData sidecar written on Enable.
  ; If redirect still appears active (backup present) and neither launcher exists, Abort.
  StrCpy $R9 ""
  IfFileExists "$INSTDIR\MfeShellLauncher.exe" 0 shell_redirect_try_sidecar
    StrCpy $R9 "$INSTDIR\MfeShellLauncher.exe"
    Goto shell_redirect_run
  shell_redirect_try_sidecar:
  IfFileExists "$APPDATA\MyFileExplorer\shell-redirect\MfeShellLauncher.exe" 0 shell_redirect_check_backup
    StrCpy $R9 "$APPDATA\MyFileExplorer\shell-redirect\MfeShellLauncher.exe"
    Goto shell_redirect_run
  shell_redirect_check_backup:
  ; No restorer binary — refuse uninstall only when a backup proves redirect was enabled.
  IfFileExists "$APPDATA\MyFileExplorer\shell-redirect\backup.json" 0 shell_redirect_done
    MessageBox MB_OK|MB_ICONEXCLAMATION "Shell redirect is still active but MfeShellLauncher.exe is missing.$\r$\n$\r$\nReinstall MyFileExplorer (or restore the launcher), then open Settings → Windows integration → Restore previous folder-opening configuration, and run uninstall again."
    Abort "Shell redirect registry restore required (launcher missing)"
  shell_redirect_run:
    ExecWait '"$R9" --restore-shell-redirect' $0
    IntCmp $0 0 shell_redirect_done shell_redirect_failed shell_redirect_failed
  shell_redirect_failed:
    MessageBox MB_OK|MB_ICONEXCLAMATION "Could not restore your previous folder-opening configuration.$\r$\n$\r$\nOpen MyFileExplorer → Settings → Windows integration → Restore previous folder-opening configuration, then run uninstall again."
    Abort "Shell redirect registry restore failed"
  shell_redirect_done:
!macroend
