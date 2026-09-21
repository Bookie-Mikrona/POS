-- Dogodek, njegova lastniška enota in vse povezane enote morajo pripadati
-- istemu podjetju tudi pri neposrednem SQL zapisu.

ALTER TABLE pos_events ADD COLUMN IF NOT EXISTS company_id uuid;
ALTER TABLE pos_event_units ADD COLUMN IF NOT EXISTS company_id uuid;

UPDATE pos_events event
SET company_id = owner.company_id
FROM enote owner
WHERE owner.id = event.enota_id
  AND event.company_id IS DISTINCT FROM owner.company_id;

UPDATE pos_event_units link
SET company_id = event.company_id
FROM pos_events event
WHERE event.id = link.event_id
  AND link.company_id IS DISTINCT FROM event.company_id;

-- Neskladne zgodovinske povezave zahtevajo ročno odločitev; migracija jih ne
-- sme tiho izbrisati ali premakniti v drugo podjetje.
DO $$
DECLARE
  invalid_links integer;
BEGIN
  SELECT count(*) INTO invalid_links
  FROM pos_event_units link
  JOIN pos_events event ON event.id = link.event_id
  JOIN enote linked_unit ON linked_unit.id = link.enota_id
  WHERE event.company_id IS DISTINCT FROM linked_unit.company_id;

  IF invalid_links > 0 THEN
    RAISE EXCEPTION
      'Najdenih je % povezav dogodkov z enotami drugega podjetja. Pred migracijo jih je treba ročno uskladiti.',
      invalid_links;
  END IF;
END $$;

ALTER TABLE pos_events ALTER COLUMN company_id SET NOT NULL;
ALTER TABLE pos_event_units ALTER COLUMN company_id SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pos_events_company_id_fkey') THEN
    ALTER TABLE pos_events
      ADD CONSTRAINT pos_events_company_id_fkey
      FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE
      NOT VALID;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pos_events_id_company_unique') THEN
    ALTER TABLE pos_events
      ADD CONSTRAINT pos_events_id_company_unique UNIQUE (id, company_id);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pos_events_unit_company_fk') THEN
    ALTER TABLE pos_events
      ADD CONSTRAINT pos_events_unit_company_fk
      FOREIGN KEY (enota_id, company_id)
      REFERENCES enote(id, company_id)
      ON DELETE CASCADE
      NOT VALID;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pos_event_units_event_company_fk') THEN
    ALTER TABLE pos_event_units
      ADD CONSTRAINT pos_event_units_event_company_fk
      FOREIGN KEY (event_id, company_id)
      REFERENCES pos_events(id, company_id)
      ON DELETE CASCADE
      NOT VALID;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pos_event_units_unit_company_fk') THEN
    ALTER TABLE pos_event_units
      ADD CONSTRAINT pos_event_units_unit_company_fk
      FOREIGN KEY (enota_id, company_id)
      REFERENCES enote(id, company_id)
      ON DELETE CASCADE
      NOT VALID;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'pos_event_units'::regclass
      AND conname = 'pos_event_units_pkey'
      AND pg_get_constraintdef(oid) NOT LIKE '%company_id%'
  ) THEN
    ALTER TABLE pos_event_units DROP CONSTRAINT pos_event_units_pkey;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'pos_event_units'::regclass
      AND conname = 'pos_event_units_pkey'
  ) THEN
    ALTER TABLE pos_event_units
      ADD CONSTRAINT pos_event_units_pkey PRIMARY KEY (company_id, event_id, enota_id);
  END IF;
END $$;

ALTER TABLE pos_events VALIDATE CONSTRAINT pos_events_company_id_fkey;
ALTER TABLE pos_events VALIDATE CONSTRAINT pos_events_unit_company_fk;
ALTER TABLE pos_event_units VALIDATE CONSTRAINT pos_event_units_event_company_fk;
ALTER TABLE pos_event_units VALIDATE CONSTRAINT pos_event_units_unit_company_fk;