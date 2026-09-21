-- test-bootstrap: audit
CREATE TABLE IF NOT EXISTS pos_credit_note_allocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  source_document_id uuid NOT NULL REFERENCES purchase_source_documents(id) ON DELETE RESTRICT,
  invoice_line_id uuid REFERENCES invoice_lines(id) ON DELETE RESTRICT,
  prejemnica_postavka_id integer NOT NULL REFERENCES prejemnice_postavke(id) ON DELETE RESTRICT,
  embalazni_promet_id integer NOT NULL REFERENCES embalazni_prometi(id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'confirmed',
  reversed_allocation_id uuid,
  operation_key uuid NOT NULL,
  actor_snapshot text,
  created_at timestamptz NOT NULL DEFAULT now(),
  quantity_snapshot numeric(12,4) NOT NULL,
  deposit_snapshot numeric(14,2) NOT NULL DEFAULT 0,
  net_snapshot numeric(14,2) NOT NULL DEFAULT 0,
  gross_snapshot numeric(14,2) NOT NULL DEFAULT 0,
  CONSTRAINT pos_credit_note_allocations_status_check CHECK (status IN ('confirmed','reversed')),
  CONSTRAINT pos_credit_note_allocations_quantity_nonzero CHECK (quantity_snapshot <> 0),
  CONSTRAINT pos_credit_note_allocations_status_sign_check CHECK ((status='confirmed' AND quantity_snapshot > 0 AND reversed_allocation_id IS NULL) OR (status='reversed' AND quantity_snapshot < 0 AND reversed_allocation_id IS NOT NULL)),
  CONSTRAINT pos_credit_note_allocations_value_nonnegative CHECK (deposit_snapshot >= 0 AND net_snapshot >= 0 AND gross_snapshot >= 0),
  CONSTRAINT pos_credit_note_allocations_reversed_fk FOREIGN KEY (reversed_allocation_id) REFERENCES pos_credit_note_allocations(id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX IF NOT EXISTS pos_credit_note_allocations_operation_key_unique ON pos_credit_note_allocations(company_id, operation_key);
CREATE INDEX IF NOT EXISTS pos_credit_note_allocations_source_idx ON pos_credit_note_allocations(company_id, source_document_id, status);
CREATE INDEX IF NOT EXISTS pos_credit_note_allocations_return_idx ON pos_credit_note_allocations(company_id, embalazni_promet_id, status);
CREATE UNIQUE INDEX IF NOT EXISTS pos_credit_note_allocations_reversal_unique ON pos_credit_note_allocations(reversed_allocation_id) WHERE reversed_allocation_id IS NOT NULL;
DO $$ BEGIN
  ALTER TABLE pos_credit_note_allocations ADD CONSTRAINT pos_credit_note_allocations_status_sign_check CHECK ((status='confirmed' AND quantity_snapshot > 0 AND reversed_allocation_id IS NULL) OR (status='reversed' AND quantity_snapshot < 0 AND reversed_allocation_id IS NOT NULL));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;