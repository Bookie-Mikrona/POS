# Bookie Local Gateway

Windows-only Bookie Local Gateway for POS/KDS. It does **not**
contain, import, or replace scanner bridge functionality. The API is versioned
under `/v1` and binds only the canonical
`http://127.0.0.1:17831/v1` base; LAN mode is HTTPS-only.

Ordinary users operate the installed service through the signed **Bookie
Offline POS** Windows window. It shows readiness, pending work, synchronization,
and the POS connection action without exposing PowerShell or protected tokens.
PowerShell remains an internal installation, signing, and verification
mechanism for administrators only.

## Install

On a Windows administrator account:

`build.bat` is an explicitly unsigned developer build and must not be used for
LAN production. A production package can only be created on a controlled
Windows x64 signing host:

```powershell
.\build-release.ps1 -Version 1.2.3 -CertificateThumbprint <cert-thumbprint>
```

The release script obtains the private key from the Windows certificate store;
it never accepts or stores a PFX/password. It emits a signed,
hash-manifested `Bookie-Local-Gateway-<version>-win-x64.zip`. Linux cannot
perform or validate this signing step.
The manifest is unsigned metadata (its self-hash is explicitly excluded);
security relies on individually Valid Authenticode signatures, trusted
timestamps, and one exact signer thumbprint on the EXE and every packaged
PowerShell script. The installer re-hashes and re-verifies the staged and
installed EXE before service replacement.

For a locked-down Windows service installation, unpack the signed package and
run elevated `.\install.ps1 -ExpectedSignerThumbprint <thumbprint> -Port 17831`.
An upgrade additionally requires `-ConfirmSafeCloudRelease` after an
authenticated manager has released authority to CLOUD with no pending work.
Use `verify-windows-install.ps1` and retain its redacted evidence JSON.
LAN mode is an explicit opt-in: `.\install.ps1 -Lan -Port 17831` (the
installer generates a certificate with the selected static IP SAN; supplied
PEM files can be passed with `-TlsCertPath` and `-TlsKeyPath`). Use a
static/fixed IP and port, reserve the device on the router, and never use a
Public Windows network profile. The installer creates an inbound firewall rule
only for the Private profile and LocalSubnet, configures delayed auto-start and recovery, and
removes stale gateway rules on reinstall. Without `-Lan` the service remains
loopback-only.

Set `BOOKIE_FISCAL_ALLOWED_ORIGIN` to the exact HTTPS POS origin before
starting. Do not use `*`. Provision with a local, elevated `POST
/v1/admin/provision` request containing tax metadata and the PKCS#12 encoded
in base64; certificates, passwords, TLS private key copy, admin token, and the
per-install pairing secret are DPAPI protected in
`%PROGRAMDATA%\BookieFiscal\fiscal.sqlite3`.
All provisioning, certificate, and client-administration HTTP requests also
require `X-Bookie-Admin-Token` read from the ACL-protected
`%PROGRAMDATA%\BookieFiscal\admin-token.txt`; the service never renders or
returns that token.

Provisioning displays a six-digit pairing code in its local administrator
response. Enter that code in the POS within ten minutes. `POST /v1/pair`
accepts `{ "code": "123456", "clientName": "Register 1" }`; the code is
one-time and only its SHA-256 is stored. The returned pairing secret is
immediately imported as a non-extractable WebCrypto HMAC CryptoKey and the
plaintext is discarded; only that CryptoKey is kept in IndexedDB. This does
not eliminate the browser's ordinary XSS risk, so deploy the POS with normal
trusted-origin and CSP controls.

Every protected request sends `X-Bookie-Client-Id`, `X-Bookie-Timestamp`,
`X-Bookie-Nonce`, and `X-Bookie-Signature`; the per-client secret is never sent.
The signature is HMAC-SHA256 over
the exact method, `/v1` path/query, timestamp, nonce and raw-body SHA-256 as
defined by `contract/bookie-fiscal-service-v1.json`. Nonces are single-use.
Pair only from the configured POS origin and never communicate a code over
chat, email, logs, or support tickets.

## Bookie Local Gateway contract

* `GET /v1/capabilities`, `POST /v1/pair`
* `POST /v1/admin/provision` (local Windows administrator)
* `POST /v1/receipts/cash`, `GET /v1/receipts/{operationId}`
* `GET /v1/queue`, `POST /v1/sync`
* `GET /v1/gateway/health`, `/capabilities`, `/snapshot`, `/events`
* order/table optimistic commands, KDS and print enqueue/ack/retry under
  `/v1/gateway/...`
* loopback/admin-token-only `GET /v1/gateway/admin/clients` and
  `POST /v1/gateway/admin/clients/{clientId}/revoke`

LAN mode is HTTPS-only and refuses to start without PEM certificate and key
(`--ssl-cert`, `--ssl-key`). The installer generates or imports these files,
ACLs the private key to SYSTEM/Administrators, opens only the Windows Private
profile/LocalSubnet firewall scope, and prints the certificate fingerprint.
Install the exported public certificate into Trusted Root Certification
Authorities on every authorized Windows/Android POS or KDS client, and use a
hostname/IP covered by its SAN. The fingerprint is diagnostic only; browser
TLS trust and hostname validation are the security boundary.
HTTP is reserved for loopback development/legacy compatibility. The POS accepts
only `https://host:port/v1` for LAN addresses and displays the diagnostic TLS
fingerprint.
Bodies are limited to 64 KiB, event batches to 200 contiguous events, and a
failed receipt print is retried three times before `NEEDS_REVIEW`.
Printing is performed only by the single durable worker. A Windows spooler job
ID is recorded after allocation; a restart with an unprovable spool outcome is
held for review rather than duplicated automatically. Manual reprints are
manager-only queued jobs.

