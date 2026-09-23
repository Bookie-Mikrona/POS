# Selective Restoration Evidence Ledger

## Baseline counters

- Recovery start (UTC): `2026-09-23T11:09:01Z`
- Recovery start (Europe/Ljubljana): `2026-09-23T13:09:01+02:00`
- Elapsed recovery time: `00:07:40`
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

## Task register

| ID | Restoration task | State | Evidence target |
|---|---|---|---|
| R-00 | Protect pre-restoration state and initialize evidence counters | Complete | Tag, branch, ledger |
| R-01 | Restore POS Manual and Daily Menu reachability | Complete | Routes, navigation, source, assets, focused checks |
| R-02 | Restore Malice end to end | Complete | UI, API, contracts, schema source, tests |
| R-03 | Restore Kosila end to end | Not started | UI, API, contracts, schema source, tests |
| R-04 | Restore Public Restaurant Page | Not started | UI, images, public visits, tests |
| R-05 | Restore voucher-delivery and Stripe safeguards | Not started | Retry, alerts, monitoring, tests |
| R-06 | Reconcile OpenAPI and generated clients | Not started | Contract diff, codegen, type checks |
| R-07 | Reconcile schema sources and historical migrations | Not started | Collision-safe migration record; no blind replay |
| R-08 | Run integrated validation and prepare final report | Not started | Checks, screenshots, final evidence report |
