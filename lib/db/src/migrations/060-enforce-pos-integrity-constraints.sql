-- 060-enforce-pos-integrity-constraints.sql
--
-- Uskladi ročno upravljane integritetne omejitve z veljavno aplikacijsko
-- logiko. Obe spremembi sta varni za ponovno izvajanje.
--
-- e_racun_status:
--   NULL, pripravljen, poslan, poslano, poslano_email, napaka
-- `poslan` ostaja podprt za že obstoječe/stare zapise, čeprav ga trenutni
-- tokovi ne nastavljajo več.

ALTER TABLE racuni
  DROP CONSTRAINT IF EXISTS racuni_e_racun_status_check;

ALTER TABLE racuni
  ADD CONSTRAINT racuni_e_racun_status_check
  CHECK (e_racun_status = ANY (ARRAY[
    'pripravljen'::text,
    'poslan'::text,
    'poslano'::text,
    'poslano_email'::text,
    'napaka'::text
  ]));

-- Razlog odklepa je revizijski podatek. API vhod že trim-a; omejitev ščiti
-- tudi neposredne zapise v podatkovno bazo.
ALTER TABLE z_porocilo_odklepi
  ALTER COLUMN razlog SET NOT NULL;

ALTER TABLE z_porocilo_odklepi
  DROP CONSTRAINT IF EXISTS z_porocilo_odklepi_razlog_check;

ALTER TABLE z_porocilo_odklepi
  ADD CONSTRAINT z_porocilo_odklepi_razlog_check
  CHECK (length(trim(razlog)) > 0);