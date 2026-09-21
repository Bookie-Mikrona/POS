#requires -Version 5.1
[CmdletBinding()]
param(
  [Parameter(Mandatory=$true)][string]$OutputDirectory,
  [switch]$ExportPfx,
  [string]$PfxPath = "",
  [SecureString]$PfxPassword
)
$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest
if ($env:OS -ne "Windows_NT") { throw "This helper runs only on Windows." }
if ($ExportPfx -and (-not $PfxPath -or -not $PfxPassword)) {
  throw "PFX export is opt-in only and requires both -PfxPath and an interactive -PfxPassword SecureString."
}
$subject = "CN=Bookie Local Gateway BOOKIE INTERNAL PRODUCTION"
$output = (New-Item -ItemType Directory -Force (Resolve-Path (Split-Path -Parent $OutputDirectory))).FullName
$output = (New-Item -ItemType Directory -Force $OutputDirectory).FullName
$cerPath = Join-Path $output "Bookie-Local-Gateway-BOOKIE-INTERNAL-PRODUCTION.cer"
$descriptorPath = Join-Path $output "Bookie-Local-Gateway-BOOKIE-INTERNAL-PRODUCTION.json"
$existing = @(Get-ChildItem Cert:\CurrentUser\My -ErrorAction SilentlyContinue | Where-Object { $_.Subject -eq $subject })
if ($existing.Count -gt 1) { throw "Multiple internal production certificates exist; refusing to choose one." }
if ($existing.Count -eq 1) {
  $cert = $existing[0]
  Write-Warning "Using the existing exact internal production certificate; no new certificate will be created."
} else {
  $cert = New-SelfSignedCertificate -Type Custom -Subject $subject -CertStoreLocation Cert:\CurrentUser\My `
    -Provider "Microsoft Software Key Storage Provider" -KeyAlgorithm RSA -KeyLength 3072 `
    -HashAlgorithm SHA256 -KeyExportPolicy NonExportable -NotAfter ([DateTime]::Now.AddYears(5)) `
    -KeyUsage DigitalSignature -TextExtension @("2.5.29.37={text}1.3.6.1.5.5.7.3.3")
}
$eku = $cert.Extensions | Where-Object { $_.Oid.Value -eq "2.5.29.37" } | Select-Object -First 1
$rsa = [Security.Cryptography.X509Certificates.RSACertificateExtensions]::GetRSAPrivateKey($cert)
try {
  if (-not $cert.HasPrivateKey -or $cert.Subject -ne $subject -or $cert.Issuer -ne $subject -or
      $null -eq $rsa -or $rsa.KeySize -lt 3072 -or
      @($eku.EnhancedKeyUsages | Where-Object Value -eq "1.3.6.1.5.5.7.3.3").Count -eq 0) {
    throw "Internal production certificate profile verification failed."
  }
} finally {
  if ($rsa -is [IDisposable]) { $rsa.Dispose() }
}
if (Test-Path $cerPath) {
  $packaged = [Security.Cryptography.X509Certificates.X509Certificate2]::new((Resolve-Path $cerPath).Path)
  if ($packaged.Thumbprint -ne $cert.Thumbprint -or $packaged.Subject -ne $subject) {
    throw "Existing public certificate output does not match the exact CurrentUser\\My certificate."
  }
} else {
  Export-Certificate -Cert $cert -FilePath $cerPath -Type CERT | Out-Null
}
foreach ($storeName in "Root","TrustedPublisher") {
  $store = New-Object Security.Cryptography.X509Certificates.X509Store($storeName,"CurrentUser")
  $store.Open("ReadWrite")
  try {
    if (@($store.Certificates | Where-Object { $_.Thumbprint -eq $cert.Thumbprint }).Count -eq 0) { $store.Add($cert) }
  } finally { $store.Close() }
}
if ($ExportPfx) {
  Export-PfxCertificate -Cert $cert -FilePath $PfxPath -Password $PfxPassword -CryptoAlgorithmOption AES256_SHA256 | Out-Null
  Write-Warning "PFX exported by explicit operator request. Store it offline in an approved secret vault; never commit or distribute it."
}
$descriptor = [ordered]@{thumbprint=$cert.Thumbprint;subject=$cert.Subject;issuer=$cert.Issuer;releaseChannel="internal-production";productionAllowed=$true;privateKeyExported=[bool]$ExportPfx}
if (-not (Test-Path $descriptorPath)) { $descriptor | ConvertTo-Json | Set-Content $descriptorPath -Encoding UTF8 }
Write-Host "BOOKIE INTERNAL PRODUCTION certificate is ready (existing certificate reused when present)."
Write-Host "Thumbprint: $($cert.Thumbprint)"
Write-Host "Public certificate: $cerPath"