-- Migration 018: Atomska zaščita pred podvojenimi amortizacijskimi temeljnicami
--
-- Parcialni unikatni indeks preprečuje race condition pri sočasnih POST /knjizenje
-- klicih za isto obdobje. Velja samo za sourceType = 'amortizacija'.
-- Ostale temeljnice (manual, bank_import, document, ai_suggestion) niso omejene.

CREATE UNIQUE INDEX IF NOT EXISTS idx_journal_entries_amortizacija_unique
  ON journal_entries (company_id, reference)
  WHERE source_type = 'amortizacija';
