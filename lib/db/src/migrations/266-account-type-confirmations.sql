-- test-bootstrap: audit
CREATE TABLE IF NOT EXISTS account_type_confirmations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id),
  account_id uuid NOT NULL REFERENCES accounts(id),
  actor_id text NOT NULL,
  confirmed_at timestamptz NOT NULL DEFAULT now(),
  code text NOT NULL,
  selected_type account_type NOT NULL,
  expected_type account_type NOT NULL,
  source text NOT NULL CHECK (source IN ('create', 'update', 'import')),
  CHECK (selected_type <> expected_type)
);
CREATE INDEX IF NOT EXISTS account_type_confirmations_lookup
  ON account_type_confirmations(company_id, account_id, confirmed_at);

CREATE OR REPLACE FUNCTION guard_account_type_confirmation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'Account type confirmations are append-only';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM accounts WHERE id = NEW.account_id AND company_id = NEW.company_id) THEN
    RAISE EXCEPTION 'Account type confirmation tenant mismatch';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS account_type_confirmation_guard ON account_type_confirmations;
CREATE TRIGGER account_type_confirmation_guard
  BEFORE INSERT OR UPDATE OR DELETE ON account_type_confirmations
  FOR EACH ROW EXECUTE FUNCTION guard_account_type_confirmation();
