# Selective Restoration Evidence Ledger

## Baseline counters

- Recovery start (UTC): `2026-09-23T11:09:01Z`
- Recovery start (Europe/Ljubljana): `2026-09-23T13:09:01+02:00`
- Elapsed recovery time: `00:59:12`
- Verified recovery cost: `$0.00`
- Unverified accrued cost: `Pending Replit Account usage export`
- Cost estimation policy: `No estimated or fabricated dollar values`

## Recovery checkpoint

- Protected Git commit: `41997d64480a4f723c208bc4f9f03f8616a411ba`
- Annotated checkpoint tag: `recovery-start-20260923-110901Z`
- Working branch: `recovery/selective-20260923`
- Preserved source branch: `recovery/before-c65-rollback-20260922`
- Verified preserved source tree: `c65df01b620eb5283e60996ee2fb3a05514c2a80`

The checkpoint tag protects the exact committed source state before restoration.
Replit Agent checkpoints are also created automatically at implementation
milestones. No reset, force push, broad merge, or database migration replay is
permitted during this restoration.

## Billing evidence method

Replit documents exact Agent and cloud-service charges in **Settings → Account
→ Account usage**, where usage can be filtered by date, project, workspace, and
resource. This workspace does not expose a personal-account usage API to the
Agent. Consequently:

1. elapsed wall-clock time is recorded from the fixed start timestamp;
2. the verified dollar counter starts at `$0.00`;
3. dollar amounts remain unverified until copied from a Replit usage export or
   support-provided usage record;
4. no token, effort, or time-based cost estimate is presented as an actual
   Replit charge;
5. final evidence will reconcile this action ledger with the official usage
   records.

## Action log

