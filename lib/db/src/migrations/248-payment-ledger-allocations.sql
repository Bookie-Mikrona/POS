-- test-bootstrap: schema
-- Additive native GL payment targets; no invoices or existing financial rows are created or rewritten.
CREATE TABLE IF NOT EXISTS payment_ledger_allocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id uuid NOT NULL REFERENCES payments(id) ON DELETE CASCADE,
  journal_line_id uuid NOT NULL REFERENCES journal_entry_lines(id) ON DELETE RESTRICT,
  allocated_amount numeric(18,2) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT payment_ledger_allocations_amount_ck CHECK (allocated_amount > 0)
);
CREATE UNIQUE INDEX IF NOT EXISTS payment_ledger_allocations_payment_line_uq
  ON payment_ledger_allocations(payment_id, journal_line_id);
CREATE INDEX IF NOT EXISTS payment_ledger_allocations_source_idx
  ON payment_ledger_allocations(journal_line_id);

CREATE OR REPLACE FUNCTION enforce_payment_ledger_allocation_scope() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  payment_company uuid;
  payment_partner uuid;
  payment_account uuid;
  payment_direction text;
  source_company uuid;
  source_partner uuid;
  source_account uuid;
  source_side text;
  source_status text;
  source_is_open_item boolean;
BEGIN
  SELECT company_id, counterparty_id, ar_ap_account_id, direction::text
    INTO payment_company, payment_partner, payment_account, payment_direction
    FROM payments WHERE id = NEW.payment_id;
  SELECT e.company_id, l.partner_id, l.account_id, e.status::text, a.is_open_item,
    CASE WHEN l.amount < 0 THEN
      CASE WHEN l.side::text = 'debit' THEN 'credit' ELSE 'debit' END
      ELSE l.side::text END
    INTO source_company, source_partner, source_account, source_status, source_is_open_item, source_side
    FROM journal_entry_lines l
    JOIN journal_entries e ON e.id = l.entry_id
    JOIN accounts a ON a.id = l.account_id
    WHERE l.id = NEW.journal_line_id;
  IF payment_company IS NULL OR source_company IS NULL
     OR payment_company <> source_company
     OR payment_partner IS DISTINCT FROM source_partner
     OR payment_account <> source_account
     OR source_status NOT IN ('posted', 'reversed')
     OR source_is_open_item IS DISTINCT FROM true
     OR (payment_direction = 'outbound' AND source_side <> 'credit')
     OR (payment_direction = 'inbound' AND source_side <> 'debit') THEN
    RAISE EXCEPTION 'GL payment allocation requires a posted same-company partner/account source on the correct side'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS payment_ledger_allocations_scope_trg ON payment_ledger_allocations;
CREATE TRIGGER payment_ledger_allocations_scope_trg
  BEFORE INSERT OR UPDATE ON payment_ledger_allocations
  FOR EACH ROW EXECUTE FUNCTION enforce_payment_ledger_allocation_scope();