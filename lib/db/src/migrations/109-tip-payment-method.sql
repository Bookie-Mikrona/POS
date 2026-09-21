-- Immutable payment channel for a receipt tip. Existing receipts intentionally
-- remain NULL: their source channel must not be guessed and is reported as
-- historical/unreviewed.
ALTER TABLE racuni
  ADD COLUMN IF NOT EXISTS tip_payment_method text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'racuni_tip_payment_method_check'
  ) THEN
    ALTER TABLE racuni
      ADD CONSTRAINT racuni_tip_payment_method_check
      CHECK (tip_payment_method IS NULL OR tip_payment_method IN ('cash', 'card'));
  END IF;
END $$;

-- A receipt is fiscal/audit evidence. Do not permit a later correction to
-- rewrite the channel (including converting an unreviewed legacy NULL).
CREATE OR REPLACE FUNCTION prevent_racun_tip_payment_method_change()
RETURNS trigger AS $$
BEGIN
  IF NEW.tip_payment_method IS DISTINCT FROM OLD.tip_payment_method THEN
    RAISE EXCEPTION 'tip_payment_method is immutable once a receipt is issued';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS racuni_tip_payment_method_immutable ON racuni;
CREATE TRIGGER racuni_tip_payment_method_immutable
  BEFORE UPDATE ON racuni
  FOR EACH ROW EXECUTE FUNCTION prevent_racun_tip_payment_method_change();