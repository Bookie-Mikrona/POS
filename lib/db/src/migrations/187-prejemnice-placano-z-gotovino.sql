-- test-bootstrap: schema
-- Varen, enkratni prehod na eksplicitno evidentiranje gotovinskega plačila.
ALTER TABLE prejemnice
  ADD COLUMN IF NOT EXISTS placano_z_gotovino boolean NOT NULL DEFAULT false;

-- Backfill samo nedvoumnih starih vrednosti: gotovin* ali samostojna beseda cash.
UPDATE prejemnice
   SET placano_z_gotovino = true
 WHERE lower(trim(coalesce(placilni_nacin, ''))) ~ '(^|[^[:alpha:]])gotovin'
    OR lower(trim(coalesce(placilni_nacin, ''))) ~ '(^|[^[:alnum:]])cash([^[:alnum:]]|$)';