| Seq. | UTC timestamp | Elapsed | Verified cost | Action | Result |
|---:|---|---:|---:|---|---|
| 000 | 2026-09-23T11:09:01Z | 00:00:00 | $0.00 | Started the selective restoration evidence clock. | Baseline counters initialized. |
| 001 | 2026-09-23T11:09:01Z | 00:00:00 | $0.00 | Captured the pre-restoration Git state. | HEAD was clean at `41997d64480a4f723c208bc4f9f03f8616a411ba`. |
| 002 | 2026-09-23T11:09:01Z | 00:00:00 | $0.00 | Created annotated checkpoint tag `recovery-start-20260923-110901Z`. | Exact pre-restoration commit protected. |
| 003 | 2026-09-23T11:09:01Z | 00:00:00 | $0.00 | Created working branch `recovery/selective-20260923`. | Restoration isolated from `main`. |
| 004 | 2026-09-23T11:09:01Z | 00:00:00 | $0.00 | Confirmed official Replit checkpoint and usage-accounting behavior. | Automatic milestone checkpoints confirmed; exact personal usage must be reconciled from Account usage. |
| 005 | 2026-09-23T11:12:00Z | 00:02:59 | $0.00 | Restored the production POS Manual source, route, and navigation from the preserved tree. | Manual search, role filters, progress persistence, and PDF access restored. |
| 006 | 2026-09-23T11:12:00Z | 00:02:59 | $0.00 | Restored Daily Menu reachability using the current surviving page. | Route, title mapping, and role-aware navigation restored without replacing newer page code. |
| 007 | 2026-09-23T11:12:00Z | 00:02:59 | $0.00 | Ran the focused POS TypeScript check and patch-integrity check. | Both completed successfully. |
| 008 | 2026-09-23T11:16:41Z | 00:07:40 | $0.00 | Restored Malice schema source, rules, API, order integration, frontend flows, KDS inference, and tests. | Historical migrations were deliberately not restored or executed. |
| 009 | 2026-09-23T11:16:41Z | 00:07:40 | $0.00 | Restored Malice OpenAPI contracts and regenerated typed clients and validators. | Code generation and library type checking completed successfully. |
| 010 | 2026-09-23T11:16:41Z | 00:07:40 | $0.00 | Ran focused Malice validation. | API tests 25/25, POS tests 24/24, API and POS type checks, and patch-integrity check passed. |
| 011 | 2026-09-23T11:26:32Z | 00:17:31 | $0.00 | Restored Kosila schema source, offer lifecycle, authoritative quote, statistics, UI, and tests. | Historical migrations 213 and 214 were not restored or executed. |
| 012 | 2026-09-23T11:26:32Z | 00:17:31 | $0.00 | Restored the daily-lunch order mutation and integrated it into the current order flow. | Added order locking, scope checks, idempotency, server pricing, snapshots, package lines, totals, and KDS materialization. |
| 013 | 2026-09-23T11:26:32Z | 00:17:31 | $0.00 | Regenerated API clients and ran focused Kosila validation. | API/POS/library type checks, codegen, focused API and POS tests, and patch-integrity check passed. |
| 014 | 2026-09-23T11:42:25Z | 00:33:24 | $0.00 | Restored the Public Restaurant Page, shared public venue UI, public-facing artifact, profile image lifecycle, and public visit handling. | Tenant-scoped object paths and stricter current storage validation were preserved. |
| 015 | 2026-09-23T11:42:25Z | 00:33:24 | $0.00 | Restored required public API contracts and regenerated typed clients. | Initial historical-contract churn was rejected; the final diff preserves every pre-phase API path/export and adds only 17 required public paths. |
| 016 | 2026-09-23T11:42:25Z | 00:33:24 | $0.00 | Ran Public Page validation. | API tests 27/27, POS tests 6/6, API/POS/public-artifact/library type checks, codegen, and patch-integrity check passed. |
| 017 | 2026-09-23T11:45:54Z | 00:36:53 | $0.00 | Restored paid-voucher delivery alerts, retry scheduling, Stripe raw-webhook verification, sync-failure monitoring, and connection alerts. | Existing commerce behavior was preserved; only safeguards and diagnostics were restored. |
| 018 | 2026-09-23T11:45:54Z | 00:36:53 | $0.00 | Restored historical safeguard migrations 216–219 as inert source records. | Files were not executed and no database was accessed. |
| 019 | 2026-09-23T11:45:54Z | 00:36:53 | $0.00 | Ran focused voucher/Stripe safeguard validation. | API/POS/library type checks, 8 focused tests, and patch-integrity check passed; no API generation drift occurred. |
| 020 | 2026-09-23T11:50:06Z | 00:41:05 | $0.00 | Reconciled historical migration sources without executing them. | Archived 23 exact SQL snapshots as non-executable evidence; active lineage remains 198 returnable-packaging and 199 company plans. |
| 021 | 2026-09-23T11:50:06Z | 00:41:05 | $0.00 | Restored POS release manifest validation and object-storage regression coverage. | Release manifest validates 4 groups and 17 suites; validator tests 4/4 passed. |
| 022 | 2026-09-23T11:50:06Z | 00:41:05 | $0.00 | Added migration collision/archive integrity validation. | Verified 206 active SQL files, 23 inert snapshots, exact preserved hashes, and no restored executable SQL in the active 200–219 range. |
| 023 | 2026-09-23T12:08:13Z | 00:59:12 | $0.00 | Added and reviewed collision-free forward migration 220 for all restored schema effects. | Transactional development execution was rolled back; archive hashes, partial-upgrade backfills, constraints, indexes, triggers, and test manifest registration were verified. |
| 024 | 2026-09-23T12:08:13Z | 00:59:12 | $0.00 | Completed integrated validation and independent architecture review. | API release group passed 22 suites/146 tests; targeted API/POS/public-app/library checks passed; final review reported no critical or high restoration blockers. |
| 025 | 2026-09-23T12:08:13Z | 00:59:12 | $0.00 | Restarted API, POS, and Bookie Obiski managed workflows and reviewed logs. | All three are running; image-retention scheduler started and completed its first scan. Bookie Obiski was registered as an artifact. |

## Task register

| ID | Restoration task | State | Evidence target |
|---|---|---|---|
| R-00 | Protect pre-restoration state and initialize evidence counters | Complete | Tag, branch, ledger |
| R-01 | Restore POS Manual and Daily Menu reachability | Complete | Routes, navigation, source, assets, focused checks |
| R-02 | Restore Malice end to end | Complete | UI, API, contracts, schema source, tests |
| R-03 | Restore Kosila end to end | Complete | UI, API, contracts, schema source, tests |
| R-04 | Restore Public Restaurant Page | Complete | UI, images, public visits, tests |
| R-05 | Restore voucher-delivery and Stripe safeguards | Complete | Retry, alerts, monitoring, tests |
| R-06 | Reconcile OpenAPI and generated clients | Complete | Contract diff, codegen, type checks |
| R-07 | Reconcile schema sources and historical migrations | Complete | Collision-safe migration record; no blind replay |
| R-08 | Run integrated validation and prepare final report | Complete | Checks, screenshots, final evidence report |
