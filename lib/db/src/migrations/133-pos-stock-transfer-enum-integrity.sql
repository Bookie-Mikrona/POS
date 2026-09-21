-- Smer in status prenosa sta text stolpca. Migracija natančno uskladi njuni
-- PostgreSQL CHECK omejitvi ter pred posegom ustavi neznane stare vrednosti.

DO $$
DECLARE
  invalid_directions integer;
  invalid_statuses integer;
BEGIN
  SELECT count(*) INTO invalid_directions
  FROM pos_stock_transfers
  WHERE direction NOT IN ('outbound', 'return');

  SELECT count(*) INTO invalid_statuses
  FROM pos_stock_transfers
  WHERE status NOT IN ('draft', 'completed', 'cancelled');

  IF invalid_directions + invalid_statuses > 0 THEN
    RAISE EXCEPTION
      'Prenosi zaloge vsebujejo neznane vrednosti (smer %, status %). Pred migracijo jih je treba ročno uskladiti.',
      invalid_directions, invalid_statuses;
  END IF;
END $$;

DO $$
DECLARE
  existing_direction_definition text;
  existing_status_definition text;
  expected_direction_definition constant text :=
    'CHECK ((direction = ANY (ARRAY[''outbound''::text, ''return''::text])))';
  expected_status_definition constant text :=
    'CHECK ((status = ANY (ARRAY[''draft''::text, ''completed''::text, ''cancelled''::text])))';
BEGIN
  SELECT pg_get_constraintdef(oid)
  INTO existing_direction_definition
  FROM pg_constraint
  WHERE conrelid = 'pos_stock_transfers'::regclass
    AND conname = 'pos_stock_transfers_direction_check';

  IF existing_direction_definition IS DISTINCT FROM expected_direction_definition THEN
    IF existing_direction_definition IS NOT NULL THEN
      ALTER TABLE pos_stock_transfers
        DROP CONSTRAINT pos_stock_transfers_direction_check;
    END IF;
    ALTER TABLE pos_stock_transfers
      ADD CONSTRAINT pos_stock_transfers_direction_check
      CHECK (direction IN ('outbound', 'return'))
      NOT VALID;
  END IF;

  SELECT pg_get_constraintdef(oid)
  INTO existing_status_definition
  FROM pg_constraint
  WHERE conrelid = 'pos_stock_transfers'::regclass
    AND conname = 'pos_stock_transfers_status_check';

  IF existing_status_definition IS DISTINCT FROM expected_status_definition THEN
    IF existing_status_definition IS NOT NULL THEN
      ALTER TABLE pos_stock_transfers
        DROP CONSTRAINT pos_stock_transfers_status_check;
    END IF;
    ALTER TABLE pos_stock_transfers
      ADD CONSTRAINT pos_stock_transfers_status_check
      CHECK (status IN ('draft', 'completed', 'cancelled'))
      NOT VALID;
  END IF;
END $$;

ALTER TABLE pos_stock_transfers
  VALIDATE CONSTRAINT pos_stock_transfers_direction_check;
ALTER TABLE pos_stock_transfers
  VALIDATE CONSTRAINT pos_stock_transfers_status_check;