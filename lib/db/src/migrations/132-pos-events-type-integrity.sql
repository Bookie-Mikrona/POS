-- Drizzle enum na text stolpcu ni PostgreSQL omejitev. Migracija uskladi
-- manjkajočo ali odstopajočo zgodovinsko omejitev vrste dogodka.

DO $$
DECLARE
  invalid_types integer;
BEGIN
  SELECT count(*) INTO invalid_types
  FROM pos_events
  WHERE type NOT IN ('festival', 'wedding', 'catering', 'celebration', 'other');

  IF invalid_types > 0 THEN
    RAISE EXCEPTION
      'Najdenih je % dogodkov z neznano vrsto. Pred migracijo jih je treba ročno uskladiti.',
      invalid_types;
  END IF;
END $$;

DO $$
DECLARE
  existing_definition text;
  expected_definition constant text :=
    'CHECK ((type = ANY (ARRAY[''festival''::text, ''wedding''::text, ''catering''::text, ''celebration''::text, ''other''::text])))';
BEGIN
  SELECT pg_get_constraintdef(oid)
  INTO existing_definition
  FROM pg_constraint
  WHERE conrelid = 'pos_events'::regclass
    AND conname = 'pos_events_type_check';

  IF existing_definition IS DISTINCT FROM expected_definition THEN
    IF existing_definition IS NOT NULL THEN
      ALTER TABLE pos_events DROP CONSTRAINT pos_events_type_check;
    END IF;
    ALTER TABLE pos_events
      ADD CONSTRAINT pos_events_type_check
      CHECK (type IN ('festival', 'wedding', 'catering', 'celebration', 'other'))
      NOT VALID;
  END IF;
END $$;

ALTER TABLE pos_events VALIDATE CONSTRAINT pos_events_type_check;