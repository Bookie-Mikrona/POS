[CmdletBinding()]
param(
  [Parameter(Mandatory=$true)][ValidatePattern('^\d+\.\d+\.\d+$')][string]$Version,
  [Parameter(Mandatory=$true)][string]$CertificateThumbprint,
  [string]$TimestampUrl = "http://timestamp.digicert.com",
  [string]$OutputRoot = "$PSScriptRoot\dist\release",
  [switch]$TestOnly,
  [string]$PublicCertificatePath = ""
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

if ($env:OS -ne "Windows_NT" -or -not [Environment]::Is64BitOperatingSystem) {
  throw "Production release builds must run on Windows x64; Linux and 32-bit hosts are rejected."
}
$thumb = ($CertificateThumbprint -replace '[^0-9A-Fa-f]','').ToUpperInvariant()
if ($thumb.Length -ne 40) { throw "CertificateThumbprint must be a SHA-1 thumbprint." }
$internalSubject = "CN=Bookie Local Gateway BOOKIE INTERNAL PRODUCTION"

function Find-SignTool {
  $command = Get-Command signtool.exe -ErrorAction SilentlyContinue
  if ($command) { return $command.Source }
  $kits = @("${env:ProgramFiles(x86)}\Windows Kits\10\bin",
            "${env:ProgramFiles}\Windows Kits\10\bin") | Where-Object { $_ }
  $found = Get-ChildItem $kits -Filter signtool.exe -Recurse -ErrorAction SilentlyContinue |
    Where-Object { $_.FullName -match '\\x64\\signtool\.exe$' } |
    Sort-Object FullName -Descending | Select-Object -First 1
  if (-not $found) { throw "signtool.exe was not found in PATH or the Windows 10 SDK." }
  return $found.FullName
}
function Find-CodeSigningCertificate {
  $thumbCandidates = @()
  foreach ($location in "Cert:\CurrentUser\My","Cert:\LocalMachine\My") {
    $thumbCandidates += @(Get-ChildItem $location -ErrorAction SilentlyContinue |
      Where-Object { $_.Thumbprint -eq $thumb } |
      ForEach-Object { [pscustomobject]@{Certificate=$_;Store=$location} })
  }
  if ($thumbCandidates.Count -ne 1) { throw "Requested signing certificate thumbprint is missing or duplicated across CurrentUser/My and LocalMachine/My." }
  $candidate = $thumbCandidates[0]; $cert = $candidate.Certificate
  if (-not $cert.HasPrivateKey -or $cert.NotBefore.ToUniversalTime() -gt [DateTime]::UtcNow -or $cert.NotAfter.ToUniversalTime() -lt [DateTime]::UtcNow) { throw "Code-signing certificate prerequisites failed." }
  $ekuExtension = $cert.Extensions | Where-Object { $_.Oid.Value -eq "2.5.29.37" } | Select-Object -First 1
  if (@($ekuExtension.EnhancedKeyUsages | Where-Object Value -eq "1.3.6.1.5.5.7.3.3").Count -eq 0) { throw "Certificate does not contain the Code Signing EKU." }
  if ($TestOnly) {
    $testIdentityCount = 0
    foreach ($location in "Cert:\CurrentUser\My","Cert:\LocalMachine\My") {
      $testIdentityCount += @(Get-ChildItem $location -ErrorAction SilentlyContinue | Where-Object Subject -eq "CN=Bookie Local Gateway TEST ONLY").Count
    }
    if ($testIdentityCount -ne 1 -or $candidate.Store -ne "Cert:\CurrentUser\My" -or $cert.Subject -ne "CN=Bookie Local Gateway TEST ONLY" -or $cert.Issuer -ne $cert.Subject) {
      throw "TEST ONLY certificate identity is missing, duplicated, non-CurrentUser, or not self-signed."
    }
    $rsa = $null
    try {
      $rsa = [System.Security.Cryptography.X509Certificates.RSACertificateExtensions]::GetRSAPrivateKey($cert)
      $rsaType = if ($null -eq $rsa) { "<null>" } else { $rsa.GetType().FullName }
      $keySize = if ($null -eq $rsa) { "<null>" } else { [string]$rsa.KeySize }
      $exportPolicy = if ($rsa -is [Security.Cryptography.RSACng]) { $rsa.Key.ExportPolicy.ToString() } else { "<not-RSACng>" }
      $profileFailures = @()
      if ($null -eq $rsa) { $profileFailures += "RSA private key is null" }
      if (-not ($rsa -is [Security.Cryptography.RSACng])) { $profileFailures += "RSA type=$rsaType" }
      if ($null -eq $rsa -or $rsa.KeySize -lt 3072) { $profileFailures += "KeySize=$keySize" }
      if ($exportPolicy -ne "None") { $profileFailures += "ExportPolicy=$exportPolicy" }
      if ($profileFailures.Count -gt 0) {
        throw "TEST ONLY certificate does not match the RSA3072 SHA256 CNG non-exportable profile: $($profileFailures -join '; ') (Subject=$($cert.Subject); Issuer=$($cert.Issuer); CodeSigningEKU=1.3.6.1.5.5.7.3.3)."
      }
    } finally {
      if ($rsa -is [IDisposable]) { $rsa.Dispose() }
    }
    $days = ($cert.NotAfter.ToUniversalTime() - $cert.NotBefore.ToUniversalTime()).TotalDays
    if ($days -gt 31 -or $days -lt 29) { throw "TEST ONLY certificate does not match the 30-day profile." }
  } elseif ($cert.Subject -ne $internalSubject -or $cert.Issuer -ne $cert.Subject) {
    throw "Production release requires the exact self-signed BOOKIE INTERNAL PRODUCTION certificate."
  }
  return $candidate
}
function Sign-Exe([string]$Path, [string]$Tool, [object]$SigningCertificate) {
  $args = @("sign","/fd","sha256","/tr",$TimestampUrl,"/td","sha256","/sha1",$thumb,"/s","My")
  if ($SigningCertificate.Store -eq "Cert:\LocalMachine\My") { $args += "/sm" }
  $args += $Path
  Invoke-Native $Tool $args "signtool sign"
  Invoke-Native $Tool @("verify","/pa","/all",$Path) "signtool verify" | Out-Null
}
function Sign-Script([string]$Path, [System.Security.Cryptography.X509Certificates.X509Certificate2]$Cert) {
  $result = Set-AuthenticodeSignature -FilePath $Path -Certificate $Cert -TimestampServer $TimestampUrl
  if ($result.Status -ne "Valid") { throw "PowerShell signing failed for $Path ($($result.Status))." }
}
function Assert-Signed([string]$Path) {
  $sig = Get-AuthenticodeSignature $Path
  if ($sig.Status -ne "Valid" -or $sig.SignerCertificate.Thumbprint -ne $thumb) {
    throw "Signature verification failed for $Path."
  }
  if (-not $sig.TimeStamperCertificate) { throw "Trusted timestamp missing for $Path." }
}
function Assert-X64Pe([string]$Path) {
  $bytes = [IO.File]::ReadAllBytes($Path)
  $offset = [BitConverter]::ToInt32($bytes, 0x3c)
  if ([Text.Encoding]::ASCII.GetString($bytes, $offset, 4) -ne "PE`0`0" -or
      [BitConverter]::ToUInt16($bytes, $offset + 4) -ne 0x8664) {
    throw "Executable is not a Windows x64 PE: $Path"
  }
}

$signtool = Find-SignTool
$signingCertificate = Find-CodeSigningCertificate
$cert = $signingCertificate.Certificate
if ($cert.Subject -eq "CN=Bookie Local Gateway TEST ONLY") {
  if (-not $TestOnly -or $cert.Issuer -ne $cert.Subject) { throw "TEST ONLY self-signed certificate requires -TestOnly." }
} elseif ($TestOnly) {
  throw "-TestOnly requires the exact TEST ONLY self-signed certificate."
}
if (-not $TestOnly -and ($cert.Subject -ne $internalSubject -or $cert.Issuer -ne $cert.Subject)) {
  throw "Production release builds require the exact BOOKIE INTERNAL PRODUCTION self-signed certificate."
}
if (-not $TestOnly -and -not $PublicCertificatePath) {
  throw "Internal production release requires -PublicCertificatePath; the public .cer is mandatory in the customer package."
}
$releaseChannel = if ($TestOnly) { "test" } else { "internal-production" }
$productionAllowed = -not $TestOnly
$visibleProductName = if ($TestOnly) { "Bookie Local Gateway TEST ONLY" } else { "Bookie Local Gateway" }
$py = Get-Command py.exe -ErrorAction SilentlyContinue
if (-not $py) { throw "The Windows Python launcher (py.exe) is required." }
$root = (Resolve-Path $PSScriptRoot).Path
$workspaceRoot = (Resolve-Path (Join-Path $root "..")).Path
if (-not [IO.Path]::IsPathRooted($OutputRoot)) { $OutputRoot = Join-Path (Get-Location).Path $OutputRoot }
$safeOutput = [IO.Path]::GetFullPath($OutputRoot).TrimEnd('\')
$dangerous = @($root,$workspaceRoot,$env:ProgramFiles,$env:ProgramData,$env:SystemRoot,
  [IO.Path]::GetPathRoot($safeOutput),(Get-Location).Path,
  (Split-Path $safeOutput -Parent)) | Where-Object { $_ }
foreach ($bad in $dangerous) {
  $normalizedDangerousPath = [IO.Path]::GetFullPath($bad).TrimEnd('\')
  if ([StringComparer]::OrdinalIgnoreCase.Equals($safeOutput.TrimEnd('\'), $normalizedDangerousPath)) {
    throw "OutputRoot is a dangerous or ambiguous location: $safeOutput"
  }
}
$outputRootExisted = Test-Path $safeOutput
New-Item -ItemType Directory -Force $safeOutput | Out-Null
$packageOutput = Join-Path $safeOutput ("package-" + [guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Force $packageOutput | Out-Null
$staging = Join-Path $root "dist\release-staging"
$work = Join-Path $root "dist\release-build-work"
trap {
  $buildFailure = $_
  Remove-Item $packageOutput -Recurse -Force -ErrorAction SilentlyContinue
  Remove-Item $staging -Recurse -Force -ErrorAction SilentlyContinue
  Remove-Item $work -Recurse -Force -ErrorAction SilentlyContinue
  [Console]::Error.WriteLine("Build failed: $($buildFailure.Exception.Message)")
  if ($buildFailure.InvocationInfo -and $buildFailure.InvocationInfo.PositionMessage) {
    [Console]::Error.WriteLine($buildFailure.InvocationInfo.PositionMessage)
  }
  exit 1
}
Remove-Item $staging -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item $work -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force $staging | Out-Null
Invoke-Native $py.Source @("-m","pip","install","--disable-pip-version-check","-r",(Join-Path $root "requirements-build.txt")) "Build dependency installation"
Invoke-Native $py.Source @("-m","pip","install","--requirement",(Join-Path $root "requirements.txt")) "Runtime dependency installation"
$versionFile = Join-Path $staging "version.txt"
$manifestProductVersion = $Version
$manifestFileVersion = "$Version.0"
$releaseManifestContract = [ordered]@{
  version=$Version; productVersion=$manifestProductVersion; fileVersion=$manifestFileVersion
}
@"
VSVersionInfo(
  ffi=FixedFileInfo(filevers=($($Version -split '\.' -join ', '), 0),
  prodvers=($($Version -split '\.' -join ', '), 0), mask=0x3f, flags=0x0,
  OS=0x40004, fileType=0x1, subtype=0x0, date=(0, 0)),
  kids=[StringFileInfo([StringTable('040904B0',
    [StringStruct('CompanyName', 'Bookie'),
      StringStruct('FileDescription', '$visibleProductName'),
      StringStruct('FileVersion', '$manifestFileVersion'),
      StringStruct('ProductName', '$visibleProductName'),
      StringStruct('ProductVersion', '$manifestProductVersion')])]),
    VarFileInfo([VarStruct('Translation', [1033, 1200])])])
"@ | Set-Content $versionFile -Encoding ASCII
$exe = Join-Path $staging "Bookie-Local-Gateway.exe"
Invoke-Native $py.Source @("-m","PyInstaller","--noconfirm","--clean","--onefile","--name","Bookie-Local-Gateway",
  "--distpath",$staging,"--workpath",$work,"--specpath",$work,
  "--version-file",$versionFile,"--collect-all","cryptography","--collect-all","lxml",
  "--hidden-import","sync","--hidden-import","servicemanager","--hidden-import","win32event",
  "--hidden-import","win32service","--hidden-import","win32serviceutil",
  "--add-data","contract;contract",(Join-Path $root "fiscal_service.py")) "PyInstaller build"
if (-not (Test-Path $exe)) { throw "PyInstaller failed to produce the gateway executable." }
Remove-Item (Join-Path $staging "version.txt") -Force -ErrorAction SilentlyContinue
Remove-Item (Join-Path $work "Bookie-Local-Gateway.spec") -Force -ErrorAction SilentlyContinue
Sign-Exe $exe $signtool $signingCertificate
if (-not $TestOnly -and $PublicCertificatePath) {
  if (-not (Test-Path $PublicCertificatePath)) { throw "Public signing certificate file is missing: $PublicCertificatePath" }
  $publicCert = [Security.Cryptography.X509Certificates.X509Certificate2]::new($PublicCertificatePath)
  if ($publicCert.Thumbprint -ne $thumb -or $publicCert.Subject -ne $cert.Subject) {
    throw "Public signing certificate does not match the selected internal production signer."
  }
  Copy-Item $PublicCertificatePath (Join-Path $staging "bookie-internal-production.cer")
}
foreach ($name in "install.ps1","verify-windows-install.ps1","export-client-certificate.ps1") {
  $source = Join-Path $root $name
  if (-not (Test-Path $source)) { throw "Release script missing: $name" }
  Copy-Item $source $staging
  Sign-Script (Join-Path $staging $name) $cert
}
Assert-Signed $exe
Assert-X64Pe $exe
foreach ($name in "install.ps1","verify-windows-install.ps1","export-client-certificate.ps1") {
  Assert-Signed (Join-Path $staging $name)
}
$versionInfo = [Diagnostics.FileVersionInfo]::GetVersionInfo($exe)
if ($versionInfo.ProductVersion.Trim() -ne [string]$releaseManifestContract.productVersion) { throw "Executable ProductVersion metadata does not exactly match $releaseManifestContract.productVersion." }
if ($versionInfo.FileVersion.Trim() -ne [string]$releaseManifestContract.fileVersion) { throw "Executable FileVersion metadata does not exactly match $releaseManifestContract.fileVersion." }
if ($TestOnly -and ($versionInfo.ProductName -notmatch "TEST ONLY" -or $versionInfo.FileDescription -notmatch "TEST ONLY")) {
  throw "TEST ONLY executable metadata is not visibly marked."
}
$commit = (& git -C $root rev-parse HEAD 2>$null).Trim()
$readme = Join-Path $root "WINDOWS-RELEASE-CHECKLIST.md"
if (Test-Path $readme) { Copy-Item $readme $staging }
$serviceReadme = Join-Path $root "README.md"
if (Test-Path $serviceReadme) { Copy-Item $serviceReadme $staging }
$internalRunbook = Join-Path $root "WINDOWS-INTERNAL-PRODUCTION-RUNBOOK.md"
if (Test-Path $internalRunbook) { Copy-Item $internalRunbook $staging }
$allowlist = @("Bookie-Local-Gateway.exe","install.ps1","verify-windows-install.ps1",
  "export-client-certificate.ps1","README.md","WINDOWS-RELEASE-CHECKLIST.md",
  "WINDOWS-INTERNAL-PRODUCTION-RUNBOOK.md")
if (-not $TestOnly) { $allowlist += "bookie-internal-production.cer" }
$actual = @(Get-ChildItem $staging -File | Select-Object -ExpandProperty Name)
if (@(Compare-Object ($actual | Sort-Object) ($allowlist | Sort-Object)).Count -ne 0) {
  throw "Clean package contains an unexpected or missing file."
}
$files = Get-ChildItem $staging -File | Where-Object Name -notin "version.txt"
$manifest = [ordered]@{
  version=$releaseManifestContract.version; productVersion=$releaseManifestContract.productVersion; fileVersion=$releaseManifestContract.fileVersion
  releaseChannel=$releaseChannel; productionAllowed=$productionAllowed
  architecture="win-x64"; buildUtc=[DateTime]::UtcNow.ToString("o")
  gitCommit=$commit; signerSubject=$cert.Subject; signerThumbprint=$thumb
  manifestException="release-manifest.json is excluded from files to avoid a circular self-hash; all other package files are listed."
  files=[ordered]@{}
}
foreach ($file in $files) {
  $manifest.files[$file.Name] = [ordered]@{ sha256=(Get-FileHash $file.FullName -Algorithm SHA256).Hash.ToLowerInvariant(); length=$file.Length }
}
$manifest | ConvertTo-Json -Depth 5 | Set-Content (Join-Path $staging "release-manifest.json") -Encoding UTF8
$zipSuffix = if ($TestOnly) { "-TEST-ONLY" } else { "" }
$zip = Join-Path $safeOutput "Bookie-Local-Gateway-$Version$zipSuffix-win-x64.zip"
Remove-Item $zip -Force -ErrorAction SilentlyContinue
Copy-Item (Join-Path $staging "*") $packageOutput -Recurse -Force
$packageActual = @(Get-ChildItem $packageOutput -File | Select-Object -ExpandProperty Name)
if (@(Compare-Object ($packageActual | Sort-Object) ($allowlist + "release-manifest.json" | Sort-Object)).Count -ne 0) {
  throw "Dedicated package directory contains an unexpected file."
}
Compress-Archive -Path (Join-Path $packageOutput "*") -DestinationPath $zip -CompressionLevel Optimal
Remove-Item $packageOutput -Recurse -Force -ErrorAction SilentlyContinue
Write-Host "Signed release created: $zip"