-- test-bootstrap: integrity
-- Stornirana temeljnica ostane v revizijski sledi, vendar ne blokira novega
-- osnutka za isto obdobje. Zamenjava indeksa je atomska in ponovljiva.
BEGIN;
DROP INDEX IF EXISTS idx_journal_entries_amortizacija_unique;
CREATE UNIQUE INDEX idx_journal_entries_amortizacija_unique
  ON journal_entries (company_id, reference)
  WHERE source_type = 'amortizacija' AND status IN ('draft', 'posted');
COMMIT;
