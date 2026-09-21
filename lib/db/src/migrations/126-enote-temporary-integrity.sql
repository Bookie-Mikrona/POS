-- Začasne enote: najprej varno popravi stare zapise, nato uveljavi DB pravila.

-- Samo-povezave in matične enote drugih podjetij niso varne za samodejno ohranitev.
UPDATE enote child
SET parent_unit_id = NULL
WHERE parent_unit_id = id
   OR (
     parent_unit_id IS NOT NULL
     AND NOT EXISTS (
       SELECT 1
       FROM enote parent
       WHERE parent.id = child.parent_unit_id
         AND parent.company_id = child.company_id
     )
   );

-- Če obstaja veljavna dogodkovna povezava, iz nje obnovi matično enoto in
-- obdobje, ki pokrije vse povezane dogodke.
WITH event_coverage AS (
  SELECT
    child.id AS child_id,
    MIN(event.enota_id) AS parent_unit_id,
    MIN(event.starts_at) AS active_from,
    MAX(event.ends_at) AS active_to
  FROM enote child
  JOIN pos_event_units link ON link.enota_id = child.id
  JOIN pos_events event ON event.id = link.event_id
  JOIN enote parent
    ON parent.id = event.enota_id
   AND parent.company_id = child.company_id
  WHERE child.is_temporary = true
    AND event.ends_at > event.starts_at
  GROUP BY child.id
)
UPDATE enote child
SET parent_unit_id = coverage.parent_unit_id,
    active_from = coverage.active_from,
    active_to = coverage.active_to
FROM event_coverage coverage
WHERE child.id = coverage.child_id;

-- Delnega ali obrnjenega obdobja ni mogoče varno ugibati.
UPDATE enote
SET active_from = NULL,
    active_to = NULL
WHERE (active_from IS NULL) <> (active_to IS NULL)
   OR (active_from IS NOT NULL AND active_to <= active_from);

-- Preostalih nepopolnih začasnih enot ni mogoče zanesljivo aktivirati.
-- Ohranimo samo osnovno poslovno enoto, dogodkovna polja pa počistimo.
UPDATE enote
SET is_temporary = false,
    parent_unit_id = NULL,
    active_from = NULL,
    active_to = NULL,
    temporary_location = NULL
WHERE is_temporary = true
  AND (parent_unit_id IS NULL OR active_from IS NULL OR active_to IS NULL);

-- Stara enostolpčna FK ne zagotavlja istega podjetja in ON DELETE SET NULL bi
-- po novem ustvaril neveljavno začasno enoto.
DO $$
DECLARE
  constraint_name text;
BEGIN
  FOR constraint_name IN
    SELECT constraint_row.conname
    FROM pg_constraint constraint_row
    WHERE constraint_row.conrelid = 'enote'::regclass
      AND constraint_row.contype = 'f'
      AND constraint_row.conkey = ARRAY[(
        SELECT attnum
        FROM pg_attribute
        WHERE attrelid = 'enote'::regclass
          AND attname = 'parent_unit_id'
      )]::smallint[]
  LOOP
    EXECUTE format('ALTER TABLE enote DROP CONSTRAINT %I', constraint_name);
  END LOOP;
END $$;

ALTER TABLE enote DROP CONSTRAINT IF EXISTS enote_active_range_check;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'enote_id_company_unique') THEN
    ALTER TABLE enote
      ADD CONSTRAINT enote_id_company_unique UNIQUE (id, company_id);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'enote_parent_company_fk') THEN
    ALTER TABLE enote
      ADD CONSTRAINT enote_parent_company_fk
      FOREIGN KEY (parent_unit_id, company_id)
      REFERENCES enote(id, company_id)
      ON DELETE RESTRICT
      NOT VALID;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'enote_parent_not_self_check') THEN
    ALTER TABLE enote
      ADD CONSTRAINT enote_parent_not_self_check
      CHECK (parent_unit_id IS NULL OR parent_unit_id <> id)
      NOT VALID;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'enote_active_period_check') THEN
    ALTER TABLE enote
      ADD CONSTRAINT enote_active_period_check
      CHECK (
        (active_from IS NULL AND active_to IS NULL)
        OR
        (active_from IS NOT NULL AND active_to IS NOT NULL AND active_to > active_from)
      )
      NOT VALID;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'enote_temporary_fields_check') THEN
    ALTER TABLE enote
      ADD CONSTRAINT enote_temporary_fields_check
      CHECK (
        NOT is_temporary
        OR (parent_unit_id IS NOT NULL AND active_from IS NOT NULL AND active_to IS NOT NULL)
      )
      NOT VALID;
  END IF;
END $$;

ALTER TABLE enote VALIDATE CONSTRAINT enote_parent_company_fk;
ALTER TABLE enote VALIDATE CONSTRAINT enote_parent_not_self_check;
ALTER TABLE enote VALIDATE CONSTRAINT enote_active_period_check;
ALTER TABLE enote VALIDATE CONSTRAINT enote_temporary_fields_check;