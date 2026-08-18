@echo off
setlocal
cd /d "%~dp0"
title Zhishu - Start

where powershell.exe >nul 2>&1
if errorlevel 1 (
  echo [FAIL] Windows PowerShell was not found.
  pause
  exit /b 1
)

powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\demo\start-windows.ps1"
exit /b %ERRORLEVEL%
