# Live POS company-plan transition proof

> This historical one-run proof now has a repeatable automated counterpart:
> `artifacts/api-server/tests/browser/pos-plan-live.spec.mjs`.
> Run instructions and cleanup guarantees:
> `artifacts/api-server/tests/browser/README.md`.
> The automated test also captures both PUT responses before either UI change,
> closing the response-listener gap noted at the end of this historical report.

**Verdict: PASS for the targeted Extended → Lite → Extended flow.** The first attempt in this same test effort did not change a plan and used an events-only unit; the SSE guard in artifacts/api-server/src/routes/pos/index.ts explicitly requires checkout. The targeted continuation recreated isolated fixtures with both checkout and events, then completed the requested UI change, measurement, UI restoration, and cleanup. No application code or production configuration was changed.

## Test run and fixture setup
- Environment: development POS at /pos/ and authenticated platform UI at /pos/superadmin; browser contexts/pages from the original run were reused and given fresh, test-only Clerk identities after the prior identities/fixtures were cleaned.
- Four identities for the completed continuation: one temporary Super-admin, two target-company POS admins, and one control-company POS admin. The target had two sessions; the control had one.
- Two newly-created isolated companies had POS enabled and Extended plans. Each had one active unit with both capabilities: checkout and events. The target unit was shared by its two admins; the control unit by its one admin.
- Source check: the /events pre-capability route mounts requireEnota followed by requireSpecificUnitCapability('checkout'). requireEnota reads the selected unit from X-Enota-Id or query enota_id and sets req.enotaId. This explains the first events-only fixture's denial; it was not evidence of a broadcast defect.
- The actual browser sessions selected target unit A and control unit B. For every page, the unit ID returned by /api/pos/auth/me exactly matched the enota_id in that page's real EventSource request. The protected manifest records exact fixture IDs; this report intentionally does not.

## SSE preflight and settled baseline
- At 2026-10-02T21:39:52.485Z, all three contexts had completed one setup document load and each had two successful auth/me responses (initial authorization plus the startup SSE-open authorization refresh).
- Target A: auth/me 200 Extended, enota A; EventSource requested enota_id A and returned HTTP 200, Content-Type text/event-stream.
- Target B: same target company/unit, same 200 Extended and 200 text/event-stream results.
- Control: auth/me 200 Extended, enota B; EventSource requested enota_id B and returned HTTP 200, Content-Type text/event-stream.
- All three connections stayed settled for a six-second observation window: before/after request counts unchanged, one SSE request per page, zero per-page SSE request failures/reconnects, one document request per page. No SSE response was non-200, so no JSON rejection body existed to parse.
- Baseline counts for the transition measurement (startup loads complete): 2 auth/me responses per page; 1 document request per page.

## Actual Super-admin UI transition and measurements
- In the genuine Super-admin company list, selected only the target row; its plan combobox showed Extended. Selected Lite in that UI. The UI displayed the target as POS Lite and showed the success toast “POS paket posodobljen”; the separate control row remained POS Extended.
- Without reloading or navigating any POS session, the two target pages each received exactly one additional auth/me response: HTTP 200, plan lite, target unit A. Target auth/me count changed 2 → 3 on each page (delta +1 each). Dogodki was absent in both target pages. Each target remained on /pos/nastavitve with exactly one document request and its original 200 SSE stream; no SSE reconnect/failure was observed.
- Control had no additional auth/me response (count stayed 2, delta 0), remained Extended with Dogodki visible, stayed on its original page, and retained one document request and its original 200 SSE stream.

## UI restoration and recovery
- Used the same target row and plan combobox in the same Super-admin UI to restore Extended. The UI showed Extended and the success toast “POS paket posodobljen.” Both target sessions each received one further auth/me response, HTTP 200 Extended on unit A; target total count became 4 (baseline 2 + Lite refresh 1 + restore refresh 1), and Dogodki returned.
- Control stayed at 2 auth/me responses, Extended, and Dogodki visible. All three POS pages remained at one document request throughout both transitions; no page reload/navigation occurred. Each page still had one original 200 text/event-stream response and zero tracked SSE reconnects/failures.
- Both target and control were confirmed Extended immediately before deleting the disposable fixture rows.

## Cleanup and evidence
- The API Server workflow was restarted without the temporary workflow env file. An equality check confirmed the exact original development SUPER_ADMIN_IDS value was restored; no managed setting was changed. Private temporary env snapshots were removed.
- Deleted only the continuation's test fixtures: 3 POS-user rows, 2 units, 2 companies, 2 plan rows, and 2 POS module rows. Exact-ID DB verification returned zero remaining rows in each table. The four fresh continuation Clerk users were deleted; each management API response was HTTP 200. The four development users created for the earlier aborted preparation had already been deleted after that attempt.
- Protected ID/cleanup manifest: /tmp/pos-plan-live-fixture-manifest.json (IDs only; no email addresses or credentials).
- This report: tests/evidence/pos-plan-live-proof.md. No app code changed.
- Super-admin UI screenshots: 1h69br shows the target Extended selector before change; unwo4b shows the Lite success toast; dend6v shows the Extended restore success toast. The POS target/control visual nav assertions were captured per page from live DOM state; the automatic screenshot set was focused on the Super-admin page, so no separate target-page screenshots are available.
- Minor verification gap: the Super-admin UI displayed success and the target row changed both times, but the browser did not have a PUT-response listener installed before the first selection, so this report does not claim a separately captured HTTP status/body for those UI PUTs. This does not affect the verified server-backed auth/me transitions and UI restoration.
