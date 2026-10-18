# POS authenticated lifecycle — live proof

**Result: the corrected A–B–C lifecycle completed in one browser context/profile.** The test avoided Home and used `/pos/nastavitve`; Home’s intentional direct-sale auto-start was not exercised and is not characterized as a regression. No app source code was changed.

## Test boundary

- Used supported Clerk helper sign-ins and genuine `Clerk.signOut()` transitions. The same ordinary Clerk identity was used for A and C; B used a fresh SuperAdmin identity.
- Created one isolated development company, one Extended-plan POS unit, its POS module, and one ordinary admin membership. A strict app-origin business-mutation guard was active before login; only device registration scoped to this exact unit was permitted.
- No order, item, receipt, invoice, payment, or stock mutation was intentionally made. The browser-only `order_note` outbox operation used a negative order ID and future retry time.
- No localStorage was cleared between A, B, and C. After the final phase, only exact test-owned unit/company values and the exact matching device cache were removed; the browser device key and unrelated storage were preserved.

## Phase A — ordinary admin on `/pos/nastavitve`

- `/api/pos/auth/me` returned HTTP 200 with `vloga=admin` and the exact fixture company/unit. The `pos_enota_id` preference matched the fixture. Settings loaded without visiting Home.
- The normal sync UI showed one pending change. IndexedDB held one `pending` operation with `attempts=0`, a future retry time, and the expected checksum.
- Startup `GET /pos/api/happy-hour` and `GET /pos/api/sim` requests returned 200. A fetch-based `/pos/api/events` stream and the fixture-scoped device registration/list requests were observed; the device registration was permitted only with the exact fixture `X-Enota-Id`.
- Read-only database checks found zero orders, items, or receipts for the unit. Genuine sign-out reached Clerk’s signed-out state. The gateway probe observed a scope-null reset; the two Phase A event-stream fetches were both aborted during sign-out.

## Phase B — fresh platform SuperAdmin with no unit

- Restarted only `artifacts/api-server: API Server` with a mode-0600 temporary allowlist override that preserved the captured original allowlist and added the fresh SuperAdmin ID. The helper-authenticated Clerk ID matched the candidate ID.
- `/api/pos/auth/me` returned HTTP 200 with `vloga=superadmin`, `companyId=null`, and `enotaId=null`. `/pos/superadmin` displayed no active unit header. A read-only `useGatewayOfflineContext` probe reported `scope=null`, `snapshot=null`, `primed=false`, and zero pinned orders.
- Over a measured **79.3-second** platform dwell, dispatched both `focus` and the source-verified `pos:sim-changed` event. Neither caused a Happy Hour, simulation, settings, device, gateway, event-stream, or outbox-replay request. There were zero request headers carrying the former unit scope; the future outbox operation remained unchanged.
- **Unclassified-request caveat:** browser instrumentation also logged nine successful GET/POST fetches to `/pos/undefined` during B (HTTP 200, JSON, no unit header). C logged four more such calls: two POST/one GET at HTTP 200 and one POST at HTTP 401. No corresponding `/undefined` entry appeared in the API Server logs, and no order/invoice/payment/stock route or database side effect was identified. Their front-end origin/effect was not resolved, so they are recorded as a verification limitation rather than silently treated as business traffic.

## Phase C — same ordinary admin again on `/pos/nastavitve`

- Signed out the SuperAdmin, restarted the API Server **without** the temporary env file to restore its configured allowlist, then used a fresh supported helper link for the original ordinary identity with `/pos/nastavitve` as the return route.
- The authenticated Clerk ID matched the original ordinary identity. `/api/pos/auth/me` returned HTTP 200 with `vloga=admin` and the exact original fixture company/unit; the stored unit preference still matched. The sync badge was visible and the same future-dated draft retained its checksum, pending status, and zero attempts.
- Over **225 seconds** after the Phase C marker, four `GET /pos/api/sim` and four `GET /pos/api/happy-hour` refreshes returned HTTP 200. Those two routes did not send `X-Enota-Id`; their unit scope is therefore supported by the matching authenticated `/api/pos/auth/me`, not by those request headers. Across the other 27 Phase C requests that carried `X-Enota-Id`, all 27 matched the fixture unit. The event stream opened on the fixture scope and was aborted on final sign-out.
- The gateway probe continued to report the exact ordinary company/unit, null snapshot, unprimed state, and zero pins. One device row existed for the unique unit after two allowed same-profile registration calls; it was removed with the fixture.
- Final sign-out observed one gateway scope-null transition, one SSE abort, and two 30-second interval clears; one clear’s stack identified `HappyHourContext`. No order, item, or receipt rows existed before cleanup.

## Cleanup and remaining limits

- Deleted the exact test company in one atomic statement. Its cascades removed the exact unit, POS module, Extended plan, admin membership, device, and unit-created KDS defaults (three stations, three displays, one settings row, and three display-order rows). Exact post-delete counts were zero for company, unit, module, plan, membership, device, KDS settings/stations/displays, orders, items, and receipts.
- Deleted both helper-created Clerk identities through the Clerk management API: exact IDs were prechecked, each DELETE returned HTTP 200, and each subsequent lookup returned HTTP 404.
- Deleted only the matching IndexedDB outbox operation and verified the store was empty. Removed the exact test unit/company localStorage values and the device cache only after confirming its device ID and unit matched this fixture.
- Removed the private temporary allowlist override, original-allowlist snapshot, and run manifest. The API Server was restarted without an override; no `.replit` or app-source change was made.
- Several transient 502/403 resource errors appeared during workflow restarts/initial loading; core authenticated role/scope checks and the required refresh reads succeeded. The exact origin of the `/pos/undefined` browser fetches and two Happy Hour/simulation routes’ omitted unit headers remain the notable verification gaps.

Screenshots: `1yg1ve` shows the masked platform isolation view; `ezlkie` shows the masked Phase C lifecycle view.
