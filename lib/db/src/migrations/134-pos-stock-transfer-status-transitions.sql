-- Status in completed_at sta eno stanje; completed/cancelled sta terminalna.

DO $$
DECLARE
  invalid_completion_state integer;
BEGIN
  SELECT count(*) INTO invalid_completion_state
  FROM pos_stock_transfers
  WHERE (status = 'completed' AND completed_at IS NULL)
     OR (status <> 'completed' AND completed_at IS NOT NULL);

  IF invalid_completion_state > 0 THEN
    RAISE EXCEPTION
      'Najdenih je % prenosov z neusklajenima statusom in completed_at. Pred migracijo jih je treba ročno uskladiti.',
      invalid_completion_state;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'pos_stock_transfers'::regclass
      AND conname = 'pos_stock_transfers_completion_check'
  ) THEN
    ALTER TABLE pos_stock_transfers
      ADD CONSTRAINT pos_stock_transfers_completion_check
      CHECK (
        (status = 'completed' AND completed_at IS NOT NULL)
        OR (status <> 'completed' AND completed_at IS NULL)
      )
      NOT VALID;
  END IF;
END $$;

ALTER TABLE pos_stock_transfers
  VALIDATE CONSTRAINT pos_stock_transfers_completion_check;

CREATE OR REPLACE FUNCTION enforce_pos_stock_transfer_status_transition()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.status IS DISTINCT FROM NEW.status
     AND OLD.status IN ('completed', 'cancelled') THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      CONSTRAINT = 'pos_stock_transfers_status_transition_check',
      MESSAGE = 'Zaključenega ali preklicanega prenosa zaloge ni mogoče ponovno odpreti ali spremeniti.';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS pos_stock_transfer_status_transition_guard ON pos_stock_transfers;
CREATE TRIGGER pos_stock_transfer_status_transition_guard
BEFORE UPDATE OF status ON pos_stock_transfers
FOR EACH ROW
EXECUTE FUNCTION enforce_pos_stock_transfer_status_transition();