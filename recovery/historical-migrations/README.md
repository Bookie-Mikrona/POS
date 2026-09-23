# Historical migration archive

This directory contains exact SQL source snapshots from the verified
`c65df01b620eb5283e60996ee2fb3a05514c2a80` tree. Every snapshot intentionally
uses the non-executable `.sql.txt` suffix. The archive is evidence and source
material for a future reviewed forward migration; it is not an active
migration directory and must never be fed to a SQL runner.

## Active lineage

The active migration directory retains the current post-transfer lineage:

- `198-pos-returnable-packaging-writeoff.sql`
- `199-company-pos-plans.sql`

The preserved tree also contained `198-pos-malice-core.sql` and
`199-malica-sale-idempotency.sql`, which collide with those active numeric
prefixes. Historical `200`–`214` filled a gap that is intentionally not
reintroduced into active discovery. Historical `215`–`219` were restored as
feature source during recovery, but have been removed from
`lib/db/src/migrations` so the test runner and any future discovery cannot
execute or reject them accidentally.

## Why this archive is inert

The existing development database may already contain some or all of these
objects, and the historical scripts do not provide an applied-migration ledger
or a safe replay contract. Replaying them can duplicate DDL, indexes,
constraints, or data backfills. The active test migration manifest remains
explicit and continues with the single reviewed forward migration
`220-restored-pos-public-features.sql`. That migration is additive and
idempotent; it preserves the active `198` packaging and `199` company-plan
lineage while reconciling the archived feature objects.

Do not rename these files back to `.sql`, add them to the test manifest, run
the post-merge migration helper against a populated database, or apply them to
the development/publish database as a recovery shortcut. A future migration
must first compare `information_schema` and constraints on a disposable
database and use a transactionally tracked, collision-free forward number.

The read-only checker `scripts/validate-recovery-migrations.mjs` verifies the
active numeric lineage, SHA-256 equality of every archived snapshot against
the preserved `c65df01b` blobs, the absence of executable restored `200`–`219`
SQL, and the complete archive inventory.

The checker permits the pre-existing legacy prefixes `003`, `009`, `010`,
`011`, `012`, and `029`, which have duplicate zero-padded/base-schema
filenames and are outside this recovery's feature lineage. It fails on every
duplicate prefix at or after the reviewed post-bootstrap lineage and on any
newly restored `200`–`219` executable SQL.
