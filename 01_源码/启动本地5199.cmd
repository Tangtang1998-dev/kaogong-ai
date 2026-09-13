@echo off
cd /d "%~dp0"
pwsh -NoProfile -ExecutionPolicy Bypass -File "%~dp0启动本地5199.ps1"
if errorlevel 1 pause
