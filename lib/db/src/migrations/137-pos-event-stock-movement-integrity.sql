-- Dogodkovni zalogovni gibi dobijo namensko povezavo na prenos. Pred backfillom
-- migracija ustavi osirotele, konfliktne ali dvoumne stare zapise.

ALTER TABLE zaloga_gibi
  ADD COLUMN IF NOT EXISTS event_transfer_id integer;

DO $$
DECLARE
  conflicting_links integer;
  orphaned_movements integer;
  ambiguous_movements integer;
BEGIN
  SELECT count(*) INTO conflicting_links
  FROM zaloga_gibi
  WHERE tip IN ('event_transfer_out', 'event_transfer_in', 'event_return_out', 'event_return_in')
    AND (
      referenca_id IS NULL
      OR (event_transfer_id IS NOT NULL AND event_transfer_id IS DISTINCT FROM referenca_id)
    );

  WITH movement_matches AS (
    SELECT zg.id, count(stl.id) AS match_count
    FROM zaloga_gibi zg
    LEFT JOIN pos_stock_transfers pst
      ON pst.id = COALESCE(zg.event_transfer_id, zg.referenca_id)
     AND pst.status = 'completed'
     AND pst.direction = CASE
       WHEN zg.tip IN ('event_transfer_out', 'event_transfer_in') THEN 'outbound'
       ELSE 'return'
     END
    LEFT JOIN pos_stock_transfer_lines stl
      ON stl.transfer_id = pst.id
     AND (
       (zg.tip IN ('event_transfer_out', 'event_return_out') AND stl.source_article_id = zg.artikel_id)
       OR
       (zg.tip IN ('event_transfer_in', 'event_return_in') AND stl.target_article_id = zg.artikel_id)
     )
    WHERE zg.tip IN ('event_transfer_out', 'event_transfer_in', 'event_return_out', 'event_return_in')
    GROUP BY zg.id
  )
  SELECT
    count(*) FILTER (WHERE match_count = 0),
    count(*) FILTER (WHERE match_count > 1)
  INTO orphaned_movements, ambiguous_movements
  FROM movement_matches;

  IF conflicting_links + orphaned_movements + ambiguous_movements > 0 THEN
    RAISE EXCEPTION
      'Dogodkovni zalogovni gibi niso enolično povezani (konfliktni %, osiroteli %, dvoumni %). Potrebna je ročna uskladitev.',
      conflicting_links, orphaned_movements, ambiguous_movements;
  END IF;
END $$;

UPDATE zaloga_gibi
SET event_transfer_id = referenca_id
WHERE tip IN ('event_transfer_out', 'event_transfer_in', 'event_return_out', 'event_return_in')
  AND event_transfer_id IS NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'zaloga_gibi'::regclass
      AND conname = 'zaloga_gibi_event_transfer_link_check'
  ) THEN
    ALTER TABLE zaloga_gibi
      ADD CONSTRAINT zaloga_gibi_event_transfer_link_check
      CHECK (
        (
          tip IN ('event_transfer_out', 'event_transfer_in', 'event_return_out', 'event_return_in')
          AND event_transfer_id IS NOT NULL
          AND referenca_id = event_transfer_id
        )
        OR
        (
          tip NOT IN ('event_transfer_out', 'event_transfer_in', 'event_return_out', 'event_return_in')
          AND event_transfer_id IS NULL
        )
      )
      NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'zaloga_gibi'::regclass
      AND conname = 'zaloga_gibi_event_transfer_fk'
  ) THEN
    ALTER TABLE zaloga_gibi
      ADD CONSTRAINT zaloga_gibi_event_transfer_fk
      FOREIGN KEY (event_transfer_id)
      REFERENCES pos_stock_transfers(id)
      ON DELETE RESTRICT
      NOT VALID;
  END IF;
END $$;

ALTER TABLE zaloga_gibi
  VALIDATE CONSTRAINT zaloga_gibi_event_transfer_link_check;
ALTER TABLE zaloga_gibi
  VALIDATE CONSTRAINT zaloga_gibi_event_transfer_fk;

CREATE OR REPLACE FUNCTION enforce_event_stock_movement_integrity()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  parent_record record;
  matching_lines integer;
BEGIN
  FOR parent_record IN
    SELECT id, status
    FROM pos_stock_transfers
    WHERE id = ANY (
      CASE
        WHEN TG_OP = 'INSERT' THEN ARRAY[NEW.event_transfer_id]
        WHEN TG_OP = 'DELETE' THEN ARRAY[OLD.event_transfer_id]
        ELSE ARRAY[OLD.event_transfer_id, NEW.event_transfer_id]
      END
    )
    ORDER BY id
    FOR UPDATE
  LOOP
    IF parent_record.status IN ('completed', 'cancelled') THEN
      RAISE EXCEPTION USING
        ERRCODE = '23514',
        CONSTRAINT = 'zaloga_gibi_terminal_event_transfer_immutable',
        MESSAGE = 'Zalogovnega giba zaključenega ali preklicanega dogodkovnega prenosa ni mogoče spreminjati.';
    END IF;
  END LOOP;

  IF TG_OP <> 'DELETE'
     AND NEW.tip IN ('event_transfer_out', 'event_transfer_in', 'event_return_out', 'event_return_in') THEN
    SELECT count(*)
    INTO matching_lines
    FROM pos_stock_transfers pst
    JOIN pos_stock_transfer_lines stl ON stl.transfer_id = pst.id
    WHERE pst.id = NEW.event_transfer_id
      AND pst.direction = CASE
        WHEN NEW.tip IN ('event_transfer_out', 'event_transfer_in') THEN 'outbound'
        ELSE 'return'
      END
      AND (
        (NEW.tip IN ('event_transfer_out', 'event_return_out') AND stl.source_article_id = NEW.artikel_id)
        OR
        (NEW.tip IN ('event_transfer_in', 'event_return_in') AND stl.target_article_id = NEW.artikel_id)
      );

    IF matching_lines <> 1 THEN
      RAISE EXCEPTION USING
        ERRCODE = '23514',
        CONSTRAINT = 'zaloga_gibi_event_transfer_semantic_link',
        MESSAGE = 'Dogodkovni zalogovni gib se mora ujemati s točno eno vrstico in smerjo prenosa.';
    END IF;
  END IF;

  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

DROP TRIGGER IF EXISTS zaloga_gibi_event_transfer_guard ON zaloga_gibi;
CREATE TRIGGER zaloga_gibi_event_transfer_guard
BEFORE INSERT OR UPDATE OR DELETE ON zaloga_gibi
FOR EACH ROW
EXECUTE FUNCTION enforce_event_stock_movement_integrity();