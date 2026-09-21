#requires -Version 5.1
[CmdletBinding()]
param(
  [Parameter(Mandatory=$true)][string]$PrebuiltExePath,
  [Parameter(Mandatory=$true)][ValidatePattern('^\d+\.\d+\.\d+$')][string]$Version,
  [Parameter(Mandatory=$true)][string]$CertificateThumbprint,
  [Parameter(Mandatory=$true)][string]$PublicCertificatePath,
  [Parameter(Mandatory=$true)][ValidatePattern('^[0-9A-Fa-f]{64}$')][string]$ExpectedInputSha256,
  [Parameter(Mandatory=$true)][string]$OutputRoot
)
$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest
$internalSubject = "CN=Bookie Local Gateway BOOKIE INTERNAL PRODUCTION"
$thumb = ($CertificateThumbprint -replace '\s','').ToUpperInvariant()
if ($thumb -notmatch '^[0-9A-F]{40}$') { throw "CertificateThumbprint must be a SHA-1 thumbprint." }
$expectedHash = $ExpectedInputSha256.ToUpperInvariant()

function Find-SignTool {
  $command = Get-Command signtool.exe -ErrorAction SilentlyContinue
  if ($command) { return $command.Source }
  $kits = @("${env:ProgramFiles(x86)}\Windows Kits\10\bin","${env:ProgramFiles}\Windows Kits\10\bin") | Where-Object { $_ }
  $found = Get-ChildItem $kits -Filter signtool.exe -Recurse -ErrorAction SilentlyContinue |
    Where-Object { $_.FullName -match '\\x64\\signtool\.exe$' } |
    Sort-Object FullName -Descending | Select-Object -First 1
  if (-not $found) { throw "signtool.exe was not found in PATH or the Windows 10 SDK." }
  return $found.FullName
}
function Invoke-Native([string]$File,[string[]]$Arguments,[string]$Context) {
  if (-not (Test-Path $File) -and -not (Get-Command $File -ErrorAction SilentlyContinue)) {
    throw "$Context could not start '$File': command not found."
  }
  $old = $ErrorActionPreference; $ErrorActionPreference = "Continue"; $exitCode = $null
  try { $output = @(& $File @Arguments 2>&1); $exitCode = $LASTEXITCODE } finally { $ErrorActionPreference = $old }
  if ($exitCode -ne 0) {
    $detail = ($output -join ' ').Trim(); if (-not $detail) { $detail = "<no native output>" }
    throw "$Context failed (exit $exitCode): $detail"
  }
  return $output
}
function Assert-X64Pe([string]$Path) {
  $bytes = [IO.File]::ReadAllBytes($Path)
  if ($bytes.Length -lt 0x40) { throw "Executable is too small to be a PE image." }
  $offset = [BitConverter]::ToInt32($bytes,0x3c)
  if ($offset -lt 0 -or $offset + 6 -gt $bytes.Length -or
      [Text.Encoding]::ASCII.GetString($bytes,$offset,4) -ne "PE`0`0" -or
      [BitConverter]::ToUInt16($bytes,$offset+4) -ne 0x8664) {
    throw "Executable is not a Windows x64 PE32+ image: $Path"
  }
}
function Get-CodeSigningCertificate {
  $matches = @()
  foreach ($store in "Cert:\CurrentUser\My","Cert:\LocalMachine\My") {
    $matches += @(Get-ChildItem $store -ErrorAction SilentlyContinue |
      Where-Object { $_.Thumbprint -eq $thumb } |
      ForEach-Object { [pscustomobject]@{Certificate=$_;Store=$store} })
  }
  if ($matches.Count -ne 1) { throw "Signing certificate is missing or duplicated in CurrentUser\My and LocalMachine\My." }
  $cert = $matches[0].Certificate
  if (-not $cert.HasPrivateKey -or $cert.Subject -ne $internalSubject -or $cert.Issuer -ne $internalSubject) {
    throw "Signer must be the exact self-signed internal production certificate with a private key."
  }
  $eku = $cert.Extensions | Where-Object { $_.Oid.Value -eq "2.5.29.37" } | Select-Object -First 1
  if (@($eku.EnhancedKeyUsages | Where-Object Value -eq "1.3.6.1.5.5.7.3.3").Count -eq 0) { throw "Signer lacks the Code Signing EKU." }
  $rsa = [Security.Cryptography.X509Certificates.RSACertificateExtensions]::GetRSAPrivateKey($cert)
  try {
    if ($null -eq $rsa -or $rsa.KeySize -lt 3072) { throw "Signer RSA private key must be at least 3072 bits." }
  } finally { if ($rsa -is [IDisposable]) { $rsa.Dispose() } }
  return $matches[0]
}
function Assert-Signer([string]$Path) {
  $sig = Get-AuthenticodeSignature $Path
  if ($sig.SignerCertificate -eq $null -or $sig.SignerCertificate.Thumbprint -ne $thumb) {
    throw "Authenticode signer thumbprint mismatch: $Path"
  }
  if ($sig.Status -notin @("Valid","Unknown")) { throw "Authenticode signature failed: $Path ($($sig.Status))." }
}

