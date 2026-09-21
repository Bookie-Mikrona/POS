#requires -Version 5.1
[CmdletBinding()]
param(
  [Parameter(Mandatory=$true)][string]$OutputDirectory
)
$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest
if ($env:OS -ne "Windows_NT") { throw "This helper runs only on Windows." }
$subject = "CN=Bookie Local Gateway TEST ONLY"
$now = [DateTime]::UtcNow
$existing = @(Get-ChildItem Cert:\CurrentUser\My | Where-Object { $_.Subject -eq $subject })
if ($existing.Count -gt 0) { throw "A TEST ONLY certificate already exists; remove the exact thumbprint before retrying." }
foreach ($storeName in "Root","TrustedPublisher") {
  $probe = New-Object Security.Cryptography.X509Certificates.X509Store($storeName,"CurrentUser")
  $probe.Open("ReadOnly")
  try {
    if (@($probe.Certificates | Where-Object Subject -eq $subject).Count -gt 0) { throw "A TEST ONLY certificate already exists in CurrentUser\$storeName." }
  } finally { $probe.Close() }
}
New-Item -ItemType Directory -Force $OutputDirectory | Out-Null
$output = (Resolve-Path $OutputDirectory).Path
$cerPath = Join-Path $output "Bookie-Local-Gateway-TEST-ONLY.cer"
$descriptorPath = Join-Path $output "Bookie-Local-Gateway-TEST-ONLY.json"
if ((Test-Path $cerPath) -or (Test-Path $descriptorPath)) { throw "Refusing to overwrite existing test certificate output." }
$createdThumbprint = $null
try {
  $cert = New-SelfSignedCertificate -Type Custom -Subject $subject -CertStoreLocation Cert:\CurrentUser\My `
    -Provider "Microsoft Software Key Storage Provider" -KeyAlgorithm RSA -KeyLength 3072 `
    -HashAlgorithm SHA256 -KeyExportPolicy NonExportable -NotAfter $now.AddDays(30) `
    -KeyUsage DigitalSignature -TextExtension @("2.5.29.37={text}1.3.6.1.5.5.7.3.3")
  $createdThumbprint = $cert.Thumbprint
  $rsa = $null
  try {
    $rsa = [System.Security.Cryptography.X509Certificates.RSACertificateExtensions]::GetRSAPrivateKey($cert)
    $rsaType = if ($null -eq $rsa) { "<null>" } else { $rsa.GetType().FullName }
    $keySize = if ($null -eq $rsa) { "<null>" } else { [string]$rsa.KeySize }
    $exportPolicy = if ($rsa -is [Security.Cryptography.RSACng]) { $rsa.Key.ExportPolicy.ToString() } else { "<not-RSACng>" }
    $eku = @($cert.Extensions | Where-Object { $_.Oid.Value -eq "2.5.29.37" } |
      ForEach-Object { $_.EnhancedKeyUsages } | Where-Object Value -eq "1.3.6.1.5.5.7.3.3")
    $failed = @()
    if (-not $cert.HasPrivateKey) { $failed += "HasPrivateKey=false" }
    if ($cert.Subject -ne $subject) { $failed += "Subject=$($cert.Subject)" }
    if ($cert.Issuer -ne $subject) { $failed += "Issuer=$($cert.Issuer)" }
    if ($null -eq $rsa) { $failed += "RSA private key is null" }
    if (-not ($rsa -is [Security.Cryptography.RSACng])) { $failed += "RSA type=$rsaType" }
    if ($null -eq $rsa -or $rsa.KeySize -lt 3072) { $failed += "KeySize=$keySize" }
    if ($exportPolicy -ne "None") { $failed += "ExportPolicy=$exportPolicy" }
    if ($cert.SignatureAlgorithm.Value -ne "1.2.840.113549.1.1.11") { $failed += "SignatureAlgorithm=$($cert.SignatureAlgorithm.Value)" }
    if ($eku.Count -eq 0) { $failed += "CodeSigningEKU missing" }
    if ($failed.Count -gt 0) {
      throw "Created certificate prerequisites failed: $($failed -join '; ') (Subject=$($cert.Subject); Issuer=$($cert.Issuer); RSAType=$rsaType; KeySize=$keySize; ExportPolicy=$exportPolicy; CodeSigningEKU=$($eku.Count))."
    }
  } finally {
    if ($rsa -is [IDisposable]) { $rsa.Dispose() }
  }
  Export-Certificate -Cert $cert -FilePath $cerPath -Type CERT | Out-Null
  $publicCert = New-Object Security.Cryptography.X509Certificates.X509Certificate2(,$cert.RawData)
foreach ($storeName in "Root","TrustedPublisher") {
  $probe = New-Object Security.Cryptography.X509Certificates.X509Store($storeName,"CurrentUser")
  $probe.Open("ReadOnly")
  try {
    if (@($probe.Certificates | Where-Object Thumbprint -eq $cert.Thumbprint).Count -gt 0) { throw "Certificate already exists in CurrentUser\$storeName." }
  } finally { $probe.Close() }
}
foreach ($storeName in "Root","TrustedPublisher") {
  $store = New-Object Security.Cryptography.X509Certificates.X509Store($storeName,"CurrentUser")
  $store.Open("ReadWrite")
  try {
    $store.Add($publicCert)
  } finally { $store.Close() }
}
$checks = @(
  @{Path="Cert:\CurrentUser\My"; Private=$true},
  @{Path="Cert:\CurrentUser\Root"; Private=$false},
  @{Path="Cert:\CurrentUser\TrustedPublisher"; Private=$false})
foreach ($check in $checks) {
  $found = @(Get-ChildItem $check.Path | Where-Object Thumbprint -eq $cert.Thumbprint)
  if ($found.Count -ne 1) { throw "Exact certificate verification failed in $($check.Path)." }
  if ($check.Private -and -not $found[0].HasPrivateKey) { throw "CurrentUser\My certificate has no private key." }
  if (-not $check.Private -and $found[0].HasPrivateKey) { throw "Public trust store unexpectedly contains a private key." }
}
$eku = @($cert.Extensions | Where-Object { $_.Oid.Value -eq "2.5.29.37" } |
  ForEach-Object { $_.EnhancedKeyUsages } | Where-Object Value -eq "1.3.6.1.5.5.7.3.3")
if ($eku.Count -eq 0 -or $cert.NotAfter.ToUniversalTime() -le $now -or
    ($cert.NotAfter.ToUniversalTime() - $cert.NotBefore.ToUniversalTime()).TotalDays -gt 31) { throw "Certificate EKU/validity/profile verification failed." }
if (-not (Get-Command Get-AuthenticodeSignature -ErrorAction SilentlyContinue)) { throw "Authenticode verification prerequisite is unavailable." }
$descriptor = [ordered]@{
  thumbprint=$cert.Thumbprint; subject=$cert.Subject; created=$cert.NotBefore.ToUniversalTime().ToString("o")
  expires=$cert.NotAfter.ToUniversalTime().ToString("o"); createdDisplay=$cert.NotBefore.ToString("dd.MM.yyyy")
  expiresDisplay=$cert.NotAfter.ToString("dd.MM.yyyy"); releaseChannel="test"; productionAllowed=$false
}
  $descriptor | ConvertTo-Json -Depth 4 | Set-Content $descriptorPath -Encoding UTF8
  Write-Host "TEST ONLY certificate thumbprint: $($cert.Thumbprint)"
} catch {
  $original = $_.Exception
  $cleanupFailures = @()
  if ($createdThumbprint) {
    foreach ($storeName in "My","Root","TrustedPublisher") {
      $store = New-Object Security.Cryptography.X509Certificates.X509Store($storeName,"CurrentUser")
      try {
        $store.Open("ReadWrite")
        foreach ($found in @($store.Certificates | Where-Object Thumbprint -eq $createdThumbprint)) { $store.Remove($found) }
      } catch { $cleanupFailures += "CurrentUser\${storeName}: $($_.Exception.Message)" }
      finally { $store.Close() }
    }
    foreach ($path in $cerPath,$descriptorPath) {
      try { Remove-Item $path -Force -ErrorAction Stop } catch {
        if (Test-Path $path) { $cleanupFailures += "$path`: $($_.Exception.Message)" }
      }
    }
  }
  if ($cleanupFailures.Count -gt 0) { throw "$($original.Message) Cleanup failures: $($cleanupFailures -join '; ')" }
  throw $original
}