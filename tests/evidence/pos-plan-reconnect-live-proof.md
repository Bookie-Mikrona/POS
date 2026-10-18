# Live POS plan-change/reconnect proof

**Verdict: PASS.** In development, two target POS sessions changed from Extended to Lite and back to Extended using the Super-admin UI while their real fetch-based SSE streams were deliberately disconnected. Both sessions refreshed authorization on the next successful stream `open`, without a document reload. A separate Extended control session remained uninterrupted. No production setting, application runtime source, or dependency was changed. The API workflow was restarted for temporary development SuperAdmin authorization and again after restoring the original setting.

## Setup and method

- Three authenticated POS browser sessions were used: two admins on the same disposable target company/unit and one admin on a separate disposable control company/unit. All units had POS enabled and both `checkout` and `events` capabilities.
- The existing Super-admin UI was used for both plan changes. The captured target-company PUT responses were HTTP 200 with matching company:
  - Extended → Lite: `2026-10-18T01:44:54.163Z`, response plan `lite`.
  - Lite → Extended: `2026-10-18T01:46:38.026Z`, response plan `extended`.
- Only the two target pages had their actual `GET /api/events` requests with `Accept: text/event-stream` aborted. Before each plan change, the current target readers were canceled; retrying requests were held until after the UI PUT. No POS page was reloaded or navigated.
- Before cleanup, read-only DB verification confirmed both companies had the POS module, an active unit with checkout and events, and Extended plan. The target had two admin rows and the control had one; all IDs matched the private test fixture manifest.

## Observed transitions

| Phase | Target A | Target B | Control |
| --- | --- | --- | --- |
| Settled baseline | 1 document; 2 auth/me 200s, Extended; 1 SSE 200/open; Dogodki visible | Same | 1 document; 2 auth/me 200s, Extended; 1 SSE 200/open; Dogodki visible |
| First disconnected gap, after Lite PUT | Stale Extended; auth count stayed 2; no plan event; Dogodki stayed visible; retry held | Same | No auth/SSE/event change |
| First recovery | SSE open at `01:45:23.209Z`; auth/me 200 Lite at `01:45:23.287Z`; Dogodki removed | SSE open at `01:45:23.208Z`; auth/me 200 Lite at `01:45:23.287Z`; Dogodki removed | Remained Extended and unchanged |
| Second disconnected gap, after Extended PUT | Stale Lite; auth count stayed 3; no plan event; Dogodki stayed absent; retry held | Same | No auth/SSE/event change |
| Second recovery | SSE open at `01:46:59.249Z`; auth/me 200 Extended at `01:46:59.290Z`; Dogodki returned | SSE open at `01:46:59.461Z`; auth/me 200 Extended at `01:46:59.504Z`; Dogodki returned | Remained Extended and unchanged |

After both recoveries, each target still had exactly one document navigation, four successful auth/me responses (Extended → Lite → Extended), three accepted HTTP 200 `text/event-stream` opens (initial plus two recoveries), and zero received `auth:pos-plan-changed` events. The control remained at one document, two auth/me 200 responses, one SSE open, zero SSE fetch errors/reconnects, and zero plan events. The successful stream `open` preceded each reconnect authorization response; the restored plan and capability state matched the company and selected unit.

Each target trace counted 24 SSE requests, three accepted SSE opens, 21 fetch failures during the two deliberately interrupted periods/retries, and two completed readers. The route handler itself recorded 11 deliberate aborts per target in the first gap and 8 in the second (19 total per target). The remaining two counted fetch errors per target were not attributable to the abort-handler counter. Browser console also showed resource 403s; they did not prevent the observed auth/me responses, plan transition, or navigation state.

## Cleanup

Cleanup ran in a `finally` path and was verified:

- Deleted exactly 3 task-owned POS-user rows, 2 units, 2 company plan rows, 2 POS-module rows, 2 task-owned plan audit rows, and 2 disposable companies.
- Deleted the four temporary Clerk identities (one Super-admin, two target admins, one control admin). A subsequent auth/me request returned 401 for each signed-out page.
- Exact-ID verification returned zero rows for companies, POS modules, POS plans, units, POS users, and the task-owned audit entries. Private fixture/ID manifests were removed.

After fixture cleanup, the parent restored the original development `SUPER_ADMIN_IDS` using the supported environment-management callback. A separate equality check confirmed the restored value matched exactly, and the managed API workflow restarted successfully. No environment configuration diff remains; production settings were not changed.

## Evidence and verification gaps

- Super-admin Lite success toast: screenshot `lco63t`.
- Super-admin Extended restoration toast: screenshot `rawjpk`.
- Recovered target navigation: Target A `2e8gng`; Target B `004g6c`.
- Uninterrupted control navigation: `hjgqgl`.
- The script `tests/pos-plan-reconnect.browser.mjs` is a parameterized reproduction harness. It was not run as a repository test because this project does not declare Playwright as a dependency and the private fixture adapter/storage states are intentionally not committed. The live browser run above is the executed evidence.
- Hook/transport regression check: `pnpm --filter @workspace/pos exec vitest run --config vitest.config.ts src/hooks/useRealtimeSync.test.ts src/lib/posEventStream.test.ts` passed all 15 tests, including a new fake-timer check that separates startup authorization, retry creation, successful reconnect open, and cleanup of a pending retry.
