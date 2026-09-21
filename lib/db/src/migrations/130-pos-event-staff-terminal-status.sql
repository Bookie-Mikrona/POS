-- Preklican ali zaključen dogodek ne sme imeti aktivnih dovoljenj osebja.
-- Stara dovoljenja varno revociramo; zgodovine ne brišemo.

UPDATE pos_event_staff_grants grant_row
SET revoked = true
FROM pos_events event
WHERE event.id = grant_row.event_id
  AND event.company_id = grant_row.company_id
  AND event.status IN ('closed', 'cancelled')
  AND grant_row.revoked = false;

CREATE OR REPLACE FUNCTION enforce_pos_event_staff_terminal_status()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  event_status text;
BEGIN
  IF TG_TABLE_NAME = 'pos_event_staff_grants' THEN
    SELECT status
    INTO event_status
    FROM pos_events
    WHERE id = NEW.event_id
      AND company_id = NEW.company_id
    FOR UPDATE;

    IF NOT NEW.revoked
       AND event_status IN ('closed', 'cancelled') THEN
      RAISE EXCEPTION USING
        ERRCODE = '23514',
        CONSTRAINT = 'pos_event_staff_active_status_check',
        MESSAGE = 'Preklican ali zaključen dogodek ne sme imeti aktivnega dovoljenja osebja.';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.status IN ('closed', 'cancelled')
     AND EXISTS (
       SELECT 1
       FROM pos_event_staff_grants grant_row
       WHERE grant_row.event_id = NEW.id
         AND grant_row.company_id = NEW.company_id
         AND grant_row.revoked = false
     ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      CONSTRAINT = 'pos_event_staff_active_status_check',
      MESSAGE = 'Terminalni status dogodka zahteva revokacijo vseh dovoljenj osebja.';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS pos_event_staff_terminal_status_guard ON pos_event_staff_grants;
CREATE CONSTRAINT TRIGGER pos_event_staff_terminal_status_guard
AFTER INSERT OR UPDATE ON pos_event_staff_grants
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION enforce_pos_event_staff_terminal_status();

DROP TRIGGER IF EXISTS pos_event_terminal_staff_guard ON pos_events;
CREATE CONSTRAINT TRIGGER pos_event_terminal_staff_guard
AFTER INSERT OR UPDATE ON pos_events
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION enforce_pos_event_staff_terminal_status();