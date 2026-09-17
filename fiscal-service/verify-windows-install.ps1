[CmdletBinding()]
param(
  [string]$InstallPath = "$env:ProgramFiles\BookieFiscalService",
  [string]$ManifestPath = "$PSScriptRoot\release-manifest.json",
  [Parameter(Mandatory=$true)][string]$ExpectedSignerThumbprint,
  [int]$Port = 17831, [string]$GatewayHost = "127.0.0.1",
  [string]$PublicCertificatePath = "", [string]$TlsCertificatePath = "",
  [switch]$RunCrashRecoveryTest, [switch]$RunPrinterTest, [string]$PrinterName,
  [int]$ConfirmPrinterJobId = 0,
  [switch]$AllowTestPackage,
  [string]$EvidencePath = "$PSScriptRoot\windows-install-evidence.json"
)
$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest
$checks = [System.Collections.Generic.List[object]]::new()
$releaseChannel = "unknown"
$productionAllowed = $false
function Write-Evidence {
  $confirmed = @($checks | Where-Object { $_.status -eq "confirmed" }).Count
  $summary = if ($releaseChannel -eq "test") {
    "TEST ONLY verification (NOT FOR CUSTOMER DISTRIBUTION) $(Get-Date -Format 'dd.MM.yyyy'): $confirmed/$($checks.Count) checks confirmed."
  } else { "Windows verification $(Get-Date -Format 'dd.MM.yyyy'): $confirmed/$($checks.Count) checks confirmed." }
  [ordered]@{generatedUtc=[DateTime]::UtcNow.ToString("o"); releaseChannel=$releaseChannel; productionAllowed=$productionAllowed; summary=$summary; checks=$checks} |
    ConvertTo-Json -Depth 6 | Set-Content $EvidencePath -Encoding UTF8
}
trap {
  $safeError = [string]$_.Exception.Message
  if ($env:ProgramData) { $safeError = $safeError -replace [regex]::Escape($env:ProgramData), "[ProgramData]" }
  if ($env:ProgramFiles) { $safeError = $safeError -replace [regex]::Escape($env:ProgramFiles), "[ProgramFiles]" }
  $checks.Add([ordered]@{name="verification";status="failed";mandatory=$true;detail=$safeError})
  Write-Evidence
  exit 1
}
function Check([string]$Name,[bool]$Pass,[bool]$Mandatory,[string]$Detail) {
  $status = "failed"
  if ($Pass) { $status = "confirmed" }
  $safeDetail = [string]$Detail
  if ($env:ProgramData) { $safeDetail = $safeDetail -replace [regex]::Escape($env:ProgramData), "[ProgramData]" }
  if ($env:ProgramFiles) { $safeDetail = $safeDetail -replace [regex]::Escape($env:ProgramFiles), "[ProgramFiles]" }
  $checks.Add([ordered]@{name=$Name; status=$status; mandatory=$Mandatory; detail=$safeDetail})
  if (-not $Pass -and $Mandatory) { throw "$Name failed: $safeDetail" }
}
function Invoke-Native([string]$File,[string[]]$Arguments,[string]$Context) {
  if (-not (Get-Command $File -ErrorAction SilentlyContinue)) {
    throw "$Context could not start '$File': command not found."
  }
  $previousErrorActionPreference = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  $exitCode = $null
  try {
    $output = @(& $File @Arguments 2>&1)
    $exitCode = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $previousErrorActionPreference
  }
  if ($exitCode -ne 0) {
    $detail = ($output -join ' ').Trim()
    if (-not $detail) { $detail = "<no native output>" }
    throw "$Context failed (exit $exitCode): $detail"
  }
  return $output
}
if (-not ("Bookie.ScmRecovery" -as [type])) {
Add-Type @'
using System; using System.ComponentModel; using System.Runtime.InteropServices;
namespace Bookie {
 public sealed class ScmAction { public int Type; public uint Delay; }
 public sealed class ScmRecovery { public uint ResetPeriod; public string RebootMessage; public string Command; public ScmAction[] Actions; public bool FailureFlag; }
 public static class ScmRecoveryApi {
  const uint Q=1,C=2;
  [StructLayout(LayoutKind.Sequential)] struct A { public int Type; public uint Delay; }
  [StructLayout(LayoutKind.Sequential)] struct F { public uint Reset; public IntPtr Msg; public IntPtr Cmd; public uint Count; public IntPtr Actions; }
  [DllImport("advapi32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern IntPtr OpenSCManager(string m,string d,uint a);
  [DllImport("advapi32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern IntPtr OpenService(IntPtr m,string n,uint a);
  [DllImport("advapi32.dll",SetLastError=true)] static extern bool CloseServiceHandle(IntPtr h);
  [DllImport("advapi32.dll",SetLastError=true)] static extern bool QueryServiceConfig2(IntPtr s,uint i,IntPtr b,uint z,out uint n);
  static IntPtr Open(string n,out IntPtr m){m=OpenSCManager(null,null,Q);if(m==IntPtr.Zero)throw new Win32Exception();IntPtr s=OpenService(m,n,Q|C);if(s==IntPtr.Zero){CloseServiceHandle(m);throw new Win32Exception();}return s;}
  public static ScmRecovery Query(string n){IntPtr m,s=Open(n,out m);try{uint z;QueryServiceConfig2(s,2,IntPtr.Zero,0,out z);IntPtr b=Marshal.AllocHGlobal((int)z);try{if(!QueryServiceConfig2(s,2,b,z,out z))throw new Win32Exception();F f=(F)Marshal.PtrToStructure(b,typeof(F));var r=new ScmRecovery{ResetPeriod=f.Reset,RebootMessage=f.Msg==IntPtr.Zero?null:Marshal.PtrToStringUni(f.Msg),Command=f.Cmd==IntPtr.Zero?null:Marshal.PtrToStringUni(f.Cmd),Actions=new ScmAction[f.Count]};int k=Marshal.SizeOf(typeof(A));for(int i=0;i<f.Count;i++){A a=(A)Marshal.PtrToStructure(IntPtr.Add(f.Actions,i*k),typeof(A));r.Actions[i]=new ScmAction{Type=a.Type,Delay=a.Delay};}IntPtr x=Marshal.AllocHGlobal(4);try{if(!QueryServiceConfig2(s,4,x,4,out z))throw new Win32Exception();r.FailureFlag=Marshal.ReadInt32(x)!=0;}finally{Marshal.FreeHGlobal(x);}return r;}finally{Marshal.FreeHGlobal(b);}}finally{CloseServiceHandle(s);CloseServiceHandle(m);}}
 }
}
'@
}
function Assert-StrictAcl([string]$Path,[bool]$Directory) {
  $allowed = @("S-1-5-18","S-1-5-32-544")
  $entries = @((Get-Acl $Path).Access)
  if ($entries.Count -ne 2) { throw "Sensitive ACL is not exactly SYSTEM and Builtin Administrators: $Path" }
  foreach ($entry in $entries) {
    $sid = $entry.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value
    if ($sid -notin $allowed -or $entry.IsInherited -or $entry.AccessControlType -ne "Allow" -or
        $entry.FileSystemRights -ne [Security.AccessControl.FileSystemRights]::FullControl) {
      throw "Sensitive ACL contains an unexpected ACE: $Path"
    }
  }
}
function Get-Health([string]$Uri) {
  $request = [Net.WebRequest]::Create($Uri)
  $request.Method = "GET"; $request.Timeout = 10000
  $response = $null
  try {
    $response = $request.GetResponse()
    return [int]$response.StatusCode
  } finally { if ($response) { $response.Close() } }
}
function Signed([string]$Path) {
  $sig = Get-AuthenticodeSignature $Path
  $ok = $sig.Status -eq "Valid" -and $sig.SignerCertificate
  if ($ExpectedSignerThumbprint) { $ok = $ok -and $sig.SignerCertificate.Thumbprint -eq ($ExpectedSignerThumbprint -replace '\s','').ToUpperInvariant() }
  Check "Authenticode $([IO.Path]::GetFileName($Path))" $ok $true ($sig.Status.ToString())
  Check "Timestamp $([IO.Path]::GetFileName($Path))" ([bool]$sig.TimeStamperCertificate) $true "RFC3161 timestamp present"
  return $sig
}
$internalSignerSubject = "CN=Bookie Local Gateway BOOKIE INTERNAL PRODUCTION"
function Is-X64Pe([string]$Path) {
  $bytes = [IO.File]::ReadAllBytes($Path); $offset = [BitConverter]::ToInt32($bytes,0x3c)
  return [Text.Encoding]::ASCII.GetString($bytes,$offset,4) -eq "PE`0`0" -and
    [BitConverter]::ToUInt16($bytes,$offset+4) -eq 0x8664
}
$exe = Join-Path $InstallPath "Bookie-Local-Gateway.exe"
if (-not (Test-Path $exe)) { throw "Installed executable is missing." }
$exeSignature = Signed $exe
Check "x64 PE" (Is-X64Pe $exe) $true "AMD64 executable"
$installerScript = Join-Path $PSScriptRoot "install.ps1"
if (Test-Path $installerScript) {
  $installerSignature = Signed $installerScript
  if ($installerSignature.SignerCertificate.Thumbprint -ne $exeSignature.SignerCertificate.Thumbprint -or
      $installerSignature.SignerCertificate.Subject -ne $exeSignature.SignerCertificate.Subject) { throw "Installer/EXE signer binding failed." }
}
if (-not (Test-Path $ManifestPath)) { throw "Release manifest is missing." }
$manifest = Get-Content $ManifestPath -Raw | ConvertFrom-Json
if ($manifest.productionAllowed -isnot [bool]) { throw "Manifest productionAllowed must be a JSON boolean." }
$releaseChannel = [string]$manifest.releaseChannel
$productionAllowed = [bool]$manifest.productionAllowed
$manifestTest = ($releaseChannel -eq "test" -and $productionAllowed -eq $false)
 $manifestProduction = ($releaseChannel -in @("production","internal-production") -and $productionAllowed -eq $true)
if (-not $manifestTest -and -not $manifestProduction) { throw "Manifest release channel/productionAllowed pair is invalid." }
$signerIsTest = ($exeSignature.SignerCertificate.Subject -eq "CN=Bookie Local Gateway TEST ONLY" -or
  $exeSignature.SignerCertificate.Subject -eq $exeSignature.SignerCertificate.Issuer)
if ($signerIsTest -and -not $AllowTestPackage) { throw "TEST ONLY signer requires -AllowTestPackage." }
if ($signerIsTest -ne $manifestTest) { throw "Manifest classification does not match actual signer classification." }
if ($manifestTest -and $exeSignature.SignerCertificate.Subject -ne "CN=Bookie Local Gateway TEST ONLY") { throw "TEST signer subject is not exact." }
 if ($manifestProduction -and ($signerIsTest -or $exeSignature.SignerCertificate.Subject -ne $internalSignerSubject)) { throw "Production manifest requires the exact internal signer." }
if ($manifest.releaseChannel -eq "internal-production") {
  $publicSignerPath = Join-Path $PSScriptRoot "bookie-internal-production.cer"
  if (-not (Test-Path $publicSignerPath)) { throw "Internal production package is missing bookie-internal-production.cer." }
  $publicSigner = [Security.Cryptography.X509Certificates.X509Certificate2]::new($publicSignerPath)
  Check "Public signer certificate fingerprint" ($publicSigner.Thumbprint -eq $exeSignature.SignerCertificate.Thumbprint) $true "matches Authenticode signer"
  Check "Public signer certificate subject" ($publicSigner.Subject -eq $internalSignerSubject) $true "BOOKIE INTERNAL PRODUCTION"
}
if ($manifest.signerThumbprint -ne $exeSignature.SignerCertificate.Thumbprint -or
    $manifest.signerSubject -ne $exeSignature.SignerCertificate.Subject) { throw "Manifest signer binding failed." }
if ([string]$manifest.architecture -ne "win-x64") { throw "Manifest architecture is not win-x64." }
$entry = $manifest.files.'Bookie-Local-Gateway.exe'
if (-not $manifest.manifestException) { throw "Manifest must explicitly document its self-hash exception." }
$packageFiles = @(Get-ChildItem $PSScriptRoot -File |
  Where-Object { $_.Name -ne "release-manifest.json" -and $_.FullName -ne ([IO.Path]::GetFullPath($EvidencePath)) } |
  Select-Object -ExpandProperty Name)
$manifestNames = @($manifest.files.PSObject.Properties | Select-Object -ExpandProperty Name)
if (@(Compare-Object ($packageFiles | Sort-Object) ($manifestNames | Sort-Object)).Count -ne 0) {
  throw "Package file set does not match manifest."
}
if ($ExpectedSignerThumbprint) {
  Check "Manifest signer" ($manifest.signerThumbprint -eq ($ExpectedSignerThumbprint -replace '\s','').ToUpperInvariant()) $true "thumbprint matches"
}
Check "Manifest version fields" ([string]$manifest.productVersion -match '^\d+\.\d+\.\d+$' -and
  [string]$manifest.fileVersion -match '^\d+\.\d+\.\d+\.0$') $true "X.Y.Z and X.Y.Z.0"
Check "Manifest hash" ((Get-FileHash $exe -Algorithm SHA256).Hash.ToLowerInvariant() -eq $entry.sha256) $true "SHA-256 matches"
foreach ($file in $manifest.files.PSObject.Properties) {
  $candidate = if ($file.Name -eq "Bookie-Local-Gateway.exe") { $exe } else { Join-Path $PSScriptRoot $file.Name }
    if (Test-Path $candidate) {
    Check "Manifest $($file.Name)" ((Get-FileHash $candidate -Algorithm SHA256).Hash.ToLowerInvariant() -eq $file.Value.sha256) $true "SHA-256 matches"
      if ($file.Name -like "*.ps1") {
        $packageSignature = Signed $candidate
        if ($packageSignature.SignerCertificate.Thumbprint -ne $exeSignature.SignerCertificate.Thumbprint -or
            $packageSignature.SignerCertificate.Subject -ne $exeSignature.SignerCertificate.Subject) { throw "Packaged script signer binding failed." }
      }
  } elseif ($file.Name -like "*.ps1") {
    throw "Signed release script is missing: $($file.Name)"
  }
}
$installedVersion = [Diagnostics.FileVersionInfo]::GetVersionInfo($exe)
Check "Manifest ProductVersion" ($installedVersion.ProductVersion.Trim() -eq [string]$manifest.productVersion) $true "exact ProductVersion"
Check "Manifest FileVersion" ($installedVersion.FileVersion.Trim() -eq [string]$manifest.fileVersion) $true "exact FileVersion"
$service = Get-CimInstance Win32_Service -Filter "Name='BookieFiscalService'"
Check "Service account" ($service.StartName -eq "LocalSystem") $true $service.StartName
if (-not $service.PathName) { throw "BookieFiscalService ImagePath is empty." }
$imagePath = [string]$service.PathName
$lanMode = $imagePath -match "(^|\s)--lan(\s|$)"
$hostMatch = [regex]::Match($imagePath, "--host\s+(""([^""]+)""|(\S+))")
$portMatch = [regex]::Match($imagePath, "--port\s+(\d+)")
$configuredHost = if ($hostMatch.Success) { if ($hostMatch.Groups[2].Success) { $hostMatch.Groups[2].Value } else { $hostMatch.Groups[3].Value } } else { "" }
$configuredPort = if ($portMatch.Success) { [int]$portMatch.Groups[1].Value } else { 17831 }
Check "Service mode" ($lanMode -or $configuredHost -eq "127.0.0.1") $true $imagePath
Check "Configured port" ($configuredPort -eq $Port) $true "$configuredPort"
Check "Installed executable path" ($imagePath -match [regex]::Escape($exe)) $true $imagePath
if ($lanMode) { Check "LAN host binding" ($configuredHost -eq "0.0.0.0") $true $configuredHost }
else { Check "Loopback host binding" ($configuredHost -eq "127.0.0.1") $true $configuredHost }
$certMatch = [regex]::Match($imagePath, "--ssl-cert\s+""([^""]+)""")
$keyMatch = [regex]::Match($imagePath, "--ssl-key\s+""([^""]+)""")
$configuredCert = if ($certMatch.Success) { $certMatch.Groups[1].Value } else { "" }
$configuredKey = if ($keyMatch.Success) { $keyMatch.Groups[1].Value } else { "" }
if ($lanMode) {
  Check "LAN TLS arguments" ($certMatch.Success -and $keyMatch.Success) $true "certificate and key configured"
  Check "Configured TLS certificate" (Test-Path $configuredCert) $true $configuredCert
  Check "Configured TLS key" (Test-Path $configuredKey) $true $configuredKey
  if (-not $TlsCertificatePath) { $TlsCertificatePath = $configuredCert }
} else {
  Check "Loopback has no TLS requirement" (-not $certMatch.Success -and -not $keyMatch.Success) $true "HTTP loopback"
}
$scConfig = Invoke-Native "sc.exe" @("qc","BookieFiscalService") "Read SCM configuration"
$scRecovery = [Bookie.ScmRecoveryApi]::Query("BookieFiscalService")
$serviceReg = Get-ItemProperty "HKLM:\SYSTEM\CurrentControlSet\Services\BookieFiscalService" -ErrorAction Stop
Check "Delayed automatic start" ([int]$serviceReg.Start -eq 2 -and [int]$serviceReg.DelayedAutostart -eq 1) $true "Start=2, DelayedAutostart=1"
Check "Recovery actions" ($scRecovery.ResetPeriod -eq 86400 -and $scRecovery.Actions.Count -eq 3 -and
  @($scRecovery.Actions | Where-Object { $_.Type -eq 1 -and $_.Delay -eq 5000 }).Count -eq 3 -and
  $null -eq $scRecovery.RebootMessage -and $null -eq $scRecovery.Command) $true "three Restart actions at 5000ms, reset 86400"
Check "Recovery failure flag" ($scRecovery.FailureFlag) $true "failure flag enabled"
$bookieRules = @(Get-NetFirewallRule -DisplayName "Bookie Local Gateway TCP *" -ErrorAction SilentlyContinue)
if ($lanMode) {
  Check "Exactly one Bookie firewall rule" ($bookieRules.Count -eq 1) $true "count=$($bookieRules.Count)"
  if ($bookieRules.Count -eq 1) {
    $bookieRule = $bookieRules[0]
    $portFilter = $bookieRule | Get-NetFirewallPortFilter
    $addressFilter = $bookieRule | Get-NetFirewallAddressFilter
    $applicationFilter = $bookieRule | Get-NetFirewallApplicationFilter
    $serviceFilter = $bookieRule | Get-NetFirewallServiceFilter
    $interfaceFilter = $bookieRule | Get-NetFirewallInterfaceFilter
    Check "Private firewall" ($bookieRule.Profile.ToString() -eq "Private") $true "Private profile"
    Check "Firewall enabled" ([bool]$bookieRule.Enabled) $true "enabled"
    Check "Firewall direction/action" ($bookieRule.Direction.ToString() -eq "Inbound" -and $bookieRule.Action.ToString() -eq "Allow") $true "Inbound Allow"
    Check "Firewall protocol/port" ($portFilter.Protocol.ToString() -eq "TCP" -and $portFilter.LocalPort -contains [string]$configuredPort) $true "$configuredPort"
    Check "LocalSubnet firewall" ($addressFilter.RemoteAddress -contains "LocalSubnet" -and $addressFilter.RemoteAddress.Count -eq 1) $true "LocalSubnet only"
    $localAddressAllowed = @("Any",$configuredHost) + @(Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue | Select-Object -ExpandProperty IPAddress)
    Check "Firewall local address" ($addressFilter.LocalAddress.Count -eq 1 -and $addressFilter.LocalAddress[0] -in $localAddressAllowed) $true "expected local address"
    Check "Firewall app/service/interface scope" (($applicationFilter.Program -in @("Any",$null)) -and ($serviceFilter.Service -in @("Any",$null)) -and
      ($interfaceFilter.InterfaceType -in @("Any",$null)) -and ($interfaceFilter.InterfaceAlias -in @("Any",$null))) $true "unrestricted app/service/interface filters"
    Check "Firewall edge traversal" ($bookieRule.EdgeTraversalPolicy.ToString() -eq "Block") $true "Block"
  }
} else {
  Check "Loopback has no firewall rule" ($bookieRules.Count -eq 0) $true "no LAN rule required"
}
$data = Join-Path $env:ProgramData "BookieFiscal"
$aclCheck = $true
try { Assert-StrictAcl $data $true } catch { $aclCheck = $false }
Check "ProgramData ACL" $aclCheck $true "exact SYSTEM/Builtin Administrators SIDs"
if (Test-Path (Join-Path $env:ProgramData "BookieFiscal-Backups")) {
  Assert-StrictAcl (Join-Path $env:ProgramData "BookieFiscal-Backups") $true
  foreach ($backupDir in @(Get-ChildItem (Join-Path $env:ProgramData "BookieFiscal-Backups") -Directory -Recurse)) {
    Assert-StrictAcl $backupDir.FullName $true
  }
}
if ($lanMode -and $configuredKey) {
  $keyAclCheck = $true
  try { Assert-StrictAcl $configuredKey $false } catch { $keyAclCheck = $false }
  Check "TLS key ACL" $keyAclCheck $true "exact SYSTEM/Builtin Administrators SIDs"
}
$scheme = if ($lanMode) {"https"} else {"http"}
if ($lanMode -and -not $PublicCertificatePath) { throw "LAN verification requires -PublicCertificatePath." }
try {
  $statusCode = Get-Health "${scheme}://$GatewayHost`:$Port/v1/gateway/health"
  Check "Gateway health" ($statusCode -eq 200) $true "HTTP $statusCode"
} catch { Check "Gateway health" $false $true $_.Exception.Message }
if ($PublicCertificatePath) {
  $cert = [System.Security.Cryptography.X509Certificates.X509Certificate2]::new($PublicCertificatePath)
  Check "TLS validity" ($cert.NotBefore -lt [datetime]::UtcNow -and $cert.NotAfter -gt [datetime]::UtcNow) $true "$($cert.NotAfter.ToString('dd.MM.yyyy'))"
  $chain = [Security.Cryptography.X509Certificates.X509Chain]::new()
  Check "TLS chain trust" $chain.Build($cert) $true "Windows trust chain"
  $fingerprint = $cert.GetCertHashString("SHA256")
  Check "TLS fingerprint" ($fingerprint.Length -eq 64) $true $fingerprint
  $sanText = ($cert.Extensions | ForEach-Object { $_.Format($true) }) -join ";"
  Check "TLS SAN" ($sanText -match [regex]::Escape($GatewayHost)) $true "hostname/IP SAN"
  if ($TlsCertificatePath) {
    $actual = [Security.Cryptography.X509Certificates.X509Certificate2]::new($TlsCertificatePath)
    Check "Service TLS fingerprint" ($actual.Thumbprint -eq $cert.Thumbprint) $true "matches supplied public certificate"
  }
}
if ($RunCrashRecoveryTest) {
  $crashService = Get-CimInstance Win32_Service -Filter "Name='BookieFiscalService'"
  $before = [int]$crashService.ProcessId
  if ($crashService.State -ne "Running" -or $before -le 0) { throw "Crash test requires BookieFiscalService Running with a nonzero ProcessId." }
  $crashStarted = [DateTime]::UtcNow
  Stop-Process -Id $before -Force
  $crashDeadline = (Get-Date).AddSeconds(60); $after = $null
  do {
    Start-Sleep 2
    $crashService = Get-CimInstance Win32_Service -Filter "Name='BookieFiscalService'"
    if ($crashService.State -eq "Running" -and [int]$crashService.ProcessId -gt 0 -and
        [int]$crashService.ProcessId -ne $before) { $after = [int]$crashService.ProcessId }
  } while ((-not $after) -and (Get-Date) -lt $crashDeadline)
  $elapsed = ([DateTime]::UtcNow - $crashStarted).TotalMilliseconds
  $recoveryHealth = Get-Health "${scheme}://$GatewayHost`:$configuredPort/v1/gateway/health"
  Check "SCM crash recovery" ([bool]$after -and $recoveryHealth -eq 200) $true "oldPid=$before newPid=$after elapsedMs=$elapsed health=$recoveryHealth"
} else {
  $checks.Add([ordered]@{name="SCM crash recovery";status="not-run";mandatory=$false;detail="Pass -RunCrashRecoveryTest explicitly."})
}
if ($RunPrinterTest) {
  if (-not $PrinterName) { throw "-PrinterName is required with -RunPrinterTest." }
  $printer = Get-Printer -Name $PrinterName -ErrorAction Stop
  $queuedAt = [DateTime]::UtcNow.ToString("o")
  $jobId = 0
  if ($ConfirmPrinterJobId -gt 0) {
    $jobId = $ConfirmPrinterJobId
    $queuedAt = "not-observed-this-run"
  } else {
    if (-not ("Bookie.RawSpool" -as [type])) {
    Add-Type @'
using System;
using System.Runtime.InteropServices;
namespace Bookie {
 public static class RawSpool {
  [DllImport("winspool.drv",SetLastError=true,CharSet=CharSet.Unicode)]
  static extern bool OpenPrinter(string n,out IntPtr h,IntPtr p);
  [DllImport("winspool.drv",SetLastError=true)] static extern bool ClosePrinter(IntPtr h);
  [DllImport("winspool.drv",SetLastError=true,CharSet=CharSet.Unicode)]
  static extern int StartDocPrinter(IntPtr h,int l,[In] DOCINFO d);
  [DllImport("winspool.drv",SetLastError=true)] static extern bool EndDocPrinter(IntPtr h);
  [DllImport("winspool.drv",SetLastError=true)] static extern bool StartPagePrinter(IntPtr h);
  [DllImport("winspool.drv",SetLastError=true)] static extern bool EndPagePrinter(IntPtr h);
  [DllImport("winspool.drv",SetLastError=true)] static extern bool WritePrinter(IntPtr h,byte[] b,int n,out int w);
  [StructLayout(LayoutKind.Sequential,CharSet=CharSet.Unicode)]
  class DOCINFO { public string pDocName="Bookie diagnostic (non-fiscal)"; public string pOutputFile=null; public string pDataType="RAW"; }
  public static int Send(string printer) {
   IntPtr h; if(!OpenPrinter(printer,out h,IntPtr.Zero)) throw new System.ComponentModel.Win32Exception();
    bool doc=false,page=false;
    try { int id=StartDocPrinter(h,1,new DOCINFO()); if(id<=0) throw new System.ComponentModel.Win32Exception(); doc=true;
     if(!StartPagePrinter(h)) throw new System.ComponentModel.Win32Exception(); page=true;
     byte[] text=System.Text.Encoding.ASCII.GetBytes("NI FISKALNI RACUN\r\n");
     byte[] b=new byte[2+text.Length+6]; b[0]=0x1b;b[1]=0x40;System.Buffer.BlockCopy(text,0,b,2,text.Length);
     int p=2+text.Length;b[p++]=0x1b;b[p++]=0x64;b[p++]=0x03;b[p++]=0x1d;b[p++]=0x56;b[p++]=0x00; int w;
     if(!WritePrinter(h,b,b.Length,out w) || w!=b.Length) throw new System.ComponentModel.Win32Exception();
     if(!EndPagePrinter(h)) throw new System.ComponentModel.Win32Exception(); page=false;
     if(!EndDocPrinter(h)) throw new System.ComponentModel.Win32Exception(); doc=false; return id;
    } finally { if(page) EndPagePrinter(h); if(doc) EndDocPrinter(h); ClosePrinter(h); }
  }
 }
}
'@
    }
    $jobId = [Bookie.RawSpool]::Send($PrinterName)
  }
  Check "Printer installed" ([bool]$printer) $true $PrinterName
  $operatorResponse = "not-requested"
  $confirmedAt = $null
  if ($ConfirmPrinterJobId -gt 0) {
    $operatorResponse = Read-Host "Visually confirm diagnostic job $jobId (NI FISKALNI RACUN). Type YES to record confirmation"
    if ($operatorResponse -eq "YES") { $confirmedAt = [DateTime]::UtcNow.ToString("o") }
  } elseif ($jobId -gt 0) {
    $operatorResponse = Read-Host "Diagnostic job $jobId queued (NI FISKALNI RACUN). Type YES after visual confirmation"
    if ($operatorResponse -eq "YES") { $confirmedAt = [DateTime]::UtcNow.ToString("o") }
  }
  $printerEvidence = [ordered]@{jobId=$jobId;queuedAt=$queuedAt;confirmedAt=$confirmedAt;operatorResponse=$operatorResponse}
  $printerStatus = "observed"
  if ($confirmedAt) { $printerStatus = "confirmed" }
  $checks.Add([ordered]@{name="Non-fiscal diagnostic RAW spool test";status=$printerStatus;mandatory=$false;detail=($printerEvidence | ConvertTo-Json -Compress)})
} else {
  $checks.Add([ordered]@{name="RAW printer test";status="not-run";mandatory=$false;detail="Pass -RunPrinterTest and -PrinterName explicitly."})
}
$confirmed = @($checks | Where-Object { $_.status -eq "confirmed" }).Count
$summary = "Windows verification $(Get-Date -Format 'dd.MM.yyyy'): $confirmed/$($checks.Count) checks confirmed."
Write-Evidence
Write-Host $summary