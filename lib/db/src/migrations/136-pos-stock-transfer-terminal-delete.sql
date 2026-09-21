-- Terminalnega prenosa ni dovoljeno izbrisati. Osnutek ostane izbrisljiv.

DROP TRIGGER IF EXISTS pos_stock_transfer_terminal_update_guard ON pos_stock_transfers;
DROP TRIGGER IF EXISTS pos_stock_transfer_terminal_mutation_guard ON pos_stock_transfers;

CREATE OR REPLACE FUNCTION prevent_terminal_stock_transfer_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.status IN ('completed', 'cancelled')
     AND (TG_OP = 'DELETE' OR NEW IS DISTINCT FROM OLD) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      CONSTRAINT = 'pos_stock_transfers_terminal_immutable',
      MESSAGE = 'Zaključenega ali preklicanega prenosa zaloge ni mogoče spreminjati ali izbrisati.';
  END IF;

  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

CREATE TRIGGER pos_stock_transfer_terminal_mutation_guard
BEFORE UPDATE OR DELETE ON pos_stock_transfers
FOR EACH ROW
EXECUTE FUNCTION prevent_terminal_stock_transfer_update();