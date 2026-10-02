-- test-bootstrap: schema
-- Immutable provenance for Bookie Old native GL lines and their original ZAPIRANJE edges.
CREATE TABLE IF NOT EXISTS bookie_old_native_ledger_evidence (
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  native_line_id uuid NOT NULL REFERENCES journal_entry_lines(id) ON DELETE RESTRICT,
  source_line_id text NOT NULL,
  dur_date date,
  original_document_number text,
  original_gl_metadata jsonb NOT NULL,
  original_closings jsonb NOT NULL,
  source_digest text NOT NULL,
  imported_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (company_id, native_line_id),
  CONSTRAINT bookie_old_native_ledger_source_native_unique
    UNIQUE (company_id, source_line_id, native_line_id)
);

CREATE INDEX IF NOT EXISTS bookie_old_native_ledger_source_idx
  ON bookie_old_native_ledger_evidence (company_id, source_line_id);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='bookie_old_native_ledger_evidence'
      AND column_name='received_date'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='bookie_old_native_ledger_evidence'
      AND column_name='dur_date'
  ) THEN
    ALTER TABLE bookie_old_native_ledger_evidence RENAME COLUMN received_date TO dur_date;
  END IF;
END
$$;