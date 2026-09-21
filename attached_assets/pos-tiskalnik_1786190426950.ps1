# POS Tiskalni Agent - samodejno generiran
$token     = "28b37db2-e5c2-4cf8-a3c4-02fcf1d964f6"
$api       = "https://973d51c6-f85b-47ca-967b-2211a87f10eb-00-24qtdhql3drct.worf.replit.dev/api/print/agent"
$tiskalnik = "POS-58"

# Win32 API za direktno posiljanje ESC/POS bajtov
Add-Type -TypeDefinition @"
using System;using System.Runtime.InteropServices;
public class WinPrint{
  [DllImport("winspool.Drv",EntryPoint="OpenPrinterA")]public static extern bool OpenPrinter(string n,out IntPtr h,IntPtr p);
  [DllImport("winspool.Drv",EntryPoint="ClosePrinter")]public static extern bool ClosePrinter(IntPtr h);
  [DllImport("winspool.Drv",EntryPoint="StartDocPrinterA")]public static extern int StartDocPrinter(IntPtr h,int l,[In,MarshalAs(UnmanagedType.LPStruct)]DocInfo d);
  [DllImport("winspool.Drv",EntryPoint="EndDocPrinter")]public static extern bool EndDocPrinter(IntPtr h);
  [DllImport("winspool.Drv",EntryPoint="StartPagePrinter")]public static extern bool StartPagePrinter(IntPtr h);
  [DllImport("winspool.Drv",EntryPoint="EndPagePrinter")]public static extern bool EndPagePrinter(IntPtr h);
  [DllImport("winspool.Drv",EntryPoint="WritePrinter")]public static extern bool WritePrinter(IntPtr h,IntPtr b,int c,out int w);
}
[StructLayout(LayoutKind.Sequential,CharSet=CharSet.Ansi)]
public class DocInfo{[MarshalAs(UnmanagedType.LPStr)]public string pDocName;[MarshalAs(UnmanagedType.LPStr)]public string pOutputFile;[MarshalAs(UnmanagedType.LPStr)]public string pDataType;}
"@ -ErrorAction SilentlyContinue

function Tiskaj-Raw([byte[]]$data){
    $h=[IntPtr]::Zero
    $ok=[WinPrint]::OpenPrinter($tiskalnik,[ref]$h,[IntPtr]::Zero)
    if(-not $ok -or $h -eq [IntPtr]::Zero){
        Write-Host "NAPAKA: Tiskalnik '$tiskalnik' ni najden ali ni dosegljiv."
        Write-Host "  Zazenite: Get-WmiObject Win32_Printer | Select-Object Name"
        Write-Host "  in preverite, da je ime tocno enako."
        return $false
    }
    $di=New-Object DocInfo;$di.pDocName="POS-Racun";$di.pDataType="RAW"
    $docId=[WinPrint]::StartDocPrinter($h,1,$di)
    if($docId -le 0){
        Write-Host "NAPAKA: StartDocPrinter ni uspel (koda $docId)."
        [WinPrint]::ClosePrinter($h)|Out-Null
        return $false
    }
    [WinPrint]::StartPagePrinter($h)|Out-Null
    $ptr=[System.Runtime.InteropServices.Marshal]::AllocHGlobal($data.Length)
    [System.Runtime.InteropServices.Marshal]::Copy($data,0,$ptr,$data.Length)
    $w=0
    $wr=[WinPrint]::WritePrinter($h,$ptr,$data.Length,[ref]$w)
    [System.Runtime.InteropServices.Marshal]::FreeHGlobal($ptr)
    if(-not $wr -or $w -ne $data.Length){
        Write-Host "NAPAKA: WritePrinter ni uspel (poslano $w / $($data.Length) bajtov)."
    }
    [WinPrint]::EndPagePrinter($h)|Out-Null
    [WinPrint]::EndDocPrinter($h)|Out-Null
    [WinPrint]::ClosePrinter($h)|Out-Null
    return $wr
}

# Samodejni zagon ob Windows prijavi
$scriptPath = if ($MyInvocation.MyCommand.Path) { $MyInvocation.MyCommand.Path } `
              elseif ($PSCommandPath) { $PSCommandPath } `
              else { $null }

if ($scriptPath) {
    # Metoda 1: Startup mapa (brez admin pravic) - VBScript zazene PS skripto skrito
    $startupDir = [Environment]::GetFolderPath("Startup")
    $vbsPath = Join-Path $startupDir "POS-TiskalniAgent.vbs"
    if (-not (Test-Path $vbsPath)) {
        $vbs = 'CreateObject("WScript.Shell").Run "powershell.exe -WindowStyle Hidden -ExecutionPolicy Bypass -File ""' + $scriptPath + '""", 0, False'
        Set-Content -Path $vbsPath -Value $vbs -Encoding ASCII
        Write-Host "Samodejni zagon registriran v Startup mapi (ob naslednji prijavi se agent zazene samodejno)"
    }
    # Metoda 2: Task Scheduler (zahteva admin - doda zagon za vse uporabnike)
    $taskName = "POS-TiskalniAgent"
    if (!(Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue)) {
        try {
            $action  = New-ScheduledTaskAction -Execute "powershell.exe" -Argument "-WindowStyle Hidden -ExecutionPolicy Bypass -File `"$scriptPath`""
            $trigger = New-ScheduledTaskTrigger -AtLogOn
            Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -RunLevel Highest -Force -ErrorAction Stop | Out-Null
            Write-Host "Samodejni zagon registriran tudi v Task Schedulerju"
        } catch { Write-Host "Info: Task Scheduler ni bil registriran (brez admin - Startup mapa zadostuje)" }
    }
} else {
    Write-Host "Opozorilo: pot skripte ni bila zaznana."
    Write-Host "  Shranite .ps1 datoteko na disk in jo zazenite z desnim klikom -> Zazi s PowerShellom."
    Write-Host "  Samodejni zagon ni bil nastavljen."
}

Write-Host "POS tiskalni agent zagnan. Tiskalnik: $tiskalnik"
Write-Host "Za ustavitev pritisnite Ctrl+C"

while ($true) {
    try {
        $jobs = Invoke-RestMethod "$api/naloge?token=$token"
        foreach ($j in $jobs) {
            $bytes = [Convert]::FromBase64String($j.bajti)
            $uspeh = Tiskaj-Raw $bytes
            Invoke-RestMethod "$api/naloge/$($j.id)/izvrseno?token=$token" -Method POST | Out-Null
            if($uspeh){
                Write-Host "$(Get-Date -Format 'HH:mm:ss') Natisnjen racun $($j.racunId) ($($bytes.Length) bajtov)"
            } else {
                Write-Host "$(Get-Date -Format 'HH:mm:ss') NAPAKA pri tiskanju racuna $($j.racunId) - preverite ime tiskalnika!"
            }
        }
    } catch { Write-Host "$(Get-Date -Format 'HH:mm:ss') Napaka: $_" }
    Start-Sleep 2
}