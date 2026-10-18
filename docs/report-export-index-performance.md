# Report export retention and history indexes

## Access paths

- `report_exports_retention_idx (exported_at, id)` matches the global cleanup
  predicate and its stable oldest-first order. The selection stops after 100
  entries; the existing primary key locates those 100 rows for deletion.
- `report_exports_company_history_idx (company_id, exported_at)` matches the
  tenant equality and retention cutoff. PostgreSQL scans it backward for the
  newest 200 metadata rows, without sorting. PDF data is deliberately not in
  either index or the history projection.

There are no changes to retention periods, tenant authorization, API responses,
batch limits, or accounting records.

## Safe migration

The two single-statement SQL migrations are registered in both the classified
test migration manifest and the existing post-merge runner:

- `267-report-export-retention-index.sql`
- `268-report-export-company-history-index.sql`

Both use `CREATE INDEX CONCURRENTLY IF NOT EXISTS` and must run separately in
autocommit, not inside a transaction or a combined multi-statement `pool.query`.
This follows the earlier concurrent QR retention-index migration. The matching
indexes are also declared in the Drizzle schema. No `push --force` is needed.
Concurrent builds permit ordinary inserts/updates/deletes, but still consume
I/O and may wait for older transactions.

After migration, verify both indexes are ready and valid:

```sql
SELECT c.relname, i.indisready, i.indisvalid, pg_get_indexdef(i.indexrelid)
FROM pg_index i
JOIN pg_class c ON c.oid = i.indexrelid
WHERE i.indrelid = 'public.report_exports'::regclass
  AND c.relname IN (
    'report_exports_retention_idx',
    'report_exports_company_history_idx'
  );
```

Both rows must have `indisready = true` and `indisvalid = true`. A cancelled or
failed concurrent build can leave an invalid index; `IF NOT EXISTS` alone does
not repair it. If that happens, inspect the failure, remove **only the invalid
new index** using a separately executed `DROP INDEX CONCURRENTLY`, and replay
its migration. Do not drop the primary key or an already valid index.

## Reproducible million-row check

```sh
pnpm --filter @workspace/api-server exec tsx scripts/verify-report-export-indexes.ts
```

The script creates a session-local temporary shadow of `report_exports`, using
the real table's columns and a primary key. It generates 1,000,000 rows across
100 tenants and 1,000 days, with timestamp ties and approximately 50% expired
rows. PDF contents are small placeholders; neither measured query reads them.
It runs `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)` before and after applying the
real migration files, replays both migrations to check idempotency, and asserts:

- Before: both operations use a sequential scan.
- After: cleanup uses the retention index and selects exactly 100 rows; company
  history uses a backward company-history index scan and returns 200 rows.
- Neither indexed plan contains a sequential scan or sort.
- Empty cleanup, absent tenant, and no recent history also use bounded index
  access. When no tenant has recent rows, either time index is acceptable.
- All benchmark DELETEs are rolled back and all million rows remain afterward.
  The temporary table is removed when finished; no business rows are modified.

Temporary-table indexes build non-concurrently in PostgreSQL. The normal test
migration runner separately verifies the real concurrent DDL in development.
Planner settings are not forced. Temporary tables do not support parallel
scans; these timings demonstrate access-path improvements, not a production SLA.

### Measured development run, 2026-10-18

| Operation | Before | After | Buffer accesses before → after |
| --- | ---: | ---: | ---: |
| Actual cleanup DELETE, batch 100 | 392.354 ms | 0.549 ms | 40,500 → 601 |
| Company history, newest 200 | 166.247 ms | 0.406 ms | 40,000 → 203 |
| Cleanup with no expired rows | — | 0.027 ms | 3 |
| Absent company's history | — | 0.023 ms | 3 |
| No recent history | — | 0.013 ms | 3 |

Buffer accesses are root-plan local hit + read blocks (8 KiB blocks); repeated
accesses count more than once. The cleanup's **selection** goes from scanning
all 1,000,000 rows plus top-N sort to an index-only scan returning 100 entries,
with 101 buffer accesses. The full DELETE additionally performs 100 primary-key
lookups and updates heap pages. The history index scan returns just 200 entries,
instead of filtering 995,000 rows and sorting 5,000 eligible rows.
