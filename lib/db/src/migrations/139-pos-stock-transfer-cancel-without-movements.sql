-- Preklican prenos ne sme imeti nobenega že ustvarjenega zalogovnega učinka.

DO $$
DECLARE
  invalid_cancelled_transfers integer;
BEGIN
  SELECT count(*)
  INTO invalid_cancelled_transfers
  FROM pos_stock_transfers pst
  WHERE pst.status = 'cancelled'
    AND EXISTS (
      SELECT 1
      FROM zaloga_gibi zg
      WHERE zg.event_transfer_id = pst.id
    );

  IF invalid_cancelled_transfers > 0 THEN
    RAISE EXCEPTION
      'Najdenih je % preklicanih prenosov z zalogovnimi gibi. Potrebna je ročna uskladitev brez tihega brisanja.',
      invalid_cancelled_transfers;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION enforce_stock_transfer_movement_completeness()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status = 'completed'
     AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM NEW.status)
     AND NOT pos_stock_transfer_movements_complete(NEW.id) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      CONSTRAINT = 'pos_stock_transfer_movement_completeness',
      MESSAGE = 'Prenosa ni mogoče zaključiti, dokler nima vsaka vrstica točnega izhodnega in vhodnega zalogovnega giba.';
  END IF;

  IF NEW.status = 'cancelled'
     AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM NEW.status)
     AND EXISTS (
       SELECT 1
       FROM zaloga_gibi zg
       WHERE zg.event_transfer_id = NEW.id
     ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      CONSTRAINT = 'pos_stock_transfer_cancelled_without_movements',
      MESSAGE = 'Prenosa z že ustvarjenimi zalogovnimi gibi ni mogoče preklicati.';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS pos_stock_transfer_movement_completion_guard ON pos_stock_transfers;
CREATE TRIGGER pos_stock_transfer_movement_completion_guard
BEFORE INSERT OR UPDATE OF status ON pos_stock_transfers
FOR EACH ROW
EXECUTE FUNCTION enforce_stock_transfer_movement_completeness();