if ($env:OS -ne "Windows_NT" -or -not [Environment]::Is64BitOperatingSystem) { throw "Signing must run on Windows x64." }
if (-not (Test-Path $PrebuiltExePath -PathType Leaf)) { throw "Prebuilt EXE is missing." }
if (-not (Test-Path $PublicCertificatePath -PathType Leaf)) { throw "Public certificate is missing." }
$resolvedPrebuiltExePath = (Resolve-Path $PrebuiltExePath).Path
$resolvedPublicCertificatePath = (Resolve-Path $PublicCertificatePath).Path
Assert-X64Pe $resolvedPrebuiltExePath
$actualHash = (Get-FileHash $resolvedPrebuiltExePath -Algorithm SHA256).Hash.ToUpperInvariant()
if ($actualHash -ne $expectedHash) { throw "Prebuilt EXE SHA-256 mismatch; refusing to sign." }
$signing = Get-CodeSigningCertificate
$public = [Security.Cryptography.X509Certificates.X509Certificate2]::new($resolvedPublicCertificatePath)
if ($public.Thumbprint -ne $thumb -or $public.Subject -ne $internalSubject -or $public.Issuer -ne $internalSubject) {
  throw "Public certificate does not match the internal production signer."
}
$root = (Resolve-Path $PSScriptRoot).Path
$requestedOutputRoot = if ([IO.Path]::IsPathRooted($OutputRoot)) {
  $OutputRoot
} else {
  Join-Path (Get-Location).Path $OutputRoot
}
$out = [IO.Path]::GetFullPath($requestedOutputRoot).TrimEnd('\')
$dangerous = @($root,(Resolve-Path (Join-Path $root "..")).Path,[IO.Path]::GetPathRoot($out),(Get-Location).Path)
foreach ($path in $dangerous) { if ([StringComparer]::OrdinalIgnoreCase.Equals($out,[IO.Path]::GetFullPath($path).TrimEnd('\'))) { throw "OutputRoot is a dangerous location." } }
New-Item -ItemType Directory -Force $out | Out-Null
$staging = Join-Path $out ("prebuilt-staging-" + [guid]::NewGuid().ToString("N"))
$package = Join-Path $out ("package-" + [guid]::NewGuid().ToString("N"))
$zip = Join-Path $out "Bookie-Local-Gateway-$Version-internal-production-win-x64.zip"
try {
  New-Item -ItemType Directory -Force $staging,$package | Out-Null
  Copy-Item $resolvedPrebuiltExePath (Join-Path $staging "Bookie-Local-Gateway.exe")
  Copy-Item (Join-Path $root "install.ps1"),(Join-Path $root "verify-windows-install.ps1") $staging
  Copy-Item $resolvedPublicCertificatePath (Join-Path $staging "bookie-internal-production.cer")
  $signtool = Find-SignTool
  $signArgs = @("sign","/fd","sha256","/sha1",$thumb,"/s","My")
  if ($signing.Store -eq "Cert:\LocalMachine\My") { $signArgs += "/sm" }
  Invoke-Native $signtool ($signArgs + (Join-Path $staging "Bookie-Local-Gateway.exe")) "signtool sign"
  foreach ($name in "install.ps1","verify-windows-install.ps1") {
    $result = Set-AuthenticodeSignature (Join-Path $staging $name) -Certificate $signing.Certificate
    if ($result.Status -notin @("Valid","Unknown")) { throw "PowerShell signing failed: $name ($($result.Status))." }
  }
  Assert-Signer (Join-Path $staging "Bookie-Local-Gateway.exe")
  Assert-Signer (Join-Path $staging "install.ps1")
  Assert-Signer (Join-Path $staging "verify-windows-install.ps1")
  $outputHash = (Get-FileHash (Join-Path $staging "Bookie-Local-Gateway.exe") -Algorithm SHA256).Hash.ToUpperInvariant()
  $hashText = "SHA256  Bookie-Local-Gateway.exe  $outputHash`r`n"
  Set-Content (Join-Path $staging "Bookie-Local-Gateway.exe.sha256") $hashText -Encoding ASCII
  Copy-Item (Join-Path $root "WINDOWS-INTERNAL-PRODUCTION-RUNBOOK.md"),(Join-Path $root "WINDOWS-RELEASE-CHECKLIST.md") $staging
  $manifest = [ordered]@{version=$Version;releaseChannel="internal-production";productionAllowed=$true;architecture="win-x64";
    signerSubject=$internalSubject;signerThumbprint=$thumb;timestampPolicy="No RFC3161 timestamp: internal self-signed certificate is not publicly timestamp-trusted.";
    inputSha256=$actualHash;outputSha256=$outputHash;manifestException="release-manifest.json is excluded from files to avoid a circular self-hash.";files=[ordered]@{}}
  foreach ($file in Get-ChildItem $staging -File) {
    $manifest.files[$file.Name] = [ordered]@{sha256=(Get-FileHash $file.FullName -Algorithm SHA256).Hash.ToLowerInvariant();length=$file.Length}
  }
  $manifest | ConvertTo-Json -Depth 6 | Set-Content (Join-Path $staging "release-manifest.json") -Encoding UTF8
  Copy-Item (Join-Path $staging "*") $package -Force
  if (Test-Path $zip) { Remove-Item $zip -Force }
  Compress-Archive -Path (Join-Path $package "*") -DestinationPath $zip -CompressionLevel Optimal
  Write-Host "Signed prebuilt package created: $zip"
} finally {
  Remove-Item $staging,$package -Recurse -Force -ErrorAction SilentlyContinue
}