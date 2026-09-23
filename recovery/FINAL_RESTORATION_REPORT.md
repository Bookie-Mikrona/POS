# Selective Technical Restoration — Final Evidence Report

## Executive result

The selective restoration completed on the protected branch
`recovery/selective-20260923`. The pre-restoration state remains protected by
tag `recovery-start-20260923-110901Z`. No reset, force push, broad merge, blind
historical migration replay, or production database access occurred.

- Start: `2026-09-23T11:09:01Z`
- Final evidence timestamp: `2026-09-23T12:08:13Z`
- Elapsed restoration time: `00:59:12`
- Verified Replit charge: `$0.00`
- Unverified charge: pending the official Replit Account usage export
- Final architecture review: PASS; no critical or high restoration blockers

The `$0.00` figure means no charge could be independently verified from the
workspace. It is not an estimate of actual Replit usage. The official usage
export remains the only acceptable source for the credit claim amount.

## Restored scope

1. POS Manual and Daily Menu routing, navigation, source, assets, and PDF access.
2. Malice schema source, pricing rules, offers, contracts, beneficiary and
   allocation flows, ordering, KDS behavior, API contracts, UI, and tests.
3. Kosila offers, authoritative quotes, order mutation, snapshots, statistics,
   UI, API contracts, and tests.
4. Public Restaurant Page administration, public venue artifact, images,
   reservations, vouchers, visits, Stripe checkout/webhook safeguards, and
   profile-image retention.
5. Paid-voucher retry and alert handling, Stripe sync monitoring, payment review,
   and connection alerts.
6. OpenAPI/code generation reconciliation without removing newer operations.
7. Release manifest and object-storage regression gates.
8. Collision-safe database reconciliation.

## Database and migration evidence

Twenty-three historical SQL files from preserved tree `c65df01b...` are stored
under `recovery/historical-migrations/` with inert `.sql.txt` suffixes. Their
SHA-256 values are checked against the preserved Git blobs.

Active migrations keep the current 198/199 lineage and add only
`220-restored-pos-public-features.sql`. Migration 220 represents the durable
effects of archived migrations 198–219, including partial-upgrade column
reconciliation, deterministic allocation-date backfill, foreign keys, checks,
indexes, controlled obsolete-index replacement, and immutable-fact triggers.
It was executed against the development schema inside a transaction and rolled
back. No persistent database mutation and no production access occurred.

## Validation evidence

- API, POS, Bookie Obiski, and shared-library TypeScript checks passed.
- Recovery migration inventory: 207 active SQL files and 23 inert snapshots.
- Archive hash checks: 23/23 passed.
- API release group: 22 suites, 146 tests passed.
- Focused Malice/Kosila/migration/startup checks passed.
- Earlier phase evidence: Malice API 25/25 and POS 24/24; Public Page API 27/27
  and POS 6/6; voucher/Stripe safeguards 8 focused tests.
- POS manual package workflow: 13 tests passed.
- Existing broader release workflow also completed successfully.
- `git diff --check` passed throughout.
- Independent architecture review passed after three blocker-driven corrections.

The root workspace typecheck still reports pre-existing errors in the unrelated
`artifacts/promo-video` package. Targeted checks for every restored package pass.
The unrelated Viva Bridge Expo workflow retains its known Metro watcher failure.

## Runtime evidence

API, POS, and Bookie Obiski managed workflows were restarted once after the
final code batch and are running. API logs confirm the public-image retention
scheduler started and completed its first scan. Bookie Obiski is registered at
`/bookie-obiski/`; its generic root route intentionally displays the application
404 page until a valid public venue slug is supplied. A screenshot is saved as
`recovery/bookie-obiski-restored.jpg`.

## Git evidence

Restoration commits, oldest to newest:

- `407863da` — POS Manual and Daily Menu access
- `cf8bdca4` — Malice feature stack
- `3b95a4ed` — Kosila feature stack
- `00c8235c` — Public Restaurant Page stack
- `f13fa68f` — voucher and Stripe safeguards
- `34521ea5` — migration archive and release checks
- `1934baf8` — forward migration and release gates
- `6d7a526c` — complete schema reconciliation
- `05617439` — partial-upgrade allocation-date backfill

## Credit-claim reconciliation

Attach this report, `RESTORATION_LEDGER.md`, the protected checkpoint/tag, and
the official Account usage export to the existing support case. Reconcile the
export to the exact interval above. Do not substitute elapsed time, token counts,
or an estimated rate for the official dollar charge.