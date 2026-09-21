CREATE OR REPLACE FUNCTION lock_pos_inventory_movements()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(918273);
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_lock_pos_inventory_movements ON zaloga_gibi;
CREATE TRIGGER trg_lock_pos_inventory_movements
BEFORE INSERT OR UPDATE OR DELETE ON zaloga_gibi
FOR EACH STATEMENT
EXECUTE FUNCTION lock_pos_inventory_movements();