!macro customUnInstall
  ; Shell redirect cleanup (D72) — never Abort uninstall/upgrade.
  ; MfeShellLauncher.exe is always shipped; running restore is fine when inactive
  ; (restorer exits 0 if HKCU does not point at the launcher). Never tell the
  ; user to open MyFileExplorer — that is a catch-22 during uninstall.
  StrCpy $R9 ""
  IfFileExists "$INSTDIR\MfeShellLauncher.exe" 0 shell_redirect_try_sidecar
    StrCpy $R9 "$INSTDIR\MfeShellLauncher.exe"
    Goto shell_redirect_run
  shell_redirect_try_sidecar:
  IfFileExists "$APPDATA\MyFileExplorer\shell-redirect\MfeShellLauncher.exe" 0 shell_redirect_no_launcher
    StrCpy $R9 "$APPDATA\MyFileExplorer\shell-redirect\MfeShellLauncher.exe"
    Goto shell_redirect_run
  shell_redirect_no_launcher:
  ; No restorer binary. Best-effort: import .reg fragments if present, then continue.
  IfFileExists "$APPDATA\MyFileExplorer\shell-redirect\Directory-shell-open.reg" 0 shell_redirect_try_explore_reg
    ExecWait 'reg.exe import "$APPDATA\MyFileExplorer\shell-redirect\Directory-shell-open.reg"' $1
  shell_redirect_try_explore_reg:
  IfFileExists "$APPDATA\MyFileExplorer\shell-redirect\Directory-shell-explore.reg" 0 shell_redirect_done
    ExecWait 'reg.exe import "$APPDATA\MyFileExplorer\shell-redirect\Directory-shell-explore.reg"' $1
  Goto shell_redirect_done
  shell_redirect_run:
    ExecWait '"$R9" --restore-shell-redirect' $0
    IntCmp $0 0 shell_redirect_done 0 0
    MessageBox MB_OK|MB_ICONINFORMATION "Folder-open registry cleanup did not finish cleanly.$\r$\n$\r$\nUninstall will continue. Windows Explorer should still open folders. After reinstalling, use Settings → Windows integration only if you had that feature enabled."
  shell_redirect_done:
!macroend
