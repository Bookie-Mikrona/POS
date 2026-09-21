#requires -RunAsAdministrator
[CmdletBinding()]
param(
  [ValidateRange(1, 65535)]
  [int]$Port = 17831,
  [switch]$UseTls
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

function Show-Result([string]$Message, [string]$Title, [bool]$IsError = $false) {
  Add-Type -AssemblyName PresentationFramework
  $icon = if ($IsError) {
    [System.Windows.MessageBoxImage]::Error
  } else {
    [System.Windows.MessageBoxImage]::Information
  }
  [void][System.Windows.MessageBox]::Show(
    $Message,
    $Title,
    [System.Windows.MessageBoxButton]::OK,
    $icon
  )
}

$token = $null
try {
  $service = Get-Service -Name "BookieFiscalService" -ErrorAction Stop
  if ($service.Status -ne "Running") {
    Start-Service -Name "BookieFiscalService"
    $service.WaitForStatus("Running", [TimeSpan]::FromSeconds(30))
  }

  $tokenPath = Join-Path $env:ProgramData "BookieFiscal\admin-token.txt"
  if (-not (Test-Path $tokenPath)) {
    throw "Skrbniška datoteka lokalne storitve manjka. Ponovno zaženite storitev ali namestitev."
  }

  $token = ([System.IO.File]::ReadAllText($tokenPath)).Trim()
  if (-not $token) {
    throw "Skrbniška datoteka lokalne storitve je prazna."
  }

  $headers = @{
    "X-Bookie-Admin-Token" = $token
    "Accept" = "application/json"
  }
  $scheme = if ($UseTls) { "https" } else { "http" }
  $hostName = if ($UseTls) { "localhost" } else { "127.0.0.1" }
  $result = Invoke-RestMethod `
    -Method Post `
    -Uri "${scheme}://${hostName}:$Port/v1/admin/connection-code" `
    -Headers $headers `
    -TimeoutSec 15

  if ([string]$result.code -notmatch '^\d{6}$') {
    throw "Lokalna storitev ni vrnila veljavne šestmestne kode."
  }
  $expires = [DateTimeOffset]::Parse([string]$result.expiresAt).ToLocalTime()
  $expiresText = $expires.ToString("dd.MM.yyyy HH:mm")

  Show-Result `
    "Koda za povezavo POS-a:`n`n$($result.code)`n`nVelja do $expiresText in jo je mogoče uporabiti samo enkrat.`nVnesite jo v Bookie POS → Nastavitve → Lokalna fiskalna storitev." `
    "Bookie Fiscal Service"
} catch {
  Show-Result `
    "Kode ni bilo mogoče ustvariti.`n`nPreverite, ali je Bookie Fiscal Service nameščena in zagnana. Če težava ostane, se obrnite na skrbnika." `
    "Bookie Fiscal Service" `
    $true
  exit 1
} finally {
  $token = $null
  Remove-Variable token -ErrorAction SilentlyContinue
}