[CmdletBinding()]
param(
  [Parameter(Mandatory=$true)][string]$PemPath,
  [string]$OutputPath = "$PWD\bookie-gateway.cer",
  [ValidateSet("CurrentUser","LocalMachine")][string]$StoreLocation = "CurrentUser",
  [switch]$InstallToTrustedRoot
)
$ErrorActionPreference = "Stop"; Set-StrictMode -Version Latest
if (-not (Test-Path $PemPath)) { throw "Public PEM certificate not found." }
$pem = Get-Content $PemPath -Raw
$body = ($pem -replace "-----BEGIN CERTIFICATE-----","" -replace "-----END CERTIFICATE-----","" -replace "\s","")
$der = [Convert]::FromBase64String($body)
[IO.File]::WriteAllBytes($OutputPath,$der)
$cert = [Security.Cryptography.X509Certificates.X509Certificate2]::new($OutputPath)
$sha = (Get-FileHash $OutputPath -Algorithm SHA256).Hash
Write-Host "Public certificate: $OutputPath"
Write-Host "Valid: $($cert.NotBefore.ToString('dd.MM.yyyy')) - $($cert.NotAfter.ToString('dd.MM.yyyy'))"
Write-Host "SHA-256: $sha"
if ($InstallToTrustedRoot) {
  $store = [Security.Cryptography.X509Certificates.X509Store]::new("Root",$StoreLocation)
  $store.Open("ReadWrite"); try { $store.Add($cert) } finally { $store.Close() }
  Write-Host "Installed public certificate only in Cert:\$StoreLocation\Root."
}
Write-Host "Android distribution: copy this .cer only; manually verify SHA-256 and hostname/IP SAN before trusting."