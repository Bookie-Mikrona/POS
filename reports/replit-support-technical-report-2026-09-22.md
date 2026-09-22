# Technical Incident Report

## Loss of previously completed POS functionality after Git history transfer

**Project:** Bookie POS Gostinstvo  
**Report date:** 22 September 2026  
**Purpose:** Evidence for Replit Support billing review, service-credit request, and recovery assistance

## 1. Executive summary

A source-tree comparison confirmed that multiple previously completed POS feature groups disappeared after a Git history transfer/merge sequence. This is not limited to one page. The losses include frontend pages, route registrations, navigation entries, backend endpoints, OpenAPI contracts, generated API clients, database schema sources, forward-only migrations, tests, validation scripts, and documentation.

The complete pre-regression tree is still preserved:

- **Recovery branch:** `recovery/before-c65-rollback-20260922`
- **Verified pre-regression tree:** `c65df01b620eb5283e60996ee2fb3a05514c2a80`
- **Current audited HEAD:** `46593d57cbf67981336a01ee5851f7e5a494a015`

The current branch also contains legitimate newer work. A full reset or blind branch replacement would therefore destroy valid changes. Recovery must be selective.

## 2. User impact

The regression removed or made inaccessible operational features that had already been implemented:

- Management of meal groups and group prices
- Daily meal and lunch offer management
- Meal/lunch ordering flows
- Public restaurant profile management
- In-app POS manual
- Parts of voucher-delivery and Stripe monitoring safeguards
- Related API contracts and automated verification

The issue also creates data and deployment risk because database tables remain present while their schema source files and migrations are absent from the current source tree.

## 3. Confirmed missing feature groups

### 3.1 Malice

High-confidence accidental loss with no identified replacement:

- `artifacts/pos/src/pages/Malice.tsx`
- `artifacts/pos/src/components/MalicaOrderFlow.tsx`
- `artifacts/pos/src/components/PartnerMaliceView.tsx`
- Malice helper modules and tests
- `/malice` route and navigation entries
- `artifacts/api-server/src/routes/pos/malice.ts`
- Supporting business-rule modules
- Malice OpenAPI paths and generated client operations
- Database schema sources for Malice and Malice contracts

The historical Malice page contained:

- Daily offers
- Meal articles
- Meal groups
- Current group prices
- Scheduling a new group price from a selected effective date
- Automatic synchronization of article prices with group prices
- Partner-specific group prices
- Beneficiaries and contracts

The deleted backend route exposed approximately 20 Malice operations, including bootstrap data, articles, group prices, offers, publishing/closing, beneficiaries, partner pricing, and contracts.

### 3.2 Kosila / daily lunch

High-confidence accidental loss with no equivalent replacement:

- `artifacts/pos/src/pages/Kosila.tsx`
- `artifacts/pos/src/components/DailyLunchOrderFlow.tsx`
- Daily lunch helper and test
- `/kosila` route and navigation entry
- `artifacts/api-server/src/routes/pos/daily-lunch.ts`
- Daily lunch OpenAPI paths and generated client operations
- `lib/db/src/schema/pos/daily-lunch.ts`

The lost backend flow included:

- List/create/update daily lunch offers
- Publish and close offers
- Quote a daily lunch
- Add a daily lunch to an order

### 3.3 Dnevni meni

The source page still exists at current HEAD, but its application route and navigation entry disappeared. The page is therefore orphaned and unreachable.

This surviving page is not a replacement for the separate Kosila daily-offer and quotation flow.

### 3.4 Public restaurant page

Confirmed missing:

- `artifacts/pos/src/pages/JavnaStran.tsx`
- Public-page preview tests
- Logo-upload tests
- Public profile staging-image hook and tests
- Public preview visual test
- `/javna-stran` route and navigation entries
- Server-side public image retention and image-variant modules
- Public visit tracking route and integration test

The surviving QR menu administration is not equivalent to the deleted public restaurant profile page.

### 3.5 In-app POS manual

Confirmed missing:

- `artifacts/pos/src/manual/PrirocnikPage.tsx`
- `artifacts/pos/src/manual/PrirocnikZajemPage.tsx`
- `artifacts/pos/src/manual/data/chapters.ts`
- `/prirocnik` route and navigation entry
- POS manual version 9.0 PDF/source archive
- Screen-guide source
- 20 POS guide screenshots

### 3.6 Voucher-delivery and Stripe safeguards

Confirmed deleted or rolled-back support code includes:

- Failed paid-voucher delivery alert in the POS shell
- Retry-delivery client integration
- Public Stripe webhook integration test
- Stripe client and monitoring modules/tests
- Stripe connection alert module
- Public payment-review migration
- Voucher delivery retry and alert migrations

This does **not** establish that all Stripe functionality is missing. It establishes that specific monitoring, retry, alerting, and verification safeguards present in the preserved tree are absent now.

### 3.7 Statistics and automated safeguards

Confirmed deleted tests or validation modules include:

- Daily lunch statistics integration test
- Statistics date-boundary test
- POS Stats page test
- Malice KDS/course tests
- Order package test
- Malice claim/order tests
- Object storage test
- Public profile image tests
- Database isolation and advisory-lock tests
- Bank-statement parsing test
- Import configuration test
- POS release validation scripts and their tests

Test deletion is not by itself proof that every related production feature is missing. It does prove loss of regression protection and release verification.

## 4. Database and migration findings

