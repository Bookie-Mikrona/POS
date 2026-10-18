# Live POS company-plan regression

This is an executable regression, not a replay of mocked HTTP/SSE responses.
It automates the scenario recorded in
[`tests/evidence/pos-plan-live-proof.md`](../../../../tests/evidence/pos-plan-live-proof.md).

## Run

Start the existing `artifacts/pos: web` development workflow, then from the
workspace root:

```sh
POS_PLAN_LIVE=1 CHROMIUM_PATH=/repl/tools/bin/chromium \
  pnpm --filter @workspace/api-server run test:pos-plan:live
```

Outside Replit, omit `CHROMIUM_PATH` to use Playwright's installed Chromium
(`pnpm --filter @workspace/api-server exec playwright install chromium`).
`POS_PLAN_FRONTEND` can override the default local frontend
`http://127.0.0.1:24730`; remote frontends are rejected.

Requires the existing **development** database and development Clerk credentials
in the environment. The test rejects production mode/deployments and non-test
Clerk keys. It is opt-in rather than part of the fast release suite because it
creates/deletes real development Clerk users and committed disposable DB rows.
Do not point it at a production database.

## What is checked

- Four fresh development Clerk identities, four independent browser contexts:
  platform SuperAdmin, two POS users in the target company/unit, one POS user in
  a different control company/unit.
- Both isolated companies start Extended, with POS enabled and active units
  explicitly supporting **checkout + events + settings**. Checkout is required
  by the SSE route, even though the feature under test is events.
- Real authenticated streaming connections: HTTP 200, `text/event-stream`, and
  the same unit as each session's `auth/me`. A baseline is accepted only after
  initial authorization and the SSE-open authorization refresh have completed,
  all finite API requests/retries have settled, followed by six seconds with
  unchanged counters. This matters because authorization refresh also awaits
  invalidation of active queries, not just the `auth/me` response.
- The real SuperAdmin card/combobox changes Extended → Lite → Extended.
  PUT request **and response** listeners are installed before clicking the
  selector. Both request payloads, HTTP 200 responses, saved company/plan, selector
  state and success toast are asserted.
- Each transition produces exactly one extra `auth/me` request **and** response
  per target context and zero in the control, with the expected effective events
  capability and visible/absent “Dogodki in slavja” navigation link.
- After each transition six seconds of finite-API quiet detects delayed
  duplicate requests or cross-company broadcasts. Document and SSE connection
  counts must remain unchanged: no reload, navigation or reconnect can make the
  test pass accidentally.

The output records safe per-transition counters and PUT status/plan, not auth
tokens, response personal data, or environment values. Retries are disabled.

Verified in development on 2026-10-18: both PUTs returned 200; the two target
sessions had `auth/me` counts 2 → 3 → 4, the control stayed at 2. Each retained
one document and one SSE stream. Both capability/navigation transitions and
the `finally` cleanup/preserved-allowlist assertions passed.

## Isolation and cleanup

The test forks a disposable **real API app** without scheduled background
business jobs. It adds the temporary SuperAdmin only to that child process's
copy of `SUPER_ADMIN_IDS`. A local streaming gateway forwards `/api` and
`/pos/api` to that API and serves the unchanged running POS frontend. The
managed API workflow, project environment settings and existing allowlisted
identities are never modified; auth middleware is not bypassed.

`finally` closes the browser/gateway/API, checks exact preservation of the
original allowlist (including absent versus empty), deletes only the newly
created companies' POS users/units/plans/modules/companies, verifies zero
remaining fixture rows, deletes all four Clerk identities and verifies 404s.
Cleanup also runs if setup or an assertion fails; cleanup errors fail the test
alongside the original failure instead of being swallowed.

The genuine plan endpoint writes append-only audit records. Those truthful
records of the synthetic companies' plan changes are intentionally retained;
the test does not bypass or delete the immutable audit trail.

As with any in-process cleanup, an OS force-kill cannot execute `finally`.
Do not forcibly terminate a run while its fixtures are active.

The platform router access-control/request-pruning work and SSE reconnect
recovery are deliberately outside this regression's scope.
