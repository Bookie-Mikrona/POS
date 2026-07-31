@echo off
echo Gradim Scanner Bridge .exe ...
pyinstaller ^
  --onefile ^
  --noconsole ^
  --name "ScannerBridge" ^
  --add-data "README.md;." ^
  bridge.py
echo.
echo Datoteka: dist\ScannerBridge.exe
pause
