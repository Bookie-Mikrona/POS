-- test-bootstrap: schema
-- Append-only partner ledger settlement/reopen evidence; does not alter financial postings.
CREATE TABLE IF NOT EXISTS partner_settlement_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  partner_id uuid NOT NULL REFERENCES counterparties(id) ON DELETE RESTRICT,
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
  source_line_id uuid NOT NULL REFERENCES journal_entry_lines(id) ON DELETE RESTRICT,
  target_line_id uuid REFERENCES journal_entry_lines(id) ON DELETE RESTRICT,
  event_type text NOT NULL CHECK (event_type IN ('close', 'reopen')),
  amount numeric(18,2) NOT NULL CHECK (amount > 0),
  effective_date date NOT NULL,
  close_event_id uuid REFERENCES partner_settlement_events(id) ON DELETE RESTRICT,
  external_closing_id text,
  idempotency_key text NOT NULL,
  reason text,
  actor_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT partner_settlement_events_reopen_parent_ck
    CHECK (
      (event_type = 'close' AND target_line_id IS NOT NULL AND close_event_id IS NULL AND external_closing_id IS NULL)
      OR (event_type = 'reopen' AND ((close_event_id IS NOT NULL AND external_closing_id IS NULL)
        OR (close_event_id IS NULL AND external_closing_id IS NOT NULL)))
    )
);
CREATE INDEX IF NOT EXISTS partner_settlement_events_line_idx
  ON partner_settlement_events(company_id, source_line_id);
CREATE INDEX IF NOT EXISTS partner_settlement_events_target_idx
  ON partner_settlement_events(company_id, target_line_id);
CREATE INDEX IF NOT EXISTS partner_settlement_events_external_close_idx
  ON partner_settlement_events(company_id, external_closing_id);
CREATE UNIQUE INDEX IF NOT EXISTS partner_settlement_events_idempotency_uq
  ON partner_settlement_events(company_id, idempotency_key);

CREATE OR REPLACE FUNCTION enforce_partner_settlement_event() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  source_company uuid;
  source_partner uuid;
  source_account uuid;
  source_side text;
  source_status text;
  target_company uuid;
  target_partner uuid;
  target_account uuid;
  target_side text;
  target_status text;
BEGIN
  SELECT e.company_id, l.partner_id, l.account_id,
    CASE WHEN l.amount < 0 THEN CASE WHEN l.side::text = 'debit' THEN 'credit' ELSE 'debit' END ELSE l.side::text END,
    e.status::text
    INTO source_company, source_partner, source_account, source_side, source_status
    FROM journal_entry_lines l JOIN journal_entries e ON e.id = l.entry_id
    WHERE l.id = NEW.source_line_id;
  IF source_company IS NULL OR source_company <> NEW.company_id
     OR source_partner <> NEW.partner_id OR source_account <> NEW.account_id
     OR source_status NOT IN ('posted', 'reversed') THEN
    RAISE EXCEPTION 'Settlement source must be a posted same-company partner/account GL line';
  END IF;
  IF NEW.target_line_id IS NOT NULL THEN
    SELECT e.company_id, l.partner_id, l.account_id,
      CASE WHEN l.amount < 0 THEN CASE WHEN l.side::text = 'debit' THEN 'credit' ELSE 'debit' END ELSE l.side::text END,
      e.status::text
      INTO target_company, target_partner, target_account, target_side, target_status
      FROM journal_entry_lines l JOIN journal_entries e ON e.id = l.entry_id
      WHERE l.id = NEW.target_line_id;
    IF target_company IS NULL OR target_company <> NEW.company_id
       OR target_partner <> NEW.partner_id OR target_account <> NEW.account_id
       OR target_status NOT IN ('posted', 'reversed') THEN
      RAISE EXCEPTION 'Settlement target must be a posted same-company partner/account GL line';
    END IF;
  END IF;
  IF NEW.event_type = 'close' AND (source_side = target_side OR NEW.target_line_id IS NULL OR NEW.close_event_id IS NOT NULL) THEN
    RAISE EXCEPTION 'Close events require opposite-side GL lines and no parent event';
  END IF;
  IF NEW.event_type = 'reopen' THEN
    IF NEW.close_event_id IS NOT NULL THEN
      IF NOT EXISTS (
        SELECT 1 FROM partner_settlement_events c
        WHERE c.id = NEW.close_event_id AND c.company_id = NEW.company_id
          AND c.event_type = 'close' AND c.source_line_id = NEW.source_line_id
          AND c.target_line_id IS NOT DISTINCT FROM NEW.target_line_id AND c.partner_id = NEW.partner_id
          AND c.account_id = NEW.account_id
      ) THEN
        RAISE EXCEPTION 'Reopen events must reference the exact original close event';
      END IF;
    ELSIF NEW.external_closing_id IS NULL THEN
      RAISE EXCEPTION 'Reopen events must reference a source closing';
    END IF;
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION reject_partner_settlement_event_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Partner settlement audit events are append-only';
END $$;

DROP TRIGGER IF EXISTS partner_settlement_event_integrity_trg ON partner_settlement_events;
CREATE TRIGGER partner_settlement_event_integrity_trg
  BEFORE INSERT ON partner_settlement_events
  FOR EACH ROW EXECUTE FUNCTION enforce_partner_settlement_event();
DROP TRIGGER IF EXISTS partner_settlement_event_append_only_trg ON partner_settlement_events;
CREATE TRIGGER partner_settlement_event_append_only_trg
  BEFORE UPDATE OR DELETE ON partner_settlement_events
  FOR EACH ROW EXECUTE FUNCTION reject_partner_settlement_event_mutation();