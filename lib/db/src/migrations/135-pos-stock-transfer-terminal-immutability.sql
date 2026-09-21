-- Terminalna glava prenosa je nespremenljiva; vrstice je dovoljeno spreminjati
-- samo, dokler je nadrejeni prenos osnutek. Migracija ne spreminja podatkov.

CREATE OR REPLACE FUNCTION prevent_terminal_stock_transfer_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.status IN ('completed', 'cancelled')
     AND NEW IS DISTINCT FROM OLD THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      CONSTRAINT = 'pos_stock_transfers_terminal_immutable',
      MESSAGE = 'Zaključenega ali preklicanega prenosa zaloge ni mogoče spreminjati.';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS pos_stock_transfer_terminal_update_guard ON pos_stock_transfers;
CREATE TRIGGER pos_stock_transfer_terminal_update_guard
BEFORE UPDATE ON pos_stock_transfers
FOR EACH ROW
EXECUTE FUNCTION prevent_terminal_stock_transfer_update();

CREATE OR REPLACE FUNCTION prevent_terminal_stock_transfer_line_change()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  parent_status text;
BEGIN
  -- Pri UPDATE preveri staro in novo glavo. Urejanje po ID zagotovi enak vrstni
  -- red zaklepanja tudi pri sočasnih premikih med dvema osnutkoma.
  FOR parent_status IN
    SELECT status
    FROM pos_stock_transfers
    WHERE id = ANY (
      CASE
        WHEN TG_OP = 'INSERT' THEN ARRAY[NEW.transfer_id]
        WHEN TG_OP = 'DELETE' THEN ARRAY[OLD.transfer_id]
        ELSE ARRAY[OLD.transfer_id, NEW.transfer_id]
      END
    )
    ORDER BY id
    FOR UPDATE
  LOOP
    -- Pri kaskadnem izbrisu glave nadrejena vrstica ni več vidna; FK določa,
    -- da neposredna sprememba obstoječe vrstice vedno ima nadrejen prenos.
    IF parent_status IN ('completed', 'cancelled') THEN
      RAISE EXCEPTION USING
        ERRCODE = '23514',
        CONSTRAINT = 'pos_stock_transfer_lines_terminal_immutable',
        MESSAGE = 'Vrstic zaključenega ali preklicanega prenosa zaloge ni mogoče spreminjati.';
    END IF;
  END LOOP;

  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

DROP TRIGGER IF EXISTS pos_stock_transfer_line_terminal_guard ON pos_stock_transfer_lines;
CREATE TRIGGER pos_stock_transfer_line_terminal_guard
BEFORE INSERT OR UPDATE OR DELETE ON pos_stock_transfer_lines
FOR EACH ROW
EXECUTE FUNCTION prevent_terminal_stock_transfer_line_change();