-- test-bootstrap: schema
-- Add one server-owned origin; retain every previously accepted source type.
-- Declared in the Drizzle schema as well, so Publish manages the schema diff.
BEGIN;
SET LOCAL lock_timeout = '3s';
ALTER TABLE invoices DROP CONSTRAINT IF EXISTS invoices_source_type_check;
ALTER TABLE invoices ADD CONSTRAINT invoices_source_type_check
  CHECK (source_type IN ('manual', 'pos-sync', 'pos-contract-summary', 'bookie-old', 'ai-document-fx', 'ai-document-gross-expense'));
COMMIT;