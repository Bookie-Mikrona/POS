# Selective Technical Restoration Plan

## Objective

Restore the functionality removed by the Git history transfer while preserving
all valid work added after the preserved source tree.

## Non-negotiable safety rules

1. Never reset the current branch to the preserved tree.
2. Never merge or cherry-pick the entire recovery branch.
3. Restore one feature group at a time.
4. Inspect current equivalents before restoring historical files.
5. Reconcile OpenAPI source and generated clients together.
6. Do not replay historical database migrations against an already-populated
   schema.
7. Resolve the migration number `199` collision before any migration workflow.
8. Validate each restored group before starting the next dependent group.
9. Record every material action and outcome in the evidence ledger.
10. Use official Replit Account usage records for dollar amounts; do not infer
    actual charges from elapsed time.

## Source hierarchy

1. Current branch for all unaffected and newer behavior.
2. `recovery/before-c65-rollback-20260922` for the latest preserved feature
   implementation.
3. Tree `c65df01b620eb5283e60996ee2fb3a05514c2a80` for the independently verified
   pre-regression snapshot.
4. Current build output and published frontend only as secondary forensic
   references.

## Restoration sequence

### Phase 1 — POS Manual and Daily Menu

- Restore manual source components and chapter data.
- Restore the manual route and authorized navigation entries.
- Restore Daily Menu route and authorized navigation entries without replacing
  the surviving current page.
- Reconcile the current manual PDF with preserved version 9.0.
- Run POS type checking and focused route checks.

### Phase 2 — Malice

- Restore database schema source without executing historical migrations.
- Restore business rules, API routes, frontend helpers, pages, and order flow.
- Restore OpenAPI operations and regenerate clients.
- Adapt historical tests to current contracts.
- Validate group pricing, daily offers, ordering, contracts, and snapshots.

### Phase 3 — Kosila

- Restore daily-lunch schema source, API route, page, order flow, and statistics.
- Restore OpenAPI operations and regenerate clients.
- Validate offer lifecycle, quotation, ordering, and historical snapshots.

### Phase 4 — Public Restaurant Page

- Restore profile administration and previews.
- Restore staged-image and image-retention logic.
- Restore public visit tracking and visual tests.
- Validate object-storage path safety before enabling writes.

### Phase 5 — Voucher and Stripe safeguards

- Restore failed-delivery alerts and retry integration.
- Restore Stripe client monitoring and connection alerts.
- Restore payment-review and webhook verification tests.

### Phase 6 — Migration and release reconciliation

- Preserve historical migration files as evidence.
- Compare schema source against the actual development schema.
- Rename or re-index colliding migration identifiers without executing already
  applied DDL.
- Confirm the publish schema diff is non-destructive.
- Restore release validation scripts and focused regression coverage.

### Phase 7 — Integrated verification and reporting

- Run package type checks and focused tests.
- Restart changed managed workflows once.
- Review workflow and browser logs.
- Capture representative restored pages.
- Reconcile elapsed time and official dollar usage.
- Produce the detailed final restoration report.
