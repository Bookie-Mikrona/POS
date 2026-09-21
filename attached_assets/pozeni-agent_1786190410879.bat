@echo off
rem POS Tiskalni Agent - zaganjalnik
rem Shranite obe datoteki v isto mapo in dvokliknite to .bat datoteko.

set "SKRIPT=%~dp0pos-tiskalnik.ps1"

if not exist "%SKRIPT%" (
    echo NAPAKA: pos-tiskalnik.ps1 ni bila najdena v isti mapi.
    echo Prenesita pos-tiskalnik.ps1 in jo shranite v isto mapo kot ta datoteka.
    pause
    exit /b 1
)

echo POS tiskalni agent se zaganja...
powershell.exe -ExecutionPolicy Bypass -WindowStyle Normal -File "%SKRIPT%"

rem Ce je agent zakljucil z napako, je sporocilo vidno zgoraj
pause