-- test-bootstrap: schema
-- One CONCURRENTLY statement per file: runners execute each file in autocommit.
-- Do not wrap in BEGIN or combine with another statement in a pool.query call.
-- Supports WHERE exported_at < cutoff ORDER BY exported_at, id LIMIT 100.
CREATE INDEX CONCURRENTLY IF NOT EXISTS report_exports_retention_idx
  ON report_exports (exported_at, id);
