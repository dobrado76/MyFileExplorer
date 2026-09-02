!macro customUnInstall
  ; Restore shell redirect registry before app files are removed (D72).
  IfFileExists "$INSTDIR\MfeShellLauncher.exe" 0 shell_redirect_done
    ExecWait '"$INSTDIR\MfeShellLauncher.exe" --restore-shell-redirect' $0
    IntCmp $0 0 shell_redirect_done shell_redirect_failed shell_redirect_failed
  shell_redirect_failed:
    MessageBox MB_OK|MB_ICONEXCLAMATION "Could not restore your previous folder-opening configuration.$\r$\n$\r$\nOpen MyFileExplorer → Settings → Windows integration → Restore previous folder-opening configuration, then run uninstall again."
    Abort "Shell redirect registry restore failed"
  shell_redirect_done:
!macroend
