-- Dogodkovni zalogovni gibi smejo postati trajni samo skupaj z zaključenim
-- prenosom. En sam DO stavek drži oba ACCESS EXCLUSIVE zaklepa od preflighta
-- do namestitve triggerja, tudi če izvajalnik migracije ne odpre transakcije.

DO $migration$
DECLARE
  invalid_draft_transfers integer;
BEGIN
  LOCK TABLE zaloga_gibi, pos_stock_transfers IN ACCESS EXCLUSIVE MODE;

  SELECT count(*)
  INTO invalid_draft_transfers
  FROM pos_stock_transfers pst
  WHERE pst.status = 'draft'
    AND EXISTS (
      SELECT 1
      FROM zaloga_gibi zg
      WHERE zg.event_transfer_id = pst.id
    );

  IF invalid_draft_transfers > 0 THEN
    RAISE EXCEPTION
      'Najdenih je % nedokončanih prenosov z zalogovnimi gibi. Potrebna je ročna uskladitev brez tihega zaključevanja, brisanja ali popravljanja.',
      invalid_draft_transfers;
  END IF;

  EXECUTE $function$
    CREATE OR REPLACE FUNCTION enforce_no_committed_draft_transfer_movements()
    RETURNS trigger
    LANGUAGE plpgsql
    AS $body$
    BEGIN
      -- Deferred trigger lahko nosi starejšo različico NEW, če je bil isti gib
      -- pozneje v transakciji spremenjen ali izbrisan.
      IF EXISTS (
           SELECT 1
           FROM zaloga_gibi zg
           JOIN pos_stock_transfers pst ON pst.id = zg.event_transfer_id
           WHERE zg.id = NEW.id
             AND zg.event_transfer_id = NEW.event_transfer_id
             AND pst.status = 'draft'
         ) THEN
        RAISE EXCEPTION USING
          ERRCODE = '23514',
          CONSTRAINT = 'zaloga_gibi_no_committed_draft_transfer',
          MESSAGE = 'Nedokončan prenos ne sme trajno vplivati na zalogo.';
      END IF;

      RETURN NEW;
    END;
    $body$
  $function$;

  EXECUTE
    'DROP TRIGGER IF EXISTS zaloga_gibi_no_committed_draft_transfer ON zaloga_gibi';
  EXECUTE $trigger$
    CREATE CONSTRAINT TRIGGER zaloga_gibi_no_committed_draft_transfer
    AFTER INSERT OR UPDATE OF event_transfer_id ON zaloga_gibi
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW
    WHEN (NEW.event_transfer_id IS NOT NULL)
    EXECUTE FUNCTION enforce_no_committed_draft_transfer_movements()
  $trigger$;
END
$migration$;