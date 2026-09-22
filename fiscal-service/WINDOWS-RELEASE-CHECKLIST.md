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
- [ ] For `internal-production`, confirm the exact packaged signer thumbprint
      is present in both `LocalMachine\Root` and
      `LocalMachine\TrustedPublisher`. The installer records whether it added
      each store entry and rollback removes only entries added by this attempt.
- [ ] During signer rotation, add and verify the new thumbprint in both stores,
      deploy packages signed by the new thumbprint, then remove the old exact
      thumbprint from both stores only after no active package uses it.
- [ ] Keep at least five backups. Never restore a backup onto an active
      different gateway identity; fence it and reprovision first.

## One-click POS connection code

Perform these checks on controlled Windows 10/11 hosts. Use separate clean
snapshots for loopback and LAN mode because changing the mode of an existing
service is intentionally rejected.

- [ ] Install the signed candidate in default loopback mode on a nonstandard
      test port, for example `18431`. Run `verify-windows-install.ps1` with the
      same port and retain its redacted JSON evidence.
- [ ] Open **Start → Bookie Fiscal → Bookie Offline POS** as a standard
      desktop user. Confirm that the operator window opens without PowerShell
      or administrator rights, shows readiness/queue status, and exposes no
      secret. Select **Koda za povezavo POS-a**, confirm that only this action
      requests administrator approval, and verify that the resulting window
      contains only a six-digit code, its expiry, and user instructions. Do
      not retain the code in screenshots or logs.
- [ ] In POS, explicitly enable local cash issuance, enter the displayed code,
      and confirm that the browser connects. Remove the browser connection and
      try the same code again; the second attempt must be rejected as expired,
      invalid, or already used. Generate a new code if the test POS must remain
      connected.
- [ ] Confirm that the POS does not probe the local service or show local
      service warnings while local cash issuance is disabled.
- [ ] Repeat the installation on a clean LAN snapshot with HTTPS, a fixed
      private IP, SAN entries for that IP and `localhost`, and a nonstandard
      test port. Run `verify-windows-install.ps1` with the exported public
      certificate and confirm the shortcut uses HTTPS through `localhost`.
- [ ] Record only redacted observations: UAC shown, six-digit format, expiry
      shown, first use accepted, second use rejected, configured port, and
      loopback/LAN verification result. Never record the administrator token,
      one-time code, connection secret, TLS private key, or signing private key.

### Controlled rollback test

Run this only on a fenced Windows test host with a verified previous gateway
installation and a manager-approved CLOUD release. The existing and candidate
installations must use the same LAN mode.

- [ ] Before the candidate upgrade, record SHA-256 for the installed EXE,
      internal signed helper, and **Bookie Offline POS** Start Menu shortcut; also record the
      service command, startup/recovery state, running state, and successful
      health response.
- [ ] Supply a temporary TLS certificate that is valid but intentionally lacks
      the required `localhost` SAN. Keep its private key only on the fenced
      host. Start the signed candidate upgrade with
      `-ConfirmSafeCloudRelease`, the existing LAN parameters, and paths to
      that temporary certificate and key.
- [ ] Confirm that installation fails with the missing-`localhost` SAN error
      and explicitly reports that rollback succeeded. This failure occurs
      after the prior EXE, data, helper, shortcut, service, and firewall state
      have been captured.
- [ ] After rollback, confirm that the prior EXE and helper hashes, shortcut
      hash, service command/startup/recovery settings, firewall state, running
      state, and health response match the pre-test evidence. Remove the
      temporary invalid certificate and key.

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
record. For the one-click code gate, also include a redacted operator record
for loopback, LAN/TLS, nonstandard ports, UAC, first/second code use, and
rollback restoration. Do not include tokens, one-time codes, private keys,
connection secrets, or raw database exports in evidence.