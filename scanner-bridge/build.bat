@echo off
setlocal
echo ============================================================
echo  Scanner Bridge -- gradnja .exe
echo ============================================================
echo.

:: Preveri predpogoje
where python >nul 2>&1
if errorlevel 1 (
    echo [NAPAKA] Python ni namescen ali ni v PATH.
    pause & exit /b 1
)
where pyinstaller >nul 2>&1
if errorlevel 1 (
    echo [NAPAKA] PyInstaller ni namescen. Pozeni: pip install -r requirements.txt
    pause & exit /b 1
)

:: Pocisti prejsnjo gradnjo
if exist dist\ScannerBridge.exe del /q dist\ScannerBridge.exe
if exist build rmdir /s /q build 2>nul
if exist ScannerBridge.spec del /q ScannerBridge.spec 2>nul

:: Ustvari ikono -- ena vrstica brez lomljenja
echo Ustvarjam ikono ...
python -c "from PIL import Image; img=Image.new('RGBA',(64,64),(30,100,200,255)); img.save('scanner.ico',format='ICO',sizes=[(16,16),(32,32),(48,48),(64,64)])"
if exist scanner.ico (set "ICON=--icon scanner.ico") else (set "ICON=")

echo.
echo Gradim ScannerBridge.exe ...
echo.

:: POZOR: ne uporabljajte oklepajev v echo vrsticah znotraj if bloka!
pyinstaller --onefile --noconsole --name ScannerBridge %ICON% ^
  --hidden-import win32api ^
  --hidden-import win32com ^
  --hidden-import win32com.client ^
  --hidden-import win32com.server.util ^
  --hidden-import win32con ^
  --hidden-import pywintypes ^
  --hidden-import win32timezone ^
  --hidden-import winreg ^
  --collect-all pystray ^
  --collect-all PIL ^
  --add-data "README.md;." ^
  --disable-windowed-traceback ^
  bridge.py

:: Pocisti vmesne datoteke
if exist scanner.ico del /q scanner.ico 2>nul
if exist build rmdir /s /q build 2>nul
if exist ScannerBridge.spec del /q ScannerBridge.spec 2>nul

echo.
echo ============================================================
if not exist dist\ScannerBridge.exe goto :napaka
echo  [OK] dist\ScannerBridge.exe je pripravljen
echo.
echo  Namestitev:
echo    1. Kopiraj dist\ScannerBridge.exe kamorkoli na disk
echo    2. Pozeni ScannerBridge.exe
echo    3. Autostart se samodejno doda v Registry
echo    4. Ikona se pojavi v sistemski vrstici
echo ============================================================
echo.
pause
endlocal
exit /b 0

:napaka
echo  [NAPAKA] Gradnja ni uspela -- preveri sporocila zgoraj.
echo ============================================================
echo.
pause
endlocal
exit /b 1
