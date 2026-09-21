# Windows TEST ONLY lab runbook

This is a controlled Windows-machine workflow while the OV USB token is
pending. The resulting package is **TEST ONLY / NOT FOR CUSTOMER DISTRIBUTION**,
is not SmartScreen/public Authenticode evidence, and does not unblock the final
OV-token release.

Use these exact lab values:

- Version: `1.0.0`
- Gateway IP: `192.168.1.250`
- ERP origin: `https://bookie-erp.replit.app`
- Printer: `POS-58`

From an elevated PowerShell 5.1 prompt in the source directory:

```powershell
Set-ExecutionPolicy -Scope Process Bypass

[Environment]::SetEnvironmentVariable(
  "BOOKIE_FISCAL_ALLOWED_ORIGIN",
  "https://bookie-erp.replit.app",
  "Machine"
)
[Environment]::SetEnvironmentVariable(
  "BOOKIE_FISCAL_PRINTER",
  "POS-58",
  "Machine"
)

Get-NetIPAddress -AddressFamily IPv4 -IPAddress 192.168.1.250
Get-NetConnectionProfile
Get-Printer -Name "POS-58"

.\new-test-signing-certificate.ps1 -OutputDirectory .\lab-test-certificate
$test = Get-Content .\lab-test-certificate\Bookie-Local-Gateway-TEST-ONLY.json | ConvertFrom-Json
.\build-release.ps1 -Version 1.0.0 -CertificateThumbprint $test.thumbprint -TestOnly
Expand-Archive .\dist\release\Bookie-Local-Gateway-1.0.0-TEST-ONLY-win-x64.zip .\lab-package -Force
Set-ExecutionPolicy -Scope Process AllSigned
.\lab-package\install.ps1 -ExpectedSignerThumbprint $test.thumbprint -AllowTestPackage -Lan -GatewayIp 192.168.1.250 -Port 17831
.\lab-package\export-client-certificate.ps1 -PemPath "$env:ProgramData\BookieFiscal\gateway-cert.pem" -OutputPath .\lab-client-certificate.cer
.\lab-package\verify-windows-install.ps1 `
  -ExpectedSignerThumbprint $test.thumbprint `
  -AllowTestPackage `
  -GatewayHost 192.168.1.250 `
  -Port 17831 `
  -PublicCertificatePath .\lab-client-certificate.cer `
  -TlsCertificatePath "$env:ProgramData\BookieFiscal\gateway-cert.pem" `
  -RunCrashRecoveryTest `
  -RunPrinterTest `
  -PrinterName "POS-58" `
  -EvidencePath .\windows-install-evidence-TEST-ONLY.json
```

For an upgrade of an existing gateway, first obtain manager-authorized CLOUD
release and verify that there is no pending work. Use the same install command
with `-ConfirmSafeCloudRelease`.

Use the real manager-approved release procedure for any production/cloud
operation; this runbook does not contain credentials or secrets. Do not remove
the test certificate until the production package has replaced the test
package and its checks are complete:

```powershell
.\remove-test-signing-certificate.ps1 -Thumbprint $test.thumbprint -ConfirmRemoval
```