#requires -Version 5.1
[CmdletBinding()]
param(
  [Parameter(Mandatory=$true)][string]$Thumbprint,
  [Parameter(Mandatory=$true)][switch]$ConfirmRemoval
)
$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest
if ($env:OS -ne "Windows_NT") { throw "This helper runs only on Windows." }
if (-not $ConfirmRemoval) { throw "Pass -ConfirmRemoval explicitly after the production package replaces the test package." }
$thumb = ($Thumbprint -replace '\s','').ToUpperInvariant()
if ($thumb -notmatch '^[0-9A-F]{40}$') { throw "Thumbprint must be SHA-1." }
$subject = "CN=Bookie Local Gateway TEST ONLY"
foreach ($storeName in "My","Root","TrustedPublisher") {
  $store = New-Object Security.Cryptography.X509Certificates.X509Store($storeName,"CurrentUser")
  $store.Open("ReadWrite")
  try {
    $matches = @($store.Certificates | Where-Object Thumbprint -eq $thumb)
    foreach ($cert in $matches) {
      if ($cert.Subject -ne $subject) { throw "Exact thumbprint is not the TEST ONLY certificate." }
      $store.Remove($cert)
    }
  } finally { $store.Close() }
}
Write-Warning "TEST ONLY certificate removed. Do not remove it until the production package has replaced the test package."