The normative, language-neutral contract and golden UTF-8
canonicalization/hash/RSA-signature/ZOI vectors are checked in under
`contract/`. TypeScript, Python and Kotlin tests must read these same JSON
files rather than copying expected values.

Only CASH/EUR receipts are accepted. A transaction uses SQLite `BEGIN
IMMEDIATE`, WAL and `synchronous=FULL` to reserve the PP-B sequence and seal
the canonical request before it signs or prints. Repeating an operation ID
returns the original envelope; changing its payload returns 409. Stored
envelopes include the canonical payload, required local FURS XML, XML/payload
hashes, ZOI, local RSA-SHA256 XML envelope signature, immutable chain hash,
and every print attempt. Print state is separate from issuance/FURS state.

The ZOI is SHA-256 RSA signature of FURS canonical fields (tax ID, local
issue time, sequence, premise, device, two-decimal amount), then MD5 of that
signature. Validate final FURS schema/version settings with the tax adviser
before production deployment. The existing hand-built XML is explicitly
labelled `provisional`; `/v1/capabilities` therefore reports `ready=false` and
`POST /v1/receipts/cash` is blocked. This must not be bypassed in production.

## Sync worker integration

`jobs` are deliberately persisted as PENDING exact envelopes with a
two-business-day Europe/Ljubljana deadline. Weekend handling and provisioned
holidays are isolated behind the `SI-BUSINESS-DAY-V1` calendar policy seam. A
deployment-specific authenticated server worker
must POST the **exported XML unchanged**, mark `SENT` only on a confirmed
receipt, mark `FAILED` on a definitive rejection, and retain `UNKNOWN` on
timeouts for exact replay. Never regenerate XML, ZOI, or invoice number.
The packaged service starts the importable `sync.py` engine automatically.
It reads the signed provisioning bundle and DPAPI-protected device key directly
from the service store; there are no config/key-file CLI arguments or exported
plaintext keys. Ambiguous delivery becomes status-only reconciliation, and only
an authenticated status 404 permits later replay of the identical envelope.

The gateway is one fiscal device and one SQLite single-writer. The POS now
integrates the shared offline order/table/KDS surface from task #672, including
cross-device edits through authenticated gateway APIs. Card/QR, cloud
configuration, automatic failover, and arbitrary cloud-screen operation while
offline remain unsupported. Orders and KDS still require the gateway to be
reachable and a single configured authority; they are not a substitute for
cloud mode.
Do not put SQLite on a network share. Backups must be stopped,
restored to a fenced device, and assigned a new gateway identity before
reconnection; otherwise event/receipt replay can fork the fiscal chain.

Use a UPS and disable sleep/hibernation on the static-IP Windows host. After
internet recovery, leave the durable sync worker running until the queue and
gateway event checkpoint are confirmed. Timeouts are unknown outcomes: retry
the same operation ID, never issue a fresh receipt. Conflicting cloud events
remain `NEEDS_REVIEW`; there is no silent merge.

Certificate import, provisioning and client administration are loopback-only,
even in LAN mode. Pair each POS/KDS device separately; secrets are per-client
and revocation is immediate. Troubleshooting: check `GET /v1/gateway/health`
locally, verify the Private profile and fixed port firewall rule, inspect the
diagnostic time (`dd.mm.yyyy HH:mm`), then check the durable queue before
restarting. No secrets or certificates are committed in this directory.

## Release, TLS-client trust, and rollback

`export-client-certificate.ps1 -PemPath gateway-cert.pem -OutputPath
gateway-cert.cer` exports only the public certificate, prints validity in
`dd.mm.yyyy` and its SHA-256 fingerprint, and can optionally install it in a
Windows Trusted Root store with an explicit switch. For Android, transfer only
the `.cer`, then manually verify the fingerprint and hostname/IP SAN before
trusting it. Never copy the TLS private key.

The installer preserves `%PROGRAMDATA%\BookieFiscal` (including SQLite,
provisioning and DPAPI identity), makes an ACL-protected timestamped backup
before replacement, retains the newest five backups, and rolls back the EXE,
data, service command and startup if health does not recover. Restoring a
backup to a new/fenced device requires a new gateway identity before
reconnection. See `WINDOWS-RELEASE-CHECKLIST.md`; final Authenticode signing,
Windows Defender/SmartScreen, Android trust, physical crash recovery and
printer spool tests must be performed on controlled Windows hardware and
cannot be validated on Linux.
For controlled Windows lab work while the OV USB token is pending, the
source-only `new-test-signing-certificate.ps1` and
`WINDOWS-TEST-RUNBOOK.md` create/use a 30-day TEST ONLY certificate. Test
packages require explicit `-AllowTestPackage`, are never customer or public
SmartScreen/Authenticode evidence, and do not unblock the OV-token release.
When it generates a self-signed LAN certificate, it adds only that public
certificate to the LocalMachine Root store and removes that exact thumbprint
on a failed fresh install; supplied certificates are never silently trusted.
Use `verify-windows-install.ps1 -RunPrinterTest -PrinterName ...` to enqueue
the clearly labelled `NI FISKALNI RACUN` RAW diagnostic, then confirm the
displayed job ID interactively (or use `-ConfirmPrinterJobId` in a later
confirmation invocation). A queued job is only observed/enqueued evidence,
not proof of physical output.