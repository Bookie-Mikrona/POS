-- Dovoljenje osebja mora imeti pozitivno obdobje in mora v celoti ležati
-- znotraj obdobja povezanega dogodka.

DO $$
DECLARE
  invalid_grants integer;
BEGIN
  SELECT count(*) INTO invalid_grants
  FROM pos_event_staff_grants grant_row
  JOIN pos_events event
    ON event.id = grant_row.event_id
   AND event.company_id = grant_row.company_id
  WHERE grant_row.valid_to <= grant_row.valid_from
     OR grant_row.valid_from < event.starts_at
     OR grant_row.valid_to > event.ends_at;

  IF invalid_grants > 0 THEN
    RAISE EXCEPTION
      'Najdenih je % časovno neusklajenih dovoljenj dogodkovnega osebja. Pred migracijo jih je treba ročno uskladiti.',
      invalid_grants;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'pos_event_staff_grants'::regclass
      AND conname = 'pos_event_staff_period_order_check'
  ) THEN
    ALTER TABLE pos_event_staff_grants
      ADD CONSTRAINT pos_event_staff_period_order_check
      CHECK (valid_to > valid_from)
      NOT VALID;
  END IF;
END $$;

ALTER TABLE pos_event_staff_grants
  VALIDATE CONSTRAINT pos_event_staff_period_order_check;

CREATE OR REPLACE FUNCTION enforce_pos_event_staff_period()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  event_starts_at timestamptz;
  event_ends_at timestamptz;
BEGIN
  IF TG_TABLE_NAME = 'pos_event_staff_grants' THEN
    SELECT starts_at, ends_at
    INTO event_starts_at, event_ends_at
    FROM pos_events
    WHERE id = NEW.event_id
      AND company_id = NEW.company_id
    FOR UPDATE;

    IF NOT FOUND
       OR NEW.valid_from < event_starts_at
       OR NEW.valid_to > event_ends_at THEN
      RAISE EXCEPTION USING
        ERRCODE = '23514',
        CONSTRAINT = 'pos_event_staff_within_event_check',
        MESSAGE = 'Dovoljenje osebja mora biti v celoti znotraj obdobja dogodka.';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.starts_at IS DISTINCT FROM OLD.starts_at
     OR NEW.ends_at IS DISTINCT FROM OLD.ends_at THEN
    IF EXISTS (
      SELECT 1
      FROM pos_event_staff_grants grant_row
      WHERE grant_row.event_id = NEW.id
        AND grant_row.company_id = NEW.company_id
        AND (
          grant_row.valid_from < NEW.starts_at
          OR grant_row.valid_to > NEW.ends_at
        )
    ) THEN
      RAISE EXCEPTION USING
        ERRCODE = '23514',
        CONSTRAINT = 'pos_event_staff_within_event_check',
        MESSAGE = 'Spremenjeno obdobje dogodka ne pokrije vseh dovoljenj osebja.';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS pos_event_staff_period_guard ON pos_event_staff_grants;
CREATE CONSTRAINT TRIGGER pos_event_staff_period_guard
AFTER INSERT OR UPDATE ON pos_event_staff_grants
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION enforce_pos_event_staff_period();

DROP TRIGGER IF EXISTS pos_event_period_staff_guard ON pos_events;
CREATE CONSTRAINT TRIGGER pos_event_period_staff_guard
AFTER UPDATE ON pos_events
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION enforce_pos_event_staff_period();