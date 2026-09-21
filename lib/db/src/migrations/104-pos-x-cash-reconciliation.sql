-- X snapshot cash count and Z close reconciliation gate.
CREATE TABLE IF NOT EXISTS pos_cash_reconciliations (
  id serial PRIMARY KEY,
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  enota_id integer NOT NULL REFERENCES enote(id) ON DELETE CASCADE,
  blagajna_id integer NOT NULL REFERENCES blagajne(id) ON DELETE RESTRICT,
  poslovni_datum date NOT NULL,
  pricakovana_gotovina numeric(14,2) NOT NULL,
  presteta_gotovina numeric(14,2) NOT NULL,
  razlika numeric(14,2) NOT NULL,
  confirmed boolean NOT NULL DEFAULT false,
  override_razlog text,
  actor_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  idempotency_key text NOT NULL,
  CONSTRAINT pos_cash_reconciliation_override_reason
    CHECK (confirmed OR length(trim(COALESCE(override_razlog, ''))) > 0),
  CONSTRAINT pos_cash_reconciliation_difference
    CHECK (razlika = presteta_gotovina - pricakovana_gotovina)
);

CREATE UNIQUE INDEX IF NOT EXISTS pos_cash_reconciliations_idempotency
  ON pos_cash_reconciliations(enota_id, idempotency_key);
CREATE UNIQUE INDEX IF NOT EXISTS pos_cash_reconciliations_business_day
  ON pos_cash_reconciliations(enota_id, blagajna_id, poslovni_datum);
CREATE INDEX IF NOT EXISTS ix_pos_cash_reconciliations_register_day
  ON pos_cash_reconciliations(enota_id, blagajna_id, poslovni_datum);