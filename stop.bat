@echo off
setlocal
cd /d "%~dp0"

title Zhishu - Stop
echo ================================================================
echo   Zhishu - Safe Stop
echo ================================================================
echo.
echo Only launcher-owned Node / Spring processes will be stopped.
echo PostgreSQL is stopped only when this launcher started it.
echo Database volumes are retained.
echo.

where node >nul 2>&1
if errorlevel 1 (
  echo [FAIL] Node.js was not found; safe state cannot be read.
  echo.
  pause
  exit /b 1
)

call npm run zhishu:stop
set "STOP_EXIT=%ERRORLEVEL%"
echo.
if not "%STOP_EXIT%"=="0" (
  echo [FAIL] Stop failed. Review the output above.
) else (
  echo [DONE] Launcher-owned services have stopped.
)
echo.
pause
exit /b %STOP_EXIT%
