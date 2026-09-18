#requires -RunAsAdministrator
[CmdletBinding()]
param(
  [string]$InstallPath = "$env:ProgramFiles\BookieFiscalService",
  [switch]$Lan, [int]$Port = 17831,
  [string]$TlsCertPath = "$env:ProgramData\BookieFiscal\gateway-cert.pem",
  [string]$TlsKeyPath = "$env:ProgramData\BookieFiscal\gateway-key.pem",
  [string]$GatewayIp = "", [string]$AllowedLocalIp = "",
  [string]$ExpectedSignerThumbprint = "",
  [switch]$AllowUnsignedDevelopment,
  [switch]$ConfirmSafeCloudRelease,
  [switch]$AllowTestPackage
)
$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest
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
function Invoke-NativeAllowNotFound([string]$File,[string[]]$Arguments,[string]$Context) {
  if (-not (Get-Command $File -ErrorAction SilentlyContinue)) {
    return @()
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
  if ($exitCode -ne 0 -and $exitCode -ne 1060) {
    $detail = ($output -join ' ').Trim()
    if (-not $detail) { $detail = "<no native output>" }
    throw "$Context failed (exit $exitCode): $detail"
  }
  return $output
}
function Invoke-RollbackPhase([string]$Name,[scriptblock]$Action,[ref]$Failures) {
  try { & $Action }
  catch { $Failures.Value += "${Name}: $($_.Exception.Message)" }
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
function Set-StrictAcl([string]$Path,[bool]$Directory) {
  if (-not (Test-Path $Path)) { throw "ACL target is missing: $Path" }
  $acl = Get-Acl $Path
  $acl.SetAccessRuleProtection($true,$false)
  foreach ($access in @($acl.Access)) { [void]$acl.RemoveAccessRuleSpecific($access) }
  $system = New-Object Security.Principal.SecurityIdentifier("S-1-5-18")
  $admins = New-Object Security.Principal.SecurityIdentifier("S-1-5-32-544")
  $inheritance = [Security.AccessControl.InheritanceFlags]::None
  if ($Directory) { $inheritance = [Security.AccessControl.InheritanceFlags]"ContainerInherit,ObjectInherit" }
  foreach ($sid in @($system,$admins)) {
    $rule = New-Object Security.AccessControl.FileSystemAccessRule($sid,[Security.AccessControl.FileSystemRights]::FullControl,$inheritance,[Security.AccessControl.PropagationFlags]::None,[Security.AccessControl.AccessControlType]::Allow)
    [void]$acl.AddAccessRule($rule)
  }
  Set-Acl -Path $Path -AclObject $acl
  Assert-StrictAcl $Path $Directory
}
function Get-Health([string]$Uri) {
  $request = [Net.WebRequest]::Create($Uri); $request.Method = "GET"; $request.Timeout = 10000
  $response = $null
  try { $response = $request.GetResponse(); return [int]$response.StatusCode }
  finally { if ($response) { $response.Close() } }
}
if (-not ("Bookie.ScmRecovery" -as [type])) {
Add-Type @'
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
namespace Bookie {
 public sealed class ScmAction { public int Type; public uint Delay; }
 public sealed class ScmRecovery { public uint ResetPeriod; public string RebootMessage; public string Command; public ScmAction[] Actions; public bool FailureFlag; }
 public static class ScmRecoveryApi {
  const uint SC_MANAGER_CONNECT=0x0001, SERVICE_QUERY_CONFIG=0x0001, SERVICE_CHANGE_CONFIG=0x0002;
  [StructLayout(LayoutKind.Sequential)] struct ActionNative { public int Type; public uint Delay; }
  [StructLayout(LayoutKind.Sequential)] struct FailureNative { public uint ResetPeriod; public IntPtr RebootMessage; public IntPtr Command; public uint Count; public IntPtr Actions; }
  [DllImport("advapi32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern IntPtr OpenSCManager(string m,string d,uint a);
  [DllImport("advapi32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern IntPtr OpenService(IntPtr m,string n,uint a);
  [DllImport("advapi32.dll",SetLastError=true)] static extern bool CloseServiceHandle(IntPtr h);
  [DllImport("advapi32.dll",SetLastError=true)] static extern bool QueryServiceConfig2(IntPtr s,uint i,IntPtr b,uint z,out uint need);
  [DllImport("advapi32.dll",SetLastError=true)] static extern bool ChangeServiceConfig2(IntPtr s,uint i,IntPtr b);
  static IntPtr Open(string name,out IntPtr manager) {
   manager=OpenSCManager(null,null,SC_MANAGER_CONNECT); if(manager==IntPtr.Zero) throw new Win32Exception();
   IntPtr service=OpenService(manager,name,SERVICE_QUERY_CONFIG|SERVICE_CHANGE_CONFIG); if(service==IntPtr.Zero){CloseServiceHandle(manager);throw new Win32Exception();} return service;
  }
  public static ScmRecovery Query(string name) {
   IntPtr manager, service=Open(name,out manager);
   try {
    uint need; QueryServiceConfig2(service,2,IntPtr.Zero,0,out need); IntPtr buf=Marshal.AllocHGlobal((int)need);
    try { if(!QueryServiceConfig2(service,2,buf,need,out need)) throw new Win32Exception(); FailureNative f=(FailureNative)Marshal.PtrToStructure(buf,typeof(FailureNative)); ScmRecovery r=new ScmRecovery();
     r.ResetPeriod=f.ResetPeriod; r.RebootMessage=f.RebootMessage==IntPtr.Zero?null:Marshal.PtrToStringUni(f.RebootMessage); r.Command=f.Command==IntPtr.Zero?null:Marshal.PtrToStringUni(f.Command); r.Actions=new ScmAction[f.Count];
     int size=Marshal.SizeOf(typeof(ActionNative)); for(int i=0;i<f.Count;i++){ ActionNative a=(ActionNative)Marshal.PtrToStructure(IntPtr.Add(f.Actions,i*size),typeof(ActionNative)); r.Actions[i]=new ScmAction{Type=a.Type,Delay=a.Delay}; }
     IntPtr flag=Marshal.AllocHGlobal(4); try { if(!QueryServiceConfig2(service,4,flag,4,out need)) throw new Win32Exception(); r.FailureFlag=Marshal.ReadInt32(flag)!=0; } finally { Marshal.FreeHGlobal(flag); } return r;
    } finally { Marshal.FreeHGlobal(buf); }
   } finally { CloseServiceHandle(service); CloseServiceHandle(manager); }
  }
  public static void Apply(string name, ScmRecovery r) {
   IntPtr manager, service=Open(name,out manager); IntPtr actions=IntPtr.Zero, msg=IntPtr.Zero, cmd=IntPtr.Zero, buf=IntPtr.Zero;
   try { int size=Marshal.SizeOf(typeof(ActionNative)); actions=Marshal.AllocHGlobal(size*r.Actions.Length); for(int i=0;i<r.Actions.Length;i++) Marshal.StructureToPtr(new ActionNative{Type=r.Actions[i].Type,Delay=r.Actions[i].Delay},IntPtr.Add(actions,i*size),false);
    if(r.RebootMessage!=null) msg=Marshal.StringToHGlobalUni(r.RebootMessage); if(r.Command!=null) cmd=Marshal.StringToHGlobalUni(r.Command);
    FailureNative f=new FailureNative{ResetPeriod=r.ResetPeriod,RebootMessage=msg,Command=cmd,Count=(uint)r.Actions.Length,Actions=actions}; buf=Marshal.AllocHGlobal(Marshal.SizeOf(typeof(FailureNative))); Marshal.StructureToPtr(f,buf,false); if(!ChangeServiceConfig2(service,2,buf)) throw new Win32Exception();
    IntPtr flag=Marshal.AllocHGlobal(4); try { Marshal.WriteInt32(flag,r.FailureFlag?1:0); if(!ChangeServiceConfig2(service,4,flag)) throw new Win32Exception(); } finally { Marshal.FreeHGlobal(flag); }
   } finally { if(buf!=IntPtr.Zero)Marshal.FreeHGlobal(buf); if(actions!=IntPtr.Zero)Marshal.FreeHGlobal(actions); if(msg!=IntPtr.Zero)Marshal.FreeHGlobal(msg); if(cmd!=IntPtr.Zero)Marshal.FreeHGlobal(cmd); CloseServiceHandle(service); CloseServiceHandle(manager); }
  }
 }
}
'@
}
function Get-CertificateHostText([string]$CertificatePath) {
  $certificate = [Security.Cryptography.X509Certificates.X509Certificate2]::new($CertificatePath)
  if ($certificate.NotBefore.ToUniversalTime() -gt [DateTime]::UtcNow -or $certificate.NotAfter.ToUniversalTime() -lt [DateTime]::UtcNow) {
    throw "TLS certificate is not currently valid."
  }
  $chain = [Security.Cryptography.X509Certificates.X509Chain]::new()
  if (-not $chain.Build($certificate)) { throw "TLS certificate chain is not trusted: $CertificatePath" }
  return ($certificate.Extensions | ForEach-Object { $_.Format($true) }) -join ";"
}
function Resolve-PriorHealthHost([object]$Service) {
  if (-not $Service -or -not ([string]$Service.PathName -match "(^|\s)--lan(\s|$)")) { return "127.0.0.1" }
  $image = [string]$Service.PathName
  $hostMatch = [regex]::Match($image,'--host\s+("?)([^"\s]+)\1')
  $certMatch = [regex]::Match($image,'--ssl-cert\s+("?)([^"\s]+)\1')
  $portMatch = [regex]::Match($image,'--port\s+(\d+)')
  $script:priorHealthPort = 17831
  if ($portMatch.Success) { $script:priorHealthPort = [int]$portMatch.Groups[1].Value }
  if (-not $certMatch.Success -or -not (Test-Path $certMatch.Groups[2].Value)) {
    throw "Existing LAN service has no usable TLS certificate for rollback health."
  }
  $san = Get-CertificateHostText $certMatch.Groups[2].Value
  $candidates = @()
  $localIps = @(Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
    Where-Object { $_.IPAddress -notlike "127.*" } | Select-Object -ExpandProperty IPAddress)
  if ($hostMatch.Success -and $hostMatch.Groups[2].Value -notin @("0.0.0.0","::","*")) {
    $candidates += $hostMatch.Groups[2].Value
  }
  if ($GatewayIp -and $GatewayIp -in $localIps) { $candidates += $GatewayIp }
  $candidates += $localIps
  foreach ($candidate in @($candidates | Select-Object -Unique)) {
    if ($san -match [regex]::Escape($candidate)) { $script:priorHealthHost = $candidate; return $candidate }
  }
  if ($san -match "localhost") { $script:priorHealthHost = "localhost"; return "localhost" }
  throw "Existing LAN service has no resolvable SAN-covered local health endpoint."
}
if ($Port -lt 1024 -or $Port -gt 65535) { throw "Port must be a fixed TCP port between 1024 and 65535." }
$packageRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$exeSource = Join-Path $packageRoot "Bookie-Local-Gateway.exe"
if (-not (Test-Path $exeSource)) { $exeSource = Join-Path $packageRoot "dist\Bookie-Local-Gateway.exe" }
if (-not (Test-Path $exeSource)) { throw "Signed gateway executable is missing." }
$manifestPath = Join-Path $packageRoot "release-manifest.json"
$signerCertificatePath = Join-Path $packageRoot "bookie-internal-production.cer"
$bookieTrustAdded = $false
$bookieTrustThumbprint = ""
$manifest = $null
if (-not $AllowUnsignedDevelopment) {
  if (-not (Test-Path $manifestPath)) { throw "Signed package requires release-manifest.json." }
  $manifest = Get-Content $manifestPath -Raw | ConvertFrom-Json
  if ([string]$manifest.releaseChannel -eq "internal-production") {
    if (-not (Test-Path $signerCertificatePath)) {
      throw "Internal production package requires bookie-internal-production.cer."
    }
    $signerCertificate = [Security.Cryptography.X509Certificates.X509Certificate2]::new($signerCertificatePath)
    $manifestThumbprint = ([string]$manifest.signerThumbprint -replace '\s','').ToUpperInvariant()
    if ($signerCertificate.Thumbprint -ne $manifestThumbprint -or $signerCertificate.Subject -ne $internalSignerSubject) {
      throw "Packaged public signer certificate does not match the manifest."
    }
    if ($ExpectedSignerThumbprint -and $signerCertificate.Thumbprint -ne ($ExpectedSignerThumbprint -replace '\s','').ToUpperInvariant()) {
      throw "Packaged public signer certificate does not match ExpectedSignerThumbprint."
    }
    $trustedPublisher = [Security.Cryptography.X509Certificates.X509Store]::new("TrustedPublisher","LocalMachine")
    $trustedPublisher.Open("ReadWrite")
    try {
      if (@($trustedPublisher.Certificates | Where-Object { $_.Thumbprint -eq $signerCertificate.Thumbprint }).Count -eq 0) {
        $trustedPublisher.Add($signerCertificate)
        $bookieTrustAdded = $true
        $bookieTrustThumbprint = $signerCertificate.Thumbprint
      }
    } finally { $trustedPublisher.Close() }
    Write-Warning "Verified Bookie public signer certificate and installed it in LocalMachine\TrustedPublisher."
  }
}
$isTestPackage = $false
function Assert-Signed([string]$Path) {
  $sig = Get-AuthenticodeSignature $Path
  if ($sig.Status -ne "Valid") { throw "Authenticode signature is not Valid: $Path" }
  if (-not $sig.TimeStamperCertificate) { throw "RFC3161 timestamp is missing: $Path" }
  if ($ExpectedSignerThumbprint -and
      $sig.SignerCertificate.Thumbprint -ne ($ExpectedSignerThumbprint -replace '\s','').ToUpperInvariant()) {
    throw "Signer thumbprint mismatch: $Path"
  }
  return $sig
}
function Assert-X64Pe([string]$Path) {
  $bytes = [IO.File]::ReadAllBytes($Path)
  $offset = [BitConverter]::ToInt32($bytes,0x3c)
  if ([Text.Encoding]::ASCII.GetString($bytes,$offset,4) -ne "PE`0`0" -or
      [BitConverter]::ToUInt16($bytes,$offset+4) -ne 0x8664) { throw "Not a Windows x64 executable: $Path" }
}
function Get-TreeManifest([string]$Path) {
  $items = @()
  if (Test-Path $Path) {
    foreach ($file in @(Get-ChildItem $Path -File -Recurse)) {
      $relative = $file.FullName.Substring($Path.TrimEnd('\').Length).TrimStart('\')
      $items += [ordered]@{path=$relative; sha256=(Get-FileHash $file.FullName -Algorithm SHA256).Hash.ToLowerInvariant(); length=$file.Length}
    }
  }
  return $items
}
function Assert-TreeManifest([string]$Path,[object[]]$Expected) {
  $actual = @(Get-TreeManifest $Path | Sort-Object path)
  $Expected = @($Expected | Sort-Object path)
  if (($actual | ConvertTo-Json -Depth 4) -ne ($Expected | ConvertTo-Json -Depth 4)) {
    throw "Backup file set or hash verification failed for $Path."
  }
}
function Get-FirewallSnapshot {
  return @(Get-BookieFirewallState | Sort-Object DisplayName)
}
function Assert-FirewallSnapshot([object[]]$Expected) {
  $actual = @(Get-BookieFirewallState)
  if (($actual | Sort-Object DisplayName | ConvertTo-Json -Depth 6) -ne
      ($Expected | Sort-Object DisplayName | ConvertTo-Json -Depth 6)) {
    throw "Firewall state failed exact rollback verification."
  }
}
function Get-BookieFirewallState {
  $state = @()
  foreach ($rule in @(Get-NetFirewallRule -DisplayName "Bookie Local Gateway TCP *" -ErrorAction SilentlyContinue)) {
    $address = $rule | Get-NetFirewallAddressFilter
    $port = $rule | Get-NetFirewallPortFilter
    $application = $rule | Get-NetFirewallApplicationFilter
    $service = $rule | Get-NetFirewallServiceFilter
    $interface = $rule | Get-NetFirewallInterfaceFilter
    $state += [ordered]@{DisplayName=$rule.DisplayName;Enabled=$rule.Enabled;Direction=$rule.Direction;Action=$rule.Action;
      Profile=$rule.Profile;Protocol=$port.Protocol;LocalPort=$port.LocalPort;LocalAddress=$address.LocalAddress;
      RemoteAddress=$address.RemoteAddress;Program=$application.Program;Service=$service.Service;
      InterfaceType=$interface.InterfaceType;InterfaceAlias=$interface.InterfaceAlias;EdgeTraversalPolicy=$rule.EdgeTraversalPolicy}
  }
  return $state
}
function Assert-CanonicalBookieFirewall([object[]]$Rules,[int]$ExpectedPort) {
  if ($Rules.Count -gt 1) { throw "Multiple Bookie firewall rules exist; refusing mutation." }
  foreach ($rule in $Rules) {
    if (-not [bool]$rule.Enabled -or $rule.Direction.ToString() -ne "Inbound" -or $rule.Action.ToString() -ne "Allow" -or
        $rule.Profile.ToString() -ne "Private" -or $rule.Protocol.ToString() -ne "TCP" -or
        @($rule.LocalPort).Count -ne 1 -or [string]$rule.LocalPort[0] -ne [string]$ExpectedPort -or
        @($rule.RemoteAddress).Count -ne 1 -or $rule.RemoteAddress[0] -ne "LocalSubnet" -or
        @($rule.LocalAddress).Count -ne 1 -or $rule.LocalAddress[0] -notin @("Any",$GatewayIp,$AllowedLocalIp) -or
        $rule.Program -notin @("Any",$null) -or $rule.Service -notin @("Any",$null) -or
        $rule.InterfaceType -notin @("Any",$null) -or $rule.InterfaceAlias -notin @("Any",$null) -or
        $rule.EdgeTraversalPolicy.ToString() -ne "Block") {
      throw "Existing Bookie firewall rule is not canonical Private/TCP/LocalSubnet state."
    }
  }
}
function Assert-ScRecoveryEqual([object]$Expected,[object]$Actual) {
  if (($Expected | ConvertTo-Json -Depth 6) -ne ($Actual | ConvertTo-Json -Depth 6)) {
    throw "SCM recovery state was not restored exactly."
  }
}
function Get-SignerIsTest([object]$Signature) {
  $certificate = $Signature.SignerCertificate
  return ($certificate.Subject -eq "CN=Bookie Local Gateway TEST ONLY")
}
$internalSignerSubject = "CN=Bookie Local Gateway BOOKIE INTERNAL PRODUCTION"
if (-not $AllowUnsignedDevelopment) {
  if (-not $ExpectedSignerThumbprint) { throw "Production install requires -ExpectedSignerThumbprint." }
  $installerSig = Assert-Signed $MyInvocation.MyCommand.Path
  $exeSig = Assert-Signed $exeSource
  $expectedSigner = ($ExpectedSignerThumbprint -replace '\s','').ToUpperInvariant()
  if ($exeSig.SignerCertificate.Thumbprint -ne $expectedSigner -or
      $installerSig.SignerCertificate.Thumbprint -ne $expectedSigner -or
      $installerSig.SignerCertificate.Thumbprint -ne $exeSig.SignerCertificate.Thumbprint -or
      $installerSig.SignerCertificate.Subject -ne $exeSig.SignerCertificate.Subject) { throw "EXE/script signer binding failed." }
  $signerIsTest = Get-SignerIsTest $exeSig
  if (-not $signerIsTest -and $exeSig.SignerCertificate.Subject -ne $internalSignerSubject) { throw "Production signer classification failed." }
  if (-not (Test-Path $manifestPath)) { throw "release-manifest.json is required for production install." }
  if ($manifest.productionAllowed -isnot [bool]) { throw "Manifest productionAllowed must be a JSON boolean." }
  $manifestTest = ([string]$manifest.releaseChannel -eq "test" -and [bool]$manifest.productionAllowed -eq $false)
  $manifestProduction = ([string]$manifest.releaseChannel -in @("production","internal-production") -and [bool]$manifest.productionAllowed -eq $true)
  if (-not $manifestTest -and -not $manifestProduction) { throw "Manifest release channel/productionAllowed pair is invalid." }
  if ($signerIsTest -and -not $AllowTestPackage) { throw "TEST ONLY signer requires -AllowTestPackage." }
  if ($signerIsTest -ne $manifestTest) { throw "Manifest classification does not match actual signer classification." }
  $isTestPackage = $signerIsTest
  if ($isTestPackage -and $exeSig.SignerCertificate.Subject -ne "CN=Bookie Local Gateway TEST ONLY") { throw "TEST package signer is not exact TEST ONLY." }
  if (-not $isTestPackage -and $exeSig.SignerCertificate.Subject -ne $internalSignerSubject) { throw "Production manifest requires the exact internal signer." }
  if ([string]$manifest.architecture -ne "win-x64") { throw "Manifest architecture is not win-x64." }
  if ($manifest.signerThumbprint -ne $expectedSigner -or $manifest.signerSubject -ne $exeSig.SignerCertificate.Subject) {
    throw "Manifest signer thumbprint does not match the required signer."
  }
  $entry = $manifest.files.'Bookie-Local-Gateway.exe'
  if (-not $entry -or (Get-FileHash $exeSource -Algorithm SHA256).Hash.ToLowerInvariant() -ne $entry.sha256) {
    throw "Executable hash does not match release manifest."
  }
  $versionInfo = [Diagnostics.FileVersionInfo]::GetVersionInfo($exeSource)
  if ([string]$manifest.productVersion -notmatch '^\d+\.\d+\.\d+$' -or
      [string]$manifest.fileVersion -notmatch '^\d+\.\d+\.\d+\.0$') { throw "Manifest version fields are invalid." }
  if ($versionInfo.ProductVersion.Trim() -ne [string]$manifest.productVersion) { throw "Executable ProductVersion does not exactly match release manifest." }
  if ($versionInfo.FileVersion.Trim() -ne [string]$manifest.fileVersion) { throw "Executable FileVersion does not exactly match release manifest." }
  Assert-X64Pe $exeSource
  $packageFiles = @(Get-ChildItem $packageRoot -File | Where-Object { $_.Name -ne "release-manifest.json" } | Select-Object -ExpandProperty Name)
  $manifestFiles = @($manifest.files.PSObject.Properties | Select-Object -ExpandProperty Name)
  if (@(Compare-Object ($packageFiles | Sort-Object) ($manifestFiles | Sort-Object)).Count -ne 0) {
    throw "Package file set does not match the signed release manifest."
  }
  foreach ($fileName in $manifestFiles) {
    $filePath = Join-Path $packageRoot $fileName
    $manifestEntry = $manifest.files.PSObject.Properties[$fileName].Value
    if ((Get-FileHash $filePath -Algorithm SHA256).Hash.ToLowerInvariant() -ne
        [string]$manifestEntry.sha256) { throw "Manifest hash mismatch: $fileName" }
    if ($fileName -like "*.ps1") {
      $packageSig = Assert-Signed $filePath
      if ($packageSig.SignerCertificate.Thumbprint -ne $exeSig.SignerCertificate.Thumbprint -or
          $packageSig.SignerCertificate.Subject -ne $exeSig.SignerCertificate.Subject) { throw "Packaged script signer does not match the executable signer." }
    }
  }
} else {
  Write-Warning "UNSIGNED DEVELOPMENT INSTALL: production LAN use is disabled by policy."
}
if ($Lan -and $AllowUnsignedDevelopment) { throw "Unsigned development mode cannot enable LAN." }
if ((Get-Service BookieFiscalService -ErrorAction SilentlyContinue) -and
    -not $ConfirmSafeCloudRelease -and -not $AllowUnsignedDevelopment) {
  throw "Before replacing an existing gateway, pass -ConfirmSafeCloudRelease after manager-verified CLOUD/no-pending-work release."
}
$preExistingService = Get-CimInstance Win32_Service -Filter "Name='BookieFiscalService'" -ErrorAction SilentlyContinue
$script:priorHealthPort = 17831
$resolvedPriorHost = Resolve-PriorHealthHost $preExistingService
$data = Join-Path $env:ProgramData "BookieFiscal"
$dataExisted = Test-Path $data
$installExisted = Test-Path $InstallPath
$generatedCertificateAdded = $false
$generatedCertificateThumbprint = ""
$backupRoot = Join-Path $env:ProgramData "BookieFiscal-Backups"
$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$backup = Join-Path $backupRoot $stamp
New-Item -ItemType Directory -Force -Path $InstallPath,$data,$backupRoot,$backup | Out-Null
Set-StrictAcl $backupRoot $true
Set-StrictAcl $backup $true
foreach ($existingBackupDir in @(Get-ChildItem $backupRoot -Directory)) {
  Set-StrictAcl $existingBackupDir.FullName $true
  foreach ($nestedBackupDir in @(Get-ChildItem $existingBackupDir.FullName -Directory -Recurse)) { Set-StrictAcl $nestedBackupDir.FullName $true }
  foreach ($nestedBackupFile in @(Get-ChildItem $existingBackupDir.FullName -File -Recurse)) { Set-StrictAcl $nestedBackupFile.FullName $false }
}
$existing = Get-Service -Name BookieFiscalService -ErrorAction SilentlyContinue
$createdService = -not [bool]$existing
$existingCim = Get-CimInstance Win32_Service -Filter "Name='BookieFiscalService'" -ErrorAction SilentlyContinue
if ($existingCim -and $existingCim.StartName -ne "LocalSystem") {
  throw "Refusing upgrade of BookieFiscalService with unexpected account $($existingCim.StartName)."
}
if ($existingCim) {
  $priorLan = [string]$existingCim.PathName -match "(^|\s)--lan(\s|$)"
  if ($priorLan -ne [bool]$Lan) {
    throw "Install mode differs from the existing service ImagePath; pass the matching -Lan switch explicitly."
  }
}
$wasRunning = $existing -and $existing.Status -eq "Running"
$oldExe = Join-Path $InstallPath "Bookie-Local-Gateway.exe"
$oldExeBackup = Join-Path $backup "Bookie-Local-Gateway.exe"
$oldConfig = @()
if ($existing) { $oldConfig = @(Invoke-Native "sc.exe" @("qc","BookieFiscalService") "Read existing SCM configuration") }
$oldBinLine = $oldConfig | Select-String "BINARY_PATH_NAME"
$oldBinPath = if ($oldBinLine) { ($oldBinLine.ToString() -split ":",2)[1].Trim() } else { "" }
$oldStartLine = $oldConfig | Select-String "START_TYPE"
$priorLan = $false
$priorHealthHost = $resolvedPriorHost
$priorPort = if ($script:priorHealthPort) { $script:priorHealthPort } else { 17831 }
if ($oldBinPath) {
  $priorLan = $oldBinPath -match "(^|\s)--lan(\s|$)"
}
$oldRecovery = $null
$serviceRegistryPath = "HKLM:\SYSTEM\CurrentControlSet\Services\BookieFiscalService"
$oldDelayedValue = $null
$oldDelayedPresent = $false
if ($existing) {
  $oldRecovery = [Bookie.ScmRecoveryApi]::Query("BookieFiscalService")
  $oldDelayedProperty = Get-ItemProperty -Path $serviceRegistryPath -Name DelayedAutostart -ErrorAction SilentlyContinue
  if ($oldDelayedProperty) { $oldDelayedPresent = $true; $oldDelayedValue = [int]$oldDelayedProperty.DelayedAutostart }
  Invoke-Native "reg.exe" @("export","HKLM\SYSTEM\CurrentControlSet\Services\BookieFiscalService",
    (Join-Path $backup "service-before.reg"),"/y") "Capture service recovery registry"
}
$oldDelayed = $oldDelayedPresent -and $oldDelayedValue -eq 1
$oldFirewall = @(Get-FirewallSnapshot)
$hadBookieFirewall = $oldFirewall.Count -gt 0
# This explicit state is retained for fresh-install cleanup: a rule is removed
# only when the pre-mutation snapshot was successfully written.
$firewallSnapshotCaptured = $false
$expectedFirewallPort = if ($existing) { $priorPort } else { $Port }
Assert-CanonicalBookieFirewall $oldFirewall $expectedFirewallPort
$oldFirewall | ConvertTo-Json -Depth 6 | Set-Content (Join-Path $backup "firewall.json") -Encoding UTF8
$firewallSnapshotCaptured = $true
$oldRecovery | ConvertTo-Json -Depth 6 | Set-Content (Join-Path $backup "service-recovery.json") -Encoding UTF8
try {
  if ($existing) {
    if ($existing.Status -ne "Stopped") { Stop-Service BookieFiscalService -Force; $existing.WaitForStatus("Stopped",[TimeSpan]::FromSeconds(60)) }
  }
  $beforeBackup = Get-TreeManifest $data
  if ($dataExisted) {
    Copy-Item $data (Join-Path $backup "ProgramData") -Recurse -Force
    Assert-TreeManifest (Join-Path $backup "ProgramData") $beforeBackup
    Set-StrictAcl (Join-Path $backup "ProgramData") $true
    foreach ($backupDir in @(Get-ChildItem (Join-Path $backup "ProgramData") -Directory -Recurse)) { Set-StrictAcl $backupDir.FullName $true }
    foreach ($backupFile in @(Get-ChildItem (Join-Path $backup "ProgramData") -File -Recurse)) { Set-StrictAcl $backupFile.FullName $false }
    $backupManifestPath = Join-Path $backup "ProgramData.manifest.json"
    $beforeBackup | ConvertTo-Json -Depth 4 | Set-Content $backupManifestPath -Encoding UTF8
    Set-StrictAcl $backupManifestPath $false
  }
  if (Test-Path $oldExe) { Copy-Item $oldExe $oldExeBackup -Force }
  $stageExe = Join-Path $InstallPath ([IO.Path]::GetRandomFileName() + ".exe")
  Copy-Item $exeSource $stageExe -Force
  if ((Get-FileHash $stageExe -Algorithm SHA256).Hash -ne (Get-FileHash $exeSource -Algorithm SHA256).Hash) {
    throw "Staged executable hash changed."
  }
  if (-not $AllowUnsignedDevelopment) { Assert-Signed $stageExe | Out-Null }
  Assert-X64Pe $stageExe
  if (-not $AllowUnsignedDevelopment) {
    $stageVersion = [Diagnostics.FileVersionInfo]::GetVersionInfo($stageExe)
    if ($stageVersion.ProductVersion.Trim() -ne [string]$manifest.productVersion -or
        $stageVersion.FileVersion.Trim() -ne [string]$manifest.fileVersion) { throw "Staged executable version changed." }
  }
  if (Test-Path $oldExe) { [IO.File]::Replace($stageExe,$oldExe,$null) }
  else { Move-Item $stageExe $oldExe -Force }
  if (-not $AllowUnsignedDevelopment) {
    $installedVersion = [Diagnostics.FileVersionInfo]::GetVersionInfo($oldExe)
    if ($installedVersion.ProductVersion.Trim() -ne [string]$manifest.productVersion -or
        $installedVersion.FileVersion.Trim() -ne [string]$manifest.fileVersion) {
      throw "Installed executable version does not exactly match release manifest."
    }
  }
  if (-not $AllowUnsignedDevelopment) { Assert-Signed $oldExe | Out-Null }
  Assert-X64Pe $oldExe
  if (-not $AllowUnsignedDevelopment -and
      (Get-FileHash $oldExe -Algorithm SHA256).Hash -ne (Get-FileHash $exeSource -Algorithm SHA256).Hash) {
    throw "Installed executable hash changed after atomic replacement."
  }
  Set-StrictAcl $data $true
  if ($Lan) {
    if (-not (Test-Path $TlsCertPath) -or -not (Test-Path $TlsKeyPath)) {
      $openssl = Get-Command openssl.exe -ErrorAction SilentlyContinue
      if (-not $openssl) { throw "LAN HTTPS requires PEM certificate/key." }
      $certIp = if ($GatewayIp) { $GatewayIp } else {
        Get-NetIPAddress -AddressFamily IPv4 -PrefixOrigin Manual,Dhcp |
          Where-Object { $_.IPAddress -notlike "127.*" } | Select-Object -First 1 -ExpandProperty IPAddress
      }
      $san = "DNS:localhost,IP:127.0.0.1"; if ($certIp) { $san += ",IP:$certIp" }
      Invoke-Native $openssl.Source @("req","-x509","-newkey","rsa:3072","-nodes","-days","825",
        "-keyout",$TlsKeyPath,"-out",$TlsCertPath,"-subj","/CN=Bookie Local Gateway",
        "-addext","subjectAltName=$san") "OpenSSL certificate generation"
      $generatedCertificate = [Security.Cryptography.X509Certificates.X509Certificate2]::new($TlsCertPath)
      $generatedCertificateThumbprint = $generatedCertificate.Thumbprint
      $rootStore = [Security.Cryptography.X509Certificates.X509Store]::new("Root","LocalMachine")
      $rootStore.Open("ReadWrite")
      try {
        $rootStore.Add($generatedCertificate)
        $generatedCertificateAdded = $true
      } finally { $rootStore.Close() }
    }
    $installedCertificate = [Security.Cryptography.X509Certificates.X509Certificate2]::new($TlsCertPath)
    $sanText = ($installedCertificate.Extensions | ForEach-Object { $_.Format($true) }) -join ";"
    if ($installedCertificate.NotBefore.ToUniversalTime() -gt [DateTime]::UtcNow -or
        $installedCertificate.NotAfter.ToUniversalTime() -lt [DateTime]::UtcNow) {
      throw "TLS certificate is not currently valid."
    }
    $healthHost = if ($GatewayIp) { $GatewayIp } else { "localhost" }
    if ($sanText -notmatch [regex]::Escape($healthHost)) {
      throw "TLS certificate SAN does not cover the selected health endpoint $healthHost."
    }
    Set-StrictAcl $TlsKeyPath $false
  }
  # Loopback default: --host 127.0.0.1 --port 17831 (LAN is explicit only).
  $hostArgs = if ($Lan) { "--lan --host 0.0.0.0 --ssl-cert `"$TlsCertPath`" --ssl-key `"$TlsKeyPath`"" } else { "--host 127.0.0.1" }
  $binPath = "`"$InstallPath\Bookie-Local-Gateway.exe`" --service $hostArgs --port $Port"
  # sc.exe config BookieFiscalService is always checked through Invoke-Native.
  if ($existing) { Invoke-Native "sc.exe" @("config","BookieFiscalService","binPath=",$binPath,"start=","delayed-auto","obj=","LocalSystem") "SCM service configuration" }
  else { Invoke-Native "sc.exe" @("create","BookieFiscalService","binPath=",$binPath,"start=","delayed-auto","obj=","LocalSystem") "SCM service creation" }
  New-Item -Path "HKLM:\SYSTEM\CurrentControlSet\Services\BookieFiscalService" -Force | Out-Null
  New-ItemProperty -Path "HKLM:\SYSTEM\CurrentControlSet\Services\BookieFiscalService" -Name Start -PropertyType DWord -Value 2 -Force | Out-Null
  New-ItemProperty -Path "HKLM:\SYSTEM\CurrentControlSet\Services\BookieFiscalService" -Name DelayedAutostart -PropertyType DWord -Value 1 -Force | Out-Null
  $newRecovery = [Bookie.ScmRecovery]::new()
  $newRecovery.ResetPeriod = 86400
  $newRecovery.RebootMessage = $null
  $newRecovery.Command = $null
  $newRecovery.Actions = @(
    [Bookie.ScmAction]@{Type=1;Delay=5000},
    [Bookie.ScmAction]@{Type=1;Delay=5000},
    [Bookie.ScmAction]@{Type=1;Delay=5000})
  $newRecovery.FailureFlag = $true
  [Bookie.ScmRecoveryApi]::Apply("BookieFiscalService",$newRecovery)
  Remove-NetFirewallRule -DisplayName "Bookie Local Gateway TCP $Port" -ErrorAction SilentlyContinue
  Get-NetFirewallRule -DisplayName "Bookie Local Gateway TCP *" -ErrorAction SilentlyContinue | Remove-NetFirewallRule -ErrorAction SilentlyContinue
  if ($Lan) {
    $rule = @{DisplayName="Bookie Local Gateway TCP $Port";Enabled=$true;Direction="Inbound";Action="Allow";Protocol="TCP";LocalPort=$Port;Profile="Private";RemoteAddress="LocalSubnet";LocalAddress="Any";Program="Any";Service="Any";InterfaceType="Any";InterfaceAlias="Any";EdgeTraversalPolicy="Block"}
    if ($AllowedLocalIp) { $rule.LocalAddress = $AllowedLocalIp }
    New-NetFirewallRule @rule | Out-Null
  }
  Start-Service BookieFiscalService
  $deadline = (Get-Date).AddSeconds(45)
  do { Start-Sleep 1; $service = Get-Service BookieFiscalService } while ($service.Status -ne "Running" -and (Get-Date) -lt $deadline)
  if ($service.Status -ne "Running") { throw "Gateway service did not reach Running." }
  $scheme = if ($Lan) {"https"} else {"http"}
  $healthHost = if ($Lan -and $GatewayIp) { $GatewayIp } elseif ($Lan) { "localhost" } else { "127.0.0.1" }
  $health = Get-Health "${scheme}://$healthHost`:$Port/v1/gateway/health"
  if ($health -ne 200) { throw "Gateway health check failed." }
  Get-ChildItem $backupRoot -Directory | Sort-Object Name -Descending | Select-Object -Skip 5 | Remove-Item -Recurse -Force
  Write-Host "Bookie Local Gateway installed and healthy. ProgramData identity was preserved."
  if ($isTestPackage) { Write-Host "`n`n*** TEST ONLY / NOT FOR CUSTOMER DISTRIBUTION ***`n*** Controlled Windows lab use only; replace with a production OV-signed package. ***`n`n" }
} catch {
  $originalFailure = $_.Exception
  $rollbackFailures = @()
  Invoke-RollbackPhase "stop service" {
    if (Get-Service BookieFiscalService -ErrorAction SilentlyContinue) { Stop-Service BookieFiscalService -Force -ErrorAction Stop }
  } ([ref]$rollbackFailures)
  Invoke-RollbackPhase "restore executable" {
    if (Test-Path $oldExeBackup) { Copy-Item $oldExeBackup $oldExe -Force -ErrorAction Stop }
  } ([ref]$rollbackFailures)
  Invoke-RollbackPhase "restore ProgramData and ACLs" {
    if (Test-Path (Join-Path $backup "ProgramData")) {
      Remove-Item $data -Recurse -Force -ErrorAction Stop
      Copy-Item (Join-Path $backup "ProgramData") $data -Recurse -Force -ErrorAction Stop
      $expectedFiles = @(Get-Content (Join-Path $backup "ProgramData.manifest.json") -Raw | ConvertFrom-Json)
      Assert-TreeManifest $data $expectedFiles
      Set-StrictAcl $data $true
      if (Test-Path $TlsKeyPath) { Set-StrictAcl $TlsKeyPath $false }
    } elseif (-not $dataExisted) {
      if (Test-Path $data) { Remove-Item $data -Recurse -Force -ErrorAction Stop }
    }
  } ([ref]$rollbackFailures)
  Invoke-RollbackPhase "restore SCM configuration" {
    if ($oldBinPath) { Invoke-Native "sc.exe" @("config","BookieFiscalService","binPath=",$oldBinPath.Trim()) "SCM binPath rollback" }
    if ($oldDelayed) { Invoke-Native "sc.exe" @("config","BookieFiscalService","start=","delayed-auto") "SCM delayed start rollback" }
    elseif ($oldStartLine -match "AUTO_START") { Invoke-Native "sc.exe" @("config","BookieFiscalService","start=","auto") "SCM start rollback" }
    elseif ($oldStartLine -match "DEMAND_START") { Invoke-Native "sc.exe" @("config","BookieFiscalService","start=","demand") "SCM start rollback" }
    if (Test-Path (Join-Path $backup "service-before.reg")) {
      Invoke-Native "reg.exe" @("import",(Join-Path $backup "service-before.reg")) "Restore service recovery registry"
    } elseif (-not $oldDelayedPresent) {
      Remove-ItemProperty -Path $serviceRegistryPath -Name DelayedAutostart -ErrorAction Stop
    } else {
      New-ItemProperty -Path $serviceRegistryPath -Name DelayedAutostart -PropertyType DWord -Value $oldDelayedValue -Force | Out-Null
    }
    if ($existing) { [Bookie.ScmRecoveryApi]::Apply("BookieFiscalService",$oldRecovery) }
  } ([ref]$rollbackFailures)
  Invoke-RollbackPhase "restore firewall" {
    if ($firewallSnapshotCaptured -and (Test-Path (Join-Path $backup "firewall.json"))) {
      $rulesToRemove = @(Get-NetFirewallRule -DisplayName "Bookie Local Gateway TCP *" -ErrorAction SilentlyContinue)
      if ($rulesToRemove.Count -gt 0) { $rulesToRemove | Remove-NetFirewallRule -ErrorAction Stop }
      $oldFirewall = @(Get-Content (Join-Path $backup "firewall.json") -Raw | ConvertFrom-Json)
      foreach ($rule in $oldFirewall) {
        New-NetFirewallRule -DisplayName $rule.DisplayName -Direction $rule.Direction -Action $rule.Action `
          -Enabled $rule.Enabled -Protocol $rule.Protocol -LocalPort $rule.LocalPort -Profile $rule.Profile `
          -RemoteAddress $rule.RemoteAddress -LocalAddress $rule.LocalAddress -Program $rule.Program `
          -Service $rule.Service -InterfaceType $rule.InterfaceType -InterfaceAlias $rule.InterfaceAlias `
          -EdgeTraversalPolicy $rule.EdgeTraversalPolicy | Out-Null
      }
      Assert-FirewallSnapshot $oldFirewall
    }
  } ([ref]$rollbackFailures)
  Invoke-RollbackPhase "restore service state" {
    if ($existing -and $wasRunning) {
      Start-Service BookieFiscalService
      $rollbackDeadline = (Get-Date).AddSeconds(60)
      do { Start-Sleep 1; $rollbackService = Get-Service BookieFiscalService } while ($rollbackService.Status -ne "Running" -and (Get-Date) -lt $rollbackDeadline)
      if ($rollbackService.Status -ne "Running") { throw "prior service did not return to Running" }
      $rollbackScheme = if ($priorLan) { "https" } else { "http" }
      if ((Get-Health "${rollbackScheme}://$priorHealthHost`:$priorPort/v1/gateway/health") -ne 200) { throw "prior gateway health failed" }
    } elseif ($existing) {
      if ((Get-Service BookieFiscalService).Status -ne "Stopped") { throw "prior stopped service is not stopped" }
    }
    if ($existing) {
      $restoredRegistry = Get-ItemProperty $serviceRegistryPath
      if ($oldDelayedPresent -and [int]$restoredRegistry.DelayedAutostart -ne $oldDelayedValue) { throw "delayed-auto registry state was not restored" }
      Assert-ScRecoveryEqual $oldRecovery ([Bookie.ScmRecoveryApi]::Query("BookieFiscalService"))
    }
  } ([ref]$rollbackFailures)
  Invoke-RollbackPhase "fresh-install cleanup" {
    if ($createdService) {
      Invoke-NativeAllowNotFound "sc.exe" @("delete","BookieFiscalService") "Remove failed fresh-install service"
      if (Test-Path $oldExe) { Remove-Item $oldExe -Force -ErrorAction Stop }
      if (-not $installExisted -and (Test-Path $InstallPath)) { Remove-Item $InstallPath -Recurse -Force -ErrorAction Stop }
    }
    if ($bookieTrustAdded -and $bookieTrustThumbprint) {
      $trustedPublisher = [Security.Cryptography.X509Certificates.X509Store]::new("TrustedPublisher","LocalMachine")
      $trustedPublisher.Open("ReadWrite")
      try {
        foreach ($certificate in @($trustedPublisher.Certificates | Where-Object { $_.Thumbprint -eq $bookieTrustThumbprint })) { $trustedPublisher.Remove($certificate) }
      } finally { $trustedPublisher.Close() }
    }
    if ($generatedCertificateAdded -and $generatedCertificateThumbprint) {
      $rootStore = [Security.Cryptography.X509Certificates.X509Store]::new("Root","LocalMachine")
      $rootStore.Open("ReadWrite")
      try {
        foreach ($certificate in @($rootStore.Certificates | Where-Object { $_.Thumbprint -eq $generatedCertificateThumbprint })) { $rootStore.Remove($certificate) }
      } finally { $rootStore.Close() }
    }
  } ([ref]$rollbackFailures)
  if ($rollbackFailures.Count -eq 0) {
    throw "Installation failed: $($originalFailure.Message). Rollback succeeded; backup=$backup"
  }
  throw "FATAL ROLLBACK ERROR: installation failed: $($originalFailure.Message); rollback failures: $($rollbackFailures -join ' | '); backup=$backup"
}