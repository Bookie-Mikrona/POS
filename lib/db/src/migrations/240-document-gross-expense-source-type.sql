-- test-bootstrap: schema
-- Accountant-reviewed gross expenses retain their authoritative line amounts.
-- Keep earlier source types and declare the matching CHECK in Drizzle for Publish.
BEGIN;
SET LOCAL lock_timeout = '3s';
ALTER TABLE invoices DROP CONSTRAINT IF EXISTS invoices_source_type_check;
ALTER TABLE invoices ADD CONSTRAINT invoices_source_type_check
  CHECK (source_type IN ('manual', 'pos-sync', 'pos-contract-summary', 'bookie-old', 'ai-document-fx', 'ai-document-gross-expense'));
COMMIT;