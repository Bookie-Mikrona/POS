DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'enote_active_range_check'
      AND NOT convalidated
  ) THEN
    ALTER TABLE enote VALIDATE CONSTRAINT enote_active_range_check;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'enote_hospitality_profile_check'
      AND NOT convalidated
  ) THEN
    ALTER TABLE enote VALIDATE CONSTRAINT enote_hospitality_profile_check;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'enote_service_mode_check'
      AND NOT convalidated
  ) THEN
    ALTER TABLE enote VALIDATE CONSTRAINT enote_service_mode_check;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'invoices_source_type_check'
      AND NOT convalidated
  ) THEN
    ALTER TABLE invoices VALIDATE CONSTRAINT invoices_source_type_check;
  END IF;
END $$;