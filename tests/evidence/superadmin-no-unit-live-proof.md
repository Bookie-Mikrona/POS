# SuperAdmin no-unit background-request isolation — live proof

**Result: FAIL (focused pass stopped at the first non-compliant request).** This report is limited to the new SuperAdmin isolation task. The earlier POS package-transition proof remains valid and was not repeated. No application code was changed.

## Setup and scope
- Created two fresh development Clerk identities for this run: a platform SuperAdmin and a regular POS admin. Created one isolated POS-enabled company, one Extended-plan unit, and one POS membership for the regular identity. The unit included checkout, settings, bar, events, and the normal operational capability set.
- Temporarily added only the fresh SuperAdmin identity to the development allowlist via a mode-0600 workflow-only env file while preserving the original development admin. The API Server workflow was restarted without that file after the finding; the original development setting in .replit was not edited.
- Used the actual SuperAdmin UI route. It rendered the company list and the isolated test company row. Performance Resource Timing recorded one GET /pos/api/superadmin/podjetja with HTTP 200.

## Per-page browser evidence
- On /pos/superadmin, GET /api/pos/auth/me returned HTTP 200, vloga=superadmin, enotaId=null, and no unit header/query. The platform company list request returned HTTP 200 and the UI displayed the test row.
- At 2026-10-02T22:10:32.515Z, navigated to /pos/superadmin/eposta. Its page-specific initial GET /api/pos/auth/me again returned HTTP 200 with vloga=superadmin and enotaId=null. After auth settled, the page issued exactly one GET /pos/api/nastavitve; it returned HTTP 400 with no X-Enota-Id header and no enota_id query parameter. This is a unit-gated settings request from the E-mail platform page, not an error inferred from aggregate server logs. No response body was captured.
- The SMTP form rendered, but its settings read failed; no send-test-email or save action was clicked. A single generic browser resource console error corresponded to the 400; zero uncaught page exceptions were recorded. No invoice, payment, or stock action was performed.
- The no-unit requirement was not met on the E-mail page: a unit-scoped endpoint was requested without a selected unit and returned 400 after successful SuperAdmin authentication. The shared NastavitveProvider being inert does not prevent this page-specific EpostaView request.

## Stop condition and verification limits
- Per the stop-on-first-bug rule, did not visit the remaining platform routes (backup, profile, tests), did not observe any platform page for 35 seconds, and did not sign in the regular POS identity. Therefore no claim is made about events, KDS/settings, simulation, Happy Hour, racuni, device registration, outbox, SSE, regular settings/Happy Hour functionality, or regular-page console behavior.
- The app shell showed links only to Nastavitve, Priročnik, and Super-admin; the E-mail route was opened by its in-app route path. No mail, backup, or test action was triggered.

## Cleanup
- Deleted only this run's POS membership, unit, POS plan, POS module, and company. Exact-ID verification returned zero remaining rows in all five tables.
- Deleted both fresh Clerk identities; both management API responses were HTTP 200.
- Restarted the API Server workflow without the temporary env override, restoring the original development allowlist; removed the private temporary env file. No production setting was changed.
- Evidence manifest (mode 0600, IDs only): /tmp/superadmin-no-unit-fixture-manifest.json. This sanitized report contains no email, personal data, company identifiers, or credentials.
- Screenshot dhna06 shows the E-mail settings page after the failed read; the company-list screenshot is intentionally not attached because it contains unrelated live company details.

## Post-fix confirmation (automated, not a second browser pass)
- The page-specific E-mail request was fixed by separating the operational SMTP form from its platform wrapper. Without an operational POS unit, the real E-mail page shows an explicit scope explanation and never mounts the unit form or reads unit settings. It does not substitute an arbitrary unit or claim to configure platform SMTP.
- A regression test renders the actual E-mail page for SuperAdmin both without a unit and with a legacy unit value: no fetch and no unit-settings save action in either case.
- The complete authenticated shell regression checks sixty seconds of simulated time plus focus and simulation-change events: no operational provider initialization, fetch, or EventSource; KDS query remains disabled.
- Ordinary POS provider composition, settings access, Happy Hour startup, SSE startup/cleanup, company-filtered plan notifications, valid platform paths and redirects are covered by the focused regression suite.
- Final verification: 32 tests across five files passed; POS TypeScript check and git diff whitespace check passed.
- The original live failure above remains recorded, not rewritten as a passing browser result. The post-fix E-mail behavior was verified by cheaper component checks. The remaining live-route/interval/ordinary-POS observations listed above were not rerun.
