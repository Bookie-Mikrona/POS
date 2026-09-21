@echo off
setlocal
cd /d "%~dp0"
echo This is an unsigned developer build only. It must never be used for LAN production.
echo Use build-release.ps1 on a controlled Windows x64 signing host for production.
py -m pip install -r requirements.txt
if errorlevel 1 exit /b 1
py -m PyInstaller --noconfirm --clean --onefile --name BookieFiscalService ^
  --collect-all cryptography --collect-all lxml ^
  --hidden-import sync --hidden-import servicemanager --hidden-import win32event ^
  --hidden-import win32service --hidden-import win32serviceutil ^
  --add-data "contract;contract" fiscal_service.py
if errorlevel 1 exit /b 1
echo Unsigned developer executable: dist\BookieFiscalService.exe