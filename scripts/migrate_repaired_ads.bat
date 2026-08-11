@echo off
setlocal
REM Migrate legacy ADS "repaired" → VER_1 + VER_COUNT (NTFS).
REM Usage:
REM   migrate_repaired_ads.bat "D:\Photos"
REM   migrate_repaired_ads.bat "D:\Photos" --dry-run

cd /d "%~dp0"

where py >nul 2>&1
if %ERRORLEVEL%==0 (
  py -3 "%~dp0migrate_repaired_ads.py" %*
  exit /b %ERRORLEVEL%
)

where python >nul 2>&1
if %ERRORLEVEL%==0 (
  python "%~dp0migrate_repaired_ads.py" %*
  exit /b %ERRORLEVEL%
)

echo Python 3 not found. Install Python or ensure py/python is on PATH.
exit /b 2