### 4.1 Deleted schema sources

- `lib/db/src/schema/pos/malice.ts`
- `lib/db/src/schema/pos/malica-contracts.ts`
- `lib/db/src/schema/pos/daily-lunch.ts`

### 4.2 Deleted migration sources

- `198-pos-malice-core.sql`
- `199-malica-sale-idempotency.sql`
- `200-malica-sale-line-link.sql`
- `201-malica-course-line-link.sql`
- `202-malica-sale-snapshots.sql`
- `203-malica-sale-link-fks.sql`
- `204-malica-one-published-offer.sql`
- `205-malica-partner-price-versioning.sql`
- `206-malica-contracts-beneficiaries.sql`
- `207-malica-extra-course-snapshots.sql`
- `208-malica-contract-sale-fields.sql`
- `209-malica-immutable-facts.sql`
- `210-malica-allocation-claims-vat.sql`
- `211-malica-summary-invoice-batches.sql`
- `212-malica-package-cancellation.sql`
- `213-daily-lunch.sql`
- `214-daily-lunch-snapshot-date-index.sql`
- `215-public-reservations-vouchers.sql`
- `216-voucher-delivery-retry.sql`
- `217-voucher-delivery-alerts.sql`
- `218-public-stripe-payment-reviews.sql`
- `219-stripe-connection-alert.sql`

### 4.3 Live-schema inconsistency

Development-database inspection confirmed that Malice tables still exist, including:

- `malica_groups`
- `malica_group_prices`
- `malica_article_assignments`
- `malica_daily_offers`
- `malica_daily_main_items`
- `malica_daily_included_courses`
- `malica_partner_group_prices`
- `malica_contracts`
- `malica_beneficiaries`
- `malica_sale_snapshots`
- `malica_allocations`

This shows that database state survived while the corresponding application/schema/migration source was lost.

### 4.4 Recovery risk

The deleted migrations are forward-only migration sources. They must not be replayed blindly against a database where their effects may already exist.

There is also a migration-number collision:

- Deleted historical migration: `199-malica-sale-idempotency.sql`
- Current migration: `199-company-pos-plans.sql`

Recovery requires reconciliation of migration bookkeeping and live schema before restoring migration files or publishing schema changes.

## 5. Quantified source-tree comparison

Comparison scope:

- `artifacts/pos/src`
- `artifacts/api-server/src`
- `lib/api-spec`
- `lib/api-client-react/src`
- `lib/api-zod/src`
- `lib/db/src`
- `docs`
- `scripts`

Results:

- **384 changed files**
- **93,534 inserted lines**
- **91,571 deleted lines**
- **114 deleted paths** relative to the preserved pre-regression tree
- **22 deleted POS frontend source/test paths**
- **35 deleted API server source/test paths**
- **3 deleted database schema files**
- **22 deleted migration files**
- **27 deleted documentation files**
- **4 deleted scripts**

Important qualification: the 384 changed files and line totals include legitimate newer development. They must not be treated as a count of lost files or restored wholesale.

## 6. Git-history findings

The affected files are present in the preserved pre-regression tree and absent from current HEAD.

The reachable current history does not provide normal path-level deletion commits for the major affected feature groups. The repository graph instead shows a transfer/rollback-style merge lineage. A branch explicitly preserving the pre-regression state exists.

No later replacement was identified for:

- Malice
- Kosila
- Public restaurant page
- In-app manual

The evidence is consistent with a tree-level rollback or incomplete history transfer rather than a series of intentional feature deletions.

## 7. Why recovery creates additional billable work

Safe recovery requires more than copying deleted files:

1. Reconcile restored pages with current navigation and newer UI changes.
2. Restore backend routes without overwriting later API work.
3. Restore OpenAPI operations and regenerate clients/types.
4. Reconcile historical schemas with current source.
5. Resolve migration numbering and migration-bookkeeping conflicts.
6. Verify live database constraints before any migration action.
7. Restore tests and adapt them to current contracts.
8. Run focused integration and release validation.

A branch reset or broad cherry-pick would risk losing valid work completed after the preserved state.

## 8. Requested support resolution

The project owner requests that Replit:

1. Review the project history and Agent/compute charges associated with:
   - the original implementation,
   - the Git history transfer/merge operation,
   - the forensic audit,
   - and the required selective recovery.
2. Apply an appropriate service credit covering the reasonable Agent usage required to restore previously completed functionality.
3. Advise whether Replit can assist with or supervise selective recovery while preserving current valid work.
4. Identify any additional project IDs, checkpoints, usage exports, or logs required for the billing investigation.

The project owner paused broad recovery work pending this billing review.

## 9. Recommended recovery method

If recovery proceeds:

- Use the preserved recovery branch as a source reference.
- Restore by feature group, not by resetting the main branch.
- Start with Malice, Kosila, and the orphaned Dnevni meni route.
- Restore OpenAPI and generated clients together.
- Compare live database structure before restoring migration sources.
- Do not replay migrations automatically.
- Validate each recovered feature against current code and data.

## 10. Evidence commands

Representative read-only commands used for the audit:

```text
git diff --name-status c65df01b..HEAD -- <audited paths>
git diff --shortstat c65df01b..HEAD -- <audited paths>
git log --all -- <affected path>
git ls-tree -r --name-only <tree>
```

A read-only database metadata query was also used to confirm the continued existence of Malice tables and columns.
