-- Completed prenos mora imeti za vsako vrstico točno en pravilen out/in par.
-- EXCEPT ALL primerja multiseta in zato zazna tudi podvojene gibe.

CREATE OR REPLACE FUNCTION pos_stock_transfer_movements_complete(checked_transfer_id integer)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  WITH expected AS (
    SELECT
      stl.source_article_id AS artikel_id,
      CASE pst.direction
        WHEN 'outbound' THEN 'event_transfer_out'
        ELSE 'event_return_out'
      END::text AS tip,
      -stl.quantity AS kolicina,
      stl.unit_cost AS cena_kos,
      round(-stl.quantity * stl.unit_cost, 4) AS vrednost
    FROM pos_stock_transfer_lines stl
    JOIN pos_stock_transfers pst ON pst.id = stl.transfer_id
    WHERE stl.transfer_id = checked_transfer_id

    UNION ALL

    SELECT
      stl.target_article_id,
      CASE pst.direction
        WHEN 'outbound' THEN 'event_transfer_in'
        ELSE 'event_return_in'
      END::text,
      stl.quantity,
      stl.unit_cost,
      round(stl.quantity * stl.unit_cost, 4)
    FROM pos_stock_transfer_lines stl
    JOIN pos_stock_transfers pst ON pst.id = stl.transfer_id
    WHERE stl.transfer_id = checked_transfer_id
  ),
  actual AS (
    SELECT artikel_id, tip, kolicina, cena_kos, vrednost
    FROM zaloga_gibi
    WHERE event_transfer_id = checked_transfer_id
      AND tip IN (
        'event_transfer_out', 'event_transfer_in',
        'event_return_out', 'event_return_in'
      )
  ),
  differences AS (
    (SELECT * FROM expected EXCEPT ALL SELECT * FROM actual)
    UNION ALL
    (SELECT * FROM actual EXCEPT ALL SELECT * FROM expected)
  )
  SELECT NOT EXISTS (SELECT 1 FROM differences);
$$;

DO $$
DECLARE
  invalid_completed_transfers integer;
BEGIN
  SELECT count(*)
  INTO invalid_completed_transfers
  FROM pos_stock_transfers
  WHERE status = 'completed'
    AND NOT pos_stock_transfer_movements_complete(id);

  IF invalid_completed_transfers > 0 THEN
    RAISE EXCEPTION
      'Najdenih je % zaključenih prenosov z manjkajočimi, podvojenimi ali neusklajenimi zalogovnimi gibi. Potrebna je ročna uskladitev.',
      invalid_completed_transfers;
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

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS pos_stock_transfer_movement_completion_guard ON pos_stock_transfers;
CREATE TRIGGER pos_stock_transfer_movement_completion_guard
BEFORE INSERT OR UPDATE OF status ON pos_stock_transfers
FOR EACH ROW
EXECUTE FUNCTION enforce_stock_transfer_movement_completeness();