-- test-bootstrap: schema
-- Keep this a single autocommit statement, like the retention index migration.
-- Equality on company_id plus a backward time scan serves recent history.
CREATE INDEX CONCURRENTLY IF NOT EXISTS report_exports_company_history_idx
  ON report_exports (company_id, exported_at);
