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
if ((Test-Path $cerPath) -or (Test-Path $descriptorPath)) { throw "Refusing to overwrite existing certificate output." }
$existing = @(Get-ChildItem Cert:\CurrentUser\My -ErrorAction SilentlyContinue | Where-Object { $_.Subject -eq $subject })
if ($existing.Count -gt 0) { throw "An internal production certificate already exists; refusing to create a second one." }
$cert = New-SelfSignedCertificate -Type Custom -Subject $subject -CertStoreLocation Cert:\CurrentUser\My `
  -Provider "Microsoft Software Key Storage Provider" -KeyAlgorithm RSA -KeyLength 3072 `
  -HashAlgorithm SHA256 -KeyExportPolicy NonExportable -NotAfter ([DateTime]::Now.AddYears(5)) `
  -KeyUsage DigitalSignature -TextExtension @("2.5.29.37={text}1.3.6.1.5.5.7.3.3")
if (-not $cert.HasPrivateKey -or $cert.Subject -ne $subject -or $cert.Issuer -ne $subject) {
  throw "Internal production certificate profile verification failed."
}
Export-Certificate -Cert $cert -FilePath $cerPath -Type CERT | Out-Null
$trustedPublisher = New-Object Security.Cryptography.X509Certificates.X509Store("TrustedPublisher","CurrentUser")
$trustedPublisher.Open("ReadWrite")
try { $trustedPublisher.Add($cert) } finally { $trustedPublisher.Close() }
if ($ExportPfx) {
  Export-PfxCertificate -Cert $cert -FilePath $PfxPath -Password $PfxPassword -CryptoAlgorithmOption AES256_SHA256 | Out-Null
  Write-Warning "PFX exported by explicit operator request. Store it offline in an approved secret vault; never commit or distribute it."
}
$descriptor = [ordered]@{thumbprint=$cert.Thumbprint;subject=$cert.Subject;issuer=$cert.Issuer;releaseChannel="internal-production";productionAllowed=$true;privateKeyExported=[bool]$ExportPfx}
$descriptor | ConvertTo-Json | Set-Content $descriptorPath -Encoding UTF8
Write-Host "BOOKIE INTERNAL PRODUCTION certificate created."
Write-Host "Thumbprint: $($cert.Thumbprint)"
Write-Host "Public certificate: $cerPath"