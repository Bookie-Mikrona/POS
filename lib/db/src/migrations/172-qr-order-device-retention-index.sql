-- test-bootstrap: privacy
-- QR guest history is intentionally linkable to a browser pseudonym for only
-- 30 days after the last update. This partial index keeps the daily global
-- anonymization bounded to terminal QR orders that still retain that link.
-- This migration must run as an autocommit statement: CONCURRENTLY avoids
-- blocking writes to the live POS order table while the index is built.
CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_narocila_qr_history_retention
  ON narocila (posodobljeno)
  WHERE vir = 'qr_gost'
    AND status IN ('zakljuceno', 'preklicano')
    AND qr_naprava_id IS NOT NULL;