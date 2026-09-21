# Scanner Bridge — gradnja .exe (PowerShell)
# Zaženite z:  .\build.ps1
# Če PS blokira: Set-ExecutionPolicy -Scope CurrentUser RemoteSigned

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

Write-Host "============================================================" -ForegroundColor Cyan
Write-Host " Scanner Bridge — gradnja .exe" -ForegroundColor Cyan
Write-Host "============================================================"

# Preveri predpogoje
if (-not (Get-Command python -ErrorAction SilentlyContinue)) {
    Write-Host "[NAPAKA] Python ni namesCen ali ni v PATH." -ForegroundColor Red
    pause; exit 1
}
if (-not (Get-Command pyinstaller -ErrorAction SilentlyContinue)) {
    Write-Host "[NAPAKA] PyInstaller ni namesCen. Pozeni:" -ForegroundColor Red
    Write-Host "  pip install -r requirements.txt"
    pause; exit 1
}

# Pocisti prejsnjo gradnjo
if (Test-Path "dist\ScannerBridge.exe") { Remove-Item "dist\ScannerBridge.exe" -Force }
if (Test-Path "build") { Remove-Item "build" -Recurse -Force }
if (Test-Path "ScannerBridge.spec") { Remove-Item "ScannerBridge.spec" -Force }

# Ustvari ikono
Write-Host "Ustvarjam ikono ..."
python -c @"
from PIL import Image, ImageDraw
sizes = [(16,16),(32,32),(48,48),(64,64)]
frames = []
for s, _ in sizes:
    img = Image.new('RGBA', (s, s), (245, 248, 252, 255))
    d = ImageDraw.Draw(img)
    d.rectangle([s//8, s*5//8, s*7//8, s*7//8], fill=(30, 100, 200, 255))
    d.rectangle([s//8, s//8, s*7//8, s*9//16], fill=(160, 200, 255, 255))
    cx = s // 2
    ay, aw, ah = s*3//16, s//5, s//4
    d.rectangle([cx-aw//6, ay, cx+aw//6, ay+ah*2//3], fill=(255,255,255,255))
    d.polygon([(cx-aw//2, ay+ah*2//3),(cx+aw//2, ay+ah*2//3),(cx, ay+ah)], fill=(255,255,255,255))
    frames.append(img)
frames[0].save('scanner.ico', format='ICO', append_images=frames[1:], sizes=sizes)
print('Ikona ustvarjena.')
"@

$iconFlag = if (Test-Path "scanner.ico") { "--icon scanner.ico" } else { "" }

Write-Host ""
Write-Host "Gradim ScannerBridge.exe ..."
Write-Host ""

$args = @(
    "--onefile",
    "--noconsole",
    "--name", "ScannerBridge",
    "--hidden-import", "win32api",
    "--hidden-import", "win32com",
    "--hidden-import", "win32com.client",
    "--hidden-import", "win32com.server.util",
    "--hidden-import", "win32con",
    "--hidden-import", "pywintypes",
    "--hidden-import", "win32timezone",
    "--hidden-import", "winreg",
    "--collect-all", "pystray",
    "--collect-all", "PIL",
    "--add-data", "README.md;.",
    "--disable-windowed-traceback",
    "bridge.py"
)
if ($iconFlag) { $args += $iconFlag.Split(" ") }

& pyinstaller @args

# Pocisti
if (Test-Path "scanner.ico") { Remove-Item "scanner.ico" -Force }
if (Test-Path "build") { Remove-Item "build" -Recurse -Force }
if (Test-Path "ScannerBridge.spec") { Remove-Item "ScannerBridge.spec" -Force }

Write-Host ""
Write-Host "============================================================" -ForegroundColor Cyan
if (Test-Path "dist\ScannerBridge.exe") {
    Write-Host " [OK] dist\ScannerBridge.exe je pripravljen!" -ForegroundColor Green
    Write-Host ""
    Write-Host " Namestitev:"
    Write-Host "   1. Kopiraj dist\ScannerBridge.exe kamorkoli"
    Write-Host "   2. Pozeni ScannerBridge.exe"
    Write-Host "   3. Autostart se doda samodejno"
} else {
    Write-Host " [NAPAKA] Gradnja ni uspela — preveri sporocila zgoraj." -ForegroundColor Red
}
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host ""
Read-Host "Pritisni Enter za izhod"
