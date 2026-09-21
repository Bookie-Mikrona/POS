-- Drizzle enum na text stolpcu ni PostgreSQL omejitev. Ta migracija uskladi
-- okolja, kjer je zgodovinska omejitev iz migracije 122 manjkala ali odstopala.

DO $$
DECLARE
  invalid_statuses integer;
BEGIN
  SELECT count(*) INTO invalid_statuses
  FROM pos_events
  WHERE status NOT IN ('planned', 'active', 'closed', 'cancelled');

  IF invalid_statuses > 0 THEN
    RAISE EXCEPTION
      'Najdenih je % dogodkov z neznanim statusom. Pred migracijo jih je treba ročno uskladiti.',
      invalid_statuses;
  END IF;
END $$;

DO $$
DECLARE
  existing_definition text;
  expected_definition constant text :=
    'CHECK ((status = ANY (ARRAY[''planned''::text, ''active''::text, ''closed''::text, ''cancelled''::text])))';
BEGIN
  SELECT pg_get_constraintdef(oid)
  INTO existing_definition
  FROM pg_constraint
  WHERE conrelid = 'pos_events'::regclass
    AND conname = 'pos_events_status_check';

  IF existing_definition IS DISTINCT FROM expected_definition THEN
    IF existing_definition IS NOT NULL THEN
      ALTER TABLE pos_events DROP CONSTRAINT pos_events_status_check;
    END IF;
    ALTER TABLE pos_events
      ADD CONSTRAINT pos_events_status_check
      CHECK (status IN ('planned', 'active', 'closed', 'cancelled'))
      NOT VALID;
  END IF;
END $$;

ALTER TABLE pos_events VALIDATE CONSTRAINT pos_events_status_check;