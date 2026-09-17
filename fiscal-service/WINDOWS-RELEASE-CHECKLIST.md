# Windows release and installation gate

This checklist is evidence-driven. Linux CI may run Python/API tests and
static checks, but it cannot sign the EXE, validate Authenticode/SmartScreen,
trust Android certificates, exercise SCM recovery, or physically print.
Those final signing and Windows/Android/printer checks cannot be validated on
Linux and must be performed on a controlled Windows host.

## Release host (controlled Windows x64)

- [ ] For a known-customer release, create the one-time internal certificate
      with `new-internal-signing-certificate.ps1`, then run
      `build-release.ps1 -Version X.Y.Z -CertificateThumbprint ... -PublicCertificatePath ...`.
- [ ] Confirm the certificate is in CurrentUser\My or LocalMachine\My and has
      a private key; no PFX, password, or private certificate is copied.
- [ ] Confirm the ZIP contains the signed EXE, signed scripts,
      `release-manifest.json`, README, and this checklist only.
- [ ] Verify manifest SHA-256, executable version, signer subject/thumbprint,
      SHA-256 Authenticode, and RFC3161 timestamp.
- [ ] Require the exact two-field version contract: ProductVersion is `X.Y.Z`
      and FileVersion is `X.Y.Z.0`; do not accept prefixes or wildcards.
- [ ] Treat `release-manifest.json` as unsigned metadata only (its self-hash
      is the documented circular exception); verify every EXE and packaged
      PowerShell script individually with Valid Authenticode, timestamp, and
      the exact expected signer thumbprint.
- [ ] Scan the ZIP with Windows Defender/SmartScreen and record any
      first-download warnings and the controlled-host observation.
- [ ] TEST ONLY certificates are never accepted as internal production
      certificates. Internal packages use the exact
      `CN=Bookie Local Gateway BOOKIE INTERNAL PRODUCTION` subject and the
      `internal-production` manifest channel. No Comodo/USB token is required
      for this controlled-customer model.

## Installation and upgrade

- [ ] Validate `install.ps1` and EXE signatures with the exact expected
      thumbprint before stopping an existing service.
- [ ] For an upgrade, obtain manager-authorized CLOUD release and verify zero
      open orders/events/reviews/leases/jobs before using
      `-ConfirmSafeCloudRelease`.
- [ ] Record the timestamped ACL-protected backup outside the source directory.
      Confirm SQLite, provisioning and DPAPI identity are present.
- [ ] Confirm delayed automatic start, three SCM restart actions, failure flag,
      LocalSystem service account, and the expected executable path.
- [ ] Confirm only Private + LocalSubnet firewall access (and no Public rule).
- [ ] Confirm local health reaches 200 before declaring success.
- [ ] If the installer generated the self-signed certificate, record its
      thumbprint and confirm only that public certificate was added to
      LocalMachine Root; failed fresh installs remove only that exact entry.
- [ ] Keep at least five backups. Never restore a backup onto an active
      different gateway identity; fence it and reprovision first.

## TLS and client trust

- [ ] Check certificate chain trust, validity dates, SAN for the configured
      hostname and fixed IP, and SHA-256 against the supplied public `.cer`.
- [ ] Install only the public `.cer` on authorized Windows/Android clients.
- [ ] On Android, record the manual trust/SAN check; never transfer a key.

## Physical verification

- [ ] Run `verify-windows-install.ps1` and retain its redacted JSON evidence.
- [ ] Run `-RunCrashRecoveryTest` only with an operator present; record old/new
      PID and SCM recovery time.
- [ ] Run `-RunPrinterTest -PrinterName ...` only with a real installed printer.
      Record the diagnostic RAW `NI FISKALNI RACUN` spool job ID and queued
      timestamp; visually confirm after enqueue interactively, or use a later
      `-ConfirmPrinterJobId` invocation. Enqueue alone is not physical proof
      and must never issue a fiscal receipt.
- [ ] Test rollback by restoring the previous EXE/data backup on a fenced host,
      then verify service health and preserved identity.

Required evidence filenames: signed release ZIP and manifest, Defender/
SmartScreen observation, certificate export/fingerprint, install/verify JSON,
SCM/firewall output, crash-recovery output, printer spool output, and rollback
record. Do not include tokens, private keys, pairing secrets, or raw database
exports in evidence.